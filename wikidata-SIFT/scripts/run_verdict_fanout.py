#!/usr/bin/env python3
"""Run verdict fanout: evaluate Wikidata edits across multiple models via OpenRouter."""

import argparse
import inspect
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from openai import OpenAI

from sift_precheck import make_verification_question, check_ontological_consistency
from tool_executor import web_search, web_fetch, load_blocked_domains

# --- Constants ---

# Context window limits per model (for monitoring/warnings)
CONTEXT_LIMITS = {
    "nvidia/nemotron-3-nano-30b-a3b": 262_000,
    "allenai/olmo-3.1-32b-instruct": 65_000,
    "deepseek/deepseek-v3.2": 164_000,
    "anthropic/claude-4.5-haiku-20251001": 200_000,
}

MODELS = [
    "nvidia/nemotron-3-nano-30b-a3b",
    "allenai/olmo-3.1-32b-instruct",
    "deepseek/deepseek-v3.2",
    "anthropic/claude-4.5-haiku-20251001",
]

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for information. Returns titles, URLs, and snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch and read the text content of a web page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"}
                },
                "required": ["url"],
            },
        },
    },
]

MAX_TURNS = 15
VERDICT_DIR = Path("logs/wikidata-patrol-experiment/verdicts-fanout")
PROMPT_PATH = Path("config/sift_prompt_openrouter.md")
STATE_PATH = Path("logs/wikidata-patrol-experiment/fanout-state.yaml")

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["verified-high", "verified-low", "plausible",
                     "unverifiable", "suspect", "incorrect"],
        },
        "rationale": {"type": "string"},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "supports_claim": {"type": "boolean"},
                    "provenance": {"type": "string", "enum": ["verified", "reported"]},
                },
                "required": ["url", "supports_claim", "provenance"],
            },
        },
    },
    "required": ["verdict", "rationale", "sources"],
}


def model_slug(model_id):
    """Extract short name from model ID: last segment after '/'."""
    return model_id.split("/")[-1]


def load_sift_prompt():
    """Read config/sift_prompt_openrouter.md and return the text."""
    prompt_path = PROMPT_PATH
    if not prompt_path.is_absolute():
        # Try relative to script location
        script_dir = Path(__file__).resolve().parent
        candidate = script_dir.parent / PROMPT_PATH
        if candidate.exists():
            prompt_path = candidate
    with open(prompt_path) as f:
        return f.read()


def build_edit_context(edit):
    """Build the user message string for the investigation phase.

    Calls make_verification_question() and check_ontological_consistency()
    from sift_precheck. Returns a string with YAML-formatted item context,
    parsed edit, and the verification question with any ontological warnings.
    """
    verification_question = make_verification_question(edit)
    warnings = check_ontological_consistency(edit)

    # Build the context message
    parts = []

    # Include key edit metadata
    parts.append("## Edit to verify\n")
    edit_meta = {
        "rcid": edit.get("rcid"),
        "revid": edit.get("revid"),
        "title": edit.get("title"),
        "user": edit.get("user"),
        "timestamp": edit.get("timestamp"),
        "tags": edit.get("tags", []),
    }
    parts.append(yaml.safe_dump(edit_meta, default_flow_style=False, allow_unicode=True))

    # Include parsed edit if available
    parsed_edit = edit.get("parsed_edit")
    if parsed_edit:
        parts.append("\n## Parsed edit\n")
        parts.append(yaml.safe_dump(parsed_edit, default_flow_style=False, allow_unicode=True))

    # Include item context if available
    item = edit.get("item")
    if item:
        parts.append("\n## Item context\n")
        parts.append(yaml.safe_dump(item, default_flow_style=False, allow_unicode=True))

    # Include removed claim if available
    removed_claim = edit.get("removed_claim")
    if removed_claim:
        parts.append("\n## Removed claim\n")
        parts.append(yaml.safe_dump(removed_claim, default_flow_style=False, allow_unicode=True))

    # Add verification question
    parts.append("\n## Verification question\n")
    if verification_question:
        parts.append(verification_question)
    else:
        parts.append("(No verification question generated — parsed_edit may be missing.)")

    # Append ontological warnings if any
    if warnings:
        parts.append("\n\n" + "\n".join(warnings))

    return "\n".join(parts)


