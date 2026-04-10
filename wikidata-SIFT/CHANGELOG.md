# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Query-aware `web_fetch(url, query)`** in `scripts/tool_executor.py` — returns page lead + paragraphs matching query terms instead of blind truncation. Reduces per-fetch token cost while preserving buried facts (e.g. "Belgium" somewhere past the intro of a Wikipedia article). Configured via `FETCH_LEAD_CHARS`, `FETCH_MATCH_WINDOW`, `FETCH_MAX_MATCHES`, `FETCH_MAX_TOTAL_CHARS`, `FETCH_FALLBACK_CHARS` constants.
- **`scripts/prefetch_search_refs.py`** — eager pre-enrichment script that runs one web_search + top-3 web_fetch per edit and populates `prefetched_references` before the fanout runs. Intended to reduce per-edit turn counts across the ensemble. Not yet validated at scale.
- **`MODELS_NO_RESPONSE_FORMAT` set and `MODEL_EXTRA_BODY` map** in `scripts/run_verdict_fanout.py` — per-model workarounds for OpenRouter provider quirks (DeepInfra Nemotron rejects json_object, Nemotron/Gemma 4 are hybrid-thinking and need reasoning disabled).
- **Defensive guard on `response.choices = None`** in investigation loop — some providers (e.g. Novita for Gemma 4) return empty-choices responses mid-investigation. Loop now exits with `finish_status="empty_response"` instead of crashing.
- **`docs/wikicredcon-lightning-talk-2026.md`** — 3-slide lightning talk (Marp) for WikiCredCon 2026.
- **`docs/wikicredcon-lightning-talk-companion.md`** — Companion web page with all numbers, tables, false positive/negative analysis, Sarabadani 2017 head-to-head, prompt design notes, reproducibility instructions.
- **PR-AUC / ROC-AUC analysis and Sarabadani 2017 comparison** in `docs/preliminary-results-2026-04.md` — computed 2026-04-08 on the clean subset. Ensemble PR-AUC 0.510, ROC-AUC 0.826. Sarabadani content-only ROC-AUC 0.813.

### Fixed
- **Fanout state key changed from `rcid` to `revid`** in `scripts/run_verdict_fanout.py`. Pool B reverter-traced edits (fetched via revision-history API) have no rcid — 21% of the 2000-edit labeled snapshot. Keying state on rcid caused silent deduplication, which would have lost 42% of the reverted class from the re-run. `load_checkpoint` still reads old rcid-keyed entries via fallback.
- **None-safe sort in `save_checkpoint`** — previously crashed with `TypeError` when any state entry had a None key.
- **Item context budget reduced from 40% to 15% of context window** in `build_edit_context`. Mistral Small 3.2 was hitting >100% of its 131k context limit on edits with large item claim sets.

### Changed
- **Dropped Gemma 3 4B from the fanout lineup.** No Gemma 3 variant on OpenRouter supports tool calling; the April 5 plan to include it was infeasible.
- **Nemotron 3 Nano demoted to experimental.** Config-fixable via MODELS_NO_RESPONSE_FORMAT + reasoning-disable, but produces 78% MAX_TURNS and 89% unverifiable at scale — minimal ensemble signal. Kept in the script for experimentation but not recommended for production runs.
- **Recommended production lineup is back to the original Cheap-3**: Mistral Small 3.2 + OLMo 3.1 + DeepSeek V3.2. Verified in the 500-edit run, no runtime quirks.
- Updated `web_fetch` tool description in `config/sift_prompt_openrouter.md` to tell models to pass a focused query with every fetch.
- Remove Nemotron from verdict fanout model lineup (#36)
  - `scripts/run_verdict_fanout.py` — two-phase execution (investigation + structured verdict) across 4 models
  - `scripts/tool_executor.py` — `web_search()` via SearXNG and `web_fetch()` via httpx/trafilatura
  - `config/sift_prompt_openrouter.md` — model-agnostic SIFT prompt
  - `docker-compose.yml` — self-hosted SearXNG + Valkey for web search
  - Checkpoint/resume via `fanout-state.yaml`, per-verdict 180s timeout, interleaved execution order
  - Cost tracking via OpenRouter generation endpoint
  - 76 new tests (26 tool executor + 50 verdict runner), 220 total
- Capture token cost per SIFT-Patrol verdict (#21)

### Fixed

### Changed
- Remove Nemotron from verdict fanout model lineup (#36)
- SIFT verdicts should always include concrete proposed additions when modeling improvements are found, even for verified edits. Not just 'note this' but 'add P1877 (after a work by) → Q47551 (Titian)'. Any classification can carry draft fixes. (#15)
- Precheck: flag ontological property mismatches (P31/P279 sanity checks) (#32)
- SIFT prompt must distinguish between sources actually fetched/read vs sources mentioned by other sources. Don't propose references the tool hasn't verified. Laundering citations through secondary sources is a failure mode. (#16)
- External ID verification must cross-reference identity against item claims (#30)
- Fix API access: proper User-Agent on all requests + logged-in session (#27)
- Resume 50-edit Sonnet 4.6 run (36 remaining) (#29)
- LabelCache: fall back to non-English labels when English missing (#31)
- Consider two-stage-fanout model for SIFT-Patrol validation (#20)
- Execute methodology testing phases 1-2 (#9)
- Verify P106 (occupation) (#8)
- Verify P734 (family name) (#7)
- Verify P735 (given name) (#6)
- Verify P21 (sex/gender) (#5)
- Enhance Luis Villa (Q243905) (#3)
- Experiment design question: unpatrolled edits skew toward substantive claims (manual, wikidata-ui) while control edits skew toward identifiers/quantities (tool-assisted, QuickStatements). May need stratification by claim type for valid comparison, or separate verification strategies per claim type. (#18)
- SIFT-Patrol Phase 3: Draft the edit-centric SIFT prompt

Context: Completed first round of manual SIFT walk-throughs on 10 unpatrolled + 5 control edits. Full synthesis in docs/sift-patrol-synthesis-02.md.

What to do next:
1. Fix the diff gap (chainlink #14) — highest priority infra work. Without old-vs-new diffs we can't distinguish value changes from reference additions, and we waste effort on duplicate edits.
2. Fetch more diverse unpatrolled edits — we haven't seen needy/unverifiable/contradicted cases yet. Need removal edits, harder cases, different property types.
3. Do another round of manual SIFT walk-throughs on the new batch.
4. Draft the SIFT-Patrol prompt using the 5-step structure from the synthesis (Parse & Pre-check -> Investigate -> Find -> Trace -> Verdict).
5. Test the prompt against previously-reviewed edits to see if it reproduces manual findings.

Key design decisions still open (from synthesis):
- How much property-class dispatch to bake into the prompt?
- How to handle unreachable sources gracefully?
- What search depth budget per edit?
- How to handle sparse/unlabeled items?

Read docs/sift-patrol-synthesis-02.md for full context. Chainlink issues #12-#18 track specific sub-tasks. (#19)
- Consider grouping sequential edits by (item, user) in the SIFT pipeline to avoid duplicate verification. Flat edit list from RecentChanges doesn't reflect how patrollers actually review edit sessions. (#17)
- Enrich snapshots with old-vs-new diff: capture what the previous value was before the edit, not just current state. Critical for understanding what actually changed (value change vs reference addition vs qualifier update) (#14)
- Merge wikidata-llm-experiment repo into this project (#11)
- Research: Avoid redundant claims - P512 vs P69 with degree qualifier (#10)
- Verify P31 (instance of: human) (#4)
- Enhance Douglas Adams (Q42) (#2)
