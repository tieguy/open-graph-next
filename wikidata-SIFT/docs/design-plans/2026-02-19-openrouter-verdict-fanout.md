# OpenRouter Verdict Fanout Design

## Summary

This experiment extends the existing SIFT-Patrol pipeline to run the same edit-verification workflow across four different language models simultaneously, enabling direct comparison of their accuracy, cost, and reasoning quality on the same set of Wikidata edits. Rather than evaluating models one at a time, a "fanout" runner takes a shared batch of 500 enriched edits and submits each one to all four models via OpenRouter, producing 2,000 structured verdict files that can later be analyzed for agreement patterns, failure modes, and cost-effectiveness.

The key infrastructure challenge is giving every model equal access to live web research during the investigation phase, without relying on Claude-specific tooling. This is solved by self-hosting a SearXNG search engine locally (avoiding cloud IP blocks) and wrapping it in a thin tool executor that exposes two model-agnostic functions: `web_search` and `web_fetch`. Each model works through the same two-phase process — a free-form tool-calling investigation loop followed by a structured JSON verdict — using a minimally adapted version of the existing SIFT prompt with Claude-specific references removed. The runner is designed for unattended overnight execution: it interleaves work across models so partial runs yield comparable coverage, and a checkpoint file allows kill-and-restart without repeating completed verdicts.

## Definition of Done

1. **A self-hosted SearXNG instance** running via Podman, providing web search to all models equally
2. **An experiment runner script** that takes 500 enriched edits, runs each through 4 models (nvidia/nemotron-3-nano-30b-a3b, allenai/olmo-3.1-32b-instruct, deepseek/deepseek-v3.2, anthropic/claude-4.5-haiku-20251001) via OpenRouter with tool-calling (web_search + web_fetch), captures structured verdicts, and saves them as YAML — unattended, with checkpoint/resume
3. **A minimally adapted SIFT prompt** that works across all models (generic tool names, no file I/O, same methodology)
4. **2000 verdict YAML files** (500 edits x 4 models) with model ID, cost metadata, and a trimmed schema focused on what's needed for voting/comparison analysis
5. **Enrichment pipeline run** to fetch and enrich 500 fresh edits as the shared sample

## Acceptance Criteria

### openrouter-verdict-fanout.AC1: Web research tools work equivalently for all models
- **AC1.1 Success:** web_search returns titles, URLs, and snippets from SearXNG for a valid query
- **AC1.2 Success:** web_fetch extracts article text from a fetchable URL via trafilatura
- **AC1.3 Failure:** web_fetch returns "blocked_domain" for URLs in config/blocked_domains.yaml
- **AC1.4 Failure:** web_fetch returns error string for HTTP 403/404/timeout responses
- **AC1.5 Failure:** web_search returns empty list with error note when SearXNG is unreachable

### openrouter-verdict-fanout.AC2: Runner produces structured verdicts via OpenRouter
- **AC2.1 Success:** Runner completes a two-phase verdict (investigation + structured output) for each model
- **AC2.2 Success:** Verdict JSON contains verdict, rationale, and sources matching the schema
- **AC2.3 Success:** Runner captures prompt_tokens, completion_tokens, and cost_usd per verdict
- **AC2.4 Failure:** Malformed tool call arguments return error string to model without crashing
- **AC2.5 Failure:** Unknown tool names return error listing valid tools
- **AC2.6 Edge:** finish_reason=length logged as incomplete, verdict saved with available data

### openrouter-verdict-fanout.AC3: Unattended execution with checkpoint/resume
- **AC3.1 Success:** Runner resumes from checkpoint, skipping completed (edit_rcid, model) pairs
- **AC3.2 Success:** Checkpoint file updated after each successful verdict
- **AC3.3 Success:** Per-verdict timeout at 180s logs timeout: true and continues to next
- **AC3.4 Success:** Interleaved execution order gives comparable model coverage on partial runs

### openrouter-verdict-fanout.AC4: Full pipeline produces 2000 verdicts
- **AC4.1 Success:** 500-edit enriched snapshot fetched and saved via existing pipeline
- **AC4.2 Success:** All 4 models produce verdicts for a small sample (2-3 edits) in end-to-end test
- **AC4.3 Success:** Verdict YAML files match the trimmed schema with all required fields

## Glossary

