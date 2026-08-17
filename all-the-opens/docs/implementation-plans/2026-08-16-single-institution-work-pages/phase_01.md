# Single-Institution Work Pages Implementation Plan — Phase 1

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Detect that an article IS a museum-held work, select its one holding
institution from the subject's own Wikidata identifiers, behind an experiment
flag that changes nothing when off.

**Architecture:** A new pure module `src/holder.js` (detection + selection),
wired into `src/discover.js` right after the existing subject-claims fetch.
Flag-on, the pipeline logs the selection and carries it on the result; nothing
renders differently until Phase 3.

**Tech Stack:** Node 22+, no new dependencies. Tests: `node --test`, one file
per module, prose-sentence test names, `node:assert/strict`, pure functions
over hardcoded fixtures (see `test/dedup.test.js` for the house style).

**Scope:** Phase 1 of 7 from
`all-the-opens/docs/design-plans/2026-08-16-single-institution-work-pages.md`.

**Codebase verified:** 2026-08-16, in this worktree. Key anchors: subject
claims are fetched in `src/discover.js` lines 885–896 (`subjectPromise`);
env-flag pattern is `src/discover.js` lines 89–96; best-rank invariant and
its rationale are in `all-the-opens/tapestry-gen/CLAUDE.md` (Invariants).

**Working directory for all commands:**
`all-the-opens/tapestry-gen/` inside this worktree.

---

## Context every task needs

- The pipeline already resolves the article title to a QID and fetches the
  subject's full claims via `wbgetentities` (`src/discover.js:885-896`). The
  claims object maps property id → array of statements; each statement has
  `mainsnak.datavalue.value` (a string for external ids, `{id: 'Q…'}` for
  items) and `rank` (`'preferred' | 'normal' | 'deprecated'`).
- **Best-rank rule (repo invariant):** every lookup reads best rank. Raw
  `wbgetentities` claims include all ranks, so this module must implement
  best-rank selection itself: use `preferred` statements if any exist,
  otherwise `normal`; never `deprecated`.
- **Design note (documented narrowing):** detection is direct P31 membership,
  not the class-ancestry walk. The 2026-08-16 census counted the round-one
  population by direct P31 (10,699 paintings / 3,917 sculptures with enwiki
  articles), so direct membership matches the measured population, costs zero
  requests, and stays off the lede's critical path. A subclass joins by
  joining the set.

## Task 1: `src/holder.js` — detection and selection (pure)

**Files:**
- Create: `src/holder.js`
- Test: `test/holder.test.js`

**Step 1: Write the failing tests**

Create `test/holder.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { bestRankValues, workClass, selectHolder, HOLDERS } from '../src/holder.js'

// Claims fixtures in wbgetentities shape. nightWatch mirrors Q219831 as read
// 2026-08-16: P31 painting, Rijksmuseum id, two collections.
const statement = (value, rank = 'normal') => ({
  mainsnak: { datavalue: { value } },
  rank,
})
const item = (qid) => ({ id: qid })

const nightWatch = {
  P31: [statement(item('Q3305213'))],
  P13234: [statement('200107928')],
  P195: [statement(item('Q190804')), statement(item('Q1820897'))],
}

test('workClass: a painting article is detected as one', () => {
  assert.equal(workClass(nightWatch), 'painting')
})

test('workClass: a sculpture is a work; a person and an empty item are not', () => {
  assert.equal(workClass({ P31: [statement(item('Q860861'))] }), 'sculpture')
  assert.equal(workClass({ P31: [statement(item('Q5'))] }), null)
  assert.equal(workClass({}), null)
})

test('bestRankValues: preferred beats normal, deprecated never surfaces', () => {
  const claims = {
    P31: [
      statement(item('Q5'), 'deprecated'),
      statement(item('Q3305213'), 'normal'),
      statement(item('Q860861'), 'preferred'),
    ],
  }
  assert.deepEqual(bestRankValues(claims, 'P31'), ['Q860861'])
  assert.deepEqual(bestRankValues({ P31: [statement(item('Q5'), 'deprecated')] }, 'P31'), [])
})

test('selectHolder: the Night Watch selects the Rijksmuseum by its stated id', () => {
  assert.deepEqual(selectHolder(nightWatch), {
    partner: 'rijks',
    property: 'P13234',
    id: '200107928',
  })
})

test('selectHolder: with several museum ids, the museum in P195 wins over precedence', () => {
  const twoMuseums = {
    P31: [statement(item('Q3305213'))],
    P13234: [statement('123')], // rijks outranks met in HOLDERS order…
    P3634: [statement('456')],
    P195: [statement(item('Q160236'))], // …but the work hangs at the Met
  }
  assert.equal(selectHolder(twoMuseums).partner, 'met')
})

test('selectHolder: no P195 match falls back to precedence order', () => {
  const noCollection = {
    P31: [statement(item('Q3305213'))],
    P3634: [statement('456')],
    P4610: [statement('789')],
  }
  assert.equal(selectHolder(noCollection).partner, 'met')
})

test('selectHolder: a work with no holder identifier honestly gets none', () => {
  const inventoryOnly = {
    P31: [statement(item('Q3305213'))],
    P217: [statement('SK-C-5')],
    P195: [statement(item('Q190804'))],
  }
  assert.equal(selectHolder(inventoryOnly), null)
})

test('selectHolder: a deprecated museum id never selects a holder', () => {
  const retracted = {
    P31: [statement(item('Q3305213'))],
    P13234: [statement('999', 'deprecated')],
  }
  assert.equal(selectHolder(retracted), null)
})

test('a manifest-only work selects the iiif candidate, which museums always outrank', () => {
  const manifestOnly = {
    P31: [statement(item('Q3305213'))],
    P6108: [statement('https://example.org/iiif/manifest.json')],
  }
  assert.equal(selectHolder(manifestOnly).partner, 'iiif')
  const both = { ...manifestOnly, P3634: [statement('456')] }
  assert.equal(selectHolder(both).partner, 'met')
})
```

**Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 holder`
Expected: every `holder` test fails — `Cannot find module '../src/holder.js'`.

**Step 3: Write `src/holder.js`**

```js
// Which single institution holds the work this article is about — the
// detection and selection halves of the single-institution page
// (../docs/design-plans/2026-08-16-single-institution-work-pages.md).
// Pure over a wbgetentities claims object; fetches nothing.

// Direct P31 membership, deliberately without the ancestry walk: the
// 2026-08-16 census counted the round-one population by direct P31, so
// direct membership matches the measured population and costs zero
// requests on the lede's critical path. A subclass joins by joining this map.
export const WORK_CLASSES = new Map([
  ['Q3305213', 'painting'],
  ['Q860861', 'sculpture'],
])

// Precedence order per the design: museum object-id properties first, the
// shared IIIF door last. The door is special: "not one institution but a
// door many institutions share" (src/partners.js), and 679 of 1,362
// round-one work-articles carry only P6108 — half the population. So an
// iiif selection is a CANDIDATE, not yet a holder: the record fetch
// (Phase 2) must resolve the manifest's own stated institution, and a
// manifest that does not name exactly one gets no holder page — the
// masthead must never read "Wikipedia + IIIF collections" (design doc,
// Decisions, 2026-08-16). `collection` is the museum's Wikidata item,
// matched against the subject's P195 when a work carries several museum
// ids (versions, studies). No fuzzy matching lives here or anywhere
// downstream — a work whose graph states no holder id gets no holder.
export const HOLDERS = [
  { partner: 'rijks', property: 'P13234', collection: 'Q190804' },
  { partner: 'met', property: 'P3634', collection: 'Q160236' },
  { partner: 'artic', property: 'P4610', collection: 'Q239303' },
  { partner: 'iiif', property: 'P6108', collection: null },
]

// Raw wbgetentities claims carry every rank, and the repo invariant is that
// nothing rests on a deprecated identifier: preferred if any, else normal.
export function bestRankValues(claims, property) {
  const statements = claims?.[property] ?? []
  const live = (rank) => statements.filter((s) => s.rank === rank)
  const chosen = live('preferred').length ? live('preferred') : live('normal')
  return chosen
    .map((s) => s.mainsnak?.datavalue?.value)
    .filter((v) => v != null)
    .map((v) => (typeof v === 'object' && 'id' in v ? v.id : v))
    .filter((v) => typeof v !== 'object') // Filter out non-entity objects like quantity/time/globecoordinate
}

export function workClass(claims) {
  for (const qid of bestRankValues(claims, 'P31')) {
    const medium = WORK_CLASSES.get(qid)
    if (medium) return medium
  }
  return null
}

