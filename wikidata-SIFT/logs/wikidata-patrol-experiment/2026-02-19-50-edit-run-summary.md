# SIFT-Patrol 50-Edit Run Summary

**Date**: 2026-02-19
**Model**: Sonnet 4.6 (44 verdicts) + 1 Opus 4.6 warmup verdict
**Snapshot**: `snapshot/2026-02-19-000124-unpatrolled.yaml`
**Verdicts completed**: 45 of 50 (5 edits stopped or not attempted)

## Verdict Distribution

| Verdict | Count | % |
|---------|-------|---|
| verified-high | 24 | 53.3% |
| incorrect | 12 | 26.7% |
| unverifiable | 5 | 11.1% |
| suspect | 3 | 6.7% |
| verified-low | 2 | 4.4% |

Over half the edits were verified with high confidence. Over a quarter were definitively
incorrect. The remaining ~18% fell into uncertain categories.

## Patterns by Property Type

| Property | Label | Count | Verdicts |
|----------|-------|-------|----------|
| P31 | instance of | 5 | 4 incorrect, 1 verified-high |
| P279 | subclass of | 5 | 3 incorrect, 2 suspect |
| P793 | significant event | 5 | 3 verified-high, 1 unverifiable, 1 suspect |
| P463 | member of | 4 | 4 verified-high |
| P108 | employer | 4 | 4 verified-high |
| P856 | official website | 3 | 3 verified-high |
| P569 | date of birth | 3 | 1 verified-high, 1 incorrect, 1 unverifiable |
| P528 | catalog code | 2 | 2 incorrect |
| P217 | inventory number | 2 | 1 verified-high, 1 verified-low |
| P180 | depicts | 2 | 2 verified-high |
| P2930 | INSPIRE-HEP ID | 2 | 2 verified-high |
| P18 | image | 2 | 1 verified-high, 1 unverifiable |
| P570 | date of death | 1 | 1 incorrect |
| P345 | IMDb ID | 1 | 1 unverifiable |
| P127 | owned by | 1 | 1 verified-high |
| P276 | location | 1 | 1 unverifiable |
| P119 | place of burial | 1 | 1 verified-low |
| P106 | occupation | 1 | 1 verified-high |
| P19 | place of birth | 1 | 1 incorrect |

**Key findings**:

- **P31 and P279 (ontological properties) are the most error-prone.** 7 of 10 edits were
  incorrect or suspect. These structural/taxonomic properties are where confused editors
  frequently misapply values.
- **P463 (member of) and P108 (employer) are reliably correct.** All 8 edits verified-high.
  Professional affiliations are well-documented online.
- **P528 (catalog codes) were 100% incorrect** -- both edits confused numbers from different
  historical inventories.
- **External identifier corrections (P2930) were 100% correct** -- the INSPIRE-HEP API is
  authoritative and queryable, making verification trivial.

## Patterns by Edit Type

| Diff Type | Count | Incorrect/Suspect Rate |
|-----------|-------|------------------------|
| value_changed | 17 | 47% (8 of 17) |
| qualifier_changed | 5 | 40% (2 of 5) |
| rank_changed | 1 | 100% (1 of 1) |
| qualifier_added | 10 | 10% (1 of 10) |
| reference_added | 9 | 0% (0 of 9) |

**Value changes are the riskiest edit type** -- nearly half were incorrect. Reference and
qualifier additions are overwhelmingly safe. This makes intuitive sense: adding supporting
data to existing correct claims is lower risk than changing values outright.

## Patterns by Entity

### Cathy Gao (Q138340097) -- 14 edits

Self-edits by user CathyLGao. 12 of 14 verified-high. The factual content (employer,
board memberships, conference appearances) was independently confirmed from press releases,
employer pages, and Fortune articles. Two minor issues:

- A conference role qualifier used Q1283344 which resolves to "Edelreis" (a plant grafting
  term), not a conference role. This Q-id has no English label -- only labels in other
  languages -- which likely caused the enrichment pipeline's LabelCache to miss it, so the
  agent had to discover the problem through investigation rather than seeing it upfront.
- Potential confusion between two Fortune conference series (Brainstorm Tech vs. Brainstorm AI).

**Takeaway**: Self-editors of professional data are highly accurate on facts but can make
qualifier/ontology mistakes with Q-id selection.

### Daniele Iarussi (Q138340290) -- 8 edits

