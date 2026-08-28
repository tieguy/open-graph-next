# Is the enwiki sourced-statement gate starved? — findings

Measured 2026-08-18. All API and database-replica reads are dated to that day;
sampling seeds and raw per-item results are in this directory. This document
reports measurements; it proposes nothing and asks for nothing. It is the input
to a possible public write-up, not the write-up.

**Method note on data sources.** No dump was used. Numbers come from three live
sources, each named per table: (1) the enwiki database replica on Toolforge
(`enwiki_p`, tables `wbc_entity_usage`, `templatelinks`, `page_props`), (2) the
enwiki/Wikidata Action APIs, and (3) CirrusSearch `totalhits` (a search-index
count, which can lag the database by hours). Replica and API state is that of
2026-08-18; re-running the queries in `queries.md` reproduces the numbers up to
ordinary wiki drift. Entity claims for all sampled items were snapshotted to
`entities.json` (45 MB, kept out of the repo; regenerate with `measure.py`).

---

## 1. Summary of findings

1. **The reference-gated path is much larger than its best-known instance.**
   `Template:Infobox person/Wikidata` (4,710 articles) is the famous case, but
   `Module:WikidataIB`'s gate runs **default-on today on ~200,000+ articles**
   through mainstream templates: {{Infobox company}} (78,949 articles,
   `fetchwikidata=ALL` and `onlysourced=yes` by default), {{Infobox video
   game}} (28,297, same defaults), and {{Marriage}} (101,353 uses; the module
   loads on 48,473 of them). These render Wikidata values only for fields the
   article leaves blank, and only when a statement clears the gate.

2. **The gate is starved on the populations that matter, and the starvation
   has structure.** On a random sample of plain {{Infobox person}} articles
   (the conversion counterfactual), the median article would render **1 of 22**
   gated fields from Wikidata; 156/400 would render zero. On {{Infobox
   company}}, the median article renders **0 of 17** gated fields; yet the
   financial fields that do exist (revenue, operating income, net income,
   assets) clear the gate at 94–100%, because they arrive with references.
   Sparse-but-sourced and dense-but-unsourced fields coexist in the same
   infobox.

3. **The binding constraint is usually the statement, not the reference.** In
   the company sample, 60.1% of (article × gated-field) pairs have **no
   Wikidata statement at all**; only 4.8% are blocked purely by referencing.
   Referencing alone would still grow visible Wikidata output ~6-fold on that
   template (60 pairs render today, 325 more would render), but most empty
   infobox fields need data before they need citations.

4. **The "sourced only to Wikipedia" class is as large as the "unsourced"
   class.** Across the person counterfactual sample, statements split almost
   evenly: 35.1% unreferenced, 33.1% referenced only in ways the gate rejects
   (99.7% of those rejected references carry P143 "imported from Wikimedia
   project"), 31.8% passing. The two shortfall classes need different
   remediation and are quantified separately in §7.

5. **The gate predicate is a case-sensitive substring match, not a policy
   engine.** `sourced()` in Module:WikidataIB passes a claim if any reference
   renders to text not containing `"Wiki"`. Its comment says "not containing
   the word 'wikipedia'"; the code is broader (blocks Wikimedia Commons,
   Wikidata, WikiTree, anything labeled *Wiki\**) and leakier (a lowercase
   `en.wikipedia.org` URL-only reference passes). Measured effect of the
   crudeness: small — 48 of 6,011 passing references (0.8%) mention
   wikipedia/wikimedia/wikidata in lowercase; 0 were bare "retrieved"-date
   references. Module:Wd's structural predicate (reject P143/P4656/P3452)
   agrees with WikidataIB's string match on 99.5%+ of measured statements.

6. **enwiki's default-on gate is the outlier among sister projects.** Commons'
   Wikidata Infobox runs a copy of WikidataIB with the gate explicitly off
   (`osd='no'`, `fwd='ALL'`). Catalan/Basque `Module:Wikidades` has a
   structural gate that defaults off. Russian Wikipedia's module doesn't gate;
   it displays references as footnotes and filters "deprecated sources" from
   display. Only enwiki both gates by default and hides the reference.

7. **The adoption record shows the gate was a deliberate, negotiated design —
   and that sourcing is a necessary but not sufficient condition.** The 2018
   Infobox RfC's only majority position (52%) was "each statement imported
   from Wikidata must comply with Wikipedia policies"; 78% wanted some
   reliability assurance. The 2017 TfD nominations argued from grounds
   supply cannot fix (no verifiability/BLP policy on Wikidata, watchlist
   integration) *and* grounds it can (unsourced values, values sourced only to
   other Wikipedias) — including one documented complaint that the gate
   false-passed a wrong date. Verdict on the four candidate explanations: §9.

