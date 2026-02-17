# SIFT-Patrol Enriched Snapshots Design

## Summary

This design extends the existing edit metadata fetcher (`scripts/fetch_patrol_edits.py`) to produce enriched snapshots that include full item context, resolved entity labels, and parsed edit summaries. Instead of implementing a separate revision diff parser (the original Phase 2 plan), enrichment happens in a single pipeline: the script parses standardized Wikibase edit summary comments to identify operations (create/update/remove), fetches the item state at the edited revision via pywikibot, resolves all Q-ids and P-ids to English labels using an in-memory cache, and for removals fetches the old revision to capture the removed claim. This produces self-contained snapshots where each edit includes the full claim structure (values, references, qualifiers) with human-readable labels, eliminating the need for downstream SIFT evaluation to make additional Wikidata API calls.

The enrichment is opt-in via an `--enrich` flag, preserving the existing metadata-only snapshot behavior. This design merges the original Phase 1 (metadata collection, already implemented) and Phase 2 (edit parsing) into a unified data collection step, while Phases 3-6 of the original experiment design (SIFT skill development, prototype run, full experiment, analysis) remain unchanged and will consume these enriched snapshots.

## Definition of Done

- **Enriched snapshots**: Each edit in the snapshot includes edit metadata (existing), current item claims/refs/qualifiers with English label+description, a parsed edit summary identifying operation/property/value, and for removals the removed claim data
- **Merged Phase 1+2**: The fetch script handles both data collection and edit summary parsing in a single pipeline, replacing the original Phase 1 (metadata only) and Phase 2 (separate diff parser)
- **Self-contained for SIFT**: Downstream phases (SIFT evaluation) can work entirely from snapshot data without additional API calls — all Q-ids and P-ids have resolved English labels
- **Existing design phases 3-6 unchanged**: The SIFT skill, prototype run, full experiment, and analysis phases from the original design remain as designed

## Glossary

- **pywikibot**: Python library for interacting with MediaWiki sites, including Wikidata. Provides high-level abstractions like `ItemPage` and `PropertyPage` for reading and writing structured data.
- **ItemPage**: Pywikibot object representing a Wikidata item (e.g., Q42). Calling `.get()` fetches its labels, descriptions, claims, and other properties from the API.
- **PropertyPage**: Pywikibot object representing a Wikidata property (e.g., P106 for "occupation"). Used to resolve property IDs to human-readable labels.
- **Wikibase**: The software powering Wikidata. Generates standardized edit summary comments like `/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]` for all claim edits.
- **Claim**: A single statement in Wikidata's data model. Contains a property (P-id), value (often a Q-id), rank, references, and qualifiers.
- **Q-id**: Wikidata entity identifier for items (e.g., Q5 = "human", Q117321337 = "singer-songwriter"). The enrichment resolves these to English labels.
- **P-id**: Wikidata property identifier (e.g., P31 = "instance of", P106 = "occupation"). The enrichment resolves these to English labels.
- **revid**: Revision ID in MediaWiki. Each edit to a Wikidata item creates a new revision. Fetching an item at a specific revid returns its state at that point in time.
- **old_revid**: The revision ID before the current edit. For removal operations, fetching the item at old_revid captures the claim that was deleted.
- **SIFT**: "Stop, Investigate, Find, Trace" — a fact-checking methodology this project uses to evaluate Wikidata edits (see `docs/wikidata-methodology.md`).
- **Recent Changes API**: MediaWiki API endpoint (`recentchanges()`) that returns edit metadata. The existing fetcher uses this; enrichment adds item data to each edit.
- **Label cache**: In-memory dictionary mapping entity IDs to English labels. Prevents redundant API calls when the same Q-id or P-id appears in multiple edits.
- **Edit summary**: Human-readable text describing what changed in an edit. Wikibase generates these automatically; they follow a parseable format like `/* operation:flags */ [[Property:P123]]: value`.
- **Reference**: In Wikidata's data model, a reference supports a claim with source information (e.g., "stated in: AllMusic"). Each claim can have zero or more references.
- **Qualifier**: In Wikidata's data model, a qualifier adds context to a claim (e.g., "start time: 1990" on an "occupation" claim). Each claim can have zero or more qualifiers.
- **Snapshot**: YAML file containing a batch of edit metadata, produced by `scripts/fetch_patrol_edits.py`. Enriched snapshots include full item context per edit.
- **Patrol**: Wikidata's review system for edits. The Recent Changes patrol feed surfaces unpatrolled edits from new editors for experienced users to review.

