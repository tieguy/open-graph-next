# SIFT-Patrol Intermediate Synthesis #1

Date: 2026-02-17
Edits reviewed: 5 unpatrolled + 5 control (autopatrolled)
Snapshot files:
- `logs/wikidata-patrol-experiment/snapshot/2026-02-17-203320-unpatrolled.yaml`
- `logs/wikidata-patrol-experiment/control/2026-02-17-203409-control.yaml`

## What we did

Manually walked through SIFT on each unpatrolled edit, consulting the methodology docs (`docs/wikidata-methodology.md`) and design plan (`docs/design-plans/2026-02-16-sift-patrol-experiment.md`) as we went. Then reviewed the control edits for comparison.

## Edits reviewed

### Unpatrolled

| # | Item | Claim | Verdict | Notes |
|---|------|-------|---------|-------|
| 1 | Q138332576 (Serhii Rieznik) | employer → State Biotech Univ | Verified (high) | University staff page confirmed, academic pubs corroborate. Likely self-edit. |
| 2 | Q13571594 (The Rape of Europa) | instance of → painting | Verified (high) | Museo del Prado reference. Trivially correct given item context. |
| 3 | Q13571594 (The Rape of Europa) | creator → Peter Paul Rubens | Verified (high) | Multiple sources confirm. Surfaced modeling gap: missing P1877 (after a work by) → Titian qualifier. |
| 4 | Q544202 (Constancia de la Mora) | cause of death → car collision | Verified (high) | Multiple independent sources. Existing reference was weakest available. Sources disagree on details (bus vs car, sole vs multiple casualties). |
| 5 | Q138332576 (Serhii Rieznik) | employer → State Biotech Univ | Verified (high) | Duplicate of #1 — same item, same user, earlier revision. |

### Control (autopatrolled)

| # | Item | Claim | Method |
|---|------|-------|--------|
| 1 | Q130597918 (Kill Me Now) | Add reference to KOBIS film ID | QuickStatements batch |
| 2 | Q129262743 (Rodrigo Pachuca) | Add height: 190cm | HarvestTemplates (OAuth bot) |
| 3 | Q138332500 (Gabriela Czarny) | Add ORCID iD | Manual (wikidata-ui) |
| 4 | Q130597918 (Kill Me Now) | Create KOBIS film ID claim | QuickStatements batch |
| 5 | Q107882224 (BC Eagles volleyball) | sport → volleyball | Manual |

## Findings

### 1. SIFT steps have unequal weight in the Wikidata context

- **Stop**: Minimal value for structured Wikidata claims. Useful only for parsing the claim and flagging obvious red flags (vandalism, nonsensical values). In the original SIFT context this is about resisting emotional reaction — not really applicable here.
- **Investigate the source**: Core step. Fetch and read the cited reference. Classify it (primary/secondary, institutional/journalistic/etc).
- **Find better coverage**: Core step. Always search independently, even when the claim looks obvious. Edit #3 showed this pays off — "obviously Rubens" turned out to have a copy-after-Titian nuance.
- **Trace claims**: Variable value. For some claims (employer → staff page) the primary source is already cited. For others (cause of death) tracing to the original source reveals contradictions.

### 2. Property type changes the verification strategy

Different properties need different approaches:

| Property class | Examples | Verification strategy |
|---|---|---|
| Institutional affiliations | employer (P108), educated at (P69) | Check official org staff pages, directories, CVs |
| Biographical facts | cause of death (P509), birth/death dates | News archives, encyclopedias, official records; sensitive, may be contested |
| Classifications | instance of (P31) | Check against item context and modeling conventions |
| Creative attributions | creator (P170) | Museum catalogs, art databases; attribution can be complex (workshop, after, circle of) |
| External identifiers | ORCID (P496), KOBIS (P8921) | Cross-reference check: does this ID resolve to the right entity? Different from narrative SIFT |
| Quantities | height (P2048) | Source verification; mechanical but not trivial |

This suggests the prompt needs a **property-class dispatch** — not a unique prompt per property, but routing to different verification strategies based on claim type. To be refined as we see more examples.

### 3. Verdicts should always include concrete proposed improvements

Even "verified" edits can surface improvements:
- Missing qualifiers (P1877 after a work by → Titian on edit #3)
- Better references available than the one cited (edit #4: encyclopedia sources stronger than the cited web magazine)
- More specific modeling (edit #1: "lecturer" rather than generic employment)

The tool should always propose these as structured additions, not just notes. (Chainlink #15)

### 4. Source provenance must be honest

The tool must distinguish between:
- **Verified sources**: fetched and read by the tool, content confirms the claim
- **Reported sources**: mentioned by a secondary source but not directly checked

The LLM will naturally want to cite the most authoritative-sounding source whether or not it actually read it (e.g., proposing a NYT obituary as a reference based on an encyclopedia mentioning it exists). Reported sources should be flagged for human confirmation, not suppressed — they're useful leads. (Chainlink #16)

### 5. The diff gap is a critical limitation

The enrichment captures current state but not what changed. This caused:
- Duplicate verification (edits #1 and #5 are the same claim)
- Inability to distinguish value changes from reference additions
- Missing context for what the edit actually did

This is high-priority for the next infrastructure iteration. (Chainlink #14)

### 6. Sequential edits should be grouped

Multiple edits by the same user on the same item in the same session are common (3 of 5 unpatrolled edits were on Q16730218 by Faginjosh234 in the first batch; edits #1/#5 on Q138332576 by Serhey0211994 in the second). Patrollers review these as clusters, not independently. The pipeline should group by (item, user) to avoid redundant work. (Chainlink #17)

### 7. Unpatrolled and control edits test different things

Unpatrolled edits skew toward substantive claims made manually via wikidata-ui. Control edits skew toward external IDs and quantities added via tools (QuickStatements, HarvestTemplates). SIFT is designed for the former. The experiment may need stratification by claim type for a valid comparison, or separate verification strategies per claim type. (Chainlink #18)

External ID verification is not purely mechanical — matching a KOBIS film ID to the right film still requires contextual understanding — but it is a different analytical path from verifying "cause of death → car collision." (Chainlink #12 for longer-term external ID work.)

## Open chainlink issues from this round

| # | Summary | Priority |
|---|---------|----------|
| 12 | Use external IDs for cross-referencing/verification, not just skip them | Future |
| 13 | Refine evidence type taxonomy for edit-centric patrol | Future |
| 14 | Enrich snapshots with old-vs-new diff | High |
| 15 | Verdicts should include concrete proposed additions | Design |
| 16 | Distinguish verified vs reported sources in output | Design |
| 17 | Group sequential edits by (item, user) | Design |
| 18 | Experiment design: stratify by claim type for valid comparison | Design |

## Next steps

- Fetch another batch of unpatrolled edits for more variety (different property types, harder cases)
- Continue SIFT walk-throughs to find more failure modes before writing the prompt
- After sufficient examples: draft the SIFT-Patrol prompt structure