def dispatch_tool_call(tool_call, blocked_domains=None):
    """Dispatch a tool call to web_search or web_fetch.

    Args:
        tool_call: An OpenAI tool call object with .function.name and
            .function.arguments.
        blocked_domains: Set of blocked domain strings (optional).

    Returns:
        str: The tool result, or an error string if dispatch fails.
    """
    if blocked_domains is None:
        blocked_domains = set()

    # Parse arguments JSON
    try:
        args = json.loads(tool_call.function.arguments)
    except json.JSONDecodeError as e:
        return f"error: Failed to parse tool call arguments as JSON: {e}"

    tool_name = tool_call.function.name

    try:
        if tool_name == "web_search":
            result = web_search(args.get("query", ""), blocked_domains=blocked_domains)
            return json.dumps(result)
        elif tool_name == "web_fetch":
            result = web_fetch(args.get("url", ""), blocked_domains=blocked_domains)
            return result
        else:
            return (
                f"error: Unknown tool '{tool_name}'. "
                f"Valid tools are: web_search, web_fetch"
            )
    except Exception as e:
        return f"error: Tool execution failed: {e}"


def run_investigation_phase(client, model, messages, blocked_domains=None, cancel_event=None):
    """Run Phase A: the investigation loop.

    Sends messages to OpenRouter with tool-calling, dispatches tool calls,
    and loops until finish_reason is 'stop' or 'length', MAX_TURNS exceeded,
    or cancel_event is set.

    Args:
        client: OpenAI client configured for OpenRouter.
        model: Model ID string.
        messages: Initial messages list (system + user).
        blocked_domains: Set of blocked domains.
        cancel_event: Optional threading.Event. If set, the loop exits early
            at the next turn boundary (cooperative cancellation).

    Returns:
        tuple: (updated_messages, total_prompt_tokens, total_completion_tokens,
                response_ids, finish_status, turns)
        finish_status is one of: 'stop', 'length', 'max_turns', 'cancelled'
        turns is the number of API calls made during investigation.
    """
    if blocked_domains is None:
        blocked_domains = set()

    total_prompt_tokens = 0
    total_completion_tokens = 0
    response_ids = []
    context_limit = CONTEXT_LIMITS.get(model, 100_000)

    for turn in range(MAX_TURNS):
        # Cooperative cancellation: check cancel event between turns
        if cancel_event is not None and cancel_event.is_set():
            print(f"WARNING: {model} investigation cancelled by timeout event after {turn} turns")
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "cancelled", turn

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice="auto",
        )

        # Track usage
        usage = response.usage
        if usage:
            total_prompt_tokens += usage.prompt_tokens or 0
            total_completion_tokens += usage.completion_tokens or 0

        # Track response ID for cost fetching
        if response.id:
            response_ids.append(response.id)

        choice = response.choices[0]
        finish_reason = choice.finish_reason
        assistant_message = choice.message

        # Check context window usage
        cumulative_tokens = total_prompt_tokens + total_completion_tokens
        if cumulative_tokens > 0.8 * context_limit:
            print(
                f"WARNING: {model} at {cumulative_tokens}/{context_limit} tokens "
                f"({100 * cumulative_tokens / context_limit:.0f}% of context window)"
            )

        if finish_reason == "stop":
            # Investigation complete
            messages = messages + [{"role": "assistant", "content": assistant_message.content}]
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "stop", turn + 1

        elif finish_reason == "length":
            # Context length exceeded — log as incomplete
            print(f"WARNING: {model} hit length limit (finish_reason=length), verdict may be incomplete")
            messages = messages + [{"role": "assistant", "content": assistant_message.content}]
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "length", turn + 1

        elif finish_reason == "tool_calls":
            # Process tool calls
            tool_calls = assistant_message.tool_calls or []

            # Convert assistant message to dict for message history
            assistant_dict = {
                "role": "assistant",
                "content": assistant_message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            }
            messages = messages + [assistant_dict]

            # Dispatch each tool call and append results
            for tc in tool_calls:
                result = dispatch_tool_call(tc, blocked_domains=blocked_domains)
                tool_result_msg = {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                }
                messages = messages + [tool_result_msg]

        else:
            # Unexpected finish reason — treat as stop
            print(f"WARNING: Unexpected finish_reason '{finish_reason}' from {model}")
            messages = messages + [{"role": "assistant", "content": assistant_message.content}]
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "stop", turn + 1

    # Exceeded MAX_TURNS
    print(f"WARNING: {model} hit MAX_TURNS ({MAX_TURNS}) without completing investigation")
    return messages, total_prompt_tokens, total_completion_tokens, response_ids, "max_turns", MAX_TURNS