## Architecture

Extend `scripts/fetch_patrol_edits.py` with an `--enrich` flag that adds item data, resolved labels, and parsed edit summaries to each edit in the snapshot. Without the flag, the script behaves exactly as it does today (metadata-only snapshots).

**Enrichment pipeline per edit:**

```
Edit metadata from recentchanges()
  → Parse edit summary comment → extract operation, property, value
  → Fetch item at revid via pywikibot ItemPage → extract claims, refs, qualifiers, English label/description
  → Resolve all P-id and Q-id labels via label cache
  → For removals: fetch item at old_revid to capture removed claim
  → Save enriched edit to snapshot YAML
```

**Edit summary parsing.** Wikibase standardizes edit summary comments:
- `/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]` → update
- `/* wbcreateclaim-create:1| */ [[Property:P569]]: 8 March 1952` → create
- `/* wbremoveclaims-remove:1| */ [[Property:P21]]: [[Q6581097]]` → remove

The `parsed_edit` section extracts operation type, property ID, and raw value from these comments, eliminating the need for a general-purpose revision diff parser.

**Label resolution with caching.** An in-memory dict caches `{entity_id: english_label}` across the batch. Common properties (P31, P106, etc.) and values are fetched once and reused. For a batch of 50 edits, this reduces hundreds of potential lookups to ~50-200 unique fetches.

**Enriched snapshot schema per edit:**

```yaml
edits:
- # existing metadata (unchanged)
  rcid: 2540280597
  revid: 2464102037
  old_revid: 2464100657
  title: Q136291923
  user: "~2026-10645-04"
  timestamp: "2026-02-17T04:42:31Z"
  comment: "/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]"
  tags: ["new editor changing statement", "wikidata-ui"]

  # parsed edit summary (new)
  parsed_edit:
    operation: "wbsetclaim-update"
    property: "P106"
    property_label: "occupation"
    value_raw: "Q117321337"
    value_label: "singer-songwriter"

  # item context at current revision (new)
  item:
    label_en: "Some Person"
    description_en: "American musician"
    claims:
      P31:
        property_label: "instance of"
        statements:
          - value: "Q5"
            value_label: "human"
            rank: "normal"
            references:
              - P248:
                  property_label: "stated in"
                  value: "Q36578"
                  value_label: "AllMusic"
            qualifiers: {}
      P106:
        property_label: "occupation"
        statements:
          - value: "Q117321337"
            value_label: "singer-songwriter"
            rank: "normal"
            references: []
            qualifiers: {}

  # for removals only (new)
  removed_claim: null
```

For removal edits, `removed_claim` contains the claim structure from the old revision (same format as a statement in `item.claims`).

## Existing Patterns

This design extends the existing `scripts/fetch_patrol_edits.py` (implemented in Phase 1 of the original plan) and follows established codebase patterns.

**Patterns followed:**
- Item fetching via `pywikibot.ItemPage(repo, qid).get()` — used by `scripts/verify_qid.py` (lines 23-29) and `scripts/check_redundancy.py` (lines 45-75)
- Production read-only access via `pywikibot.Site('wikidata', 'wikidata')` — consistent with all existing scripts
- YAML logging with `yaml.safe_dump` — used by all log schemas in the project
- Self-contained scripts with argparse CLI — pattern established by `scripts/verify_qid.py`, `scripts/check_redundancy.py`, and `scripts/fetch_patrol_edits.py`
- Pywikibot's built-in throttling for rate limiting — no custom throttling in codebase (`throttle.ctrl` in `.gitignore`)