- **SIFT**: Stop, Investigate the source, Find better coverage, Trace claims — the fact-checking methodology used to evaluate whether a Wikidata edit is correct.
- **SIFT-Patrol**: The edit-centric application of SIFT in this project. Given a single unpatrolled Wikidata edit, it asks: is this specific change correct?
- **Verdict fanout**: Running the same edit through multiple models, producing one verdict per (edit, model) pair for comparison.
- **OpenRouter**: An API gateway providing a unified OpenAI-compatible interface to models from many providers under a single API key with per-token cost tracking.
- **Tool calling**: A mechanism where a model emits a structured request to invoke an external function (e.g., `web_search`). The caller runs the function and feeds results back; the loop repeats until the model stops calling tools.
- **Two-phase verdict execution**: Phase A is an open-ended tool-calling investigation loop; Phase B appends a "give me your verdict as JSON" message with `response_format=json_object` to extract structured output.
- **SearXNG**: An open-source, self-hostable metasearch engine aggregating results from multiple engines (Google, DuckDuckGo, Brave) via a JSON API.
- **Podman**: A daemonless container runtime, functionally equivalent to Docker for this use case.
- **trafilatura**: A Python library for extracting main article text from web pages, stripping navigation, ads, and boilerplate.
- **Enriched snapshot**: A YAML file from `fetch_patrol_edits.py --enrich` containing Wikidata edits augmented with full item context, parsed edit summaries, and resolved labels.
- **Checkpoint/resume**: A state file (`fanout-state.yaml`) records completed (edit, model) pairs so killed runs can restart without repeating work.
- **Interleaved execution**: Processing as (edit 1 × model A, edit 1 × model B, ...) rather than all edits for one model first, so partial runs have proportional coverage across all models.
- **Generation endpoint**: OpenRouter's `/api/v1/generation?id={id}` endpoint for authoritative token counts and cost data.
- **Provenance classification**: Whether a cited source was `verified` (fetched and read) or `reported` (seen in search snippets only).

## Architecture

Four components, all running on a home machine (residential IP required for SearXNG to avoid search engine blocks on cloud IPs):

**SearXNG** — Podman container, localhost only. Provides `/search?q=...&format=json`. Upstream engines: Google, DuckDuckGo, Brave. Redundancy across engines means if one rate-limits, others still return results.

**Tool executor** (`scripts/tool_executor.py`) — Two functions shared by all models:
- `web_search(query, num_results=5)` — calls SearXNG, returns `[{title, url, snippet}]`
- `web_fetch(url)` — `httpx.get()` + `trafilatura.extract()`, checks `config/blocked_domains.yaml` first. Returns extracted text or error string.

Rate limiting: 0.5s between fetches (matching existing codebase pattern).

**Verdict runner** (`scripts/run_verdict_fanout.py`) — Argparse CLI. Loads an enriched snapshot YAML, iterates over (edit, model) pairs, runs two-phase verdict execution, saves results as YAML.

Two-phase execution per verdict:
1. *Investigation phase* — system prompt (adapted SIFT) + user message (edit context). Tool-calling loop via OpenRouter: model calls `web_search`/`web_fetch`, executor runs them, results appended, loop repeats until model stops or `max_turns=15`.
2. *Verdict phase* — append "provide your final verdict as JSON" message with schema. Send with `response_format={"type": "json_object"}`, no tools. Parse JSON response.

Execution order: models interleaved per edit (edit 1 × model A, edit 1 × model B, ...) so partial runs have comparable coverage across models.

**Adapted SIFT prompt** (`config/sift_prompt_openrouter.md`) — Current SKILL.md with minimal changes: `WebSearch` → `web_search`, `WebFetch` → `web_fetch`, file I/O instructions removed. Same SIFT methodology, verdict definitions, source provenance rules.

Data flow: `enriched snapshot → runner → (OpenRouter ↔ tool executor ↔ SearXNG) → verdict YAMLs`

### Checkpoint/Resume

`logs/wikidata-patrol-experiment/fanout-state.yaml` tracks completed `(edit_rcid, model)` pairs. Updated after each successful verdict save. On startup, completed pairs are skipped. Allows kill-and-restart at any point.

### Per-Verdict Timeout

3-minute wall-clock timeout per verdict (Phase A + B combined). Timeouts logged as `timeout: true` in the verdict file. Worst case: 2000 verdicts × 3 min = 100 hours. Expected runtime: 10-20 hours (most verdicts complete in under a minute).

### Error Handling