8. **A fifth explanation exists that the four candidates don't cover:
   data-model mismatch** — Wikidata cannot represent the editorial artifact
   the infobox needs, so referencing is orthogonal. It is the written,
   tried-and-declined reason enwiki's largest infobox family (~400k taxobox
   articles) reads no Wikidata, and a six-domain sweep finds it recurs in
   its strong form exactly where the article's unit of coverage differs
   from Wikidata's unit of description (taxa vs names, works vs editions),
   while database-record subjects (genes, identifiers) adopt wholesale and
   ungated. §10 and `domain_sweep.md`.

---

## 2. Channel survey: how enwiki consumes Wikidata (step 0)

### 2.1 Aggregate scale (enwiki replica, `wbc_entity_usage`, 2026-08-18)

| usage aspect | rows | distinct pages |
|---|---:|---:|
| S (sitelinks) | 10,577,030 | 10,348,056 |
| T (title) | 8,215,326 | 7,774,065 |
| D (descriptions) | 6,898,266 | 6,768,669 |
| O (other) | 6,169,098 | 4,270,613 |
| **C (statements, `C.Pnn`)** | **19,257,580** | **5,154,675** |
| CQR (statement+qualifier+reference tracking) | 1,575,608 | 1,213,062 |
| L (labels) | 2,933,704 | 866,507 |
| A (aliases) | 38,999 | 13,990 |
| X (all aspects) | 1,906 | 1,458 |

**5,055,321 article-namespace pages consume Wikidata statement data** (C
aspects joined to ns-0; same query set). Statement consumption is not a niche:
it is within a factor of two of sitelink consumption.

Top statement properties consumed in articles, by distinct pages: P31
instance-of 1,337,007; P625 coordinates 888,283; P910 topic's-main-category
714,977; P1754 (list-related) 714,471; **P569 date-of-birth 625,608**; P1630
formatter-URL 505,205; P18 image 350,929. Note P569: birth dates are already
read at scale — largely by tracking/comparison code rather than display (see
§2.3 caveat).

### 2.2 The channels (each row: article count, method, gate)

| channel | articles (ns 0) | count method | reads Wikidata for | reference gate |
|---|---:|---|---|---|
| {{Authority control}} | 2,267,260 | Cirrus | external identifiers | none |
| Module:Wd callers ({{URL}}, {{IMDb name}}, {{Infobox settlement}}, sports/ID link templates — 1,267 non-doc templates) | 1,835,308 | Cirrus, module reach | identifiers, websites, link targets | opt-in `sourced` flag exists (predicate: reject refs containing P143/P4656/P3452); high-volume callers examined don't pass it |
| {{Commons category}} / sister-project links | 550,071 / 12,413 | Cirrus | sitelinks, P373 | none |
| {{Taxonbar}} | 501,397 | Cirrus | taxonomy identifiers | none |
| **Module:WikidataIB (all carriers)** | **491,014** | Cirrus | **displayed facts** (dates, places, people, quantities) | **`onlysourced` default ON**, per-field overridable |
| {{Official website}} | 341,389 | Cirrus | P856 | none |
| Module:Wikidata (2013-era) callers (sports bios, anatomy, Chembox, NRHP) | 205,703 | Cirrus | mixed facts/ids | none |
| {{Cite Q}} | 16,469 | templatelinks | bibliographic data for citations | n/a (renders sources themselves; excludes P143-style refs from display) |
| {{Infobox gene}} | 12,838 | Cirrus | wholesale gene data | none |
| Short description | — | — | **not Wikidata-fed on enwiki** (local descriptions; Wikidata read only for comparison/tracking) | n/a |

The pattern the prompt predicted holds exactly: **what enwiki accepts ungated
is identifiers, links, coordinates, and taxonomy — data that is its own
source. The gate sits precisely where prose-like factual claims get
displayed.** There is one class of exception: the 2013-era Module:Wikidata
callers (~205k articles) display facts ungated in narrower niches (anatomy,
sports bios, NRHP refnums, Chembox identifiers).

### 2.3 Inside the WikidataIB reach: who actually displays what