**New patterns introduced:**
- Revision-specific item fetching via `site.simple_request(action="wbgetentities", ids=qid, revids=revid)` — no existing code fetches specific revisions
- In-memory label cache for batch Q-id/P-id resolution — no existing caching pattern in codebase
- Edit summary comment parsing — Wikibase comment format not currently parsed anywhere

**Patterns extended:**
- Snapshot YAML schema extends the existing `fetch_date`/`label`/`count`/`edits` structure with nested `parsed_edit`, `item`, and `removed_claim` fields per edit

## Implementation Phases

This design revises the original SIFT-Patrol experiment design (`docs/design-plans/2026-02-16-sift-patrol-experiment.md`). The original Phase 1 (edit fetcher) is already implemented. This design replaces the original Phase 2 (separate diff parser) with enrichment integrated into the fetcher.

### Phase 1: Edit Summary Parser and Label Cache

**Goal:** Add edit summary parsing and a reusable label resolution cache to the fetch script.

**Components:**
- Edit summary parser in `scripts/fetch_patrol_edits.py` — regex-based extraction of operation type, property ID, and raw value from Wikibase comment format
- Label cache in `scripts/fetch_patrol_edits.py` — in-memory dict that resolves Q-ids and P-ids to English labels via `ItemPage.get()` / `PropertyPage.get()`, caching results across the batch
- Tests for edit summary parsing — verify extraction from all Wikibase comment formats (`wbsetclaim-update`, `wbcreateclaim-create`, `wbremoveclaims-remove`, `wbsetclaimvalue`, `wbsetreference`, `wbsetqualifier`)

**Dependencies:** Existing `scripts/fetch_patrol_edits.py` from prior implementation

**Done when:** Edit summaries from real snapshot data are correctly parsed into operation/property/value, label cache resolves Q-ids and P-ids to English labels, tests pass

### Phase 2: Item Enrichment and Snapshot Schema

**Goal:** Fetch full item data at the edit's revision and produce enriched snapshots.

**Components:**
- Item fetcher in `scripts/fetch_patrol_edits.py` — fetches item at `revid` using pywikibot, extracts English label, English description, and all claims with references/qualifiers in the simplified schema
- Claim serializer — converts pywikibot Claim objects to the YAML-friendly dict format (value, value_label, rank, references with labels, qualifiers with labels)
- Removal handler — for `wbremoveclaims` operations, fetches item at `old_revid` via `site.simple_request(action="wbgetentities")` to capture the removed claim
- `--enrich` CLI flag — opt-in enrichment; without it, script produces metadata-only snapshots as before
- Tests for claim serialization and enrichment pipeline

**Dependencies:** Phase 1 (edit summary parser and label cache)

**Done when:** `python scripts/fetch_patrol_edits.py --enrich --unpatrolled 5 --dry-run` produces enriched output with item data, resolved labels, and parsed edit summaries; snapshot YAML matches the schema defined in Architecture; removal edits include `removed_claim` data

## Additional Considerations

**Revision-specific fetching for removals.** When fetching the old revision to capture a removed claim, the item may have been further edited since `old_revid`. The `wbgetentities` API with `revids` parameter returns the item state at that exact revision, so this is safe. If the item has been deleted entirely (rare), the fetch will fail — log the error and set `removed_claim` to an error indicator rather than crashing the batch.

**Snapshot size.** Enriched snapshots will be significantly larger than metadata-only ones. A batch of 50 edits with full claim data and resolved labels is estimated at 500KB-5MB depending on item sizes. This is acceptable for a research experiment producing ~100 total edits.

**Relationship to original design.** This design document supplements `docs/design-plans/2026-02-16-sift-patrol-experiment.md`. After this work, the original design's Phase 2 (Edit Diff Parser) is complete. Phases 3-6 of the original design proceed unchanged — the edit-centric SIFT skill reads enriched snapshots instead of raw metadata.
