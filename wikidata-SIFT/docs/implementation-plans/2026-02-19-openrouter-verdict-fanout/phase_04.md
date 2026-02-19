# OpenRouter Verdict Fanout — Phase 4: Verdict Runner Core

**Goal:** Tool-calling loop and structured verdict capture via OpenRouter for a single (edit, model) pair

**Architecture:** `scripts/run_verdict_fanout.py` implements two-phase verdict execution: Phase A runs an investigation loop (system prompt + edit context, tool-calling via OpenRouter), Phase B appends a verdict-request message with `response_format=json_object` and no tools. The runner dispatches tool calls to `tool_executor.py` functions, captures cost data via the OpenRouter generation endpoint, and saves verdict YAML files.

**Tech Stack:** OpenAI Python SDK (`openai` package, pointed at OpenRouter), tool_executor (from Phase 2), sift_precheck (existing), PyYAML

**Scope:** Phase 4 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-verdict-fanout.AC2: Runner produces structured verdicts via OpenRouter
- **openrouter-verdict-fanout.AC2.1 Success:** Runner completes a two-phase verdict (investigation + structured output) for each model
- **openrouter-verdict-fanout.AC2.2 Success:** Verdict JSON contains verdict, rationale, and sources matching the schema
- **openrouter-verdict-fanout.AC2.3 Success:** Runner captures prompt_tokens, completion_tokens, and cost_usd per verdict
- **openrouter-verdict-fanout.AC2.4 Failure:** Malformed tool call arguments return error string to model without crashing
- **openrouter-verdict-fanout.AC2.5 Failure:** Unknown tool names return error listing valid tools
- **openrouter-verdict-fanout.AC2.6 Edge:** finish_reason=length logged as incomplete, verdict saved with available data

---

<!-- START_TASK_1 -->
### Task 1: Add openai dependency

**Files:**
- Modify: `wikidata-SIFT/pyproject.toml` (line 8, inside `dependencies` list)

**Step 1: Add openai to dependencies**

Add `"openai>=1.40"` to the `dependencies` list. The list should become:

```toml
dependencies = [
    "pywikibot>=10.7",
    "pyyaml",
    "trafilatura>=2.0",
    "httpx>=0.27",
    "openai>=1.40",
]
```

**Step 2: Sync dependencies**

```bash
cd wikidata-SIFT && uv sync
```

**Step 3: Verify import**

```bash
cd wikidata-SIFT && uv run python -c "import openai; print(openai.__version__)"
```

Expected: Version 1.40.x or higher.

**Step 4: Commit**

