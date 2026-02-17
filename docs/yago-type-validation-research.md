# YAGO Type Validation & Wikidata Constraint Systems: Research Notes

Last updated: 2026-02-16

## Purpose

Research collected during the SIFT-Patrol experiment design (see `docs/design-plans/2026-02-16-sift-patrol-experiment.md`). Documents why structural/type validation was excluded from the experiment — Wikidata already handles it — and provides a reference for future work that could layer on top of existing constraint checking.

## Why We're Not Reimplementing Structural Checks

Wikidata's WikibaseQualityConstraints extension already checks 25+ constraint types on every item page load. These include type constraints, value type constraints, format constraints, range constraints, single-value constraints, conflicts-with constraints, and qualifier constraints. While these are advisory (not blocking), the constraint checking infrastructure exists and covers ~99% of properties.

The gap that requires human patrollers is not structural — it's factual: structurally valid but factually wrong claims, missing references, and subtle good-faith errors. That's where SIFT adds value.

## Wikidata's Existing Automation Stack

```
EDIT SUBMITTED
    │
    ▼
Wikibase Core — Hard Blocks
  - Datatype mismatch → BLOCKED
  - Property label duplicate → BLOCKED
  - Everything else → ALLOWED THROUGH
    │
    ▼
WikibaseQualityConstraints — Advisory Warnings (25+ constraint types)
  - Shown on page load to logged-in users
  - NOT a save-time gate
  - Cached ~1 day
  - Anonymous users see nothing
  - API: action=wbcheckconstraints
    │
    ▼
ORES/LiftWing — Behavioral Scoring
  - Scores surface features (edit size, account age, patterns)
  - Does NOT understand semantic content of claims
    │
    ▼
Abuse Filters — Pattern Matching
  - Text-level abuse in labels/descriptions
  - Poorly adapted to structured data
    │
    ▼
Database Reports — Periodic Batch (12-36 hour lag)
    │
    ▼
HUMAN PATROLLERS
  - Factual errors, subtle mistakes, policy violations, semantic inconsistency
```

## YAGO's Approach to Type Validation

YAGO (Yet Another Great Ontology) treats Wikidata as a source of raw instance data, then filters through a strict type system during knowledge base construction. Unlike Wikidata's advisory constraints, YAGO enforces constraints as hard filters — violating facts are discarded.

### Scale of Violations Found

Of 474 million Wikidata facts mapped to Schema.org properties, YAGO removed 131.6 million (28%):
- 89 million domain constraint violations (wrong subject type for property)
- 42 million range/regex violations (wrong value type)
- 0.6 million cardinality violations

### Constraint Types YAGO Enforces

| Type | Description | Example |
|------|-------------|---------|
| Domain | Subject must be instance of required class | `birthPlace` requires subject to be `schema:Person` |
| Range | Value must be instance of required class or match datatype | `country of citizenship` requires a country item |
| Disjointness | Six top-level classes declared pairwise disjoint | Cannot be both `Person` and `Place` |
| Functional | At most one value per subject | `birthPlace` should have one value |
| Cardinality | Upper bounds beyond functional | Person has at most two parents |
| Regex | String values match pattern | Identifier format validation |

### YAGO vs. Wikidata Constraints

| Dimension | YAGO | Wikidata Native |
|-----------|------|-----------------|
| Philosophy | Enforce and discard | Flag and leave in place |
| Coverage | Only Schema.org-mapped properties | ~99% of all properties |
| Expressivity | ~6 constraint types (OWL 2 DL) | 30+ constraint types |
| Exceptions | Not modeled | P2303 qualifier |
| Enforcement | Hard filter at construction | Advisory warnings |

## Taxonomy Issues in Wikidata

YAGO 4.5 found structural problems in Wikidata's class hierarchy:
- 47 pairs of mutual subclass relationships (cycles of length 2)
- 15 cycles of length 3+
- 40,000 transitive redundant subclass links
- 9,000 subclass links violating disjointness
- 1.3 million unpopulated classes
- YAGO retained only 10,124 of Wikidata's ~2.4 million classes (99.6% reduction)

## Key Papers

1. **YAGO 4: A Reason-able Knowledge Base** — Tanon, Weikum, Suchanek. ESWC 2020. Core paper on domain/range/disjointness constraint enforcement. [PDF](https://suchanek.name/work/publications/eswc-2020-yago.pdf)

2. **YAGO 4.5: A Large and Clean Knowledge Base with a Rich Taxonomy** — Suchanek, Alam, Bonald, Paris, Soria. SIGIR 2024. Taxonomy integration and structural violations. [arXiv](https://arxiv.org/html/2308.11884v2)

3. **Neural Knowledge Base Repairs** — Tanon, Suchanek. ESWC 2021. ML approach to fixing constraint violations using historical edit patterns. Found 1M domain violations and 4.4M single-value violations as of March 2020. [PDF](https://suchanek.name/work/publications/eswc-2021.pdf)

4. **Refining Wikidata Taxonomy using Large Language Models (WiKC)** — Peng, Bonald, Alam. CIKM 2024. LLMs for taxonomy cleaning. Entity typing accuracy improved from 43% (raw Wikidata) to 70% (cleaned). [arXiv](https://arxiv.org/abs/2409.04056), [GitHub](https://github.com/peng-yiwen/WiKC)

5. **Formalizing and Validating Wikidata's Property Constraints using SHACL and SPARQL** — Ferranti, De Souza, Ahmetaj, Polleres. Semantic Web Journal, 2024. Complete SPARQL formulations for all 30+ Wikidata constraint types. [Journal](https://www.semantic-web-journal.net/content/formalizing-and-validating-wikidatas-property-constraints-using-shaclsparql)

6. **Formalizing Repairs for Wikidata Constraints** — Ferranti et al. ISWC 2025. A-box and T-box repairs, tracking constraint violation evolution over time. [PDF](https://aic.ai.wu.ac.at/~polleres/publications/ferr-etal-2025ISWC.pdf)

## Open-Source Tools

- [yago-naga/yago4](https://github.com/yago-naga/yago4) — Rust-based YAGO 4 pipeline with SHACL constraint definitions in `data/shapes.ttl`
- [yago-naga/yago-4.5](https://github.com/yago-naga/yago-4.5) — Python-based YAGO 4.5 pipeline with taxonomy cleaning
- [peng-yiwen/WiKC](https://github.com/peng-yiwen/WiKC) — LLM-cleaned Wikidata taxonomy
- [WikibaseQualityConstraints](https://github.com/wikimedia/mediawiki-extensions-WikibaseQualityConstraints) — Wikidata's native constraint extension

## Potential Future Work

If the SIFT-Patrol experiment succeeds at factual verification, a natural next step would be combining it with structural checking:

1. **Use `wbcheckconstraints` API as pre-filter** — Skip edits that already have constraint violations (existing systems flag those). Focus SIFT on structurally-valid edits.
2. **Layer YAGO-style disjointness reasoning** — Catch type errors that Wikidata's constraints miss (e.g., entity typed as both Person and Place).
3. **Apply WiKC taxonomy cleaning patterns** — Use LLM to evaluate whether P31/P279 (instance of/subclass of) edits make taxonomic sense.
4. **Neural KB Repairs approach** — Train on historical Wikidata edit patterns to suggest fixes for constraint violations, complementing SIFT's source-based verification.
