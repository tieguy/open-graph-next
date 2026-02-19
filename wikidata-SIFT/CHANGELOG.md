# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Capture token cost per SIFT-Patrol verdict (#21)

### Fixed

### Changed
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