def run_verdict_phase(client, model, messages):
    """Run Phase B: structured verdict extraction.

    Appends a verdict-request message and calls the model with
    response_format=json_object (no tools).

    Args:
        client: OpenAI client.
        model: Model ID string.
        messages: Messages list from Phase A.

    Returns:
        tuple: (verdict_dict_or_None, prompt_tokens, completion_tokens, response_id)
    """
    verdict_request = (
        "Based on your investigation, please provide your final verdict as JSON. "
        "Use this exact schema:\n\n"
        + json.dumps(VERDICT_SCHEMA, indent=2)
        + "\n\nRespond with only valid JSON matching the schema."
    )
    messages = messages + [{"role": "user", "content": verdict_request}]

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_object"},
    )

    usage = response.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    response_id = response.id

    content = response.choices[0].message.content
    if not content:
        return None, prompt_tokens, completion_tokens, response_id

    try:
        verdict_dict = json.loads(content)
        return verdict_dict, prompt_tokens, completion_tokens, response_id
    except json.JSONDecodeError:
        print(f"WARNING: {model} returned invalid JSON in verdict phase. Raw: {content[:200]}")
        # Return raw content as a signal of failure
        return None, prompt_tokens, completion_tokens, response_id


def fetch_generation_cost(generation_id, api_key):
    """Fetch authoritative cost data from OpenRouter generation endpoint."""
    time.sleep(0.5)  # brief delay for stats to be ready
    resp = httpx.get(
        f"https://openrouter.ai/api/v1/generation?id={generation_id}",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10.0,
    )
    if resp.status_code != 200:
        return None
    data = resp.json().get("data", {})
    return {
        "prompt_tokens": data.get("native_tokens_prompt"),
        "completion_tokens": data.get("native_tokens_completion"),
        "cost_usd": data.get("total_cost"),
    }


