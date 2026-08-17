# Single-Institution Work Pages Implementation Plan — Phase 7

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** The offline census exists (dated, checked in, never read at
request time), the flagship set is warmable from it, and a hand QA window
runs before any broad flag-on.

**Architecture:** A `tools/census-holder-articles.mjs` script materializes
the WDQS union query (every enwiki work-article carrying a `HOLDERS`
property) to a dated JSON file under `all-the-opens/docs/data/`; the QA
window samples from that file; findings are written up dated. Nothing at
request time reads any of it.

**Scope:** Phase 7 of 7. Depends on Phases 1–5; Phase 6 holders join the
census and sample as they land.

**Codebase verified:** 2026-08-16. WDQS fetches must ride the project's
compliant path — reuse the WDQS request helper `src/statements.js` uses
(single UA definition `src/wmf.js`; `WIKIMEDIA_UA_CONTACT` mandatory, no
default), serial, through the request cache. `warm.js` /
`src/warming.js` walk pages through the server's own front door.

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## Task 1: The census script

**Files:**
- Create: `tools/census-holder-articles.mjs`
- Create: `all-the-opens/docs/data/2026-MM-DD-holder-census.json` (its output;
  actual run date in the name)
- Test: the query builder is exported and URL-tested (DigitalNZ style) in
  `test/holder.test.js` or a new `test/census.test.js`.

**Step 1:** The query, built from `HOLDERS` + `WORK_CLASSES` in
`src/holder.js` so the census can never drift from what the pipeline
detects:

```sparql
SELECT ?item ?article ?property ?value ?collection WHERE {
  VALUES ?class { wd:Q3305213 wd:Q860861 }
  ?item wdt:P31 ?class .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?item wdt:P195 ?collection }
  { ?item wdt:P13234 ?value . BIND("P13234" AS ?property) }
  UNION { ?item wdt:P3634 ?value . BIND("P3634" AS ?property) }
  UNION { ?item wdt:P4610 ?value . BIND("P4610" AS ?property) }
  UNION { ?item wdt:P6108 ?value . BIND("P6108" AS ?property) }
  # … one UNION branch per HOLDERS row — GENERATED from HOLDERS, not typed
}
```

The script generates the branches from `HOLDERS`, runs the query through
the compliant WDQS path, and writes:

```json
{
  "queried": "2026-08-16",
  "sparql": "<the exact query text>",
  "holders": { "rijks": "P13234", "…": "…" },
  "articles": [
    { "title": "The Night Watch", "qid": "Q219831", "property": "P13234", "id": "200107928" }
  ]
}
```

`queried` is the run date — the file's honesty depends on it. Re-running
overwrites nothing: a new run is a new dated file, and the doc that cites a
number cites the file that produced it. The output directory is
`../docs/data/` relative to the working directory (`mkdir -p` it — it does
not exist yet).

**Per-holder attribution rule:** census rows are per (item, property); a
few items carry more than one round-one property (5 of 1,362 measured
2026-08-16 across four properties). Whenever the census reports per-holder
coverage, attribute each ITEM to the holder `selectHolder` would pick —
import it, don't re-implement it, and reconstruct the minimal claims
shape it reads from the census rows (the per-item property/value pairs
plus the `?collection` column the query carries for exactly this), so the
precedence + P195 tiebreak actually runs and the QA denominators match
what the pipeline does.

**The narrowing control (one extra query, same run):** detection is direct
P31, so the census cannot see what an ancestry walk would have added. The
script also runs and records, dated, a control count: enwiki articles whose
subject is P31 of a *subclass* (`wdt:P31/wdt:P279+ wd:Q3305213` or
`wd:Q860861`, minus direct members) carrying a `HOLDERS` property. The
number is reported in the census file as `subclassControl` — it is the
measured cost of the direct-P31 narrowing, and the flag-default writeup in
Task 3 must cite it.