The 491,014-article module reach includes trivial uses (({{Expand French}}
renders a sitelink label; {{Wikidata sitelink}}, {{Edit on Wikidata}} render
links). Attribution by Cirrus intersection (`hastemplate:"Module:WikidataIB"
hastemplate:"X"`, 2026-08-18), against each template's own transclusion count:

| carrier | loads module / uses template | fetch default | gate default | what displays |
|---|---:|---|---|---|
| {{Infobox company}} | 78,946 / 78,949 | **ALL** | **on** (image/logo off) | 17 gated fields (founded, founder, HQ, industry, financials…) |
| {{Marriage}} | 48,473 / 101,353 | **ALL** (`fwd=ALL` hardcoded) | **on** | P570 (end-of-marriage inference), conditional branch |
| {{Infobox video game}} | 28,184 / 28,297 | **ALL** | **on** (image off) | 14 gated fields (developer, publisher, platform, genre…) |
| {{Infobox river}} / {{Infobox mountain}} | 31,451 / 29,349 (≈all) | narrow | image **off**; mountain metrics gated | P18; mountain: P2044 elevation etc. |
| {{Infobox person/Wikidata}} | 4,710 | opt-in (394/400 sampled articles pass `fetchwikidata=ALL`) | **on** for 22 bio fields; off for image/website/signature | full biography |
| {{Infobox power station}} | 3,270 | ALL | mixed per field | ~40 fields |
| {{Infobox lighthouse}} / {{Infobox telescope}} | 2,602 / 337 | ALL | on (image off) | full |
| other `/Wikidata` forks (organization, scientist, museum, writer, artwork, sportsperson, expedition, religious biography, noble, archive) | 1,193 total | mixed | on | full |

Two populations the prompt asked to separate:

- **Deployed-but-empty (population a):** the default-on carriers — company,
  video game, Marriage, power station, lighthouse, telescope, plus the forks —
  put the gated fetch live on **~160,000–210,000 articles today** (bounds:
  sum of module-loading intersections vs template totals). On these, supply
  alone changes what renders; no conversion, consent, or RfC is needed.
- **Not-deployed (population b):** plain {{Infobox person}} alone is 563,871
  articles; its infobox reads no Wikidata for display. Conversion is social
  work regardless of supply.

The ratio: for the person domain specifically, deployed:not-deployed is
4,710 : 563,871 ≈ **1:120**. Counting all default-on carriers against all
plausible convertible infoboxes, the deployed population is no longer
negligible — roughly a quarter-million articles run a gated fetch now.

**Caveat (labeled: how it is implemented).** "Loads the module" over-counts
display: a carrier may fetch only to compare or track (e.g. {{Marriage}}'s
error categories). "Uses the template" under-counts nothing but includes
articles where every wired field is locally filled, so nothing from Wikidata
can show (§6 quantifies this for company).

---

## 3. The gate as implemented (step 1)

`Module:WikidataIB`, revision 1329681003 (2025-12-27), lines 697–713:

```lua
-- sourced takes a table representing a statement that may or may not have references
-- it looks for a reference sourced to something not containing the word "wikipedia"
-- it returns a boolean = true if it finds a sourced reference.
local sourced = function(claim)
	if claim.references then
		for kr, vr in pairs(claim.references) do
			local ref = mw.wikibase.renderSnaks(vr.snaks)
			if not ref:find("Wiki") then
				return true
			end
		end
	end
end
```

The predicate, as code behaviour (not documentation): **a claim passes iff at
least one of its references, rendered to wikitext in the local language, does
not contain the case-sensitive substring `Wiki`.** `onlysourced` defaults to
true in every entry point (`parseParam(args.onlysourced or args.osd, true)`).
Consequences, each verified against the code and measured where possible:

- P143 "imported from Wikimedia project" fails (value label "…Wikipedia"
  contains `Wiki`). This is 99.7% of all gate-failing references measured
  (1,465 of 1,478 across the person samples).
- P248 "stated in" fails whenever the source item's English label contains
  `Wiki` — Wikimedia projects, but also WikiTree and any *Wiki\**-named
  source. Measured: 12 occurrences.
- A reference that is only `P854 = https://en.wikipedia.org/...` **passes**
  (lowercase). A bare `P813` retrieved-date-only reference **passes**.
  Measured frequency of exploitable leaks among 6,011 passing references in
  the samples: 48 rendered with lowercase wikipedia/wikimedia/wikidata (0.8%),
  36 contained P4656, **0 were P813-only**. The loopholes exist; the data does
  not currently exploit them at meaningful scale.
- The comment says "wikipedia"; the code matches `Wiki`. The documentation of
  {{Infobox person/Wikidata}} says values must be "sourced on Wikidata to a
  source other than Wikipedia" — both understate what is blocked and overstate
  rigor. This code/documentation disagreement is a finding, per the research
  brief, not a defect report.

Comparison predicates found in the survey (all read from module source,
2026-08-18):

| module | predicate | default |
|---|---|---|
| enwiki `Module:WikidataIB` (rev 1329681003) | rendered ref text lacks `"Wiki"` | **on** |
| enwiki `Module:Wd` (rev 1301986908) | ref lacks P143, P4656, P3452 | off (opt-in `sourced` flag) |
| enwiki `Module:Wikidata` (rev 1142750825) | none | — |
| ca/eu `Module:Wikidades` (revs 36825375 / 9989864) | ref lacks P143, P3452, P887, P4656 | off |
| ru `Модуль:Wikidata` (rev 153491506) | no gate; renders references as footnotes, hides refs whose P248/P1433 target is in a `deprecatedSources` config | — |
| Commons `Module:Wikidata Infobox` (rev 1207373352) | inherits WikidataIB's gate but sets `osd='no'`, `fwd='ALL'` | **off** |

In practice the predicate choice barely matters: on 10,978 measured
statements, WikidataIB's string match and Wd's structural test disagreed on
fewer than 0.5% (e.g. personwd: 2,667 vs 2,654 passing).

---

## 4. Population and property scope (steps 2–3)

Template wiring read from current template wikitext (2026-08-18); article
counts from `templatelinks` (exact, same day). The circulating ~1,800 figure
for {{Infobox person/Wikidata}} is stale: **4,710** article transclusions.

Gated property scopes used for measurement (from the templates' `#invoke`
lines; the per-field gate map is in `queries.md` §4):

- **Infobox person/Wikidata** (22 gated fields): P1559, P1477, P569, P19,
  P1636, P570, P20, P119, P1449, P69, P106, P108, P800, P102, P26, P451, P40,
  P22, P25, P3373, P53, P166. (P18 image, P856 website, P109 signature are
  wired gate-off.)
- **Infobox company** (17): P946, P452, P155, P156, P571, P576, P112, P1001,
  P159, P17, P2139, P3362, P2295, P2403, P1128, P749, P856.
- **Infobox video game** (14): P178, P123, P57, P162, P287, P943, P3080, P50,
  P86, P179, P408, P400, P136, P404.
- **Marriage** (1): P570.

Samples (seeded, reproducible; see `samples.tsv` and `queries.md`):

| population | frame | n | seed |
|---|---|---:|---|
| `personwd` | all 4,710 articles using Infobox person/Wikidata (full list saved) | 400 | Python `random.Random(42)` |
| `person` | articles using Infobox person (563,871) | 400 | MySQL `RAND(42)` |
| `company` | articles using Infobox company (78,949) | 400 | MySQL `RAND(42)` |
| `videogame` | articles using Infobox video game (28,297) | 300 | MySQL `RAND(42)` |
| `marriage` | articles using Marriage (101,353) | 300 | MySQL `RAND(42)` |

Rank handling matches `getValue`'s default (preferred + normal; deprecated
excluded). "Renders" means: at least one statement for that property passes
the gate, i.e. the field would show a value if fetch is enabled and the local
parameter is empty.