```bash
git add wikidata-SIFT/pyproject.toml wikidata-SIFT/uv.lock
git commit -m "deps: add openai SDK for OpenRouter verdict runner"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Implement run_verdict_fanout.py (single-verdict core)

**Verifies:** openrouter-verdict-fanout.AC2.1, openrouter-verdict-fanout.AC2.2, openrouter-verdict-fanout.AC2.3, openrouter-verdict-fanout.AC2.4, openrouter-verdict-fanout.AC2.5, openrouter-verdict-fanout.AC2.6

**Files:**
- Create: `wikidata-SIFT/scripts/run_verdict_fanout.py`

**Implementation:**

Create `scripts/run_verdict_fanout.py` following the project's script pattern (shebang, imports, module-level constants, functions, main, if-name guard).

The script structure:

```python
#!/usr/bin/env python3
"""Run verdict fanout: evaluate Wikidata edits across multiple models via OpenRouter."""

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
import openai
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
```

Key functions to implement:

**`load_sift_prompt()`** — Reads `config/sift_prompt_openrouter.md` and returns the text.

**`build_edit_context(edit)`** — Calls `make_verification_question(edit)` and `check_ontological_consistency(edit)` from sift_precheck. Builds a user message string containing the enriched edit data (YAML-formatted item context, parsed edit, etc.) and the verification question with any ontological warnings appended.

**`dispatch_tool_call(tool_call, blocked_domains)`** — Takes a tool call object, parses the arguments JSON, dispatches to `web_search()` or `web_fetch()` from tool_executor. Returns the result string. Handles:
- `json.JSONDecodeError` on malformed arguments → returns error string describing the problem
- Unknown tool name → returns error string listing valid tools (`web_search`, `web_fetch`)
- Any exception from the tool functions → returns error string

**`run_investigation_phase(client, model, messages, blocked_domains)`** — The Phase A loop:
1. Send messages to OpenRouter with tools and `tool_choice="auto"`
2. Check `finish_reason`:
   - `"stop"` → investigation complete, return messages and usage stats
   - `"tool_calls"` → dispatch each tool call, append assistant message + tool results, loop
   - `"length"` → log as incomplete, return what we have
3. Loop up to `MAX_TURNS` iterations
4. Track cumulative `prompt_tokens` and `completion_tokens` across all turns
5. After each turn, check if cumulative token usage exceeds 80% of the model's context window (using `CONTEXT_LIMITS`). If so, print a warning but continue.
6. Return: updated messages list, total token counts, list of response IDs, finish status

**`run_verdict_phase(client, model, messages)`** — The Phase B call:
1. Append a message asking for the structured verdict as JSON, including the schema
2. Send with `response_format={"type": "json_object"}` and NO tools
3. Parse the JSON response
4. Handle parse failures gracefully (save raw content if JSON is invalid)
5. Return: parsed verdict dict (or None), token usage, response ID

**`fetch_generation_cost(generation_id, api_key)`** — Query OpenRouter's generation endpoint:
```python
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
```

**`run_single_verdict(client, model, edit, blocked_domains, api_key)`** — Orchestrates a full verdict:
1. Load SIFT prompt, build edit context
2. Construct initial messages: `[{"role": "system", "content": sift_prompt}, {"role": "user", "content": edit_context}]`
3. Run Phase A (investigation)
4. Run Phase B (verdict extraction)
5. Fetch cost from generation endpoint (sum across all response IDs)
6. Build and return the full verdict dict matching the trimmed schema

**`save_verdict(verdict, edit, model)`** — Save verdict YAML to `VERDICT_DIR`:
- Filename: `{date}-{qid}-{property}-{model_slug}.yaml` where `model_slug` is the last segment of the model name (e.g., `deepseek-v3.2` from `deepseek/deepseek-v3.2`)
- Uses `yaml.safe_dump(default_flow_style=False, allow_unicode=True)`

**`model_slug(model_id)`** — Extract short name: `model_id.split("/")[-1]`

**`main()`** — Argparse CLI:
- `--snapshot PATH` (required): path to enriched snapshot YAML
- `--models MODEL [MODEL ...]` (optional): override model list
- `--limit N` (optional): process only first N edits
- `--dry-run` (optional): print what would be processed without calling OpenRouter
- Loads snapshot, loads blocked domains, creates OpenAI client with retry config, iterates edits

The OpenAI client should be configured with automatic retries for transient errors (429, 5xx):

```python
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
    max_retries=3,  # retry 429/5xx with exponential backoff
    timeout=120.0,  # 2-minute timeout per API call
)
```

The SDK's built-in retry handles exponential backoff automatically (default delays of ~0.5s, 1s, 2s). This satisfies the design requirement of "OpenRouter 429/5xx → exponential backoff, max 3 retries."

**Note on `edit_diff` vs `diff_type`:** The enriched edit dict uses `edit_diff.type` (nested) while the trimmed verdict schema uses `diff_type` (flat). The `save_verdict` function should extract `edit.get("edit_diff", {}).get("type", "unknown")` and save it as the flat `diff_type` field in the verdict YAML.

**Verification:**
```bash
cd wikidata-SIFT && PYTHONPATH=scripts uv run python -c "from run_verdict_fanout import run_single_verdict, dispatch_tool_call, build_edit_context; print('imports OK')"
```

Expected: "imports OK"
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for verdict runner core

**Verifies:** openrouter-verdict-fanout.AC2.1, openrouter-verdict-fanout.AC2.2, openrouter-verdict-fanout.AC2.3, openrouter-verdict-fanout.AC2.4, openrouter-verdict-fanout.AC2.5, openrouter-verdict-fanout.AC2.6

**Files:**
- Create: `wikidata-SIFT/tests/test_verdict_runner.py`

**Testing:**

Tests must verify each AC listed above. Follow the project's existing testing patterns: `unittest.mock` (`patch`, `MagicMock`), test classes per function, plain `assert`, `_make_*()` helpers.

**Helper functions:**

```python
def _make_enriched_edit(**overrides):
    """Build a minimal enriched edit dict for testing."""
    edit = {
        "rcid": 12345,
        "revid": 67890,
        "title": "Q42",
        "user": "TestUser",
        "timestamp": "2026-02-19T12:00:00Z",
        "tags": [],
        "parsed_edit": {
            "operation": "wbsetclaim-update",
            "property": "P569",
            "property_label": "date of birth",
            "value_raw": "+1952-03-11T00:00:00Z/11",
            "value_label": "11 March 1952",
        },
        "edit_diff": {"type": "value_changed"},
        "item": {"label_en": "Douglas Adams", "claims": {}},
    }
    edit.update(overrides)
    return edit


