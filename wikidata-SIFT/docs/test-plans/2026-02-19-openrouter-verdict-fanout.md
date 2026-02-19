# Human Test Plan: OpenRouter Verdict Fanout

## Prerequisites

- SearXNG + Valkey running: `docker compose up -d` in the project root
- Verify SearXNG responds: `curl -s "http://localhost:8080/search?q=test&format=json" | python -m json.tool | head -5`
- `OPENROUTER_API_KEY` environment variable set with a valid key
- All unit tests passing: `uv run pytest tests/test_tool_executor.py tests/test_verdict_runner.py` (76 tests, 0 failures)

## Phase 1: SearXNG Operational Verification

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Run `curl -s "http://localhost:8080/search?q=Douglas+Adams&format=json" \| python -m json.tool \| head -20` | JSON response with `results` array containing objects with `title`, `url`, `content` keys. At least 1 result returned. |
| 1.2 | Run `curl -s "http://localhost:8080/search?q=nonexistent_gibberish_term_12345&format=json" \| python -m json.tool` | JSON response with empty or near-empty `results` array. No errors. |

## Phase 2: SIFT Prompt Adaptation (manual inspection)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Run `grep -iE "(WebSearch\|WebFetch\|Haiku\|Sonnet\|Opus\|Claude\|Save Log\|Step 7)" config/sift_prompt_openrouter.md` | No output (exit code 1). No Claude-specific references. |
| 2.2 | Open `config/sift_prompt_openrouter.md` and read the "Available Tools" section. | Should reference `web_search(query)` and `web_fetch(url)` as the two tools. |
| 2.3 | Read the "Output" section (Step 6). | Should describe YAML verdict output. No references to "Save Log" or Claude-specific steps. |

## Phase 3: Enrichment Run (AC4.1)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Run `uv run python scripts/fetch_patrol_edits.py -u 500 --enrich` | Script completes without error (15-30 min). |
| 3.2 | Check the newest file in `logs/wikidata-patrol-experiment/snapshot/` | YAML file with edit list. |
| 3.3 | Count edits in the snapshot | ~500 edits. |
| 3.4 | Spot-check 3 edits: verify each has `parsed_edit` and `item` keys. | All 3 contain enrichment keys. |

## Phase 4: Small-Sample E2E Run (AC4.2)

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Run `uv run python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --limit 2` | Prints progress, completes without crash. |
| 4.2 | Count verdict files in `logs/wikidata-patrol-experiment/verdicts-fanout/` | Exactly 8 files (2 edits x 4 models). |
| 4.3 | Verify per-model distribution (each model slug in exactly 2 filenames) | 2 per model. |
| 4.4 | Check checkpoint: count completed entries in `fanout-state.yaml` | 8 completed pairs. |
| 4.5 | Re-run the same command | All 8 pairs skipped. No new files. |

## Phase 5: Schema Validation (AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Check each verdict YAML for required fields: `model`, `rcid`, `title`, `timestamp`, `verdict`, `rationale`, `sources`, `prompt_tokens`, `completion_tokens`, `turns`, `cost_usd`, `diff_type` | All present. `verdict` is one of the valid values. |
| 5.2 | Verify `cost_usd` is a positive float for at least 6/8 verdicts | At least 6/8 have non-null cost. |
| 5.3 | Verify `turns >= 1` for non-timeout verdicts | All non-timeout verdicts have turns >= 1. |

## Resume After Partial Failure

1. Clear checkpoint and verdict files
2. Start `--limit 3` run (12 pairs), Ctrl+C after 3-4 verdicts
3. Verify verdict files and checkpoint entries match
4. Re-run same command; completed pairs skipped, remaining processed
5. After second run, verify 12 total verdict files

## Timeout Handling

1. If any verdicts timed out, check the YAML file
2. Verify it contains `timeout: true`, `verdict: null`, `rationale: null`, `sources: []`
3. Verify next verdict was still attempted

## Verdict Quality Spot-Check

Read 2-3 verdicts. Check that:
- Rationale references specific sources
- Sources list contains URLs actually consulted
- Verdict is consistent with rationale

## Traceability

| AC | Automated Test | Manual Step |
|----|----------------|-------------|
| AC1.1-1.5 | test_tool_executor.py (26 tests) | Phase 1 |
| AC2.1-2.6 | test_verdict_runner.py (50 tests) | Phase 4 |
| AC3.1-3.4 | test_verdict_runner.py (12 tests) | Phase 4, Resume scenario |
| AC4.1 | -- | Phase 3 |
| AC4.2 | -- | Phase 4 |
| AC4.3 | -- | Phase 5 |
