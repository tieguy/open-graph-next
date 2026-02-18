# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

### Fixed

### Changed
- Consider grouping sequential edits by (item, user) in the SIFT pipeline to avoid duplicate verification. Flat edit list from RecentChanges doesn't reflect how patrollers actually review edit sessions. (#17)
- Enrich snapshots with old-vs-new diff: capture what the previous value was before the edit, not just current state. Critical for understanding what actually changed (value change vs reference addition vs qualifier update) (#14)
- Merge wikidata-llm-experiment repo into this project (#11)
- Research: Avoid redundant claims - P512 vs P69 with degree qualifier (#10)
- Verify P31 (instance of: human) (#4)
- Enhance Douglas Adams (Q42) (#2)