def _make_tool_call(name, arguments, call_id="call_123"):
    """Build a mock tool call object."""
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc
```

**Test classes and what they verify:**

**`TestDispatchToolCall`:**
- openrouter-verdict-fanout.AC2.4: Pass a tool call with malformed JSON arguments (e.g., `tc.function.arguments = "not json"`). Assert returns an error string mentioning the parse error. Assert no exception raised.
- openrouter-verdict-fanout.AC2.5: Pass a tool call with `name="unknown_tool"`. Assert returns an error string listing valid tools (web_search, web_fetch).
- Test successful dispatch to web_search: mock `tool_executor.web_search`, pass a valid tool call, assert the mock was called with correct args and result returned.
- Test successful dispatch to web_fetch: mock `tool_executor.web_fetch`, same pattern.

**`TestRunInvestigationPhase`:**
- openrouter-verdict-fanout.AC2.1 (investigation half): Mock the OpenAI client's `chat.completions.create`. First call returns a response with `finish_reason="tool_calls"` and one tool call. Second call returns `finish_reason="stop"` with content. Assert the function returns messages with tool results appended, and cumulative token counts.
- openrouter-verdict-fanout.AC2.6: Mock response with `finish_reason="length"`. Assert function returns with incomplete status flag set.
- Test max_turns enforcement: mock responses that always return tool_calls. Assert function stops after MAX_TURNS iterations.

**`TestRunVerdictPhase`:**
- openrouter-verdict-fanout.AC2.2: Mock client response with valid JSON content matching the verdict schema. Assert parsed verdict contains `verdict`, `rationale`, `sources`.
- Test invalid JSON response: mock client returns content that isn't valid JSON. Assert function handles gracefully (returns None or raw content).

**`TestFetchGenerationCost`:**
- openrouter-verdict-fanout.AC2.3: Mock httpx.get to return a generation endpoint response with `tokens_prompt`, `tokens_completion`, `total_cost`. Assert function extracts the correct values.
- Test non-200 response: mock httpx.get returning 404. Assert function returns None.

**`TestSaveVerdict`:**
- Test that save_verdict creates a YAML file at the expected path with correct filename format.
- Test the YAML content matches the trimmed schema (use `tmp_path` to write to a temp directory).

**`TestBuildEditContext`:**
- Mock `make_verification_question` and `check_ontological_consistency` from sift_precheck. Pass an enriched edit. Assert the returned string contains the verification question and any warnings.

**Verification:**

Run: `cd wikidata-SIFT && uv run pytest tests/test_verdict_runner.py -v`

Expected: All tests pass.

**Commit:**

```bash
git add wikidata-SIFT/scripts/run_verdict_fanout.py wikidata-SIFT/tests/test_verdict_runner.py
git commit -m "feat: add verdict runner with two-phase execution via OpenRouter"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