- Malformed tool call arguments → error string returned to model, loop continues
- Unknown tool name → error string listing valid tools
- `finish_reason=length` → logged as incomplete, saved, marked in checkpoint
- OpenRouter 429/5xx → exponential backoff (5s, 10s, 20s), max 3 retries
- Per-verdict exceptions → logged, skipped, continue to next

### Cost Capture

After each verdict, query OpenRouter's `/api/v1/generation?id={response.id}` for authoritative cost data. Store `prompt_tokens`, `completion_tokens`, `cost_usd` per verdict.

### Trimmed Verdict Schema

```yaml
# File: {date}-{qid}-{property}-{model_slug}.yaml
model: deepseek/deepseek-v3.2
edit_rcid: 2540801376
edit_revid: 2464598906
qid: Q138340290
property: P31
diff_type: value_changed
timestamp: 2026-02-19T12:34:56Z

verdict: incorrect
rationale: "2-3 sentences"

sources:
  - url: https://example.com
    supports_claim: true
    provenance: verified

token_usage:
  prompt_tokens: 1234
  completion_tokens: 456
  turns: 4
cost_usd: 0.00023
timeout: false
```

Model produces `verdict`, `rationale`, `sources` as JSON. Runner adds metadata wrapper (model, edit IDs, cost, token usage, timestamp, timeout).

### Verdict JSON Schema (contract for structured output)

```json
{
  "type": "object",
  "properties": {
    "verdict": {
      "type": "string",
      "enum": ["verified-high", "verified-low", "plausible", "unverifiable", "suspect", "incorrect"]
    },
    "rationale": {"type": "string"},
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "url": {"type": "string"},
          "supports_claim": {"type": "boolean"},
          "provenance": {"type": "string", "enum": ["verified", "reported"]}
        },
        "required": ["url", "supports_claim", "provenance"]
      }
    }
  },
  "required": ["verdict", "rationale", "sources"]
}
```

### Tool JSON Schemas (contract for tool calling)

```json
[
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
        "required": ["query"]
      }
    }
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
        "required": ["url"]
      }
    }
  }
]
```

### Models

| Model | OpenRouter slug | Context | Input $/M | Output $/M |
|-------|----------------|---------|-----------|------------|
| Nemotron Nano 30B | `nvidia/nemotron-3-nano-30b-a3b` | 262K | $0.05 | $0.20 |
| OLMo 3.1 32B | `allenai/olmo-3.1-32b-instruct` | 65K | $0.20 | $0.60 |
| DeepSeek V3.2 | `deepseek/deepseek-v3.2` | 164K | $0.26 | $0.38 |
| Haiku 4.5 | `anthropic/claude-4.5-haiku-20251001` | 200K | $1.00 | $5.00 |

All accessed via OpenRouter's OpenAI-compatible API. OpenRouter API key via `OPENROUTER_API_KEY` environment variable.

## Existing Patterns

**Script structure:** All scripts in `scripts/` use argparse CLI with `main()` guard, `#!/usr/bin/env python3` shebang, module-level path constants. Runner follows this pattern.

**YAML I/O:** `yaml.safe_dump()` with `default_flow_style=False, allow_unicode=True` for writes, `yaml.safe_load()` for reads. No shared helper module — each script handles its own I/O inline.

**Error recovery:** `fetch_patrol_edits.py` wraps each edit/group in try/except, logs errors inline, continues the loop. Runner follows this per-verdict pattern.

**Progress reporting:** Print to stdout with `end="", flush=True` for inline status. No Python `logging` module used anywhere in the project.

**Config:** `config/blocked_domains.yaml` loaded relative to script path. Runner reuses `load_blocked_domains()` for the web_fetch tool.

**Precheck functions:** `make_verification_question(edit)` and `check_ontological_consistency(edit)` from `scripts/sift_precheck.py` are called by the runner to prepare each edit's user message.

**New patterns introduced:**
- Environment variable for API key (`OPENROUTER_API_KEY`) — no .env file pattern exists in the project; env var is the simplest approach
- Podman Compose for SearXNG — no container infrastructure exists yet
- `openai` and `httpx` as new dependencies

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: SearXNG Setup
**Goal:** Self-hosted search engine running via Podman on home machine

**Components:**
- `docker-compose.yml` at project root (Podman-compatible) — SearXNG + Redis
- `config/searxng/settings.yml` — engine selection (Google, DuckDuckGo, Brave), JSON output, rate limiting
- Startup verification script or instructions

**Dependencies:** None

