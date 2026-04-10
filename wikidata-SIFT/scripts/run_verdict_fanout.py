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

# Path to evaluation-mode blocked domains config (relative to project root).
EVAL_BLOCKED_DOMAINS_PATH = Path("config/blocked_domains_eval.yaml")


def load_eval_blocked_domains():
    """Load the evaluation-mode blocked domain config.

    Includes wikidata.org to prevent label leakage during evaluation.
    Uses load_blocked_domains from tool_executor (already imported).

    Returns:
        Set of domain strings.
    """
    config_path = EVAL_BLOCKED_DOMAINS_PATH
    if not config_path.is_absolute():
        script_dir = Path(__file__).resolve().parent
        candidate = script_dir.parent / EVAL_BLOCKED_DOMAINS_PATH
        if candidate.exists():
            config_path = candidate
    return load_blocked_domains(config_path)


def strip_ground_truth(edit):
    """Return a copy of the edit dict with ground_truth removed.

    Does NOT modify the original dict — returns a shallow copy with the
    ground_truth key removed so models never see the labels.

    Args:
        edit: Edit dict that may contain a ground_truth key.

    Returns:
        New dict with all keys except ground_truth.
    """
    return {k: v for k, v in edit.items() if k != "ground_truth"}


# --- Constants ---

# Context window limits per model (for monitoring/warnings)
CONTEXT_LIMITS = {
    "mistralai/mistral-small-3.2-24b-instruct": 131_000,
    "allenai/olmo-3.1-32b-instruct": 65_000,
    "deepseek/deepseek-v3.2": 164_000,
    "anthropic/claude-4.5-haiku-20251001": 200_000,
    "nvidia/nemotron-3-super-120b-a12b:free": 262_144,
    "nvidia/nemotron-3-nano-30b-a3b": 262_144,
    "google/gemma-3-4b-it": 131_072,
    "google/gemma-4-31b-it": 262_144,
}

# Per-model verdict timeout overrides (seconds). Models not listed use DEFAULT_TIMEOUT.
MODEL_TIMEOUTS = {}
DEFAULT_TIMEOUT = 180

MODELS = [
    "mistralai/mistral-small-3.2-24b-instruct",
    "allenai/olmo-3.1-32b-instruct",
    "mistralai/ministral-8b-2512",
]

# Models whose only OpenRouter provider rejects response_format=json_object at
# runtime despite advertising support. For these, Phase B falls back to
# prompt-only JSON (the existing fence-stripping parser handles it).
MODELS_NO_RESPONSE_FORMAT = {
    "nvidia/nemotron-3-nano-30b-a3b",
}

# Per-model extra_body params passed on every chat.completions call.
# Used to disable reasoning on hybrid-thinking models so completion content
# isn't routed to a separate reasoning field (which would leave content empty
# and cause silent Phase B parse failures), and to keep wall-clock time below
# the per-verdict timeout.
MODEL_EXTRA_BODY = {
    "nvidia/nemotron-3-nano-30b-a3b": {"reasoning": {"enabled": False}},
    # Gemma 4 is hybrid-thinking; reasoning must be disabled so content isn't
    # routed to a separate field. require_parameters=true steers routing to
    # providers that actually support tools + tool_choice + response_format.
    "google/gemma-4-31b-it": {
        "reasoning": {"enabled": False},
        "provider": {"require_parameters": True},
    },
}

# Per-model provider routing. Models not listed default to OpenRouter.
# Keys are the canonical model IDs used in MODELS, checkpoints, and verdict
# records. The model_id field is the provider-native ID for API calls.
MODEL_PROVIDERS = {
    "nvidia/nemotron-3-nano-30b-a3b": {
        "base_url": "https://api.deepinfra.com/v1/openai",
        "api_key_env": "DEEPINFRA_API_KEY",
        "model_id": "nvidia/Nemotron-3-Nano-30B-A3B-v1",
    },
}

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def resolve_api_model_id(model):
    """Return the provider-specific model ID for API calls.

    Models in MODEL_PROVIDERS may use a different ID on their native provider
    than the OpenRouter-style ID used as the config key.
    """
    provider = MODEL_PROVIDERS.get(model)
    if provider:
        return provider.get("model_id", model)
    return model