---

## 5. Coverage against the gate (steps 4–5)

### 5.1 Per-property, person domain (the actionable structure)

Of sampled items **having** the property (denominator "present"), the share
where at least one statement clears the gate:

| property | personwd: present → renders | person: present → renders |
|---|---:|---:|
| P569 birth date | 376 → 332 (88.3%) | 351 → 170 (48.4%) |
| P570 death date | 294 → 280 (95.2%) | 184 → 113 (61.4%) |
| P106 occupation | 387 → 304 (78.6%) | 377 → 131 (34.7%) |
| P19 birth place | 308 → 222 (72.1%) | 301 → 57 (18.9%) |
| P20 death place | 204 → 161 (78.9%) | 124 → 37 (29.8%) |
| P69 education | 179 → 110 (61.5%) | 177 → 28 (15.8%) |
| P166 awards | 114 → 85 (74.6%) | 84 → 40 (47.6%) |
| P108 employer | 107 → 81 (75.7%) | 68 → 22 (32.4%) |
| P26 spouse | 75 → 58 (77.3%) | 42 → 17 (40.5%) |
| P22 father | 72 → 49 (68.1%) | 28 → 10 (35.7%) |
| (12 further fields: full tables in `results.json`) | | |

### 5.2 Per-item completeness (the number that determines editor experience)

Fields rendering, of 22 gated (person) / 17 (company) / 14 (video game):

| population | median | mean | items rendering **zero** | distribution (renders: items) |
|---|---:|---:|---:|---|
| personwd (n=400) | **5** | 4.72 | 16 (4.0%) | 0:16 1:14 2:34 3:59 4:64 5:73 6:57 7:36 8:27 9:9 10:6 11:4 |
| person (n=400) | **1** | 1.68 | 156 (39.0%) | 0:156 1:71 2:69 3:39 4:24 5:16 6:14 7:6 8:3 10:2 |
| company (n=400) | **0** | 0.52 | 306 (76.5%) | 0:306 1:45 2:24 3:10 4:6 5:1 6:3 7:3 8:2 |
| videogame (n=300) | **0** | 0.77 | 185 (61.7%) | 0:185 1:41 2:48 3:13 4:9 5:4 |
| marriage (n=300, 1 field) | 0 | 0.37 | 189 (63.0%) | P570 present on 165; renders on 111 (67.3% of present) |

