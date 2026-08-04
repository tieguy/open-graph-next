# Link Quality Phases 1–3 Implementation Plan — Phase 2: Maps Only for Real Places (E)

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** No map cards for languages, peoples, or dead polities — a map renders only for a locatable, extant place.

**Architecture:** The single WDQS query in `src/statements.js` gains two computed booleans per item — `place` (instance-of/subclass-of a small allowset of locatable classes) and `defunct` (has a dissolution date, or is a historical polity). A pure exported `mappable(statements)` combines them, and the one map-building call site gates on it. Same one query per page; zero extra requests.

**Tech Stack:** Node 22 ESM, `node --test` + `node:assert/strict` (pure functions, static data), SPARQL over WDQS via the existing `getJson` client. Wikimedia compliance is already handled by `src/wmf.js`/`src/http.js` — do not add any new request paths.

**Scope:** 3 phases from design `all-the-opens/docs/design-plans/2026-08-04-link-quality-live-discovery.md`. This file is design Phase 2.

**Codebase verified:** 2026-08-04.

**Working directory for all commands:** `all-the-opens/tapestry-gen/`.

---

## Context for an engineer new to this repo

- `src/statements.js` answers every anchor's partner statements with one WDQS query per 100 QIDs: `VARS` (line 16) lists the variables, `wdqsUrl` (18–34) builds the query, `entityStatements` (64–83) parses bindings into a `Map<qid, {met, aic, …}>` of *string* values.
- `mapEntry` (216–240) builds the OSM tile card; the only call site is inside `statementEntries` at line 280–282: `const coord = withMap ? parseEarthPoint(statements.coord) : null; if (coord) out.push(mapEntry(...))`.
- Today the only gates are `withMap` (one map per section, managed by the caller in `discover.js:851-862`) and `parseEarthPoint`'s non-Earth-globe refusal (54–58). Nothing checks *what kind of thing* the item is — which is how the Khmer *language* (Q9205, which carries a P625 coordinate) got a map card on the Angkor Wat page, and how the Khmer Empire and the French Protectorate of Cambodia got modern OSM maps.
- `test/pivots.test.js` already unit-tests `wdqsUrl` string construction (line 73) and other pure functions from this module — follow that file's style.

## Task 1: The query learns place-ness and defunct-ness; `mappable` decides

**Files:**
- Modify: `src/statements.js:16` (`VARS`), `src/statements.js:18-34` (`wdqsUrl`), new export `mappable` next to `osmFeature`
- Test: `test/pivots.test.js` (extend the `wdqsUrl` test; add `mappable` tests)

**Step 1: Write the failing tests**

In `test/pivots.test.js`, add `mappable` to the import from `../src/statements.js`, and append:

```js
test('wdqsUrl also asks whether the item is a locatable, extant place', () => {
  const url = decodeURIComponent(wdqsUrl(['Q1']))
  assert.match(url, /AS \?place/)
  assert.match(url, /AS \?defunct/)
  assert.match(url, /wdt:P31\/wdt:P279\*/)
  assert.match(url, /wdt:P576/)
})

test('mappable: a locatable extant place maps; a language or dead polity never does', () => {
  // WDQS returns xsd:boolean bindings as the literal strings 'true'/'false',
  // and entityStatements stores binding values verbatim.
  assert.equal(mappable({ place: 'true', defunct: 'false', coord: 'Point(103.9 13.4)' }), true)
  assert.equal(mappable({ place: 'false', defunct: 'false', coord: 'Point(104 12)' }), false) // Khmer, a language
  assert.equal(mappable({ place: 'true', defunct: 'true' }), false) // Khmer Empire
  assert.equal(mappable({}), false) // WDQS failed for this item: refuse, don't guess
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -B1 -A3 "mappable\|locatable"`
Expected: FAIL — `mappable` is not exported; the `?place` assertion fails.

**Step 3: Implement**

In `src/statements.js`:

1. Extend `VARS` (line 16):

```js
const VARS = ['met', 'aic', 'gbif', 'inat', 'coord', 'osmr', 'osmw', 'osmn', 'iiif', 'lc', 'eu', 'place', 'defunct']
```

2. In `wdqsUrl`, add `?place ?defunct` to the SELECT list and append the two BINDs before the closing `}` (after the P7704 OPTIONAL):