A confused new editor systematically misused Wikidata properties: classified a person as
"external identifier" (P31), used P279 (subclass of) on an individual instead of a class,
stored LinkedIn URLs in wrong formats, and used incorrect qualifier properties. 0 of 8
edits were correct (4 incorrect, 2 suspect, 1 incorrect rank change, 1 unverifiable
birth date reference that didn't actually contain a birth date).

**Takeaway**: New editor confusion on ontological properties produces systematic errors
that are easy to catch.

### AI Chatbot (Q133284163) -- 2 edits

Both edits reclassified a software concept as a subclass of "Homo sapiens" / "human" --
ontologically absurd and likely vandalism or deep confusion.

### Prado Paintings (Q59771198, Q59771199, Q71828511) -- 9 edits

Art catalog items with mixed results. Depicts and ownership claims verified well using
Prado catalog data and Joconde database. Catalog code edits were incorrect (confused
between historical inventories from different eras). Museum storage status was unverifiable
due to 403 blocking.

## Vandalism Caught

1. **Goddess Bunny (Q628148)**: Death date changed from 2021 to 2026 while keeping the
   original 2021 NYT obituary reference. The agent caught the internal contradiction and
   confirmed 2021 from six independent sources.

2. **AI chatbot subclass of human (Q133284163)**: Two edits flagged as ontologically absurd.

3. **Maya Hawke DOB (Q46994907)**: Birth date changed from July 8 to July 7. Every source
   confirms July 8.

4. **Bob Barlen birthplace (Q16198106)**: Country qualifier set to United States, but
   Kitchener is in Canada.

## Failure Modes

### HTTP 403 Blocking (Primary Obstacle)

Nearly every verdict encountered 403 errors from at least one source. Most impactful:

| Domain | Impact |
|--------|--------|
| museodelprado.es | Forced 1 verdict to unverifiable; others worked around via search |
| en.wikipedia.org | 403 on direct fetch; search snippets adequate |
| crunchbase.com | Blocked but alternatives found (Sapphire Ventures, press releases) |
| imdb.com | Blocked entirely; 1 verdict unverifiable |
| linkedin.com | HTTP 999 (bot block); never successfully fetched |

The agent consistently fell back to web search snippets when direct fetches failed. This
worked in most cases but forced 5 verdicts to "unverifiable" where no alternative source
existed.

No catastrophic 403 retry loops occurred in this run -- the earlier prompt improvements
(limiting retry attempts, encouraging search fallback) appear effective.

### Label Resolution Gap

Q1283344 ("Edelreis") has no English label, only labels in other languages. The enrichment
pipeline's LabelCache missed it, so two verdicts initially didn't see that a qualifier
value was completely wrong. One verdict eventually resolved it through investigation.

**Action needed**: The LabelCache should fall back to other languages when no English label
exists, or the precheck should flag unresolved Q-ids for the agent.

### Missing Verdicts

5 edits did not produce verdicts:

- **Edit 8 (Q59771198 P180)**: Stopped after 35+ tool uses in a 403 loop on Prado/Wikipedia
  (this was early in the run, before prompt improvements took effect)
- **Edit 14 (Q6758818 P2930)**: Stopped manually after INSPIRE-HEP API confirmed the value;
  agent was continuing unnecessary searches. Would have been verified-high.
- **Edit 16 (Q138076653 P1566)**: GeoNames ID -- not attempted
- **Edit 40 (Q71828478 P170)**: Creator qualifier -- not attempted
- 1 additional edit index gap

## Prompt Improvement Recommendations

Based on this run:

1. **Known-403 domain list** (see #28): Add a blocklist to the prompt so agents skip direct
   WebFetch on Prado, IMDb, LinkedIn, Crunchbase and go straight to search. For art/museum
   edits, suggest Wikimedia Commons structured data and catalog APIs (Joconde, Europeana)
   instead of museum websites.

2. **External identifier verification must cross-reference identity** (#30): For external
   ID edits (P2930, P345, etc.), confirming the ID exists in the target service is necessary
   but not sufficient. The agent must also cross-reference the API response against the
   Wikidata item's other claims (employer, affiliation dates, advisor, etc.) to confirm
   it's the same entity, not just a name match. Both INSPIRE-HEP verdicts in this run did
   this well — the Gazdzicki verdict used a pre-existing control number link, and the Hill
   verdict matched Fermilab affiliation and Caltech/Gell-Mann PhD against item claims.
   Codify that pattern in the prompt.

3. **Validate external ID approach at scale** (#33): Pick one external identifier property
   with a good API (INSPIRE-HEP, ORCID, or GND) and batch-test ~20-30 recent unpatrolled
   edits to validate the identity cross-referencing pattern, flesh out prompt guidance, and
   identify edge cases (deleted IDs, merged records, disambiguation).

4. **Non-English label fallback** (#31): When enrichment can't resolve a Q-id in English,
   try other languages before giving up. Q1283344 ("Edelreis") had no English label, causing
   the LabelCache to return null — two verdicts initially missed that a qualifier value was
   completely wrong. An unresolved Q-id in enriched data is a red flag worth surfacing.

5. **Ontological property heuristics** (#32): For P31/P279 edits, the precheck could flag
   obvious mismatches (e.g., a person item getting P31 = external identifier) before the
   agent even starts investigating. 7 of 10 ontological edits were incorrect or suspect —
   a cheap heuristic check would save agent tokens on edits that are almost certainly wrong.

## Cost

No token cost data was captured in verdict files. Per earlier experiments, Sonnet 4.6
runs approximately 18-27k tokens per verdict. Token cost capture is tracked as chainlink
issue #21.

Estimated total for 45 verdicts at ~22k tokens average: ~990k tokens.

## Bottom Line

Sonnet 4.6 is reliable for patrol triage at this scale. It correctly identifies incorrect
edits including vandalism, handles self-edit patterns well, and degrades gracefully when
sources are blocked. The main gaps are enrichment quality (resolve all Q-ids, including
non-English labels) and routing strategy (direct agents to APIs for external identifiers,
search for known-403 domains). The 53% verified-high rate on unpatrolled edits suggests
real patrol value -- over a quarter of edits had actionable problems.
