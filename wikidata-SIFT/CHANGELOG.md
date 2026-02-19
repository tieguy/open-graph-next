# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Multi-model verdict fanout via OpenRouter (#23)
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