```js
    // A map card is only true of a locatable, extant place. `?place` asks
    // whether the item is an instance of (or of a subclass of) one of a small
    // set of mappable classes; `?defunct` whether it ended — a dissolution
    // date or a historical-polity class. A language with a coordinate, or an
    // empire that ended in 1431, answers false and gets no modern map.
    'BIND(EXISTS { VALUES ?locClass { wd:Q618123 wd:Q486972 wd:Q56061 wd:Q41176 wd:Q811979 wd:Q43229 } ' +
    '?item wdt:P31/wdt:P279* ?locClass } AS ?place) ' +
    'BIND((EXISTS { ?item wdt:P576 ?ended } || ' +
    'EXISTS { ?item wdt:P31/wdt:P279* wd:Q3024240 }) AS ?defunct) }'
```

(The allowset, per the design: Q618123 geographical feature, Q486972 human settlement, Q56061 administrative territorial entity, Q41176 building, Q811979 architectural structure, Q43229 organization — the last is what keeps institution headquarters like the EFEO mappable. Q3024240 is "historical country"; P576 is "dissolved, abolished or demolished date". Keep the existing string-concatenation style of the surrounding code, and remember the old closing `}` of the WHERE clause is now supplied by this appended fragment.)

3. Add the pure gate next to `osmFeature` (~line 46):

```js
/**
 * Whether a map card would be TRUE of this item: a locatable, extant place.
 * WDQS boolean bindings arrive as the strings 'true'/'false'; an item the
 * query never answered for stays unmappable — refusal over wrongness, the
 * same stance parseEarthPoint takes for non-Earth globes.
 */
export function mappable(statements) {
  return statements.place === 'true' && statements.defunct !== 'true'
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass, including the pre-existing `wdqsUrl asks for every partner property…` test (extend it only if it asserts an exact full string — it currently checks substrings).

**Step 5: Verify the SPARQL against live WDQS for the known exemplars**

The unit tests prove the strings; this proves the ontology assumptions. `wm-fetch` is the compliant shell fetcher (sets User-Agent; one URL per call — serial):

```bash
node -e "import('./src/statements.js').then(m => console.log(m.wdqsUrl(['Q9205','Q201705','Q3173090','Q43473','Q1449','Q273559'])))"
# then fetch the printed URL:
wm-fetch '<printed url>' | python3 -m json.tool | grep -B6 '"place"\|"defunct"' | head -60
```

Expected booleans: Q9205 (Khmer language) place=false · Q201705 (Khmer Empire) defunct=true · Q3173090 (French Protectorate) defunct=true · Q43473 (Angkor Wat) place=true, defunct=false · Q1449 (Genoa) place=true, defunct=false · Q273559 (EFEO) place=true, defunct=false.

If any exemplar disagrees, STOP and adjust the allowset/defunct clauses before proceeding — the design's acceptance list (phase "Done when") is exactly these six items. EFEO is the one to watch: it is the sole reason Q43229 (organization) is in the allowset, and its map today comes from P625 on the item itself — if `place` comes back false for it, the allowset (not the gate) is what needs fixing.

**Step 5b: Measure the enriched query at realistic scale**

The two `EXISTS { … wdt:P31/wdt:P279* … }` clauses ride the SINGLE query that answers every partner pivot for up to 100 QIDs — if Blazegraph times out, `entityStatements` drops the whole group (`src/statements.js:70-73`) and the page silently loses Met/AIC/GBIF/iNat/IIIF/DPLA/Europeana *and* maps, not just the gate. Before wiring anything further, time a realistic batch:

Use the page's real anchors, not synthetic QIDs (nonexistent items short-circuit the `P31/P279*` walk and understate the cost). After a cached Angkor Wat run, harvest its QIDs and time the enriched query over them:

```bash
node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  import { wdqsUrl } from './src/statements.js'
  const s = readFileSync('demo/spike-angkor-wat.html', 'utf8')
  const qids = [...new Set([...s.matchAll(/\b(Q\d+)\b/g)].map((m) => m[1]))].slice(0, 80)
  console.log(qids.length, 'qids'); console.log(wdqsUrl(qids))
