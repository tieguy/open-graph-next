# OpenRouter Verdict Fanout -- Test Requirements

This document maps each acceptance criterion from the `openrouter-verdict-fanout` design plan to specific automated tests or human verification steps. It serves as a traceability matrix: every AC has at least one test or documented verification approach, and every test traces back to at least one AC.

**Phases without ACs:** Phase 1 (SearXNG Setup) and Phase 3 (Adapted SIFT Prompt) are infrastructure phases with no acceptance criteria. Phase 1 is verified by operational curl test. Phase 3 is verified by manual grep inspection (no Claude-specific references remain).

**Test files:**
- `tests/test_tool_executor.py` -- Phase 2 (AC1)
- `tests/test_verdict_runner.py` -- Phases 4-5 (AC2, AC3)
- Phase 6 (AC4) -- E2E verification via manual execution with live services

---

## AC1: Web research tools work equivalently for all models

These criteria verify that the tool executor (`scripts/tool_executor.py`) provides consistent web_search and web_fetch behavior regardless of which model invokes them. All tests use mocked HTTP responses (no live SearXNG or external URLs required).

### AC1.1: web_search returns titles, URLs, and snippets from SearXNG for a valid query

- **Criterion text:** web_search returns titles, URLs, and snippets from SearXNG for a valid query
- **Test type:** Unit
- **Test file:** `tests/test_tool_executor.py`
- **Test class/method:** `TestWebSearch::test_search_returns_results`
- **Description:** Mocks `httpx.get` to return a SearXNG-format JSON response with `results` containing `title`, `url`, `content` fields. Asserts the returned list contains dicts with `title`, `url`, `snippet` keys and correct values.

### AC1.2: web_fetch extracts article text from a fetchable URL via trafilatura

- **Criterion text:** web_fetch extracts article text from a fetchable URL via trafilatura
- **Test type:** Unit
- **Test file:** `tests/test_tool_executor.py`
- **Test class/method:** `TestWebFetch::test_fetch_extracts_text`
- **Description:** Mocks `httpx.get` to return status 200 with HTML body. Mocks `trafilatura.extract` to return extracted text. Asserts function returns the extracted text string (not prefixed with "error:").

### AC1.3: web_fetch returns "blocked_domain" for URLs in config/blocked_domains.yaml

- **Criterion text:** web_fetch returns "blocked_domain" for URLs in config/blocked_domains.yaml
- **Test type:** Unit
- **Test file:** `tests/test_tool_executor.py`
- **Test class/method:** `TestWebFetch::test_fetch_blocked_domain`
- **Description:** Calls `web_fetch` with a URL whose domain is in the blocked set. Asserts return value is `"error: blocked_domain"`. Verifies no HTTP request is made (mock not called).

### AC1.4: web_fetch returns error string for HTTP 403/404/timeout responses

- **Criterion text:** web_fetch returns error string for HTTP 403/404/timeout responses
- **Test type:** Unit
- **Test file:** `tests/test_tool_executor.py`
- **Test class/method:** `TestWebFetch::test_fetch_http_403`, `TestWebFetch::test_fetch_http_404`, `TestWebFetch::test_fetch_timeout`
- **Description:** Three separate tests. (1) Mock `httpx.get` returning status 403, assert returns `"error: HTTP 403 Forbidden"`. (2) Mock returning 404, assert returns `"error: HTTP 404 Not Found"`. (3) Mock raising `httpx.TimeoutException`, assert returns `"error: timeout"`.

### AC1.5: web_search returns empty list with error note when SearXNG is unreachable

- **Criterion text:** web_search returns empty list with error note when SearXNG is unreachable
- **Test type:** Unit
- **Test file:** `tests/test_tool_executor.py`
- **Test class/method:** `TestWebSearch::test_search_searxng_unreachable`
- **Description:** Mocks `httpx.get` to raise `httpx.ConnectError`. Asserts returned list contains a single dict with an `"error"` key whose value mentions "unreachable".

---

## AC2: Runner produces structured verdicts via OpenRouter

These criteria verify the verdict runner's two-phase execution (investigation loop + structured output), tool call dispatch, cost capture, and error handling. All tests use mocked OpenAI client responses (no live OpenRouter calls required).

### AC2.1: Runner completes a two-phase verdict (investigation + structured output) for each model

