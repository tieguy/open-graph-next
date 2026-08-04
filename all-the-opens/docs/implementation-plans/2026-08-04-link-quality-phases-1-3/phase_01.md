# Link Quality Phases 1–3 Implementation Plan — Phase 1: Timeout Honesty (H)

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** A failed OpenLibrary batch can never harden into the false claim "no open copy" / "not held anywhere" — unchecked works are reported as unchecked.

**Architecture:** `openLibraryVolumes` (src/discover.js) gains one batch-level retry with backoff and returns which ISBNs it could not check. The coverage functions move to `src/citations.js` (the module that already owns `openLibraryAccess` and is unit-tested with static data in `test/citations.test.js`), gaining an `unchecked` bucket with its own coverage-line wording.

**Tech Stack:** Node 22 ESM, `node --test` + `node:assert/strict`, no mocking (repo convention: unit-test pure functions only).

**Scope:** 3 phases from design `all-the-opens/docs/design-plans/2026-08-04-link-quality-live-discovery.md` (phases 1–3 of 8). This file is design Phase 1.

**Codebase verified:** 2026-08-04 (line numbers are pre-change; if drift is suspected, grep for the quoted code).

**Working directory for all commands:** `all-the-opens/tapestry-gen/`. Tests run with plain `npm test` (no network, no env vars needed — `WIKIMEDIA_UA_CONTACT` is only required by the entry points).

---

## Context for an engineer new to this repo

- `src/discover.js` orchestrates live discovery. It currently defines three private functions this phase touches: `openLibraryVolumes` (lines 225–239), `citationCoverage` (251–262), `coverageText` (271–284).
- Today a timed-out OpenLibrary group is logged and dropped (`discover.js:234-236`); its ISBNs then have no `access`, so `coverageText` counts them as `linked` ("no open copy") or `unreached` ("not held anywhere") — both false claims about works we never checked.
- `src/citations.js` owns citation parsing and `openLibraryAccess` (line 309) and is tested in `test/citations.test.js` — pure functions, static data, `assert` from `node:assert/strict`.
- Consumers of the volumes map: `discover.js:665-668` (creates `volumesPromise`), `discover.js:789-795` (bands that cite no ISBNs substitute `new Map()`), `discover.js:798` (`citationCoverage(unit.railCandidates, volumes)`), `discover.js:1013` (band `coverage` string).

## Task 1: Coverage functions move to citations.js and learn "unchecked"

**Files:**
- Modify: `src/citations.js` (append near `openLibraryAccess`, line ~309)
- Modify: `src/discover.js` (delete lines 242–284: `citationCoverage` + `coverageText` and their doc comments; extend the import from `./citations.js` at lines 29–35 — the block that already imports `openLibraryAccess`)
- Test: `test/citations.test.js` (append)

**Step 1: Write the failing tests**

Append to `test/citations.test.js` (it already imports `test` from `node:test` and `assert` from `node:assert/strict`; extend its existing `from '../src/citations.js'` import list with `citationCoverage, coverageText`):

```js
test('citationCoverage buckets unchecked ISBNs instead of calling them closed', () => {
  const candidates = [
    { isbn: '111', url: 'https://x' }, // volumes hit, full scan
    { isbn: '222', url: 'https://x' }, // unchecked: OL batch failed
    { isbn: '333' },                   // unchecked, no links either
    { url: 'https://y' },              // no isbn: plain linked citation
    {},                                // no isbn, no links: unreached
  ]
  const volumes = new Map([
    ['111', { records: { 'ISBN:111': { data: { ebooks: [{ availability: 'full', preview_url: 'https://archive.org/details/x' }] } } } }],
  ])
  const cov = citationCoverage(candidates, volumes, new Set(['222', '333']))
  assert.equal(cov.total, 5)
  assert.equal(cov.open, 1)
  assert.equal(cov.unchecked, 2)
  assert.equal(cov.linked, 1) // only the no-isbn linked cite; 222 must NOT land here
  assert.equal(cov.catalogued, 0)
})

test('coverageText names the unchecked bucket and never counts it as unreached', () => {
  const text = coverageText({ total: 5, open: 1, catalogued: 0, linked: 1, unchecked: 2 })
  assert.match(text, /2 could not be checked this run/)
  assert.match(text, /1 not held anywhere/)
  assert.doesNotMatch(text, /3 not held/)
})

test('coverageText omits the unchecked part when everything was checked', () => {
  const text = coverageText({ total: 2, open: 1, catalogued: 0, linked: 1, unchecked: 0 })
  assert.doesNotMatch(text, /could not be checked/)
})
```