def run_single_verdict(client, model, edit, blocked_domains, api_key, cancel_event=None):
    """Orchestrate a full verdict for one (edit, model) pair.

    Args:
        client: OpenAI client configured for OpenRouter.
        model: Model ID string.
        edit: Enriched edit dict.
        blocked_domains: Set of blocked domain strings.
        api_key: OpenRouter API key for cost fetching.
        cancel_event: Optional threading.Event for cooperative cancellation.
            Passed through to run_investigation_phase.

    Returns:
        dict: Full verdict including metadata, verdict data, and cost info.
    """
    sift_prompt = load_sift_prompt()
    edit_context = build_edit_context(edit)

    initial_messages = [
        {"role": "system", "content": sift_prompt},
        {"role": "user", "content": edit_context},
    ]

    # Phase A: investigation
    messages, inv_prompt_tokens, inv_completion_tokens, response_ids, finish_status, turns = \
        run_investigation_phase(client, model, initial_messages, blocked_domains, cancel_event=cancel_event)

    # Phase B: verdict extraction
    verdict_dict, vrd_prompt_tokens, vrd_completion_tokens, verdict_response_id = \
        run_verdict_phase(client, model, messages)

    if verdict_response_id:
        response_ids.append(verdict_response_id)

    # Fetch cost data from OpenRouter generation endpoint
    total_cost_usd = None
    total_prompt_tokens_authoritative = None
    total_completion_tokens_authoritative = None

    for gen_id in response_ids:
        cost_data = fetch_generation_cost(gen_id, api_key)
        if cost_data:
            if cost_data.get("cost_usd") is not None:
                total_cost_usd = (total_cost_usd or 0) + cost_data["cost_usd"]
            if cost_data.get("prompt_tokens") is not None:
                total_prompt_tokens_authoritative = (
                    (total_prompt_tokens_authoritative or 0) + cost_data["prompt_tokens"]
                )
            if cost_data.get("completion_tokens") is not None:
                total_completion_tokens_authoritative = (
                    (total_completion_tokens_authoritative or 0)
                    + cost_data["completion_tokens"]
                )

    # Fall back to SDK-reported tokens if generation endpoint returned nothing
    total_prompt_tokens = (
        total_prompt_tokens_authoritative
        or (inv_prompt_tokens + vrd_prompt_tokens)
    )
    total_completion_tokens = (
        total_completion_tokens_authoritative
        or (inv_completion_tokens + vrd_completion_tokens)
    )

    # Build verdict record
    parsed_edit = edit.get("parsed_edit") or {}
    diff_type = edit.get("edit_diff", {}).get("type", "unknown")

    verdict_record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "rcid": edit.get("rcid"),
        "revid": edit.get("revid"),
        "title": edit.get("title"),
        "property": parsed_edit.get("property"),
        "property_label": parsed_edit.get("property_label"),
        "value_label": parsed_edit.get("value_label"),
        "diff_type": diff_type,
        "finish_status": finish_status,
        "turns": turns,
        "prompt_tokens": total_prompt_tokens,
        "completion_tokens": total_completion_tokens,
        "cost_usd": total_cost_usd,
    }

    if verdict_dict:
        verdict_record.update({
            "verdict": verdict_dict.get("verdict"),
            "rationale": verdict_dict.get("rationale"),
            "sources": verdict_dict.get("sources", []),
        })
    else:
        verdict_record.update({
            "verdict": None,
            "rationale": None,
            "sources": [],
        })

    return verdict_record


def save_verdict(verdict, edit, model, verdict_dir=None):
    """Save verdict YAML to VERDICT_DIR.

    Filename: {date}-{qid}-{property}-{model_slug}.yaml

    Args:
        verdict: Verdict dict to save.
        edit: Original edit dict (for metadata).
        model: Model ID string.
        verdict_dir: Override verdict directory (for testing).

    Returns:
        Path: Path to the saved YAML file.
    """
    out_dir = Path(verdict_dir) if verdict_dir else VERDICT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = edit.get("title", "Q0")
    parsed_edit = edit.get("parsed_edit") or {}
    prop = parsed_edit.get("property", "P0")
    slug = model_slug(model)

    filename = f"{date_str}-{title}-{prop}-{slug}.yaml"
    out_path = out_dir / filename

    with open(out_path, "w") as f:
        yaml.safe_dump(verdict, f, default_flow_style=False, allow_unicode=True)

    return out_path


def load_checkpoint(state_path=None):
    """Load checkpoint state from YAML.

    Returns:
        set of (edit_rcid, model) tuples that have been completed.
    """
    path = state_path or STATE_PATH
    if not path.exists():
        return set()
    with open(path) as f:
        data = yaml.safe_load(f)
    if not data or "completed" not in data:
        return set()
    return {(entry["rcid"], entry["model"]) for entry in data["completed"]}


def save_checkpoint(completed, state_path=None):
    """Save checkpoint state to YAML.

    Args:
        completed: set of (edit_rcid, model) tuples.
    """
    path = state_path or STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    entries = [{"rcid": rcid, "model": model} for rcid, model in sorted(completed)]
    with open(path, "w") as f:
        yaml.safe_dump({"completed": entries}, f, default_flow_style=False)