- **Criterion text:** Runner completes a two-phase verdict (investigation + structured output) for each model
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestRunInvestigationPhase::test_investigation_completes_with_tool_calls`
- **Description:** Mocks the OpenAI client's `chat.completions.create`. First call returns `finish_reason="tool_calls"` with one tool call. Second call returns `finish_reason="stop"` with content. Asserts the function returns messages with tool results appended and cumulative token counts. Combined with `TestRunVerdictPhase` tests, this covers the full two-phase flow.

### AC2.2: Verdict JSON contains verdict, rationale, and sources matching the schema

- **Criterion text:** Verdict JSON contains verdict, rationale, and sources matching the schema
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestRunVerdictPhase::test_verdict_phase_parses_valid_json`
- **Description:** Mocks client response with valid JSON content matching the verdict schema (`verdict`, `rationale`, `sources` with `url`, `supports_claim`, `provenance`). Asserts parsed verdict dict contains all required fields with correct types.

### AC2.3: Runner captures prompt_tokens, completion_tokens, and cost_usd per verdict

- **Criterion text:** Runner captures prompt_tokens, completion_tokens, and cost_usd per verdict
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestFetchGenerationCost::test_cost_capture`
- **Description:** Mocks `httpx.get` to return a generation endpoint response with `native_tokens_prompt`, `native_tokens_completion`, `total_cost` fields. Asserts function extracts the correct values into `prompt_tokens`, `completion_tokens`, `cost_usd`.

### AC2.4: Malformed tool call arguments return error string to model without crashing

- **Criterion text:** Malformed tool call arguments return error string to model without crashing
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestDispatchToolCall::test_malformed_json_arguments`
- **Description:** Creates a mock tool call with `function.arguments = "not json"`. Asserts `dispatch_tool_call` returns an error string mentioning the parse error. Asserts no exception is raised.

### AC2.5: Unknown tool names return error listing valid tools

- **Criterion text:** Unknown tool names return error listing valid tools
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestDispatchToolCall::test_unknown_tool_name`
- **Description:** Creates a mock tool call with `function.name = "unknown_tool"`. Asserts return value is an error string that lists the valid tools (`web_search`, `web_fetch`).

### AC2.6: finish_reason=length logged as incomplete, verdict saved with available data

- **Criterion text:** finish_reason=length logged as incomplete, verdict saved with available data
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestRunInvestigationPhase::test_finish_reason_length_incomplete`
- **Description:** Mocks a response with `finish_reason="length"`. Asserts the function returns with an incomplete status flag set to `True`, and that available messages/data are preserved (not discarded).

---

## AC3: Unattended execution with checkpoint/resume

These criteria verify checkpoint persistence, resume behavior, per-verdict timeouts, and interleaved execution ordering. Tests use temporary files and controlled functions (no live services required).

### AC3.1: Runner resumes from checkpoint, skipping completed (edit_rcid, model) pairs

- **Criterion text:** Runner resumes from checkpoint, skipping completed (edit_rcid, model) pairs
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestCheckpoint::test_load_and_skip_completed`
- **Description:** Creates a checkpoint file with known completed pairs via `save_checkpoint`. Calls `load_checkpoint`. Asserts the loaded set matches. Simulates the main loop's skip logic by filtering execution pairs against the completed set and verifying already-done pairs are excluded.

### AC3.2: Checkpoint file updated after each successful verdict

- **Criterion text:** Checkpoint file updated after each successful verdict
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestCheckpoint::test_incremental_save`
- **Description:** Starts with empty checkpoint. Calls `save_checkpoint` with one pair, reads the YAML file, asserts it contains one entry. Adds a second pair, saves again, asserts file now contains both entries. Uses `tmp_path` fixture.

### AC3.3: Per-verdict timeout at 180s logs timeout: true and continues to next