Note on the `volumes` fixture shape: `citationCoverage` feeds `volumes.get(isbn)` to `openLibraryAccess`, which reads `volume.records[...].data.ebooks[0].availability` — check `openLibraryAccess` at `src/citations.js:309` and mirror whatever shape it actually reads (the wrapper shape is built at `discover.js:232`). Adjust the fixture until the `open: 1` assertion is exercising a real 'full' availability path, not a null.

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 citationCoverage`
Expected: FAIL — `citationCoverage` is not exported from `src/citations.js`.

**Step 3: Move and extend the functions**

In `src/citations.js`, add after `openLibraryAccess` (keep the original doc comments — they are moved, not rewritten; the diff below shows only what changes inside them):

```js
/**
 * What the section cites versus what a reader can actually open. [...original
 * comment from discover.js:242-250 moves here verbatim...] `unchecked` names
 * the ISBNs whose OpenLibrary batch failed this run: those works get no
 * access verdict at all, because "we could not look" must never render as
 * "there is no copy".
 */
export function citationCoverage(candidates, volumes, unchecked = new Set()) {
  for (const cite of candidates) {
    if (!cite.isbn) continue
    cite.access = openLibraryAccess(volumes.get(cite.isbn))
  }
  const isUnchecked = (c) => c.isbn && !c.access && unchecked.has(c.isbn)
  const open = candidates.filter(
    (c) => c.access?.availability === 'full' || c.access?.availability === 'borrow',
  ).length
  const catalogued = candidates.filter((c) => c.access?.availability === 'catalog').length
  const linked = candidates.filter(
    (c) => !c.access && !isUnchecked(c) && (c.archiveUrl || c.doi || c.url),
  ).length
  return {
    total: candidates.length,
    open,
    catalogued,
    linked,
    unchecked: candidates.filter(isUnchecked).length,
  }
}

/**
 * [...original comment from discover.js:264-270 moves here verbatim...]
 */
