# Link Quality Phases 1–3 Implementation Plan — Phase 3: Pivot Once Per Page (D)

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** No repeated carousels and no repeated files: each anchor QID enriches exactly one band (its first mention in article order, with later sections backfilling from their own candidates), and no `File:` renders twice on a page.

**Architecture:** Two pure functions in a new `src/dedup.js` — `claimAnchors` (greedy, article-order anchor ownership with per-section backfill) and `dropSeenFiles` (article-order file dedup) — plus wiring in `src/discover.js`: the picked-anchor pass claims through the registry (seeded with the subject QID resolved in the existing title batch — no new await on the critical path), and per-band Commons depicts fetches are **chained** unit-to-unit (band *i* awaits only bands 0..*i-1*'s Commons work, which the serial commons host queue already imposes in practice) so file dedup is deterministic in article order without a page-wide barrier. Streaming stays streaming: no band waits on the lede's slow pivots or on later bands.

**Tech Stack:** Node 22 ESM, `node --test` + `node:assert/strict`, pure functions with static data (repo convention).

**Scope:** 3 phases from design `all-the-opens/docs/design-plans/2026-08-04-link-quality-live-discovery.md`. This file is design Phase 3.

**Codebase verified:** 2026-08-04, re-verified by plan review (which also confirmed: `commonsDepicting` sets `_file`; category files don't; `statementEntries` signature; WDQS booleans as strings). Phase 1 shifts `discover.js` line numbers upward by ~40; every reference below pairs the pre-phase-1 number with a grep anchor — trust the grep.

**Working directory for all commands:** `all-the-opens/tapestry-gen/`.

---

## Context for an engineer new to this repo

- Each article section is a `unit`; `unit.linkCandidates` is its wikilinks in document order (`discover.js:608-617`). `pickedPromise` (grep `const pickedPromise`; pre-phase-1 lines 642-653) resolves titles→QIDs and takes the first `QIDS_PER_SECTION` (default 2) *unique-within-the-unit* QIDs. Nothing dedups **across** units — that is why Angkor Wat's Khmer Empire carousel rendered identically in three sections and Dapples' University of Lausanne pair twice.
- Everything downstream keys off `picked`: the Commons depicts loop (grep `commonsDepicting(qid)`; lines 768-783), statements/maps (grep `statementQids`; 850-866), DPLA (876-882), Europeana (914-920). Owning the anchor in one band therefore dedups all of them at once.
- Band tasks run concurrently and `emit('band')` in completion order, and the module contract (top of `discover.js`) is that **a band waits only on its own dependencies** — early rails stream while slow batches answer. Ownership must therefore be decided *before* pivots run, from article order alone; and file dedup must not introduce a page-wide barrier.
- The subject's own QID is prepended to the lede's statement anchors (grep `extras?.subjectQid ? [extras.subjectQid`; line 850) — the registry must reserve it for the lede so a section that happens to wikilink the subject doesn't claim it.
- Card identity: Commons depicts entries carry `_file` (set in `commonsDepicting`, grep `_file: p.title`); the subject's Commons-category entries (grep `gcmtitle`) don't yet — Task 3 adds it.
- **Deliberately out of scope, with reasons:** (a) IA/citation cards can still repeat across bands when two sections cite the same book — those cards pace each section's own footnotes, the design's Phase 3 targets *anchor* repetition, and `dedupeIdentifiers` already collapses within a band; (b) partner cards (Met/AIC/DPLA/Europeana/IIIF) are emitted only for owned anchors, so anchor ownership dedups them — the lede's subject-derived partner cards can't repeat elsewhere because the subject QID is seeded to the lede. Only Commons files can reach one page through two *different* owned anchors (one file depicting both), which is what `dropSeenFiles` handles.
- Byte-reproducibility (batch invariant): all new logic is pure over fetched data; the chain changes where awaits happen, not which requests are made.

## Task 1: `claimAnchors` and `dropSeenFiles` (pure, tested)

**Files:**
- Create: `src/dedup.js`
- Test: `test/dedup.test.js`

**Step 1: Write the failing tests**

Create `test/dedup.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { claimAnchors, dropSeenFiles } from '../src/dedup.js'

test('claimAnchors: first band in article order owns an anchor; later bands backfill', () => {
  const picks = claimAnchors(
    [
      ['Q1', 'Q2', 'Q3'],
      ['Q1', 'Q4', 'Q5'], // Q1 already claimed -> backfills with Q4, Q5
      ['Q2', 'Q4'],       // both claimed -> nothing left
    ],
    { perUnit: 2 },
  )
  assert.deepEqual(picks, [['Q1', 'Q2'], ['Q4', 'Q5'], []])
})

test('claimAnchors: within a unit, duplicates collapse before the cap', () => {
  const picks = claimAnchors([['Q1', 'Q1', 'Q2']], { perUnit: 2 })
  assert.deepEqual(picks, [['Q1', 'Q2']])
})

test('claimAnchors: a seeded owner keeps its anchor even against earlier units', () => {
  // The subject QID belongs to the lede (index 0) even if section 1 links it.
  const picks = claimAnchors([['Q9'], ['Q9', 'Q7']], { perUnit: 2, seeded: new Map([['Q9', 0]]) })
  assert.deepEqual(picks, [['Q9'], ['Q7']])
})

test('claimAnchors: null/undefined QIDs never claim a slot', () => {
  const picks = claimAnchors([[null, 'Q1', undefined]], { perUnit: 2 })
  assert.deepEqual(picks, [['Q1']])
})

test('dropSeenFiles: a file renders once, at its first article-order appearance', () => {
  const lists = [
    [{ _file: 'File:A.jpg' }, { _file: 'File:B.jpg' }],
    [{ _file: 'File:B.jpg' }, { _file: 'File:C.jpg' }],
  ]
  const out = dropSeenFiles(lists, (e) => e._file)
  assert.deepEqual(out.map((l) => l.map((e) => e._file)), [
    ['File:A.jpg', 'File:B.jpg'],
    ['File:C.jpg'],
  ])
})

test('dropSeenFiles: entries with no key always pass', () => {
  const out = dropSeenFiles([[{ title: 'x' }], [{ title: 'x' }]], (e) => e._file)
  assert.equal(out.flat().length, 2)
})

test('dropSeenFiles: a pre-seeded set claims files before any list does', () => {
  const seen = new Set(['File:A.jpg'])
  const out = dropSeenFiles([[{ _file: 'File:A.jpg' }, { _file: 'File:B.jpg' }]], (e) => e._file, seen)
  assert.deepEqual(out[0].map((e) => e._file), ['File:B.jpg'])
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -B2 "dedup"`
Expected: FAIL — `src/dedup.js` does not exist (module resolution error).

**Step 3: Implement**

Create `src/dedup.js`:

```js
// Page-level dedup, decided from article order alone. Bands run and emit in
// COMPLETION order (streaming), so any first-come-wins state consulted at
// band-run time would be nondeterministic; both functions here are pure over
// article-ordered input.

/**
 * Assign each anchor QID to the first unit (article order) whose prose
 * mentions it, capping each unit at `perUnit` owned anchors; a unit whose
 * early candidates were claimed upstream backfills from its later ones.
 * `seeded` pre-assigns QIDs to a unit index — the subject's QID belongs to
 * the lede no matter who else links it.
 *
 * @param {Array<Array<string|null>>} candidates per-unit QID candidates, article order
 * @returns {Array<Array<string>>} per-unit owned anchors, same outer order
 */
export function claimAnchors(candidates, { perUnit, seeded = new Map() }) {
  const owner = new Map(seeded)
  return candidates.map((qids, i) => {
    const own = []
    for (const q of qids) {
      if (own.length >= perUnit) break
      if (!q || own.includes(q)) continue
      const holder = owner.get(q)
      if (holder != null && holder !== i) continue
      owner.set(q, i)
      own.push(q)
    }
    return own
  })
}

/**
 * Drop entries whose key already appeared in an earlier list (or in `seen`),
 * so one file never renders twice on a page. Keyless entries always pass —
 * refusing to dedup is safer than dedup-by-accident on a null key.
 */
export function dropSeenFiles(lists, keyOf, seen = new Set()) {
  return lists.map((list) =>
    list.filter((e) => {
      const key = keyOf(e)
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

**Step 5: Commit**

```bash
git add src/dedup.js test/dedup.test.js
git commit -m "feat: article-order anchor ownership and file dedup, as pure functions"
```

## Task 2: Anchors claim through the registry — without a new await on the critical path

**Files:**
- Modify: `src/discover.js` — `qidsPromise` + `pickedPromise` (grep `const qidsPromise`; pre-phase-1 lines 641-653) and the import block.

**Step 1: Resolve the subject QID inside the existing title batch**

`pickedPromise` must NOT await `subjectPromise` — that would put `subjectPromise`'s `wbgetentities` claims round-trip (grep `subject claims failed`) in front of `labelsPromise`, `statementsPromise`, and every band's Commons work. The subject's QID is just a title resolution, and `fetchQids` is already batching titles — add the page's own title to the batch:

Add to imports: `import { claimAnchors, dropSeenFiles } from './dedup.js'` (dropSeenFiles is used in Task 3).

Replace (grep `const qidsPromise`):

```js
  // The page's own title rides the same batch: its QID seeds the anchor
  // registry below without waiting on the subject's claims fetch.
  const qidsPromise = fetchQids(CACHE, [
    ...new Set([page, ...units.flatMap((u) => u.linkCandidates)]),
  ])
  const pickedPromise = qidsPromise.then((qids) => {
    // Every unit's candidates in article order; ownership is decided here,
    // before any pivot runs, so streaming's completion-order emission can
    // never reassign an anchor between runs. The subject QID is seeded to
    // the lede: its statements and category belong there by design.
    const seeded = new Map()
    const ledeAt = units.findIndex((u) => u.index === '0')
    const subjectQid = qids.get(page)
    if (subjectQid && ledeAt !== -1) seeded.set(subjectQid, ledeAt)
    const owned = claimAnchors(
      units.map((u) => u.linkCandidates.map((t) => qids.get(t))),
      { perUnit: QIDS_PER_SECTION, seeded },
    )
    const picked = new Map()
    units.forEach((unit, i) => {
      stats.anchorsQid += owned[i].length
      picked.set(unit, owned[i])
    })
    return picked
  })
```

Notes for the implementer:
- Check how `discover(page, …)` names its argument (grep `export async function discover`) and how `fetchQids` normalizes titles (grep `function fetchQids` — follow redirects/normalization: if it returns a Map keyed by *normalized* title, `qids.get(page)` may need the same normalization the linkCandidates get; verify with a quick `node -e` against the cache, and if normalization differs, match `subjectPromise`'s own resolution instead — but still without awaiting its claims call).
- The old per-unit `.filter((q, i, a) => q && a.indexOf(q) === i).slice(0, QIDS_PER_SECTION)` logic is superseded by `claimAnchors` — delete it.
- `stats.anchorsQid` keeps counting picked anchors; totals drop on pages with repeated anchors. That is the point.

**Step 2: Verify**

Run: `npm test`
Expected: all pass.

Run: `WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Dapples"` (add `NODE_USE_ENV_PROXY=1` if sandboxed)
Expected: the University of Lausanne carousel and map appear in "Notable Members" (its first mention) and are absent from "Vaud Branch". Capture the stderr `network requests —` tally line for the commit message (Commons count drops).

**Step 3: Commit**

```bash
git add src/discover.js
git commit -m "fix: an anchor enriches the band of its first mention — later bands backfill

<paste the before/after 'network requests' tally lines here>"
```

## Task 3: Depicts dedups in a unit-to-unit chain; category files claim their keys first

**Files:**
- Modify: `src/discover.js` — the category-files entry builder (grep `gcmtitle`, then the object literal below; pre-phase-1 ~line 455), the lede-extras block (grep `const ledeExtrasPromise`), and the per-band Commons loop (grep `commonsDepicting(qid)`; pre-phase-1 lines 768-783).

**Step 1: Give category files a `_file` key**

In the category-members entry builder (the `.map((p) => {` under the `gcmtitle` request), add `_file: p.title,` alongside `_via: 'P373'`. Confirm inertness at the real consumer: the `e.fix` stamping loop in the band task (grep `Check or fix it on Commons`) iterates `commonsEntries` only, so category entries gaining `_file` changes no rendered output. Run `npm test` to confirm.

**Step 2: Extract the category fetch from ledeExtrasPromise**

The file-dedup chain must seed with the subject's category files (the subject's own media outranks an anchor's claim to the same file), but it must NOT wait for all of `ledeExtrasPromise` — that promise also awaits the thesis pivot and IA batch. Extract unconditionally:

In the block defining `ledeExtrasPromise` (grep `const ledeExtrasPromise`), the category name comes from `subjectClaims.P373` (grep `categoryName`). Hoist the category fetch into its own promise directly above:

```js
  // The subject's Commons category, as its own promise: the depicts chain
  // seeds from it, and waiting there for ALL the lede's pivots (thesis, IA)
  // would stall every band's rail behind the slowest one. The catch is
  // load-bearing: this promise now sits on EVERY band's critical path, and
  // a failed category fetch is cosmetic, not fatal — without the catch it
  // would reject the whole chain and take down discover() entirely.
  const categoryFilesPromise = subjectPromise.then(({ claims }) => {
    const categoryName = claims.P373?.[0]?.mainsnak?.datavalue?.value
    return typeof categoryName === 'string'
      ? commonsCategoryFiles(categoryName, CATEGORY_FILES).catch((e) => {
          console.error(`  commons category failed: ${e.message}`)
          return []
        })
      : []
  })
```

(The guard, the `.catch`, and the `CATEGORY_FILES` budget are carried verbatim from the current in-place fetch — grep `commons category failed` to find it, currently at discover.js:703-708. Verify the helper is really named `commonsCategoryFiles` there and match it exactly.)

…then inside `ledeExtrasPromise`, replace its own category fetch (the `categoryFiles` element of the `Promise.all` around pre-phase-1 line 689 — the block the grep above lands in) with `categoryFilesPromise`. Rejection audit for the chain, for the implementer's confidence: `subjectPromise` never rejects (it catches internally, grep `subject claims failed`), `categoryFilesPromise` now never rejects, and `commonsDepicting` errors are caught inside the loop — the only remaining rejection path into the chain is `pickedPromise` itself, which already fails the page today. Note also that the final unit's trailing `seenSoFar = result.then((r) => r.seen)` has no consumer, so if a rejection path is ever reintroduced it would surface as an unhandled-rejection warning; keeping the chain rejection-free is the contract.

**Step 3: Chain the per-band depicts through a rolling seen-set**

Replace the per-band Commons loop. Add, after `ledeExtrasPromise` is defined:

```js
  // Commons depicts, deduped page-wide in ARTICLE order via a unit-to-unit
  // chain: band i's rail waits only on bands 0..i-1's Commons work — which
  // the serial commons host queue imposes anyway — never on later bands and
  // never on the lede's slow pivots. Inside the band tasks this state would
  // be first-come in completion order, i.e. nondeterministic streaming.
  // The chain seeds from the subject's category files: its own media
  // outranks an anchor's claim to the same file.
  const depictsByUnit = new Map()
  {
    let seenSoFar = Promise.all([pickedPromise, categoryFilesPromise]).then(([, catFiles]) => {
      const seen = new Set()
      for (const f of catFiles) if (f._file) seen.add(f._file)
      return seen
    })
    for (const unit of units) {
      const result = seenSoFar.then(async (seen) => {
        const commonsEntries = []
        const breadth = []
        for (const qid of (await pickedPromise).get(unit)) {
          try {
            const { files, totalhits } = await commonsDepicting(qid)
            for (const f of files) f._qid = qid
            const [kept] = dropSeenFiles([files], (f) => f._file, seen)
            commonsEntries.push(...kept)
            stats.commons += kept.length
            // Deduped files stay disclosed: an anchor whose whole carousel
            // rendered earlier on the page must not silently vanish from
            // the band's own accounting.
            if (files.length)
              breadth.push({ qid, shown: kept.length, dropped: files.length - kept.length, totalhits })
          } catch (e) {
            console.error(`  commons lookup failed (${qid}): ${e.message}`)
          }
        }
        return { commonsEntries, breadth, seen }
      })
      depictsByUnit.set(unit, result)
      seenSoFar = result.then((r) => r.seen)
    }
  }
```

In the band task, replace the whole old loop (the `const commonsEntries = []` / `const breadth = []` / `for (const qid of (await pickedPromise).get(unit))` block) with:

```js
    const { commonsEntries, breadth } = await depictsByUnit.get(unit)
```

**Step 4: Disclose what dedup dropped**

In the disclosure builder (grep `Commons media follows this section’s links`), the map over `breadth` currently renders `showing N of M`. Extend each item with the dropped count when present, keeping the existing null-totalhits branch:

```js
              b.totalhits == null
                ? `${labels.get(b.qid) ?? b.qid} (showing ${b.shown}; total unknown)`
                : `${labels.get(b.qid) ?? b.qid} (showing ${b.shown} of ${b.totalhits.toLocaleString()}` +
                  `${b.dropped ? `; ${b.dropped} shown earlier on this page` : ''})`,
```

Also check the `band.broad` computation (grep `broad: breadth.some`) still reads `b.totalhits` — unchanged, and a fully-deduped anchor (`shown: 0`) now correctly still counts toward `broad` when its pool was large.

**Step 5: Verify determinism and behavior**

Run: `npm test`
Expected: all pass (`dedup.test.js` covers the pure logic; no existing test imports `discover.js`, so the double-render diff below is the determinism guarantee — there is no unit-level determinism test, deliberately, per repo convention).

Byte-reproducibility (the batch invariant):

```bash
WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Angkor Wat" && cp demo/spike-angkor-wat.html /tmp/a.html
WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Angkor Wat" && diff /tmp/a.html demo/spike-angkor-wat.html
```

Expected: empty diff.

Design acceptance greps:

```bash
grep -c "PhetMahaThamm2" demo/spike-angkor-wat.html    # expected: 1 (was 3)
grep -c "Sri Mariamman Temple Singapore 3 amk" demo/spike-angkor-wat.html  # expected: 1 (was 3)
WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "Dapples"
grep -c "Cubotron" demo/spike-dapples.html             # expected: 1 (was 2)
grep -c "shown earlier on this page" demo/spike-angkor-wat.html  # expected: >= 1
```

No-double-file sweep (ESM-safe):

```bash
for f in demo/spike-*.html; do
  node --input-type=module -e "
    import { readFileSync } from 'node:fs'
    const s = readFileSync('$f', 'utf8')
    const m = [...s.matchAll(/commons\.wikimedia\.org\/wiki\/(File%3A[^\"]+)/g)].map((x) => x[1])
    const dup = m.filter((v, i, a) => a.indexOf(v) !== i)
    if (dup.length) { console.error('$f duplicates:', [...new Set(dup)]); process.exit(1) }
  " || exit 1
done; echo "no file rendered twice"
```

Expected: `no file rendered twice`.

Streaming check (the contract the review protected): `WIKIMEDIA_UA_CONTACT=<your-address> npm run serve`, open `http://localhost:8787/wiki/Barbara_McClintock` cold (delete `.cache/` first if you want the true cold profile) and confirm the spine still renders ~1s and the first rail lands well before the page completes — baseline from `tapestry-gen/CLAUDE.md`: spine 0.9s, first rail 4.5s, complete ~9s. Modest movement is acceptable; first-rail-arrives-with-completion is a regression, stop and re-examine the chain.

**Step 6: Re-render the fixtures and record the request delta**

```bash
for t in "Apollo 11" "Brown v. Board of Education" "Ludwig Prandtl"; do
  WIKIMEDIA_UA_CONTACT=<your-address> node spike.js "$t"
done
```

Expected: all complete; eyeball each page for absent-but-expected carousels (an anchor that legitimately dominated two sections now appears at first mention only — designed; but confirm nothing vanished *entirely*). Capture each run's stderr `network requests —` tally; the Prandtl line updates the Tier-1 profile and belongs in the commit message (and in `tapestry-gen/CLAUDE.md` when this branch's docs pass runs).

**Step 7: Commit**

```bash
git add src/discover.js
git commit -m "fix: depicts dedups page-wide in article order — no file renders twice

<paste the before/after Prandtl 'network requests' tally lines here>"
```

## Done when (from the design)

- Angkor Wat renders the Khmer Empire set once; Dapples renders the Lausanne pair once; no `File:` appears twice on any fixture page — and the dedup is disclosed, not silent ("shown earlier on this page").
- `npm test` (including the new `dedup.test.js`) passes; a warm-cache double render byte-matches; streaming's first-rail profile holds.
- Ownership is decided from article order before any pivot runs (streaming can never reassign carousels between runs).