"
time wm-fetch '<printed url>' > /dev/null
```

Expected: comparable to the current query (the existing WDQS batches settle in under ~1s per the stderr timing lines; anything under ~3s is fine). If it is dramatically slower or times out: fall back to issuing `place`/`defunct` as a *second* WDQS query, only for the QIDs whose first-query bindings carry `coord`/`osmr`/`osmw`/`osmn` (typically a handful per page), on the same host queue — the failure mode then costs only maps, never the partner pivots. Record which variant shipped in the commit message.

**Step 6: Commit**

```bash
git add src/statements.js test/pivots.test.js
git commit -m "feat: the statements query learns whether an item is a mappable place"
```

## Task 2: The map call site refuses non-places

**Files:**
- Modify: `src/statements.js:280-282` (the `coord` line inside `statementEntries`)
- Test: `test/pivots.test.js`

**Step 1: Write the failing test**

Add `statementEntries` to the `../src/statements.js` import in `test/pivots.test.js` (the list at lines 5–14 currently has `aicEntryFrom, gbifEntryFrom, inatEntryFrom, mapEntry, metEntryFrom, osmFeature, parseEarthPoint, wdqsUrl` plus Task 1's `mappable`). `statementEntries` is async but with no partner statements set it does no I/O — only the map branch runs, so it is safe to call in a unit test with static data:

```js
test('statementEntries builds no map card for a non-place, even with room for one', async () => {
  const dead = await statementEntries('Q201705', { coord: 'Point(103.9 13.4)', place: 'true', defunct: 'true' }, { label: 'Khmer Empire', withMap: true })
  assert.deepEqual(dead, [])
  const lang = await statementEntries('Q9205', { coord: 'Point(104 12)', place: 'false', defunct: 'false' }, { label: 'Khmer', withMap: true })
  assert.deepEqual(lang, [])
  const wat = await statementEntries('Q43473', { coord: 'Point(103.8667 13.4125)', place: 'true', defunct: 'false', osmw: '43497551' }, { label: 'Angkor Wat', withMap: true })
  assert.equal(wat.length, 1)
  assert.equal(wat[0].source, 'openstreetmap')
})
```

**Step 2: Run tests to verify the new one fails**

Run: `npm test 2>&1 | grep -A4 "no map card"`
Expected: FAIL — the dead-polity and language cases currently return a map entry.

**Step 3: Implement the gate**

At `src/statements.js:280`, change the coord line (comment included — it states the constraint):

```js
  // A map is only built for a locatable, extant place: a language with a
  // coordinate, or an empire with a P625 centroid, would render a confident
  // modern map of the wrong fact. An OSM identifier does not override the
  // gate — OSM maps the territory, Wikidata says whether the item IS one.
  const coord = withMap && mappable(statements) ? parseEarthPoint(statements.coord) : null
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

**Step 5: Verify on the evidence pages**

The changed query string is a new cache key, so each page pays one live WDQS call, then re-runs offline:

```bash
WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Angkor Wat"
grep -c "Map: Khmer" demo/spike-angkor-wat.html        # expected: 0
grep -c "Map: Angkor Wat" demo/spike-angkor-wat.html   # expected: >= 1
grep -c "Map: École\|Map: French School" demo/spike-angkor-wat.html  # expected: >= 1 (EFEO, the organization case — the card title uses Wikidata's English label, so match both renderings)
WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Dapples"
grep -c "Map: Genoa" demo/spike-dapples.html           # expected: >= 1
```

(Sandboxed sessions: prefix `NODE_USE_ENV_PROXY=1`.) Also re-render one fixture (`node spike.js "Ludwig Prandtl"`) and confirm no crash and no unexpected map loss — Prandtl's places (Göttingen etc.) are extant and must survive.

**Step 6: Commit**

```bash
git add src/statements.js test/pivots.test.js
git commit -m "fix: no modern maps for languages or dead polities — mappable() gates the card"
```

## Done when (from the design)

- Angkor Wat page: no "Map: Khmer", no Khmer Empire / French Protectorate maps; the Angkor Wat, Genoa, and EFEO maps survive.
- `test/pivots.test.js` covers member/non-member items; `npm test` fully passes.
- Fixture renders unchanged where they were already correct.
