# OA-tier data quality: OpenAlex vs Wikidata

*All measurements 2026-08-14, commands shown. These findings decay — OpenAlex
re-derives `oa_status` continuously and Wikidata's diamond class is actively
curated, so re-run before relying on any number here.*

The question, twice asked and twice measured:

1. Should the citation shelf prefer **diamond** open-access papers?
   (Answered no; `openRank` in `tapestry-gen/src/dedup.js` is the decision,
   this file is its evidence.)
2. Is **Wikidata's** OA-tier data better than **OpenAlex's**?
   (Better asserted, near-zero coverage; details below.)

## What OpenAlex's `diamond` actually is

`oa_status: diamond` means "fully open journal with **no article-processing
charge on record**" — an inference from *absent* data, not a statement. Two
measurements make that concrete:

- OpenAlex holds no APC figure for **17,904 of the 23,235** journals it marks
  as DOAJ members; only 126 are recorded as APC = 0:

  ```
  curl 'https://api.openalex.org/sources?filter=is_in_doaj:true,apc_usd:null&mailto=…'   → 17904
  curl 'https://api.openalex.org/sources?filter=is_in_doaj:true&mailto=…'                → 23235
  curl 'https://api.openalex.org/sources?filter=is_in_doaj:true,apc_usd:0&mailto=…'      → 126
  ```

  So "charges authors nothing" and "nobody told us what it charges" arrive as
  the same word.

- 119 of 200 sampled diamond works are not in a DOAJ source at all, and the
  single most common diamond venue in the sample is *CA: A Cancer Journal for
  Clinicians* — a **Wiley** title, free because the American Cancer Society
  subsidizes it:

  ```
  curl 'https://api.openalex.org/works?filter=open_access.oa_status:diamond&per-page=200&select=primary_location&mailto=…'
  ```

- Diamond is also the **weaker** signal on the axis this project cares about
  (reuse). License stated on the open copy, 200 works per tier:

  | | no license stated | CC BY | NC variants |
  |---|---|---|---|
  | diamond | **99 (50%)** | 70 | 28 |
  | gold | 27 (14%) | 133 | 36 |

  Ranking diamond first would push CC BY papers off a three-card shelf in
  favor of copies that may reserve every right.

Global tier distribution, for scale (`group_by=open_access.oa_status`):
closed 200.6M · green 67.4M · **diamond 17.7M** · gold 15.2M · bronze 14.6M ·
hybrid 8.7M.

## What Wikidata has instead

Wikidata has no per-work OA tier and no gold/bronze/hybrid classes for
journals — the WikiCite article imports stalled years ago, and P6954 ("online
access status") describes whether linked content is readable, not a tier. What
it has is a **journal-level diamond class**, `P31 → Q108440863` ("diamond
open-access journal"), plus the broader `Q773668` ("open-access journal").

Size and sourcing (WDQS):

```
?j wdt:P31 wd:Q108440863                          → 1,572 journals
… ; wdt:P236 []                                   → 1,565 with an ISSN
?j p:P31 ?st . ?st ps:P31 wd:Q108440863 ;
              prov:wasDerivedFrom []              → 107 referenced (7%)
?j wdt:P31 wd:Q773668                             → 15,261 open-access journals
?j wdt:P31 wd:Q5633421                            → 101,827 scientific journals
```

**Precision, spot-checked, is decent** — better than the reference rate
suggests:

- ZooKeys (gold, $754 APC per OpenAlex) is correctly *not* diamond — just
  `Q773668`.
- Zootaxa is marked **hybrid open access journal**, which is more precise than
  OpenAlex's flat `is_oa: false` on the same source (Zootaxa does sell an OA
  option per article).
- Of 7 sampled WD-diamond journals cross-checked against OpenAlex: 5 clean
  (open, in DOAJ, no APC), one borderline (*Acta Palaeontologica Polonica*,
  $23 APC on record), one OpenAlex disputes (*EHP Toxicogenomics*,
  `is_oa: false`).

**Recall is the killer.** Joining the venues real articles cite (ISSN-L from
OpenAlex `primary_location`) against Wikidata's classes:

```
Monarch butterfly + Drosophila melanogaster cited DOIs
  → 113 distinct venues (ISSN-L), 199 paper-slots
  → Wikidata classes 28 of them  open-access journal (Q773668)
  → Wikidata classes  0 of them  diamond (Q108440863)
```

OpenAlex marked 5 works diamond across those same two articles. Wikidata's
diamond set — 1,572 journals against DOAJ's 23,235 — simply does not intersect
the citation graph of the pages this demo renders.

## Verdict

- **Neither vocabulary changes the shelf's ranking.** Cards rank on the
  license the host states for the copy (`openRank`); `oa_status` rides
  entries as data and is printed nowhere. An inference from missing data is
  exactly what "a mark is never a guess" refuses.
- **OpenAlex is operationally better** (per-work, total coverage) and
  epistemically weak (inferred).
- **Wikidata is epistemically better** (asserted, editable, spot-checks
  clean) and operationally near-empty (0 recall on real pages, 7%
  referenced).
- **If diamond ever earns a card-level claim, the Wikidata route is the
  project-shaped one**: an ISSN join against `Q108440863` (one cached SPARQL)
  yields a claim with a provenance fold and a "check or fix it on Wikidata"
  link — which OpenAlex structurally cannot have. And the measured gap (28
  open-access venues on two articles, 0 diamond) is itself a demo-shaped
  finding: the graph doesn't know this yet.

Related same-day survey: Wikispecies as a DOI source, measured and declined —
see *Deliberately excluded* in `tapestry-gen/CLAUDE.md` (the densest
Wikispecies DOI prefix is Zootaxa, which is closed; its real wealth is
identifiers already read from Wikidata, plus a BHL lead parked with LUI-141).