def run_with_timeout(func, args, timeout_secs=180):
    """Run func(*args, cancel_event=cancel_event) with a wall-clock timeout.

    Creates a threading.Event cancellation flag and passes it as a keyword
    argument to func. When the timeout fires, the event is set so the function
    can exit cooperatively at its next turn boundary rather than running
    indefinitely in the background.

    Returns:
        (result, timed_out) tuple. If timed out, result is None.
    """
    result = [None]
    exception = [None]
    cancel_event = threading.Event()

    # Determine whether func accepts a cancel_event keyword argument
    try:
        sig = inspect.signature(func)
        _accepts_cancel = "cancel_event" in sig.parameters
    except (ValueError, TypeError):
        _accepts_cancel = False

    def target():
        try:
            if _accepts_cancel:
                result[0] = func(*args, cancel_event=cancel_event)
            else:
                result[0] = func(*args)
        except Exception as e:
            exception[0] = e

    thread = threading.Thread(target=target)
    thread.daemon = True
    thread.start()
    thread.join(timeout=timeout_secs)

    if thread.is_alive():
        # Thread still running — timed out. Signal cooperative cancellation
        # so the investigation loop exits at the next turn boundary instead
        # of continuing to make API calls in the background indefinitely.
        cancel_event.set()
        return None, True

    if exception[0]:
        raise exception[0]

    return result[0], False


def build_execution_order(edits, models):
    """Build interleaved (edit, model) pairs for comparable model coverage.

    Returns list of (edit, model) tuples ordered as:
    (edit_1, model_A), (edit_1, model_B), ..., (edit_2, model_A), ...
    """
    pairs = []
    for edit in edits:
        for model in models:
            pairs.append((edit, model))
    return pairs


def main():
    """CLI entry point for verdict fanout."""
    parser = argparse.ArgumentParser(
        description="Run verdict fanout: evaluate Wikidata edits across multiple models"
    )
    parser.add_argument(
        "--snapshot", required=True, help="Path to enriched snapshot YAML"
    )
    parser.add_argument(
        "--models", nargs="+", default=None, help="Override model list"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Process only first N edits"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would be processed without calling OpenRouter"
    )
    args = parser.parse_args()

    # Load snapshot
    with open(args.snapshot) as f:
        snapshot = yaml.safe_load(f)

    edits = snapshot.get("edits", [])
    if args.limit:
        edits = edits[: args.limit]

    models_to_use = args.models or MODELS

    # Load blocked domains
    blocked_domains = load_blocked_domains()

    if args.dry_run:
        print(f"Dry run: would process {len(edits)} edits across {len(models_to_use)} models")
        for edit in edits:
            title = edit.get("title", "?")
            parsed = edit.get("parsed_edit") or {}
            prop = parsed.get("property", "?")
            print(f"  {title} {prop}")
        print(f"Models: {models_to_use}")
        return

    api_key = os.environ["OPENROUTER_API_KEY"]

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        max_retries=3,
        timeout=120.0,
    )

    # Load checkpoint
    completed = load_checkpoint()

    # Build interleaved execution order
    pairs = build_execution_order(edits, models_to_use)
    total = len(pairs)

    skipped_count = 0
    timeout_count = 0
    error_count = 0
    completed_count = 0

    for i, (edit, model) in enumerate(pairs):
        rcid = edit.get("rcid")

        # Skip already-completed pairs
        if (rcid, model) in completed:
            skipped_count += 1
            continue

        title = edit.get("title", "?")
        print(f"[{i+1}/{total}] {title} {model_slug(model)}... ", end="", flush=True)

        try:
            verdict, timed_out = run_with_timeout(
                run_single_verdict,
                (client, model, edit, blocked_domains, api_key),
                timeout_secs=180,
            )

            if timed_out:
                timeout_count += 1
                print("TIMEOUT")
                # Create a minimal timeout verdict
                verdict = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": model,
                    "rcid": rcid,
                    "revid": edit.get("revid"),
                    "title": title,
                    "timeout": True,
                    "verdict": None,
                    "rationale": None,
                    "sources": [],
                }
            else:
                completed_count += 1
                print(verdict.get("verdict") or "no verdict")

            save_verdict(verdict, edit, model)
            completed.add((rcid, model))
            save_checkpoint(completed)

        except Exception as e:
            error_count += 1
            print(f"ERROR: {e}")

    print(
        f"\nDone. completed={completed_count}, skipped={skipped_count}, "
        f"timeout={timeout_count}, errors={error_count}"
    )


if __name__ == "__main__":
    main()