export function selectHolder(claims) {
  const collections = new Set(bestRankValues(claims, 'P195'))
  const present = HOLDERS.map((h) => {
    const [id] = bestRankValues(claims, h.property)
    return id == null ? null : { partner: h.partner, property: h.property, id, _collection: h.collection }
  }).filter(Boolean)
  if (!present.length) return null
  const hangsThere = present.find((h) => h._collection && collections.has(h._collection))
  const { _collection, ...picked } = hangsThere ?? present[0]
  return picked
}
```

**Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all holder tests pass; full suite stays green (489 pre-existing
tests plus the new ones).

**Step 5: Commit**

```bash
git add all-the-opens/tapestry-gen/src/holder.js all-the-opens/tapestry-gen/test/holder.test.js
git commit -m "A work-article names its holder from the graph, or gets none"
```

(Repo commit style: a prose sentence stating the behavior; see `git log
--oneline`. Run `git show HEAD --stat` after committing — only these two
files may be in it.)

## Task 2: Wire detection into `src/discover.js` behind the flag

**Files:**
- Modify: `src/discover.js` (env consts around lines 89–96; after
  `subjectPromise`, lines 885–896; the `discover()` return object)
- Test: acceptance is operational (see below) — no test imports `discover()`
  by repo convention (`tapestry-gen/CLAUDE.md`, Two entry points).

**Step 1: Add the flag beside the existing env consts**

Next to the `MAX_SECTIONS` block (`src/discover.js:89-96`), following the
same pattern:

```js
const HOLDER_PAGE = process.env.HOLDER_PAGE === '1'
```

**Step 2: Add the holder promise after `subjectPromise`**

Import at top with the other src imports:

```js
import { workClass, selectHolder } from './holder.js'
```

Directly after the `subjectPromise` block (`src/discover.js:885-896`):

```js
// Single-institution work pages (HOLDER_PAGE=1, experiment): when the
// article IS a museum-held work, its one holding institution — selected
// from the subject's own best-rank identifiers, never by search.
const holderPromise = (async () => {
  if (!HOLDER_PAGE) return null
  const subject = await subjectPromise
  const medium = workClass(subject.claims)
  if (!medium) return null
  const holder = selectHolder(subject.claims)
  if (!holder) return null
  console.error(`  holder page: ${medium} held by ${holder.partner} (${holder.property} ${holder.id})`)
  return { medium, ...holder }
})()
```

**Step 3: Carry it on the result**

Find the object `discover()` resolves with (`{title, bands, stats, dropped,
opinion, reach}` per `tapestry-gen/CLAUDE.md`, Two entry points) and add
`holder: await holderPromise` to it. Renderers do not read the field yet, so
output bytes must not change in either flag state this phase.

**Step 4: Verify operationally — flag off is inert, flag on selects right**

The discovery path's test is a spike render plus byte-comparison (repo
convention). First run may need network to fill `.cache/`; reruns are
offline.

```bash
cd all-the-opens/tapestry-gen
# Baseline before this change (git stash) or use the committed Task 1 state:
WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
cp "demo/spike-the-night-watch.html" /tmp/before.html   # note: slug from resolved title; check spike output for exact name
# With the change, flag off:
WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
diff "demo/spike-the-night-watch.html" /tmp/before.html && echo FLAG-OFF-IDENTICAL
# Flag on — stderr must log the selection:
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch" 2>&1 | grep "holder page"
```

Expected: `FLAG-OFF-IDENTICAL`, and flag-on stderr contains
`holder page: painting held by rijks (P13234 200107928)`.

Also verify a Met and an AIC painting select correctly, and a non-work is
silent (grep for `holder page` finds nothing):

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "Washington Crossing the Delaware (1851 paintings)" 2>&1 | grep "holder page"   # met
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "Nighthawks (Hopper)" 2>&1 | grep "holder page"                                 # artic
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "Ludwig Prandtl" 2>&1 | grep -c "holder page"                   # expect 0
```

(If a title resolves to a work with a different holder than expected —
Washington Crossing the Delaware has versions — the correct behavior is
whatever the item's best-rank identifiers and P195 say; verify against the
item on wikidata.org before calling it a bug.)

**Step 5: Run the full test suite**

Run: `npm test`
Expected: green.

**Step 6: Commit**

```bash
git add all-the-opens/tapestry-gen/src/discover.js
git commit -m "HOLDER_PAGE=1 detects a work-article and logs its holder, changing nothing else"
```

## Task 3: The flag joins the page-cache build key

**Files:**
- Modify: `src/page-cache.js` (`buildId`, lines 76–96)
- Test: `test/page-cache.test.js` (beside the existing key tests)

`buildId()` already fingerprints `env:SITE_ORIGIN` under the stated rule
"Environment that is BAKED INTO stored page bytes belongs in the key".
`HOLDER_PAGE` is exactly such a variable: a flag-on and a flag-off render of
the same article must never collide on one cache path, or switching the flag
serves the wrong experiment state to everyone.

**Step 1: Failing test:** two `buildId()` results computed with
`HOLDER_PAGE` unset vs. `'1'` differ. (No existing test covers the env
half of the key — `test/page-cache.test.js` imports `sourceFingerprint`
and never touches `process.env` — so the shape is: set
`process.env.HOLDER_PAGE`, call `buildId()`, delete it, call again,
assert the two differ, restoring the variable in a `finally`.)

**Step 2: Implement:** in `buildId()`, beside the SITE_ORIGIN entry:

```js
files.push({ name: 'env:HOLDER_PAGE', bytes: process.env.HOLDER_PAGE ?? '' })
```

**Step 3:** `npm test` green.

**Step 4: Commit:**

```bash
git add all-the-opens/tapestry-gen/src/page-cache.js all-the-opens/tapestry-gen/test/page-cache.test.js
git commit -m "The experiment flag is part of the page identity, so flag states never share a stored render"
```

## Phase done when

- `npm test` green including the new `holder.test.js` and the build-key test.
- Flag-off spike render of The Night Watch is byte-identical to the
  pre-change render.
- **Flag-on render of a non-work article (Ludwig Prandtl) is byte-identical
  to its flag-off render** — the flag may not change a page that has no
  holder.
- Flag-on stderr names the right holder for a Rijksmuseum, a Met, and an
  AIC painting, and stays silent for a non-work article.