The personwd/person gap (median 5 vs 1) confounds two mechanisms this data
cannot separate: adopters selected well-covered subjects, and adoption
attracts sourcing to the item. Both directions are plausible; no evidence
here distinguishes them.

Company shows the coexistence sharply: P2139 revenue clears the gate on 15/16
present (93.8%), P3362/P2295/P2403 on 8/8, 12/12, 6/6 — while P856 website
clears on 9/267 (3.4%), P452 industry 14/240 (5.8%), P571 inception 33/307
(10.7%). Financial data arrives through referenced imports; descriptive basics
arrived unreferenced years ago and stayed that way.

### 5.3 Statement-level rates and the P143 delta (step 6)

Statements on scoped properties, non-deprecated ranks:

| population | statements | unreferenced | referenced but gate-fails | passes gate |
|---|---:|---:|---:|---:|
| personwd | 3,773 | 788 (20.9%) | 318 (8.4%) | 2,667 (70.7%) |
| person | 2,895 | 1,015 (35.1%) | 958 (33.1%) | 922 (31.8%) |
| company | 1,991 | 651 (32.7%) | 896 (45.0%) | 444 (22.3%) |
| videogame | 2,143 | 981 (45.8%) | 832 (38.8%) | 330 (15.4%) |
| marriage | 176 | 23 (13.1%) | 32 (18.2%) | 121 (68.8%) |

The counterfactual delta the prompt asked for: counting any reference at all
(including P143-class) as sufficient would raise the person population's rate
from 31.8% to 64.9%, company's from 22.3% to 67.3%, video game's from 15.4%
to 54.2%. **Roughly half the shortfall is "referenced, but only to a
Wikimedia import"** — the class Wikidata's own Help:Sources asks editors to
replace — and the failing references are 99.7% P143.

---

## 6. Deployed-but-empty: what supply alone would change (company)

For the company sample, each of 400 articles × 17 gated fields was classified
by joining the article's current infobox wikitext (local parameter empty or
filled) with the item's statements (6,800 pairs total; parser and raw
per-article data in this directory):

| pair state | pairs | share |
|---|---:|---:|
| local parameter filled (Wikidata cannot show) | 2,326 | 34.2% |
| locally empty, **no Wikidata statement** | 4,089 | 60.1% |
| locally empty, statement exists, **gate blocks** | 325 | 4.8% |
| locally empty, statement passes — **renders from Wikidata today** | 60 | 0.9% |

Extrapolated to the 78,949-article deployment (sample-proportional, ±
sampling error): ~12,000 field-values render from Wikidata now; **referencing
existing statements would add ~64,000 more** without touching a single
article. The blocked pairs concentrate: P159 headquarters-city 122, P17
country 103 — together 69% of the yield. Split by fix type: 163 of 325
blocked pairs have no reference (need sourcing), 162 have only gate-failing
references (need the P143 swapped for the source it points through).

The same remediation split for the person counterfactual population, ranked
by blocked volume (n=400 items; full table in
`person_remediation_split.json`):

| property | present | renders | blocked, unreferenced | blocked, P143-class only |
|---|---:|---:|---:|---:|
| P106 occupation | 377 | 131 | 124 | 122 |
| P19 birth place | 301 | 57 | 42 | **202** |
| P569 birth date | 351 | 170 | 49 | 132 |
| P69 education | 177 | 28 | 61 | 88 |
| P20 death place | 124 | 37 | 25 | 62 |
| P570 death date | 184 | 113 | 17 | 54 |

P19 birth place is the standout: on half the sampled biographies it exists,
came from a Wikipedia import, and fails the gate for that reason alone.

---

## 7. Adoption evidence (secondary question)

Primary documents fetched and read 2026-08-18; quotes verified against page
text.

