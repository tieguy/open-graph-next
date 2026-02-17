# SIFT-Patrol Experiment Design

## Summary

This design specifies an LLM-assisted fact-checking pipeline for evaluating Wikidata statement edits made by new contributors. Unlike existing approaches that verify entire items, this system operates on individual edits — the atomic unit that human patrollers actually review. The core question is: "After applying LLM recommendations (adding missing references or rejecting contradicted claims), would unpatrolled edits be acceptable to human reviewers at rates comparable to edits from trusted contributors?"

The pipeline fetches unpatrolled statement edits from production Wikidata via the RecentChanges API, extracts the specific claim change from revision diffs, applies the SIFT methodology (Stop, Investigate the source, Find better coverage, Trace claims to primary sources) to verify factual correctness, classifies edits as verified/needy/unverifiable/contradicted, and drafts fixes for edits that need references added. The experiment compares 50 unpatrolled edits against 50 autopatrolled control edits to measure whether LLM-assisted review can achieve parity with Wikidata's existing trust mechanisms. All verification steps are logged with resource tracking (model, tokens, time) to understand real-world cost and scalability. This is read-only research against production Wikidata — no edits are executed, only proposed and logged for human review.

## Definition of Done

- Phase 0 prototype completed on 10 unpatrolled statement edits with full SIFT pipeline
- Phase 1 completed: 50 unpatrolled edits + 50 autopatrolled control edits processed through edit-centric SIFT
- Human review of all 100 edits with patrol-acceptance judgments
- Primary metric calculated: patrol-acceptance parity between LLM-assisted unpatrolled edits and autopatrolled edits
- Failure modes categorized and documented
- Per-step resource usage (model, tokens, time) logged for all edits
- YAGO type validation research documented separately in `docs/yago-type-validation-research.md`
- Analysis script produces aggregate metrics from YAML logs
- All results logged in structured YAML format

## Glossary

- **Autopatrolled**: Trust flag granted to experienced Wikidata editors whose edits skip the patrol queue. These edits represent the community's baseline for "acceptable quality without review."
- **Patrol queue**: Wikidata's review system where recent edits by new/non-trusted users await verification by experienced volunteers before being marked as verified.
- **rcid**: Recent Changes ID — unique identifier for an edit in Wikidata's revision history, used to fetch and reference specific edits.
- **RecentChanges API**: Wikidata/MediaWiki API endpoint for querying recent edits with filters (time range, patrol status, namespace, tags).
- **SIFT methodology**: Fact-checking framework (Stop, Investigate the source, Find better coverage, Trace claims) adapted for Wikidata verification in this project's `docs/wikidata-methodology.md`.
- **Statement edit**: Modification of a single Wikidata claim (property-value pair), as opposed to label edits, description edits, or sitelink changes.
- **WikibaseQualityConstraints**: Wikidata's built-in constraint validation system that checks structural correctness (type constraints, value formats, ranges, conflicts) on item page loads.
- **ORES/LiftWing**: Wikidata's machine learning service that scores edits for vandalism probability and quality issues.
- **Namespace 0**: MediaWiki namespace for main content pages (items in Wikidata). Edits outside this namespace are talk pages, user pages, or metadata.
- **Pywikibot**: Python library for automated interaction with Wikimedia wikis, used in this project for read-only access to production Wikidata and read-write access to test.wikidata.org.
- **Stratified sampling**: Statistical sampling method ensuring representation across categories (here: edit types, property diversity, entity types) rather than random selection.
- **YAGO**: Knowledge graph project (from Max Planck Institute) researching automated type constraint validation and knowledge base repair, referenced here as prior art for structural validation.
- **Edit-centric vs. item-centric**: Architectural distinction — edit-centric analysis evaluates individual changes ("is this specific diff correct?") while item-centric analysis evaluates complete items ("what claims should Q42 have?"). Patrol workflows are inherently edit-centric.
- **Draft fix**: Proposed remediation for a "needy" edit, logged as a suggestion (e.g., "add reference URL") but not executed against production Wikidata.
- **Patrol-acceptance parity**: Primary success metric — the rate at which unpatrolled edits (after hypothetically applying LLM recommendations) would be accepted by human reviewers, compared to the acceptance rate of autopatrolled control edits.

## Architecture

Edit-centric SIFT verification pipeline that evaluates individual unpatrolled Wikidata statement edits for factual accuracy, classifies them, and drafts improvements for needy edits.

