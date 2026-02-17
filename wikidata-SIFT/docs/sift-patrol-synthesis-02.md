# SIFT-Patrol Full Synthesis: Walk-through Round 1

Date: 2026-02-17
Edits reviewed: 10 unpatrolled (2 batches) + 5 control (autopatrolled)
Supersedes: `docs/sift-patrol-synthesis-01.md` (intermediate)

## Purpose

Before writing a SIFT-Patrol prompt or skill, we manually walked through SIFT verification on real unpatrolled Wikidata edits. The goal was to understand what the process actually looks like for edit-centric verification, identify failure modes, and surface design decisions for the prompt.

## All edits reviewed

### Batch 2 (enriched snapshots)

| # | Item | User | Claim | Verdict | Key observation |
|---|------|------|-------|---------|-----------------|
| 1 | Q138332576 (Serhii Rieznik) | Serhey0211994 | employer → State Biotech Univ | Verified (high) | Self-edit; university staff page + academic pubs confirm |
| 2 | Q13571594 (The Rape of Europa) | ~2026-10673-79 | instance of → painting | Verified (high) | Trivially correct from item context |
| 3 | Q13571594 (The Rape of Europa) | ~2026-10673-79 | creator → Rubens | Verified (high) | Surfaced copy-after-Titian modeling gap (P1877) |
| 4 | Q544202 (Constancia de la Mora) | ~2026-10613-88 | cause of death → car collision | Verified (high) | Source contradictions (bus vs car); better sources available than cited; NYT obituary reported but unverified |
| 5 | Q138332576 (Serhii Rieznik) | Serhey0211994 | employer → State Biotech Univ | Verified (high) | Duplicate of #1 — diff gap caused redundant work |

### Batch 1 (no enrichment — 403 errors, pre-fix)

| # | Item | User | Claim | Verdict | Key observation |
|---|------|------|-------|---------|-----------------|
| 6 | Q16730218 (Joshua Fagin) | Faginjosh234 | occupation → record producer | Verified (medium) | Self-edit, no references; "record producer" may not be best fit vs "music producer" |
| 7 | Q16730218 (Joshua Fagin) | Faginjosh234 | notable work → Spirit Jumper | Verified (medium) | Self-edit, no references; press coverage supports notability but P800 is subjective |
| 8 | Q16730218 (Joshua Fagin) | Faginjosh234 | notable work → Spirit Jumper | Verified (medium) | Duplicate of #7 — sequential edit on same claim |
| 9 | Q138227815 (Spirit Jumper) | Faginjosh234 | instance of → animated music video | Verified (high) | Multiple press sources confirm; no references cited |
| 10 | Q108311539 (ArchivArte) | ~2026-10727-68 | instance of → art archive | Verified (medium) | Unlabeled item; P31 is correct but incomplete (also a Verein, gallery); inception date discrepancy |

### Control group (autopatrolled)

| # | Item | User | Claim | Method |
|---|------|------|-------|--------|
| C1 | Q130597918 (Kill Me Now) | ならちゃん | Add reference to KOBIS film ID | QuickStatements batch |
| C2 | Q129262743 (Rodrigo Pachuca) | Laurentius | Add height: 190cm | HarvestTemplates (OAuth) |
| C3 | Q138332500 (Gabriela Czarny) | Add ORCID iD | Manual (wikidata-ui) |
| C4 | Q130597918 (Kill Me Now) | ならちゃん | Create KOBIS film ID claim | QuickStatements batch |
| C5 | Q107882224 (BC Eagles volleyball) | Gymnicus | sport → volleyball | Manual |

## Findings: SIFT step weights

### Stop — minimal, reframe as "Parse & Pre-check"

In the original SIFT context, "Stop" means resist emotional reaction before sharing. For structured Wikidata claims there's no emotional pull. The useful residue is:

- **Parse the claim clearly**: what property, what value, what changed
- **Flag obvious red flags**: vandalism, nonsensical values, edit warring
- **Note editor context**: self-editing pattern (Faginjosh234 = Joshua Fagin, Serhey0211994 = Serhii Rieznik), temporary accounts, new editor tags
- **Check internal consistency**: does the value make sense given other claims on the item?

This step should be fast and cheap. It's a gate, not a deep analysis.

### Investigate the source — core step

Fetch and read the cited reference. Classify it using the evidence type taxonomy. In practice:

- **When a reference exists** (edits #1-5): check the URL is live, read it, assess whether it actually supports the claim, classify its authority level
- **When no reference exists** (edits #6-9): note the gap. The tool's value is finding sources the editor didn't cite.

The evidence type taxonomy from `docs/wikidata-methodology.md` needs to be flipped from "what source do I need?" to "how good is this source?" for edit evaluation. (Chainlink #13, deferred.)

### Find better coverage — core step, never skip

Always search independently, even for "obvious" claims. Specific payoffs we observed:

- Edit #3: "obviously Rubens" revealed copy-after-Titian nuance
- Edit #4: found better sources than the one cited (encyclopedia vs web magazine)
- Edit #6: found that "record producer" might not be the most precise classification
- Edit #10: found inception date discrepancy

Compute is cheap; rigor should be the default. No short-circuiting for "obvious" claims.

### Trace claims — valuable but situational

Tracing to primary sources was valuable for:
- Edit #4: contradictions between primary account and later retellings
- Edit #1: university staff page was already the primary source

Less relevant when the cited source is already primary (institutional pages, official records).

## Findings: property-class verification strategies

Different claim types need different verification approaches. Observed so far:

| Property class | Properties seen | Strategy | Search targets |
|---|---|---|---|
| Institutional affiliations | employer (P108) | Check official org pages | Staff directories, CVs, academic profiles |
| Biographical facts | cause of death (P509) | Consult multiple independent sources; sensitive | News archives, encyclopedias, official records |
| Classifications | instance of (P31) | Check item context + modeling conventions | Existing similar items, category norms |
| Creative attributions | creator (P170) | Museum/database cross-referencing; attribution nuance | Museum catalogs, art databases (RKD, etc.) |
| Occupations | occupation (P106) | Match to how reliable sources describe the person | Press coverage, institutional pages, professional profiles |
| Notability claims | notable work (P800) | Assess independent coverage | Press mentions, databases, review aggregators |
| External identifiers | ORCID, KOBIS, etc. | Cross-reference: does ID resolve to right entity? | Target database lookup |
| Quantities | height (P2048) | Source verification | Authoritative databases for the domain |

The prompt should route to different strategies based on claim type. Not a unique prompt per property, but a dispatch to the right verification approach. Some properties (P31, P106) may need additional checks against Wikidata modeling conventions — "is this the right value even if factually true?"

## Findings: output structure

### Classification categories

The design plan defines: verified / needy / unverifiable / contradicted. Walk-throughs suggest:

- **Verified (high)**: multiple independent sources confirm, or primary source directly supports
- **Verified (medium)**: confirmed by sources but with caveats (imprecise value, incomplete modeling, self-edit without references)
- **Needy**: factually plausible but lacks references, or cited reference doesn't fully support the claim
- **Unverifiable**: can't find sources to confirm or deny (not seen yet in our sample)
- **Contradicted**: sources actively disagree with the claim (not seen yet)

We didn't see needy/unverifiable/contradicted in this sample — all 10 edits were basically correct. This may be because new editor edits are mostly good-faith, or our sample is too small. Need harder cases.

### Every verdict should include proposed improvements

Even verified edits produce useful output:

| Edit | Improvement type | Specific proposal |
|---|---|---|
| #1 (Rieznik) | More specific modeling | Role qualifier: lecturer, not just employer |
| #3 (Rubens) | Missing qualifier | Add P1877 (after a work by) → Titian |
| #4 (de la Mora) | Better reference | Replace web magazine with encyclopedia source |
| #4 (de la Mora) | Reported source lead | NYT 1950-01-29 p22 obituary (not verified by tool) |
| #6 (Fagin) | Value precision | Q488205 (music producer) may fit better than Q183945 (record producer) |
| #6 (Fagin) | Missing claims | Additional occupations: director, software engineer |
| #6-9 (Fagin) | Missing references | No references cited; press coverage available |
| #10 (ArchivArte) | Incomplete P31 | Also a Verein (Q48204), gallery |
| #10 (ArchivArte) | Data discrepancy | Inception 1998 vs registration 2016 |
| #10 (ArchivArte) | Missing label | No English label or description |

### Source provenance tiers

The tool must be honest about what it actually read vs what it heard about:

- **Verified source**: tool fetched and read the URL, content supports the claim
- **Reported source**: cited by a secondary source the tool read, but not directly checked — flag for human confirmation

This prevents citation laundering (proposing a NYT obituary as a reference because an encyclopedia mentioned it). Reported sources are still valuable leads — just need the honesty tier. (Chainlink #16)

## Findings: infrastructure gaps

### Critical: diff gap (Chainlink #14, high priority)

The enrichment captures current item state but not what changed. Impact:

- **Duplicate work**: edits #1/#5 and #7/#8 verified the same claim twice
- **Can't distinguish edit types**: value change vs reference addition vs qualifier update are fundamentally different edits requiring different verification
- **Missing "before" state**: can't assess whether a P31 change from "sculpture" to "painting" is an improvement or vandalism

This is the single biggest infrastructure gap. The `wbsetclaim-update` operation in the edit summary tells us something changed, but not what. Fixing this requires fetching old and new revisions and diffing — which was the original `fetch_entity_at_revision` approach that hit 403s. Needs a pywikibot-based solution or the authenticated requests fix.

### Important: edit session grouping (Chainlink #17)

Of 10 unpatrolled edits, only 5 were independent (the rest were same-user-same-item clusters). The pipeline should group by (item, user, time window) to:
- Avoid redundant verification
- Provide session context ("this user made 4 related edits")
- Better match how human patrollers actually review

### Important: experiment design (Chainlink #18)

Unpatrolled and control edits have systematically different character:
- **Unpatrolled**: substantive claims (employer, creator, cause of death, occupation), manual (wikidata-ui), often self-edits
- **Control**: external IDs and quantities, tool-assisted (QuickStatements, HarvestTemplates, OAuth bots)

Direct comparison may not be meaningful. Options:
1. Stratify by claim type (compare substantive unpatrolled vs substantive control)
2. Develop separate verification paths for different claim types
3. Acknowledge the asymmetry in the analysis

## Findings: patterns in new editor behavior

From 10 unpatrolled edits across 5 unique users:

- **Self-editing is very common**: 2 of 4 identifiable users were editing their own items (Faginjosh234 = Joshua Fagin, Serhey0211994 = Serhii Rieznik). Not inherently wrong but means claims need external corroboration.
- **Reference quality varies widely**: some edits had good references (university staff page), some had weaker ones (partisan web magazine), some had none at all.
- **Edits come in session clusters**: users make multiple related edits in quick succession. Single-edit analysis misses the pattern.
- **New editors work on sparse items**: ArchivArte had no English label. New editors often fill gaps in underdeveloped items, which paradoxically makes verification harder (less existing context to cross-reference).

## Open chainlink issues

| # | Summary | Priority | Category |
|---|---------|----------|----------|
| 12 | Use external IDs for cross-referencing/verification | Future | Infrastructure |
| 13 | Refine evidence type taxonomy for edit-centric patrol | Future | Methodology |
| 14 | Enrich snapshots with old-vs-new diff | **High** | Infrastructure |
| 15 | Verdicts should include concrete proposed additions | Design | Prompt |
| 16 | Distinguish verified vs reported sources in output | Design | Prompt |
| 17 | Group sequential edits by (item, user) | Design | Infrastructure |
| 18 | Stratify experiment by claim type for valid comparison | Design | Experiment |

## Toward the prompt

Based on these walk-throughs, the SIFT-Patrol prompt structure should roughly be:

```
1. PARSE & PRE-CHECK (replaces "Stop")
   - What is the claim? (property, value, item context)
   - Who is the editor? (self-edit pattern? temporary account?)
   - Any obvious red flags?
   - Internal consistency with existing item claims?

2. INVESTIGATE THE SOURCE
   - If reference exists: fetch it, read it, classify its authority
   - If no reference: note the gap
   - Evidence type classification (per methodology taxonomy)

3. FIND BETTER COVERAGE
   - Web search for independent corroboration
   - Search strategy depends on property class:
     - Institutional: org pages, directories
     - Biographical: encyclopedias, news archives
     - Classifications: similar items, modeling conventions
     - Creative: specialized databases
     - etc.
   - Require multiple independent sources

4. TRACE (if applicable)
   - Can we reach a primary source?
   - Do secondary sources agree with each other?
   - Note any contradictions

5. VERDICT
   - Classification: verified (high/medium) / needy / unverifiable / contradicted
   - Proposed improvements (always, even for verified):
     - Missing references (with verified vs reported tier)
     - Missing qualifiers
     - Value precision improvements
     - Modeling suggestions
     - Data discrepancies found
```

This is a starting point. Key open questions before writing the actual prompt:

1. **How much property-class dispatch to bake in?** A single prompt with guidance per class, or separate sub-prompts?
2. **How to handle the diff gap?** The prompt needs to work with current infrastructure (no diff) while being ready for when diffs are available.
3. **How to handle unreachable sources?** Several URLs were 403/unavailable during testing. The prompt needs graceful degradation.
4. **What's the right search depth?** We did 1-2 web searches per edit. Is that enough? Should there be a budget?
5. **How to handle edits on sparse items?** Less existing context makes verification harder. Should the tool flag these differently?

## Next steps

1. **Fix the diff gap** (Chainlink #14) — highest-priority infrastructure work
2. **Fetch more diverse edits** — we haven't seen needy/unverifiable/contradicted cases yet; need harder examples, removal edits, and different property types
3. **Draft the SIFT-Patrol prompt** — using this synthesis as the design basis
4. **Test the prompt** on existing reviewed edits to see if it reproduces our manual findings