export function coverageText({ total, open, catalogued, linked, unchecked = 0 }) {
  if (!total) return null
  const parts = []
  if (open)
    parts.push(`${open} readable or borrowable at the Internet Archive — the links on the notes above`)
  if (catalogued)
    parts.push(`${catalogued} in OpenLibrary’s catalogue, but with no scan to open yet`)
  if (linked)
    parts.push(`${linked} with no open copy — the citation’s own links are all there is`)
  if (unchecked) parts.push(`${unchecked} could not be checked this run`)
  const unreached = total - open - catalogued - linked - unchecked
  if (unreached > 0) parts.push(`${unreached} not held anywhere in the open ecosystem`)
  if (!parts.length) return null
  return `Of the ${total} work${total === 1 ? '' : 's'} cited here: ${parts.join(' · ')}`
}
```

In `src/discover.js`:
- Delete the two function definitions and their comments (lines 242–284).
- Add `citationCoverage, coverageText` to the existing `from './citations.js'` import (lines 29–35, the block that already imports `openLibraryAccess`).
- The two call sites (`discover.js:798` and `:1013`) keep working unchanged for now — `unchecked` defaults to the empty set until Task 2 wires the real one.

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including the three new ones.

**Step 5: Commit**

```bash
git add src/citations.js src/discover.js test/citations.test.js
git commit -m "feat: coverage learns an unchecked bucket — a failed lookup is not a closed book"
```

## Task 2: openLibraryVolumes retries once, then reports what it couldn't check

**Files:**
- Modify: `src/discover.js` — `openLibraryVolumes` (now at ~line 214 after Task 1's deletion; grep `async function openLibraryVolumes`), its caller (`volumesPromise`, grep `openlibrary volumes`), and the band consumption (grep `volumesPromise : new Map()` and `citationCoverage(unit.railCandidates`).

**Step 1: Extend openLibraryVolumes**

Replace the function body (keep the existing doc comment, appending one sentence: "Returns `{volumes, unchecked}`: failed groups get one delayed second pass, and ISBNs that still fail are reported as unchecked rather than silently absent." — note this is one flat 2s delay before the retry pass, not per-group exponential backoff; `getJson` already handles transport-level retry):

```js
async function openLibraryVolumes(isbns) {
  const volumes = new Map()
  const unchecked = new Set()
  const fill = (group, body) => {
    for (const isbn of group) {
      const data = body[`ISBN:${isbn}`]
      if (data) volumes.set(isbn, { records: { [`ISBN:${isbn}`]: { data } } })
    }
  }
  const failed = []
  for (const group of chunk([...new Set(isbns)], 40)) {
    try {
      fill(group, await getJson(olBooksUrl(group), { throttleMs: 1100 }))
    } catch (e) {
      console.error(`  openlibrary books failed (${group.length} isbns): ${e.message}`)
      failed.push(group)
    }
  }
  // One more chance after a beat — OpenLibrary's stumbles are usually
  // moments, not outages. Whatever still fails is truthfully unchecked.
  if (failed.length) await new Promise((r) => setTimeout(r, 2000))
  for (const group of failed) {
    try {
      fill(group, await getJson(olBooksUrl(group), { throttleMs: 1100 }))
    } catch (e) {
      console.error(`  openlibrary books failed again (${group.length} isbns): ${e.message}`)
      for (const isbn of group) unchecked.add(isbn)
    }
  }
  return { volumes, unchecked }
}
```

(`getJson` already does transport-level retries — `tries: 2`, `src/http.js:33` — this adds one batch-level second pass on top, matching the design's "retry the failed group once with backoff".)

**Step 2: Update the consumers**

At the band dependency wait (currently `discover.js:789-795`), the no-ISBN substitute must match the new shape, and the coverage call passes the set through:

```js
const [iaHits, ol, labels, scholarHits, statements] = await Promise.all([
  unit.identified.length ? iaPromise : new Map(),
  unit.railCandidates.some((c) => c.isbn)
    ? volumesPromise
    : { volumes: new Map(), unchecked: new Set() },
  breadth.length || picked.length ? labelsPromise : new Map(),
  unit.scholarly.length ? scholarPromise : new Map(),
  picked.length || unit.index === '0' ? statementsPromise : new Map(),
])
```

and (currently `discover.js:798`):

```js
const coverage = citationCoverage(unit.railCandidates, ol.volumes, ol.unchecked)
```

Search for any other reads of the old `volumes` binding inside the band task (there is one more: the `accessByIsbn` block right below reads `c.access` off the candidates, which `citationCoverage` sets — no change needed there, but confirm with `grep -n "volumes" src/discover.js` that no other site destructures the old shape).

**Step 3: Verify operationally**

Run: `npm test`
Expected: all pass (the retry path is deliberately not unit-tested — repo convention is not to mock the network; the pure bucketing logic was tested in Task 1).

Run: `WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Angkor Wat"` (sandboxed sessions also need `NODE_USE_ENV_PROXY=1`; warm cache makes this fast and offline)
Expected: completes; per-section coverage lines render; since the cache answers, nothing is unchecked and no wording changes on this run. Then confirm the honest path end-to-end by inspecting the emitted band text: `grep -o "could not be checked this run" demo/spike-angkor-wat.html` is expected to find nothing on a healthy run — the phrase exists only when a batch genuinely fails. (The unit tests are the guarantee; this render is the no-regression check.)

**Step 4: Commit**

```bash
git add src/discover.js
git commit -m "fix: a timed-out OpenLibrary batch retries once, then says 'could not be checked'"
```

## Done when (from the design)

- A simulated OpenLibrary failure produces a coverage line saying the works went unchecked, never "no open copy" — proven by the Task 1 unit tests.
- `test/citations.test.js` covers the failed-batch bucketing; `npm test` fully passes.
- A warm-cache render of Angkor Wat is unchanged (no false "unchecked" claims when the lookup succeeded).