**Step 2:** URL/query-builder test: with `HOLDERS` as of Phase 5 the
generated query contains all four properties exactly once; adding a fake
holder row adds a branch (test with a stubbed list — the builder takes the
list as an argument).

**Step 3:** Run it (network; operator UA):

```bash
WIKIMEDIA_UA_CONTACT=luis@lu.is node tools/census-holder-articles.mjs
```

Expected order of magnitude: ~1,360 articles (a 2026-08-16 plan-review run
counted 1,362 items across the three museum properties plus P6108, 679 of
them P6108-only — record the actual number, dated, and do not reuse
these). The census counts graph reachability; how many manifest-held items
actually clear the Phase 2 gate is a separate number the QA window
measures.

**Step 4:** Commit — `git add` exactly
`all-the-opens/tapestry-gen/tools/census-holder-articles.mjs`, the dated
file under `all-the-opens/docs/data/`, and the test file.

## Task 2: Flagship warm list

**Files:**
- Modify: whatever list `warm.js`/`src/warming.js` walks — **only behind the
  experiment**: do NOT touch the production showcase list; add an optional
  `node warm.js --holder-flagships` (or equivalent flag read from the census
  file's top N by a hand-picked title list checked into the tool) that walks
  the holder flagships through a HOLDER_PAGE=1 server.

**Step 1:** Implement the optional walk: The Night Watch + one article per
wired holder (from Phase 6's acceptance articles), sourced from a small
exported list next to the census tool. The switch is an env var, because
`warm.js` reads `process.argv[2]` as the base URL (`warm.js:26`) — a flag
argument would be parsed as the URL:

**Step 2:** Verify against a local server:

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is npm run serve &
HOLDER_FLAGSHIPS=1 node warm.js http://localhost:8787
```

Every page must reach `__tapdone`; none thin. Kill the server after.

**Step 3:** `npm test` green (showcase/warming agreement test must be
untouched). Commit — `git add all-the-opens/tapestry-gen/warm.js` plus
whichever warming/list file was touched, explicitly.

## Task 3: The QA window

**Files:**
- Create: `all-the-opens/docs/2026-MM-DD-holder-page-qa.md` (run date in name)

**Step 1:** Sample 20–50 articles from the census file across all wired
holders (every holder represented; weight toward the biggest). For each,
render flag-on locally and check by hand:

1. **Right object**: the hero's `href` id round-trips to the census row's
   identifier.
2. **Rights honored**: no featured image on any object the museum does not
   flag public-domain (these pages must render as ordinary pages).
3. **Panel sane**: rows attributed; where Wikipedia and the museum disagree,
   both values visible; no row claiming a field neither side stated.
4. **Clean degradation**: pick 2–3 articles whose holder fetch is forced to
   fail (temporarily bogus id in the claims fixture or offline cache miss):
   ordinary page renders, no error surfaces.
4b. **Stubs lead too**: at least 2 short-lede (stub) work-articles in the
   sample, verifying the holder hero leads despite `FLOAT_MIN_PROSE`.
5. **Single-source discipline**: grep each render for foreign partner hosts
   (Phase 5's grep), expect 0.

**Step 2:** Write findings in the QA doc: per-holder coverage (count in
census vs. count rendering a holder page, dated); **for the iiif lane
specifically, the gate pass-rate at sample scale** — what fraction of
manifest-held articles cleared institution/rights/image, per failure leg
(the scaled-up answer to the Phase 2 inspection window, and to the
operator's stated expectation that many hosts will not publish what the
gate needs); every defect found with its article; and the flag
recommendation (default on for work-articles, or not yet).

**Step 3:** Commit (`git add` the dated QA doc path only). The
flag-default decision itself is the operator's,
made on this document — do not flip any production default in this phase.

## Phase done when

- A dated census file exists, generated from `HOLDERS`, with its query
  embedded; the builder is tested.
- The flagship warm walk completes with no thin pages locally.
- The QA doc records the window's findings, per-holder coverage with dates,
  and a flag recommendation — and production defaults are unchanged.