**Done when:** `curl 'http://localhost:8080/search?q=test&format=json'` returns search results
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Tool Executor
**Goal:** Shared web_search and web_fetch functions usable by all models

**Components:**
- `scripts/tool_executor.py` — `web_search()`, `web_fetch()` functions, blocked domain checking
- Tests in `tests/test_tool_executor.py` — unit tests with mocked HTTP responses

**Dependencies:** Phase 1 (SearXNG must be available for integration testing)

**Done when:** Tests pass for search result parsing, fetch with trafilatura extraction, blocked domain rejection, error cases (HTTP 403, extraction empty, SearXNG unreachable)

**Acceptance criteria covered:** openrouter-verdict-fanout.AC1.1–AC1.5
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Adapted SIFT Prompt
**Goal:** Model-agnostic version of the SIFT-Patrol skill prompt

**Components:**
- `config/sift_prompt_openrouter.md` — adapted from `skills/sift-patrol/SKILL.md`

**Dependencies:** None (can be done in parallel with Phases 1-2)

**Done when:** Prompt contains no Claude-specific tool names or file I/O instructions; references `web_search` and `web_fetch` by name; retains all SIFT methodology, verdict definitions, and source provenance rules
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Verdict Runner Core
**Goal:** Tool-calling loop and structured verdict capture via OpenRouter

**Components:**
- `scripts/run_verdict_fanout.py` — argparse CLI, OpenAI SDK client configured for OpenRouter, two-phase verdict execution (investigation loop + structured output), cost capture via generation endpoint
- Edit context formatter — builds user message from enriched edit dict using `make_verification_question()` and `check_ontological_consistency()` from `sift_precheck.py`
- Tests in `tests/test_verdict_runner.py` — unit tests with mocked OpenRouter responses for tool-calling loop, structured output parsing, malformed response handling

**Dependencies:** Phase 2 (tool executor), Phase 3 (prompt)

**Done when:** Runner can execute a single verdict against a mocked OpenRouter endpoint, correctly dispatching tool calls, capturing the structured verdict, and saving the YAML output

**Acceptance criteria covered:** openrouter-verdict-fanout.AC2.1–AC2.6
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Checkpoint/Resume and Timeout
**Goal:** Unattended execution with resilience to interruption

**Components:**
- Checkpoint logic in `run_verdict_fanout.py` — `fanout-state.yaml` read/write, skip completed pairs
- Per-verdict 3-minute timeout
- Interleaved execution order (per-edit across models)
- Tests in `tests/test_verdict_runner.py` — checkpoint save/load, resume after interruption, timeout handling

**Dependencies:** Phase 4

**Done when:** Runner can be killed and restarted, skipping already-completed verdicts; timed-out verdicts are logged with `timeout: true` and the runner continues

**Acceptance criteria covered:** openrouter-verdict-fanout.AC3.1–AC3.4
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Enrichment Run and End-to-End Test
**Goal:** Fetch 500 fresh edits and validate the full pipeline

**Components:**
- Enrichment run via existing `scripts/fetch_patrol_edits.py -u 500 --enrich` to create the shared sample
- End-to-end test: run 2-3 edits through all 4 models on real OpenRouter, verify verdict YAML output, cost capture, and checkpoint behavior

**Dependencies:** Phases 1-5

**Done when:** 500-edit enriched snapshot exists; end-to-end test produces valid verdict YAMLs for a small sample across all 4 models; checkpoint correctly tracks completions

**Acceptance criteria covered:** openrouter-verdict-fanout.AC4.1–AC4.3
<!-- END_PHASE_6 -->

## Additional Considerations

**OLMo context window:** At 65K tokens, OLMo is the tightest context. Enriched edits with many claims + multi-turn tool results could approach this limit. The runner should monitor token usage and log a warning if a model's cumulative context exceeds 80% of its window. If this becomes a problem in practice, item claims could be trimmed to only the edited property's claim group.

**SearXNG upstream reliability:** If all upstream engines block the instance, searches return empty results. The tool executor returns an empty list with a note, and the model must work with whatever `prefetched_references` already provide. This is a realistic failure mode — the model's ability to cope with limited search results is itself useful experimental data.

**Voting analysis (future):** The trimmed verdict schema captures enough signal for post-experiment analysis: verdict classification, rationale text, source URLs, and cost. Potential voting approaches (majority vote, confidence-weighted, disagreement flagging) can be explored once data exists. Not designed upfront.