**Why edit-centric, not item-centric:** Patrol operates on diffs — "is this specific change correct?" — not on items. The existing methodology-testing skill asks "what claims should Q42 have?" which is a different question. Edit-centric analysis matches how patrollers actually work and is more scalable.

**Why factual verification, not structural checks:** Wikidata's WikibaseQualityConstraints extension already checks 25+ constraint types (type, value type, format, range, single-value, conflicts-with) on every item page load. ORES/LiftWing scores edits for vandalism probability. Abuse filters catch text-level abuse. The gap that requires human patrollers is: **structurally valid but factually wrong claims, missing references, and subtle good-faith errors.** This is where SIFT adds value.

**Pipeline per edit:**

```
Fetch unpatrolled edit via RecentChanges API
    → Parse diff: property, old value, new value, references
    → Fetch item context: label, description, P31, existing claims
    → Apply edit-centric SIFT (web search for multiple corroborating sources)
    → Classify: verified | needy | unverifiable | contradicted
    → Draft fix for needy edits (e.g., "add reference P854 to [url]")
    → Log structured YAML with per-step resource tracking
```

**Experiment structure:**

| Group | Size | Purpose |
|-------|------|---------|
| Unpatrolled edits | 50 | Target population — statement edits by non-autoconfirmed users |
| Autopatrolled edits | 50 | Control group — edits Wikidata considers "good enough to skip review" |

**Primary success criterion:** After hypothetically applying LLM recommendations (fixes for needy, rejection of contradicted), would a human patroller accept the unpatrolled edits at a rate comparable to the autopatrolled control group?

**Data collection:** Batch-fetch via `site.recentchanges()` with `patrolled=False` for unpatrolled and `patrolled=True` (autopatrolled) for control. Filter to namespace 0, statement-change tags (`new editor changing statement`, `new editor removing statement`). Save raw edit data as reproducible snapshot before analysis.

## Existing Patterns

This design builds on the existing methodology-testing skill (`skills/wikidata-methodology-testing/SKILL.md`) and its associated infrastructure.

**Patterns followed:**
- SIFT methodology from `docs/wikidata-methodology.md` — Stop, Investigate, Find better coverage, Trace
- Structured YAML logging to `logs/` directories with machine-readable schemas
- `scripts/verify_qid.py` for guarding against hallucinated Q-ids
- `scripts/check_redundancy.py` for detecting duplicate claims
- `scripts/analyze_test_results.py` as model for aggregate analysis scripts
- Source reliability taxonomy (1-5 scale) and confidence levels (high/medium/low)
- Human verification fields in logs, filled post-hoc

**Patterns extended:**
- Unit of analysis shifts from item+property to edit (keyed by rcid, not Q-id/P-id)
- Classification categories shift from "is this claim correct?" to "is this edit good/needy/unverifiable/contradicted?"
- Logging schema adds edit context (rcid, revision, user, tags, old/new values) and draft fixes
- Resource tracking added per-step with model identification
- Control group (autopatrolled edits) is a new experimental design element

**New patterns introduced:**
- Edit fetching via `site.recentchanges()` with patrol status filtering — no existing code for this
- Edit diff parsing to extract specific claim changes from revision comparisons
- Separate log directories for experiment groups (`control/` subdirectory)

## Implementation Phases

### Phase 1: Edit Fetcher and Snapshot Infrastructure
**Goal:** Fetch unpatrolled and autopatrolled statement edits from production Wikidata and save as reproducible snapshots.

**Components:**
- `scripts/fetch_patrol_edits.py` — Fetches recent changes via pywikibot's `site.recentchanges()`, filters by patrol status, namespace, and tags. Saves raw edit metadata (rcid, revisions, user, timestamp, tags, edit summary) as YAML snapshot.
- `logs/wikidata-patrol-experiment/snapshot/` — Directory for raw edit data snapshots

**Dependencies:** None

**Done when:** Can fetch unpatrolled and autopatrolled statement edits from production Wikidata, save as timestamped snapshot files, and reload them for processing

### Phase 2: Edit Diff Parser
**Goal:** Extract the specific claim change from each edit's old and new revisions.

**Components:**
- Diff parsing module (in `scripts/` or `skills/`) — Compares old and new item revisions to identify: which property changed, old value, new value, value types, whether references were included, whether it's an addition/change/removal
- Integration with `scripts/verify_qid.py` for any Q-id values in edits