- **Criterion text:** Per-verdict timeout at 180s logs timeout: true and continues to next
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestTimeout::test_timeout_triggers`
- **Description:** Creates a function that sleeps for 5 seconds. Calls `run_with_timeout` with `timeout_secs=1`. Asserts `timed_out` is `True` and result is `None`. A complementary test verifies successful execution within timeout returns the result with `timed_out=False`.

### AC3.4: Interleaved execution order gives comparable model coverage on partial runs

- **Criterion text:** Interleaved execution order gives comparable model coverage on partial runs
- **Test type:** Unit
- **Test file:** `tests/test_verdict_runner.py`
- **Test class/method:** `TestBuildExecutionOrder::test_interleaved_order`
- **Description:** Passes 2 edits and 3 models to `build_execution_order`. Asserts result ordering is `[(edit1, modelA), (edit1, modelB), (edit1, modelC), (edit2, modelA), (edit2, modelB), (edit2, modelC)]` -- models interleaved per edit, so stopping at any point yields proportional coverage across all models.

---

## AC4: Full pipeline produces 2000 verdicts

These criteria cover the enrichment run and end-to-end pipeline validation. They require live infrastructure (SearXNG, OpenRouter API, production Wikidata read access) and cannot be fully automated in the unit test suite.

### AC4.1: 500-edit enriched snapshot fetched and saved via existing pipeline

- **Criterion text:** 500-edit enriched snapshot fetched and saved via existing pipeline
- **Test type:** E2E (manual)
- **Verification approach:** Run `uv run python scripts/fetch_patrol_edits.py -u 500 --enrich`. Verify the resulting YAML snapshot in `logs/wikidata-patrol-experiment/snapshot/` contains 500 edits, each with `parsed_edit` and `item` keys. See Phase 6, Task 1, Step 2 for the validation script.

### AC4.2: All 4 models produce verdicts for a small sample (2-3 edits) in end-to-end test

- **Criterion text:** All 4 models produce verdicts for a small sample (2-3 edits) in end-to-end test
- **Test type:** E2E (manual)
- **Verification approach:** With SearXNG running and `OPENROUTER_API_KEY` set, run `uv run python scripts/run_verdict_fanout.py --snapshot [SNAPSHOT] --limit 2`. Verify 8 verdict YAML files are produced in `logs/wikidata-patrol-experiment/verdicts-fanout/`, with 2 verdicts per model. Verify checkpoint contains 8 completed pairs. Re-run the same command and verify all pairs are skipped (resume works).

### AC4.3: Verdict YAML files match the trimmed schema with all required fields

- **Criterion text:** Verdict YAML files match the trimmed schema with all required fields
- **Test type:** E2E (manual)
- **Verification approach:** After AC4.2, run the validation script from Phase 6, Task 2, Step 3 that checks each verdict file for the required fields: `model`, `edit_rcid`, `qid`, `property`, `diff_type`, `timestamp`, `verdict`, `rationale`, `sources`, `token_usage` (with `prompt_tokens`, `completion_tokens`, `turns`), `cost_usd`, `timeout`. All files should report "OK".

---

## Human Verification

The following criteria cannot be fully automated and require human verification during or after Phase 6 execution.

### AC4.1 -- Enrichment run (live infrastructure)

**Justification:** Requires live read access to production Wikidata's RecentChanges API. The existing `fetch_patrol_edits.py` script is already tested separately (existing test suite covers enrichment logic), but the 500-edit run itself depends on network access and API availability.

**Verification approach:** Execute the enrichment command, then run the validation script that counts edits and checks for enrichment keys. Document the snapshot filename and edit count.

### AC4.2 -- Multi-model E2E (live OpenRouter + SearXNG)

**Justification:** Requires live OpenRouter API calls (costs real money, ~$0.01 for 2 edits x 4 models), running SearXNG container, and network access to both. Cannot be mocked without defeating the purpose of E2E validation.

**Verification approach:** Run the verdict runner with `--limit 2`. Check verdict file count, per-model distribution, and checkpoint state. Verify resume by re-running the same command.

### AC4.3 -- Schema validation (depends on AC4.2 output)

**Justification:** Validates the actual output files from AC4.2, which are produced by live API calls. The schema itself is verified in unit tests (`TestSaveVerdict`), but the E2E check confirms that real model responses + real cost data + real tool calls produce conformant output.

**Verification approach:** Run the field-checking script from Phase 6 against all verdict files in `verdicts-fanout/`.

### Phase 3 -- SIFT prompt adaptation (manual inspection)

**Justification:** No AC assigned, but the prompt must not contain Claude-specific references. This is a text artifact, not testable code.

**Verification approach:** Run `grep -iE "(WebSearch|WebFetch|Haiku|Sonnet|Opus|Claude|Save Log|Step 7)" config/sift_prompt_openrouter.md` and confirm no matches.

---

## Summary Table

| Criterion | Test File | Test Class / Method Pattern | Type |
|-----------|-----------|---------------------------|------|
| AC1.1 | `tests/test_tool_executor.py` | `TestWebSearch::test_search_returns_results` | Unit |
| AC1.2 | `tests/test_tool_executor.py` | `TestWebFetch::test_fetch_extracts_text` | Unit |
| AC1.3 | `tests/test_tool_executor.py` | `TestWebFetch::test_fetch_blocked_domain` | Unit |
| AC1.4 | `tests/test_tool_executor.py` | `TestWebFetch::test_fetch_http_403`, `test_fetch_http_404`, `test_fetch_timeout` | Unit |
| AC1.5 | `tests/test_tool_executor.py` | `TestWebSearch::test_search_searxng_unreachable` | Unit |
| AC2.1 | `tests/test_verdict_runner.py` | `TestRunInvestigationPhase::test_investigation_completes_with_tool_calls` | Unit |
| AC2.2 | `tests/test_verdict_runner.py` | `TestRunVerdictPhase::test_verdict_phase_parses_valid_json` | Unit |
| AC2.3 | `tests/test_verdict_runner.py` | `TestFetchGenerationCost::test_cost_capture` | Unit |
| AC2.4 | `tests/test_verdict_runner.py` | `TestDispatchToolCall::test_malformed_json_arguments` | Unit |
| AC2.5 | `tests/test_verdict_runner.py` | `TestDispatchToolCall::test_unknown_tool_name` | Unit |
| AC2.6 | `tests/test_verdict_runner.py` | `TestRunInvestigationPhase::test_finish_reason_length_incomplete` | Unit |
| AC3.1 | `tests/test_verdict_runner.py` | `TestCheckpoint::test_load_and_skip_completed` | Unit |
| AC3.2 | `tests/test_verdict_runner.py` | `TestCheckpoint::test_incremental_save` | Unit |
| AC3.3 | `tests/test_verdict_runner.py` | `TestTimeout::test_timeout_triggers` | Unit |
| AC3.4 | `tests/test_verdict_runner.py` | `TestBuildExecutionOrder::test_interleaved_order` | Unit |
| AC4.1 | -- | Manual: run enrichment, validate snapshot | E2E |
| AC4.2 | -- | Manual: run runner with --limit 2, check output | E2E |
| AC4.3 | -- | Manual: validate verdict YAML fields | E2E |

### Supporting tests (not directly mapped to ACs)

These tests appear in the implementation plans and provide additional coverage without mapping to a specific AC:

| Test File | Test Class / Method Pattern | What It Covers |
|-----------|---------------------------|----------------|
| `tests/test_tool_executor.py` | `TestWebSearch::test_search_filters_blocked_domains` | Blocked domains filtered from search results |
| `tests/test_tool_executor.py` | `TestWebSearch::test_search_caps_at_10` | Result count cap |
| `tests/test_tool_executor.py` | `TestWebFetch::test_fetch_extraction_empty` | trafilatura returns None |
| `tests/test_tool_executor.py` | `TestWebFetch::test_fetch_truncation` | Long page text truncated at 15K chars |
| `tests/test_tool_executor.py` | `TestLoadBlockedDomains::test_load_from_yaml` | YAML config parsing |
| `tests/test_tool_executor.py` | `TestLoadBlockedDomains::test_missing_file` | Graceful empty set on missing file |
| `tests/test_tool_executor.py` | `TestIsBlockedDomain::test_exact_match` | Domain exact match |
| `tests/test_tool_executor.py` | `TestIsBlockedDomain::test_subdomain_match` | Subdomain matching |
| `tests/test_tool_executor.py` | `TestIsBlockedDomain::test_non_match` | Non-blocked domain passes through |
| `tests/test_verdict_runner.py` | `TestDispatchToolCall::test_dispatch_web_search` | Successful web_search dispatch |
| `tests/test_verdict_runner.py` | `TestDispatchToolCall::test_dispatch_web_fetch` | Successful web_fetch dispatch |
| `tests/test_verdict_runner.py` | `TestRunInvestigationPhase::test_max_turns_enforcement` | Loop stops after MAX_TURNS |
| `tests/test_verdict_runner.py` | `TestRunVerdictPhase::test_invalid_json_response` | Graceful handling of non-JSON response |
| `tests/test_verdict_runner.py` | `TestFetchGenerationCost::test_non_200_response` | Returns None on failed cost fetch |
| `tests/test_verdict_runner.py` | `TestSaveVerdict::test_yaml_output` | File path format and YAML content |
| `tests/test_verdict_runner.py` | `TestBuildEditContext::test_context_includes_question_and_warnings` | Verification question and ontological warnings |
| `tests/test_verdict_runner.py` | `TestCheckpoint::test_missing_file` | Empty set on nonexistent checkpoint |
| `tests/test_verdict_runner.py` | `TestTimeout::test_successful_within_timeout` | Normal execution returns result |
| `tests/test_verdict_runner.py` | `TestTimeout::test_exception_propagation` | Exceptions re-raised through timeout wrapper |