def build_clients(models):
    """Create one OpenAI client per unique provider needed by the model list.

    Returns:
        dict mapping base_url string to OpenAI client instance.
    """
    clients = {}
    for model in models:
        provider = MODEL_PROVIDERS.get(model)
        if provider:
            base_url = provider["base_url"]
            api_key = os.environ[provider["api_key_env"]]
        else:
            base_url = OPENROUTER_BASE_URL
            api_key = os.environ["OPENROUTER_API_KEY"]
        if base_url not in clients:
            clients[base_url] = OpenAI(
                base_url=base_url,
                api_key=api_key,
                max_retries=3,
                timeout=120.0,
            )
    return clients


def get_client(model, clients):
    """Return the OpenAI client for the given model from the clients dict."""
    provider = MODEL_PROVIDERS.get(model)
    base_url = provider["base_url"] if provider else OPENROUTER_BASE_URL
    return clients[base_url]


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
            "description": (
                "Fetch and read the text content of a web page. Always returns "
                "the lead/intro of the page, plus paragraphs containing the "
                "query terms (e.g. the specific value or phrase you are trying "
                "to verify). Providing a focused query is strongly encouraged "
                "for long pages like Wikipedia articles, where the fact you "
                "need may be buried later in the page."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"},
                    "query": {
                        "type": "string",
                        "description": (
                            "Specific term, value, or short phrase you are "
                            "looking for on this page — typically the claim "
                            "value you are trying to verify (e.g. 'Belgium', "
                            "'Pulitzer Prize', 'born 1972'). Paragraphs "
                            "containing this query will be extracted in "
                            "addition to the page lead. Leave blank only if "
                            "you want a generic snapshot of the page."
                        ),
                    },
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


def build_edit_context(edit, context_budget=None):
    """Build the user message string for the investigation phase.

    Calls make_verification_question() and check_ontological_consistency()
    from sift_precheck. Returns a string with YAML-formatted item context,
    parsed edit, and the verification question with any ontological warnings.

    Args:
        edit: Enriched edit dict.
        context_budget: Optional approximate character budget for the message.
            If set, item context is truncated to fit. Prioritizes the edited
            property's claims over other claims. If None, no truncation.
    """
    verification_question = make_verification_question(edit)
    warnings = check_ontological_consistency(edit)

    # Build essential sections (always included regardless of budget)
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

    # Include edit diff if available (and not an error result)
    edit_diff = edit.get("edit_diff")
    if edit_diff and "error" not in edit_diff:
        parts.append("\n## Edit diff\n")
        parts.append(yaml.safe_dump(edit_diff, default_flow_style=False, allow_unicode=True))

    # Include removed claim if available
    removed_claim = edit.get("removed_claim")
    if removed_claim:
        parts.append("\n## Removed claim\n")
        parts.append(yaml.safe_dump(removed_claim, default_flow_style=False, allow_unicode=True))

    # Build verification question section (always included)
    vq_parts = []
    vq_parts.append("\n## Verification question\n")
    if verification_question:
        vq_parts.append(verification_question)
    else:
        vq_parts.append("(No verification question generated — parsed_edit may be missing.)")
    if warnings:
        vq_parts.append("\n\n" + "\n".join(warnings))

    # Calculate essential size to determine remaining budget for optional sections
    essential = "\n".join(parts) + "\n".join(vq_parts)
    essential_len = len(essential)

    if context_budget is not None:
        remaining_budget = max(0, context_budget - essential_len)
    else:
        remaining_budget = None

    # Include item context if available (with optional truncation)
    item = edit.get("item")
    if item:
        item_section = _build_item_context_section(item, parsed_edit, remaining_budget)
        if item_section:
            parts.append(item_section)
            if remaining_budget is not None:
                remaining_budget = max(0, remaining_budget - len(item_section))

    # Include prefetched references if available
    prefetched = edit.get("prefetched_references")
    if prefetched:
        ref_section = _build_prefetched_section(prefetched, remaining_budget)
        if ref_section:
            parts.append(ref_section)

    # Append verification question at the end
    parts.extend(vq_parts)

    return "\n".join(parts)


def _build_item_context_section(item, parsed_edit, budget):
    """Build the item context section with optional truncation.

    Priority order:
    1. Item label and description (always)
    2. Claims on the edited property
    3. Other claims (truncated if over budget)
    """
    claims = item.get("claims", {})
    edited_prop_label = parsed_edit.get("property_label") if parsed_edit else None

    header = "\n## Item context\n"
    meta = {}
    if item.get("label_en"):
        meta["label_en"] = item["label_en"]
    if item.get("description_en"):
        meta["description_en"] = item["description_en"]

    meta_str = yaml.safe_dump(meta, default_flow_style=False, allow_unicode=True) if meta else ""

    if not claims:
        return header + meta_str

    # Split claims by priority: edited property vs others
    edited_prop_claims = {}
    other_claims = {}
    for prop_key, prop_data in claims.items():
        if edited_prop_label and prop_key == edited_prop_label:
            edited_prop_claims[prop_key] = prop_data
        else:
            other_claims[prop_key] = prop_data

    # Serialize priority groups
    edited_str = yaml.safe_dump(
        {"claims": edited_prop_claims}, default_flow_style=False, allow_unicode=True
    ) if edited_prop_claims else ""
    other_str = yaml.safe_dump(
        {"claims": other_claims}, default_flow_style=False, allow_unicode=True
    ) if other_claims else ""

    if budget is None:
        # No truncation
        all_claims_str = yaml.safe_dump(
            {"claims": claims}, default_flow_style=False, allow_unicode=True
        )
        return header + meta_str + all_claims_str

    # Truncation logic
    used = len(header) + len(meta_str)
    result = header + meta_str

    if used + len(edited_str) <= budget:
        result += edited_str
        used += len(edited_str)
    elif edited_str:
        # Truncate edited property claims
        result += edited_str[:max(0, budget - used)] + "\n...(truncated)\n"
        return result

    if used + len(other_str) <= budget:
        result += other_str
    elif other_str:
        result += other_str[:max(0, budget - used)] + "\n...(truncated)\n"

    return result


def _build_prefetched_section(prefetched, budget):
    """Build the prefetched references section with optional truncation."""
    if not prefetched:
        return ""

    parts = ["\n## Prefetched references\n"]
    current_len = len(parts[0])

    for url, ref_data in prefetched.items():
        text = ref_data.get("extracted_text") if isinstance(ref_data, dict) else None
        error = ref_data.get("error") if isinstance(ref_data, dict) else None

        entry = ""
        if text:
            truncated_text = text[:5000]
            entry = f"### {url}\n{truncated_text}\n"
        elif error:
            entry = f"### {url}\n(Fetch failed: {error})\n"

        if budget is not None and current_len + len(entry) > budget:
            break
        parts.append(entry)
        current_len += len(entry)

    return "\n".join(parts) if len(parts) > 1 else ""


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
            result = web_fetch(
                args.get("url", ""),
                query=args.get("query") or None,
                blocked_domains=blocked_domains,
            )
            return result
        else:
            return (
                f"error: Unknown tool '{tool_name}'. "
                f"Valid tools are: web_search, web_fetch"
            )
    except Exception as e:
        return f"error: Tool execution failed: {e}"


def run_investigation_phase(client, model, messages, blocked_domains=None, cancel_event=None, has_prefetched_refs=False):
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
                response_ids, finish_status, turns, total_cost)
        finish_status is one of: 'stop', 'length', 'max_turns', 'cancelled'
        turns is the number of API calls made during investigation.
        total_cost is the sum of inline usage.cost from all responses (float or None).
    """
    if blocked_domains is None:
        blocked_domains = set()

    total_prompt_tokens = 0
    total_completion_tokens = 0
    total_cost = None
    response_ids = []
    context_limit = CONTEXT_LIMITS.get(model, 100_000)

    for turn in range(MAX_TURNS):
        # Cooperative cancellation: check cancel event between turns
        if cancel_event is not None and cancel_event.is_set():
            print(f"WARNING: {model} investigation cancelled by timeout event after {turn} turns")
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "cancelled", turn, total_cost

        # Force tool use on the first turn so models investigate rather
        # than answering from parametric knowledge alone — unless prefetched
        # references are already in context, in which case let the model
        # decide whether it needs to search.
        if turn == 0 and not has_prefetched_refs:
            tc = "required"
        else:
            tc = "auto"
        phase_a_kwargs = dict(
            model=resolve_api_model_id(model),
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice=tc,
        )
        if model in MODEL_EXTRA_BODY:
            phase_a_kwargs["extra_body"] = MODEL_EXTRA_BODY[model]
        response = client.chat.completions.create(**phase_a_kwargs)

        # Defensive: OpenRouter can return a response with choices=None if the
        # upstream provider errored. Dump the raw response so we can diagnose,
        # and bail out of this investigation cleanly rather than crashing.
        if not getattr(response, "choices", None):
            try:
                raw = response.model_dump() if hasattr(response, "model_dump") else dict(response)
            except Exception:
                raw = str(response)
            print(f"WARNING: {model} returned no choices; raw response: {raw}")
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "empty_response", turn, total_cost

        # Track usage and inline cost
        usage = response.usage
        if usage:
            total_prompt_tokens += usage.prompt_tokens or 0
            total_completion_tokens += usage.completion_tokens or 0
            inline_cost = getattr(usage, "cost", None)
            if inline_cost is not None:
                total_cost = (total_cost or 0) + inline_cost

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
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "stop", turn + 1, total_cost

        elif finish_reason == "length":
            # Context length exceeded — log as incomplete
            print(f"WARNING: {model} hit length limit (finish_reason=length), verdict may be incomplete")
            messages = messages + [{"role": "assistant", "content": assistant_message.content}]
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "length", turn + 1, total_cost

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
            return messages, total_prompt_tokens, total_completion_tokens, response_ids, "stop", turn + 1, total_cost

    # Exceeded MAX_TURNS
    print(f"WARNING: {model} hit MAX_TURNS ({MAX_TURNS}) without completing investigation")
    return messages, total_prompt_tokens, total_completion_tokens, response_ids, "max_turns", MAX_TURNS, total_cost


def run_verdict_phase(client, model, messages):
    """Run Phase B: structured verdict extraction.

    Appends a verdict-request message and calls the model with
    response_format=json_object (no tools).

    Args:
        client: OpenAI client.
        model: Model ID string.
        messages: Messages list from Phase A.

    Returns:
        tuple: (verdict_dict_or_None, prompt_tokens, completion_tokens, response_id, cost)
    """
    verdict_request = (
        "Based on your investigation, please provide your final verdict as JSON. "
        "Use this exact schema:\n\n"
        + json.dumps(VERDICT_SCHEMA, indent=2)
        + "\n\nThe sources array MUST contain at least one entry with "
        "provenance: \"verified\". If you did not fetch any source during "
        "your investigation, your verdict must be \"unverifiable\"."
        "\n\nRespond with only valid JSON matching the schema."
    )
    messages = messages + [{"role": "user", "content": verdict_request}]

    create_kwargs = dict(model=resolve_api_model_id(model), messages=messages)
    if model not in MODELS_NO_RESPONSE_FORMAT:
        create_kwargs["response_format"] = {"type": "json_object"}
    if model in MODEL_EXTRA_BODY:
        create_kwargs["extra_body"] = MODEL_EXTRA_BODY[model]

    response = client.chat.completions.create(**create_kwargs)

    usage = response.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    cost = getattr(usage, "cost", None) if usage else None
    response_id = response.id

    content = response.choices[0].message.content
    if not content:
        return None, prompt_tokens, completion_tokens, response_id, cost

    # Strip markdown code fences that some models wrap around JSON
    stripped = content.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        # Remove first line (```json or ```) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        stripped = "\n".join(lines).strip()

    try:
        verdict_dict = json.loads(stripped)
        # Some models return a JSON array instead of object — unwrap first element
        if isinstance(verdict_dict, list):
            verdict_dict = verdict_dict[0] if verdict_dict else None
        if not isinstance(verdict_dict, dict):
            print(f"WARNING: {model} returned non-object JSON in verdict phase: {type(verdict_dict)}")
            return None, prompt_tokens, completion_tokens, response_id, cost
        return verdict_dict, prompt_tokens, completion_tokens, response_id, cost
    except json.JSONDecodeError:
        print(f"WARNING: {model} returned invalid JSON in verdict phase. Raw: {content[:200]}")
        # Return raw content as a signal of failure
        return None, prompt_tokens, completion_tokens, response_id, cost


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
    context_limit = CONTEXT_LIMITS.get(model, 100_000)
    # Budget for item-context bulk (essential sections like diff/parsed_edit are
    # always included separately). 15% of context_limit * 4 chars ≈ 15% of tokens.
    # Leaves ~50% headroom for 15 turns of ~1.25k-token tool results + assistant
    # replies before hitting the window.
    context_budget = int(context_limit * 4 * 0.15)
    edit_context = build_edit_context(edit, context_budget=context_budget)

    initial_messages = [
        {"role": "system", "content": sift_prompt},
        {"role": "user", "content": edit_context},
    ]

    # Phase A: investigation
    has_prefetched = bool(edit.get("prefetched_references"))
    messages, inv_prompt_tokens, inv_completion_tokens, response_ids, finish_status, turns, inv_cost = \
        run_investigation_phase(client, model, initial_messages, blocked_domains, cancel_event=cancel_event, has_prefetched_refs=has_prefetched)

    # Phase B: verdict extraction
    verdict_dict, vrd_prompt_tokens, vrd_completion_tokens, verdict_response_id, vrd_cost = \
        run_verdict_phase(client, model, messages)

    if verdict_response_id:
        response_ids.append(verdict_response_id)

    # Sum inline costs from both phases
    total_cost_usd = None
    if inv_cost is not None or vrd_cost is not None:
        total_cost_usd = (inv_cost or 0) + (vrd_cost or 0)

    # Token totals from SDK-reported usage
    total_prompt_tokens = inv_prompt_tokens + vrd_prompt_tokens
    total_completion_tokens = inv_completion_tokens + vrd_completion_tokens

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
    return {(entry.get("revid") or entry.get("rcid"), entry["model"]) for entry in data["completed"]}


def save_checkpoint(completed, state_path=None):
    """Save checkpoint state to YAML.

    Args:
        completed: set of (edit_rcid, model) tuples.
    """
    path = state_path or STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    entries = [
        {"revid": revid, "model": model}
        for revid, model in sorted(completed, key=lambda p: (p[0] is None, p[0] or 0, p[1]))
    ]
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
    parser.add_argument(
        "--eval", action="store_true",
        help="Evaluation mode: block wikidata.org and strip ground_truth from edits",
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
    if args.eval:
        blocked_domains = load_eval_blocked_domains()
        print("Evaluation mode: wikidata.org blocked, ground_truth will be stripped")
    else:
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
        state_key = edit.get("revid") or rcid

        # Skip already-completed pairs
        if (state_key, model) in completed:
            skipped_count += 1
            continue

        title = edit.get("title", "?")
        print(f"[{i+1}/{total}] {title} {model_slug(model)}... ", end="", flush=True)

        try:
            timeout = MODEL_TIMEOUTS.get(model, DEFAULT_TIMEOUT)
            verdict_edit = strip_ground_truth(edit) if args.eval else edit
            verdict, timed_out = run_with_timeout(
                run_single_verdict,
                (client, model, verdict_edit, blocked_domains, api_key),
                timeout_secs=timeout,
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
            completed.add((state_key, model))
            save_checkpoint(completed)

        except Exception as e:
            error_count += 1
            import traceback
            print(f"ERROR: {e}")
            traceback.print_exc()

    print(
        f"\nDone. completed={completed_count}, skipped={skipped_count}, "
        f"timeout={timeout_count}, errors={error_count}"
    )


if __name__ == "__main__":
    main()