**Dependencies:** Phase 1 (edit snapshots to parse)

**Done when:** Given an edit's old and new revision IDs, can extract structured diff showing exactly what claim changed and how

### Phase 3: Edit-Centric SIFT Skill
**Goal:** Adapt SIFT methodology for edit verification and build the classification pipeline.

**Components:**
- `skills/wikidata-patrol-experiment/SKILL.md` — Edit-centric SIFT skill that takes an edit diff and applies optimized verification:
  - Targeted search for the specific property and topic (but requiring multiple independent sources)
  - Removal-specific SIFT when statements are deleted (checking whether removed value was well-sourced)
  - Classification into verified/needy/unverifiable/contradicted with confidence levels
  - Draft fix generation for needy edits
- Extended YAML logging schema in `logs/wikidata-patrol-experiment/` with edit context, classification, draft fixes, and per-step resource tracking (model, tokens, time per step)

**Dependencies:** Phase 2 (diff parser provides structured input)

**Done when:** Can process an edit through full SIFT pipeline and produce structured YAML log with classification, draft fix, and resource usage

### Phase 4: Phase 0 Prototype Run (10 Edits)
**Goal:** Validate the pipeline end-to-end on a small sample before scaling up.

**Components:**
- Fetch and snapshot 10 unpatrolled statement edits
- Run full pipeline on all 10
- Human review of all 10 — do classifications make sense? Are draft fixes useful? What breaks?
- Cost/time measurement per edit

**Dependencies:** Phases 1-3 (full pipeline built)

**Done when:** 10 edits processed, human-reviewed, pipeline issues identified and fixed, per-edit cost baseline established. Go/no-go decision for Phase 1 full run.

### Phase 5: Full Experiment Run (50 + 50)
**Goal:** Execute the full experiment with stratified sampling.

**Components:**
- Fetch metadata for ~500 unpatrolled statement edits
- Select stratified sample of 50 (by edit type, property diversity, entity type)
- Fetch matched sample of 50 autopatrolled edits from same time window
- Run full SIFT pipeline on all 100 edits
- Logs written to `logs/wikidata-patrol-experiment/` (unpatrolled) and `logs/wikidata-patrol-experiment/control/` (autopatrolled)

**Dependencies:** Phase 4 (prototype validated, pipeline issues fixed)

**Done when:** 100 YAML log files produced with classifications, draft fixes, and resource usage

### Phase 6: Human Review and Analysis
**Goal:** Measure patrol-acceptance parity and analyze results.

**Components:**
- Human review of all 100 logs, filling `human_verification` sections with patrol-acceptance judgment
- `scripts/analyze_patrol_results.py` — Computes primary metric (patrol-acceptance parity), plus secondary metrics: accuracy by edit type/property/entity type, false positive rate on control group, draft fix usefulness, cost per edit, failure mode distribution
- Results written to `docs/patrol-experiment-results.md`

**Dependencies:** Phase 5 (experiment data collected)

**Done when:** All 100 edits human-reviewed, analysis script produces aggregate metrics, results documented with findings and failure mode analysis

## Additional Considerations

**SIFT optimization for edits — what changes and what doesn't:** The edit-centric context means we know exactly which claim to verify (narrower search than item-centric). But we must still search for the topic and property broadly and require multiple independent sources. A single source confirming the edit value is not sufficient — the "Find better coverage" step is not optional. The optimization is knowing what to search for, not reducing search depth.

**Structural/type validation deferred:** Research into YAGO's type constraint work (YAGO 4, ESWC 2020; Neural KB Repairs, ESWC 2021; WiKC, CIKM 2024) and Wikidata's native WikibaseQualityConstraints system revealed that structural checking is already well-covered. This research is documented in `docs/yago-type-validation-research.md` for potential future work layering on top of existing constraint checking. The current experiment focuses exclusively on the factual verification gap.

**Read-only against production Wikidata:** All pywikibot operations against production are read-only (fetching edits, item data, diffs). No writes to production. Draft fixes are logged as proposals, not executed. This matches the project's core principle of targeting test.wikidata.org only for writes.

**Statement removals deserve special attention:** When an editor removes a statement, SIFT should check whether the removed value was well-sourced. A removal of a referenced claim is more concerning than removal of an unreferenced one. This is a different verification question than checking additions/changes.