- **[2013 RfC on Wikidata Phase 2](https://en.wikipedia.org/wiki/Wikipedia:Requests_for_comment/Wikidata_Phase_2)**
  (linked from the 2018 RfC's background as the origin of infobox use; not
  independently re-read for this report).
- **[TfD 2017 January 24](https://en.wikipedia.org/wiki/Wikipedia:Templates_for_discussion/Log/2017_January_24)**
  on Infobox person/Wikidata: closed keep, with the closer inviting a revisit.
- **[TfD 2017 May 11](https://en.wikipedia.org/wiki/Wikipedia:Templates_for_discussion/Log/2017_May_11)**:
  closed **no consensus** to delete. The nomination's stated grounds, sorted
  by what supply could address: *fixable by sourcing* — values unsourced or
  sourced only to other Wikipedias; *not fixable by sourcing* — Wikidata has
  no verifiability or BLP policy, vandalism response is slow, watchlist
  integration produces unusable output; *tooling* — Q-numbers displayed,
  duplicate values. It also documents a **gate false-pass**: a wrong date
  displayed "even when the infobox is said to only show sourced data"
  (Stefan Andres). Passing the gate is not verification.
- **[2018 Infobox RfC](https://en.wikipedia.org/wiki/Wikipedia:Wikidata/2018_Infobox_RfC)**
  (94 poll participants): 31 opposed every use. The only option anywhere in
  the poll matrix with a majority was 3A, "Each statement imported from
  Wikidata must comply with Wikipedia policies" (52%); with 3C "require
  source" and 3D "BLPs sourced", 78% wanted a reliability assurance. Closers'
  summary: "data drawn [from] Wikidata might be acceptable … if Wikipedians
  can be assured that the data is accurate." A participant objection recorded
  on the page: opponents of any use had no stricter option than 3A to vote
  for, so 3A's majority overstates conditional acceptance.
- The template documentation of Infobox person/Wikidata now presents
  `onlysourced` as what "[the] 2018 RFC requires" — the gate is understood by
  its maintainers as the license under which the template operates. The
  module author's own description (in the RfC): "ensuring that by default
  only Wikidata that has a reference is imported," alongside local-value
  precedence and per-article opt-in — the conditional-acceptance design was
  deliberate, negotiated, and built to answer the objections as raised.
- **[Perennial proposals](https://en.wikipedia.org/wiki/Wikipedia:Perennial_proposals)**
  lists "Use Wikidata in infoboxes" as previously rejected over
  "verifiability … and subtle vandalism," marked **"Partly done"** citing
  {{Infobox software}}'s release-version fields.
- Watchlist integration problems are tracked as
  [phab:T177707](https://phabricator.wikimedia.org/T177707) (Wikidata changes
  dropped from watchlists at volume) and
  [phab:T171027](https://phabricator.wikimedia.org/T171027) (Wikidata
  recent-changes disabled on Commons and ruwiki), per the 2018 RfC background.
- Current maintenance signal:
  [KiranBOT 11](https://en.wikipedia.org/wiki/Wikipedia:Bots/Requests_for_approval/KiranBOT_11)
  (approved 2024) does routine cleanup of `qid` parameters on ~312 Infobox
  person/Wikidata articles — the template is maintained, not abandoned.

Not done at scale (see §10): systematic sampling of article histories where a
gated template was added and reverted, with reason classification.

---

## 8. Sister-project comparison (secondary question)

Read from module source, 2026-08-18 (revisions in §3): Commons deploys the
same WikidataIB machinery with the gate off on its category infobox — the
largest Wikidata-infobox deployment anywhere chose display-everything.
Catalan and Basque share `Module:Wikidades` with a structural gate available
but off by default. Russian Wikipedia's module surfaces references as
footnotes (filtering import-class references from display) rather than
suppressing values. enwiki is the only project in this set whose default
statement-display path is reference-gated. Their coverage rates were not
measured here; with gates off, gate-clearing coverage is not the operative
quantity on those projects.

---

## 9. What this does and does not establish

**Framing.** The evidence supports the prompt's "conditional consumer"
re-framing over the "gate as checkpoint" model: the mechanisms are deployed,
default to render-nothing, and require no one's permission to begin rendering
when qualifying statements appear (§6 measures exactly that). The remaining
work on population (a) is logistical; on population (b) it is political.

Against the four candidate explanations:

1. **Supply constraint — supported, with structure.** On every population
   except the self-selected adopters, most gated fields cannot render
   (median 0–1). But the constraint is layered: for most empty fields the
   missing thing is the statement (60.1% of company pairs), and where a
   statement exists, the missing reference is half "nothing" and half "P143
   pointing back at a Wikipedia."
2. **Demand/politics constraint — also supported, independently.** The
   TfD/RfC record contains objections that better sourcing cannot answer
   (no Wikidata V/BLP policy; "Wikidata cannot be trusted" as a category
   claim), held by a durable ~third of 2018 RfC participants. The gate
   false-pass complaint shows even the sourcing objection is not fully
   answered by references existing.
3. **Ergonomics constraint — supported for the watchlist specifically**
   (phab:T177707/T171027, and TfD participants reporting the integration
   unusable), unmeasured otherwise.
4. **Nobody-tried — ruled out.** Conversion was tried (two TfDs, an RfC, and
   4,710 standing adoptions); separately, maintainers wired default-on gated
   fetch into flagship templates covering ~200k articles, which is adoption
   of the channel by another route.

(A fifth explanation, outside this list and discovered after the main
measurement — data-model mismatch, which no amount of supply addresses —
is established with its own evidence in §10. It bounds where the
supply-vs-politics analysis above even applies: the four explanations
contest domains where the item can represent the field; §10's domains are
out of their reach entirely.)

**The data supports "both, in series":** supply is measurably insufficient
for the person-domain conversion case *and* the political objections would
survive full supply. These operate on different populations, though — the
politics binds conversions (population b), while on the already-deployed
population (a) supply is the only binding constraint, by construction.

**What this measurement cannot distinguish:** selection vs. causation in
adopter coverage (§5.2); whether referencing campaigns would trigger new
objections (e.g. to reference quality); whether the deployed-but-empty
carriers are known to and accepted by their WikiProjects or merely
unnoticed.

**What would falsify the supply-constraint reading:** finding gate-clearing
coverage on the counterfactual population comparable to the adopter
population (measured: 31.8% vs 70.7% statement-level — not found); or
finding that rendered-field counts do not differ (measured: median 1 vs 5 —
not found).

**What would falsify the politics-constraint reading:** an RfC or TfD in
which full sourcing was stipulated and acceptance followed. No such event is
in the record examined.

---

## 10. A fifth explanation the prompt's four don't cover: data-model mismatch

Added 2026-08-18, after the main measurement, from the taxon domain.

The research prompt's four candidate explanations (supply, politics,
ergonomics, nobody-tried) share an assumption: that the Wikidata statement,
once well-referenced, is the thing the infobox needs. The taxon domain —
enwiki's single largest infobox family, roughly 400,000 taxobox articles —
breaks that assumption, and has the decision in writing.

{{Speciesbox}} and the automated taxobox system read no Wikidata for display.
The stated reason is not sourcing. In the September–October 2021 [WikiProject
Tree of Life discussion of the automatic taxonomy
system](https://en.wikipedia.org/wiki/Wikipedia_talk:WikiProject_Tree_of_Life/Archive_50),
a maintainer states "Here on English Wikipedia there is a consensus not to
use Wikidata for a number of reasons, including eas[e] of use and flexible
control of the taxonomy system, which is limited by the data model on
Wikidata," and the reasons given (Peter coxhead, 2021-10-11, expanded in the
essay [User:Peter coxhead/Wikidata
issues](https://en.wikipedia.org/wiki/User:Peter_coxhead/Wikidata_issues))
are representational:

- Wikidata "taxon" items are taxon **names**, not taxa — one species can be
  six items in four genera; "there are no items in Wikidata that correspond
  to taxa."
- Wikidata is deliberately neutral between classifications, so parent-taxon
  (P171) chains form a **net, not a tree**; a taxobox must render one
  curated tree, and choosing it is an editorial act each wiki makes
  separately.
- Even within enwiki, organism groups run incompatible classifications,
  reconciled by local machinery (`Template:Taxonomy/…/skip`) — "not data of
  the kind that Wikidata should try [to] represent."

The same thread explored and dropped a workaround (a dedicated "private" set
of Wikidata items and properties for autotaxoboxes), so this is tried-and-
declined, not inertia. Note also that the local automated taxobox system
(built ~2010–2016) already delivers the centralize-once benefit Wikidata
transclusion promises — edit one taxonomy template, update every taxobox
below it — under local editorial control; the niche was occupied before
Wikidata's taxonomy was usable.

Two implications for the gate question:

1. **A reference gate cannot buy adoption here.** A perfectly referenced
   P171 chain is still a net of competing classifications. This objection
   class is orthogonal to `onlysourced`, which is presumably why
   Module:WikidataIB never entered the taxobox family at all (it appears
   nowhere in the autotaxobox call chain).
2. **The domain did not reject Wikidata — it partitioned it along the
   data-model line.** The identifier-shaped taxon data (GBIF P846, iNat
   P3151, IUCN P627, and the rest) flows from Wikidata ungated via
   {{Taxonbar}} on 501,397 articles (§2.2), directly below the infobox that
   declines Wikidata's classification. Conservation-status autofill (P141),
   the displayed-fact case in between, has **no located discussion either
   way** in the archives searched — reported as absence, not decision.

### Is the data-model barrier widespread? A six-domain sweep

Checked the same day across artwork, books, settlements, music, medicine,
and genes (full quotes, page titles, dates, and search list in
`domain_sweep.md`, same directory). The barrier is **not taxon-specific,
and it is not uniform — it clusters where the article's unit of coverage
differs from Wikidata's unit of description**:

| domain | verdict | evidence class |
|---|---|---|
| Books | **Strong data-model barrier, same shape as taxa**: articles cover *works*, items are often *editions*; stated as the obstacle in the Cite Q TfD (2017, closed no consensus), conceded by the template's defender, with a live revert war over which model one item should follow; still generating repair work in a January 2026 WikiProject Books thread. The WikidataIB fork never left the sandbox — but (corrected 2026-08-19) the mainstream {{Infobox book}} fetches six edition-shaped fields (P577, P136, P1104, P1036, P1149, P212) **ungated** via Module:Wikidata as local-empty fallbacks: the barrier blocked the fork and item-mapping trust, not the fallback path. | data-model (strong, for the mapping); ungated fallback ships anyway |
| Artwork | Sourcing and control objections dominate the 2018 WikiProject Visual arts thread on {{Infobox artwork/wikidata}}; data-model complaints appear only at field level (medium phrasing, bot-populated third dimensions on paintings) and both sides treat them as workaroundable by local overwrite/suppression. The one-item-one-painting mapping itself is undisputed. | sourcing + politics; data-model (weak) |
| Medicine | **Tried wholesale, rolled back December 2016** after a bot-imported drug list replaced editorial "antibiotics" on [[pneumonia]]. Stated grounds MEDRS/reliability, with a model-flavored diagnosis: "Wikidata can do well handling discrete numerical data but as soon as one get[s] into more nuanced text things become muddy." Explains today's P1995-only fetch. | sourcing, with data-model diagnosis |
| Video games | The norms-vs-model gap stated explicitly in 2017 ("in Wikidata eyes, there's no issue with setting 'science fiction' as the genre of a video game… do we filter out genres we don't want") — and resolved by consumer-side filtering; the infobox later adopted gated default-on fetch anyway (§2.3). | data-model (weak, filterable) |
| Settlements, music | **No written objection located** — population and genre autofill were simply never wired or proposed-and-decided in the records searched. Absence, not decision. | none found |
| Genes (control) | Accepted wholesale and ungated; the subject is itself a database record with a curated upstream feed, so article-unit and item-unit coincide by construction. | accepted |

The gradient this draws: where the unit mismatch is structural (taxa/names,
works/editions), the barrier blocks adoption outright, its own advocates
concede it in writing, and it survives a decade because referencing is
orthogonal to it. Where the mismatch is field-level semantics, communities
treat it as filterable and it does not by itself prevent gated adoption.
Where the subject is a database record, adoption is wholesale and skips the
gate entirely. Any supply-side strategy should triage domains on this axis
before counting references.

## 11. Gaps, and things noticed but deliberately not fixed

Per the brief, nothing encountered was repaired, and no Wikidata or Wikipedia
edit was made.

**Not measured (with the method that would measure it):**
- Reference rot behind the gate (sample passing references' P854 URLs,
  test resolution; needs a crawl budget and archive fallback).
- Trend against a 2–3-year-old dump (rerun `measure.py`'s classifier over an
  old JSON dump for the same QID samples).
- Reversion sampling ("is it permitted in practice") — needs revision-history
  mining over articles where gated templates were added and later removed.
- A census of which Module:Wd callers pass the `sourced` flag (1,267
  templates; only the highest-volume were read).
- Coverage rates on ca/eu/ru (their gates are off, so a different question).

**Noticed, logged, not acted on:**
- `Module:WikidataIB`'s `sourced()` comment ("wikipedia") does not match its
  behaviour (`"Wiki"`, case-sensitive); the lowercase-URL and P813-only
  passes are latent loopholes (measured at 0.8% and 0% of passing
  references).
- {{Infobox company}} passes `name=countrry` (sic) in one P17 invoke — field
  suppression via `suppressfields` for that field name would need the typo.
- 6 of 400 sampled Infobox person/Wikidata articles pass no
  `fetchwikidata`, so the template fetches nothing there.
- The ~1,800 transclusion figure for Infobox person/Wikidata still circulates
  in old discussions; the 2026-08-18 count is 4,710.
- `wbc_entity_usage` on enwiki contains an aspect spelled `CQR` (1.2M pages)
  that standard Wikibase documentation of usage aspects does not list;
  unidentified here.
- Candidate upstream fixes (each would change measurements if done before a
  re-run): replacing P143-only references on P19/P569/P106 for the
  person-domain items (the §6 queue); referencing the 325 blocked company
  pairs.

## Reproduction

Every query, with the endpoint or replica named, is in `queries.md`; the
§10 sweep's searches and pages are listed at the end of `domain_sweep.md`.
`measure.py` re-runs the sampling classifier end to end (serial, compliant
User-Agent via `wm-fetch`; ~90 API requests). Raw outputs kept here:
`samples.tsv` (all five sampling frames with QIDs), `results.json`
(per-property and per-item results), `company_yield.json`,
`company_local_params.json`, `person_remediation_split.json`,
`channel_counts.json`. The 45 MB claims snapshot (`entities.json`) is
regenerable and deliberately not committed.
