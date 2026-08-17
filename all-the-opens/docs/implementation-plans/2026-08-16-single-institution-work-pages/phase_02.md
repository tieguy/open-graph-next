# Single-Institution Work Pages Implementation Plan — Phase 2

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** For a selected holder, fetch the museum's catalog record and the
work's public-domain image into one normalized holder-record shape, gated on
the museum's own rights flag.

**Architecture:** A new module `src/holder-record.js`: one pure
`…RecordFrom(response)` transform per holder partner plus one
`fetchHolderRecord(holder)` dispatcher that reuses each partner's existing
request URL (so the request cache is shared with the partner's card fetcher)
and degrades to `null` on any failure.

**Tech Stack:** Node 22+, no new dependencies. Fetches ride `getJson` in
`src/http.js` (URL-keyed cache, per-host serial queues) exactly as the
existing partner fetchers do.

**Scope:** Phase 2 of 7. Depends on Phase 1 (`src/holder.js`).

**Codebase verified:** 2026-08-16. Existing fetchers: `metEntryFrom`
(`src/statements.js:470`), `metEntry` (`:493`), `aicEntryFrom` (`:497`),
`aicEntry` (`:520`); Rijksmuseum in `src/rijks.js` (`rijksEntry` :241,
`rijksEntryFrom` :212, plus `rijksTitle`/`rijksDate`/`rijksObjectNumber`/
`rijksPageUrl`/`rijksRights`/`rijksIdFrom`); IIIF manifest parsing (v2 and
v3) in `src/iiif.js`.

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## The normalized holder-record shape (contract for Phases 3–4)

```js
{
  partner: 'rijks' | 'met' | 'artic' | 'iiif' | …,   // PARTNERS key
  id: string,                // the identifier the graph stated
  title: string | null,
  creator: string | null,    // the museum's own artist display string
  date: string | null,
  medium: string | null,
  dimensions: string | null,
  accession: string | null,
  credit: string | null,     // the museum's credit line
  rights: { publicDomain: boolean, label: string | null },
  imageUrl: string | null,   // hi-res primary image, museum-stated
  href: string,              // the museum's own page for the object —
                             // ALWAYS a URL the API stated or an existing
                             // verified builder (rijksPageUrl); never a
                             // constructed guess (the Rijksmuseum-404 rule)
}
```

Every field the holder does not state is `null` — the merged panel renders
what exists and claims nothing else. `rights.publicDomain` comes from **the
museum's own per-object flag**, never inferred.

**The one gate rule (single statement of it — Phases 3–4 rely on it):** a
holder page exists only when the record has `rights.publicDomain === true`,
an `imageUrl`, an `href`, **and an `institution`** (see the field below);
otherwise the holder resolves to `null` and the ordinary page ships.
Catalog fields (`creator`, `medium`, `dimensions`, `accession`, `credit`)
may individually be `null` — a partially failed hop (the Rijksmuseum's hops
2–3 already degrade this way, `src/rijks.js:241-253`) still makes a holder
page as long as the gate fields survive.

**The `institution` field** (added to the contract): the display name of
the holding institution. For the three museums it is
`PARTNERS[partner].name` — always present. For `iiif` it comes from IIIF
v3's structured `provider` ONLY: present when `provider` has exactly one
entry (its label, markup-stripped); none or several fails the gate. v2's
`attribution` is free text and never yields an institution — splitting it
would be fuzzy matching — so a v2-only manifest fails as
`no-institution` (design doc, Decisions). Do not reuse `iiifCredit`
(`src/iiif.js:57-63`) for this field: it deliberately collapses
requiredStatement/provider/attribution into one display string.
The operator's stated expectation (2026-08-16) is that many manifests will
fail one gate leg or another — the inspection window below turns that
suspicion into a dated number instead of an assumption.

**Image size:** "hi-res" means visibly beyond Wikipedia's 220px thumbnail,
not the museum's full-resolution master (that lives behind the Phase 3 zoom
link-out, and batch renders inline images as data URIs, so a 30 MB master
would be the page). Use: Met `primaryImageSmall` (their web-large
derivative; fall back to `primaryImage` only when small is absent);
AIC/Rijksmuseum IIIF bases at width 800 —
`<base>/full/800,/0/default.jpg`. For manifests, build the width-800 URL
from the image service — do NOT reuse `iiifThumbnail`, which prefers the
manifest's stated (often tiny) thumbnail and otherwise builds at width
400. Streaming proxies these via the existing
`imgPath` registry; batch inlines them — both already consume
`entry.imageUrl`, no renderer change.

## Task 1: Pure record transforms with fixture tests

**Files:**
- Create: `src/holder-record.js` (transforms only in this task)
- Test: `test/holder-record.test.js`

**Step 1: Write the failing tests.** Fixtures are trimmed real API shapes.
The Met and AIC field names below are their public APIs' documented fields
(same responses `metEntryFrom`/`aicEntryFrom` already consume — read
`src/statements.js:470-520` first and keep the field usage consistent with
what those functions read):

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { metRecordFrom, aicRecordFrom } from '../src/holder-record.js'

test('metRecordFrom carries the catalog fields and the museum-stated page and image', () => {
  const record = metRecordFrom({
    objectID: 11417,
    title: 'Washington Crossing the Delaware',
    artistDisplayName: 'Emanuel Leutze',
    objectDate: '1851',
    medium: 'Oil on canvas',
    dimensions: '149 x 255 in. (378.5 x 647.7 cm)',
    accessionNumber: '97.34',
    creditLine: 'Gift of John Stewart Kennedy, 1897',
    isPublicDomain: true,
    primaryImage: 'https://images.metmuseum.org/CRDImages/ad/original/DP215410.jpg',
    primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ad/web-large/DP215410.jpg',
    objectURL: 'https://www.metmuseum.org/art/collection/search/11417',
  })
  assert.equal(record.partner, 'met')
  assert.equal(record.accession, '97.34')
  assert.equal(record.rights.publicDomain, true)
  // primaryImageSmall (web-large) preferred; the full-res master stays behind the zoom link
  assert.match(record.imageUrl, /web-large/)
  assert.equal(record.href, 'https://www.metmuseum.org/art/collection/search/11417')
})

test('a rights-reserved object fails the gate: publicDomain false, no image claim', () => {
  const record = metRecordFrom({ objectID: 1, title: 'X', isPublicDomain: false, primaryImage: '', objectURL: 'https://www.metmuseum.org/art/collection/search/1' })
  assert.equal(record.rights.publicDomain, false)
  assert.equal(record.imageUrl, null)
})

test('aicRecordFrom reads the AIC envelope and builds the record image at width 800', () => {
  const record = aicRecordFrom({
    data: {
      id: 111628, title: 'Nighthawks', artist_display: 'Edward Hopper\nAmerican, 1882–1967',
      date_display: '1942', medium_display: 'Oil on canvas',
      dimensions: '84.1 × 152.4 cm (33 1/8 × 60 in.)', main_reference_number: '1942.51',
      credit_line: 'Friends of American Art Collection', is_public_domain: true,
      image_id: '831a05de-d3f6-f4fa-a460-23008dd58dda',
    },
    config: { iiif_url: 'https://www.artic.edu/iiif/2' },
  })
  assert.equal(record.partner, 'artic')
  assert.equal(record.accession, '1942.51')
  assert.equal(record.rights.publicDomain, true)
  assert.match(record.imageUrl, /831a05de/)
  assert.equal(record.href, 'https://www.artic.edu/artworks/111628')
})
```

Also add a `rijksRecordFrom` test after reading `src/rijks.js` — build its
fixture from the trimmed HumanMadeObject shape `rijksEntryFrom` already
consumes (see `test/`'s existing rijks fixtures if present, else trim from a
cached `.cache/` response), asserting `accession` comes via
`rijksObjectNumber`, `href` via `rijksPageUrl`, and `rights.publicDomain`
true only when `rijksRights` reads the public-domain mark on the visual
item (`subject_to`, never the catalogue-text CC0 — the documented trap).

**Step 2: Run to verify failure.** `npm test 2>&1 | grep -B1 -A2 holder-record`

**Step 3: Implement the transforms** in `src/holder-record.js`. Rules the
code must follow:

- Each transform normalizes to the contract shape above; missing fields → null;
  empty strings → null.
- `imageUrl` is null whenever the museum's own flag is not public-domain
  (which fails the gate — see the gate rule above).
- **AIC needs its shared request widened first**: `aicEntry`
  (`src/statements.js:520-525`) requests
  `fields=id,title,artist_display,date_display,image_id,is_public_domain` —
  four record fields short. Widen that one `fields` list to add
  `medium_display,dimensions,main_reference_number,credit_line` so ONE
  cached response serves both the card and the record. This re-keys the AIC
  request cache exactly once (the documented shape for such changes — say so
  in the commit message); request count is unchanged.
- AIC `href`: `https://www.artic.edu/artworks/<id>` **only if** that is the
  shape `aicEntryFrom` already links; otherwise reuse whatever verified href
  that function builds. Never invent a second URL shape for the same object.
- Rijksmuseum: compose from the existing exported helpers
  (`rijksTitle`/`rijksDate`/`rijksObjectNumber`/`rijksPageUrl`/`rijksRights`);
  do not duplicate their parsing.
- `iiifRecordFrom(manifest)`: title from the manifest label; `institution`
  per the contract rule (v3 `provider` with exactly one entry, else gate
  failure — v2 never qualifies); `rights.publicDomain`
  only when the v3 `rights` / v2 `license` URI reads as **`CC0` or the
  public-domain mark (`PDM`)** through the existing vocabulary readers —
  never the NoC family, never `NoC-US`/`NKC`/`USGOV` (`src/rights.js` is
  emphatic those are not interchangeable, and a museum's own manifest
  claiming anything less than an unambiguous PD/CC0 fails the gate);
  `imageUrl` at IIIF width 800 built from the image service (see the image
  rule above); `href` ONLY from the manifest's own stated `homepage` (v3)
  or `related` (v2) — a manifest that states neither FAILS the gate
  (`no-object-page`): the zoom affordance must land a reader on the
  institution's page for the object, never on a JSON file. Note
  `iiifHomepage` exists in `src/iiif.js` (:83-87) but is not exported —
  export it, and **never pass it the manifest URL second argument on this
  path**: its last-resort fallback returns the manifest URL, which would
  silently defeat the `no-object-page` leg (same trap shape as
  `iiifThumbnail` above). Also capture v3
  `requiredStatement` / v2 `attribution` verbatim on the record as
  `requiredStatement` (label/value text, markup-stripped): the IIIF spec
  makes displaying it MANDATORY for a client showing the resource, and
  Phase 3 renders it in the credit. Contract catalog fields stay null
  (manifest `metadata` pairs are institution-shaped free text; Phase 4's
  panel renders only what the contract carries). Prior art considered
  (2026-08-16): `@iiif/parser` (IIIF-Commons) normalizes v2→v3 and would
  replace this parsing, but the repo deliberately carries one runtime
  dependency and `src/iiif.js` already parses both versions for a narrow
  field surface — extend it; revisit the library if manifest parsing
  grows. Test fixtures: one v3 manifest that passes all gate legs, one
  v2-only manifest (fails: `no-institution` — the recorded decision), one
  v3 with no rights statement (fails), one naming two providers (fails),
  one with no homepage (fails: `no-object-page`).

**Step 4: Run tests.** `npm test` — green.

**Step 5: Commit:**

```bash
git add all-the-opens/tapestry-gen/src/holder-record.js all-the-opens/tapestry-gen/test/holder-record.test.js
git commit -m "A holder's catalog record normalizes to one shape, gated on the museum's own rights flag"
```

(Verify with `git show HEAD --stat` — the worktree holds untracked files
that are not this work's.)

## Task 2: `fetchHolderRecord` — the dispatcher

**Files:**
- Modify: `src/holder-record.js`
- Test: URL-construction tests in `test/holder-record.test.js` (pure); the
  fetch path is verified operationally (repo convention).

**Step 1: Write failing tests** for the exported URL builders (the DigitalNZ
pattern — test the URL, not the network): `metRecordUrl(id)`,
`aicRecordUrl(id)` etc. must equal the URLs the existing entry fetchers
request — read `src/statements.js:493` and `:520` and assert the literal
strings, so the request cache is shared and a holder page costs zero extra
requests on a warm cache.

**Step 2: Implement:**

```js
export async function fetchHolderRecord(holder) {
  try {
    if (holder.partner === 'met') return metRecordFrom(await getJson(metRecordUrl(holder.id)))
    if (holder.partner === 'artic') return aicRecordFrom(await getJson(aicRecordUrl(holder.id)))
    if (holder.partner === 'rijks') return rijksRecordFrom(await /* the same hop sequence rijksEntry performs — reuse its internals, exporting a raw-object helper from src/rijks.js if none is exported today */)
    if (holder.partner === 'iiif') return iiifRecordFrom(await getJson(holder.id)) // P6108's value IS the manifest URL
    return null
  } catch (e) {
    console.error(`  holder record failed (${holder.partner} ${holder.id}): ${e.message}`)
    return null
  }
}
```

Failure semantics follow the gate rule in the contract above: a throw on the
gate-field path → log to stderr → `null` → ordinary page; a failed
secondary hop → that field null, record still stands.

**Step 3: Wire into the holder promise** in `src/discover.js`: extend the
Phase 1 `holderPromise` so a detected holder fetches its record and resolves
`{ medium, ...holder, record }` — resolving `null` (with a logged reason)
whenever the gate rule (see the contract — all four legs: `publicDomain`,
`imageUrl`, `href`, `institution`) fails.

**Step 3b: The manifest inspection window** (measurement hygiene: a small
window before anything batch-shaped, and "no errors" is not "good
output"). Write a throwaway script in the session scratchpad — not the
repo — that takes ~30 P6108 values whose items have enwiki articles (one
WDQS pick, compliant UA), runs each manifest through `iiifRecordFrom`, and
prints the gate outcome per manifest: PASS, or which leg failed
(no-institution / several-institutions / no-rights / non-PD-rights /
no-image / no-object-page). Context for expectations: Europeana's 2019
manifest-harvest analysis found rights information "either completely
missing or not controlled" across harvested manifests
(github.com/nfreire/IIIF-Manifest-Metadata-Harvesting), and the KB's own
2026 corpus test found 2 of 26 of its manifests unusable — this window
measures OUR population. Record the distribution, dated, in the task's commit message
and on the phase's PR/notes — this is the operator's "many will not"
hypothesis, answered. If PASS is near zero, STOP and surface to the
operator before Phases 3–5 build on the iiif lane.

**Step 4: Verify operationally:**

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch" 2>&1 | grep "holder"
```

Expected: the holder line from Phase 1, and no `holder record failed` line.
Then re-run: byte-identical (warm cache), flag-off still identical to
baseline. `npm test` green.

**Step 5: Commit.**

## Phase done when

- Transform tests pass for met, artic, rijks, and iiif (one passing v3
  manifest plus the four gate-failure fixtures: v2-only, no rights, two
  providers, no object page) with fixture data; URL builders equal the
  existing fetchers' URLs (AIC's after its one documented field-widening
  re-key).
- The manifest inspection window's pass/fail distribution is recorded,
  dated — and if PASS was near zero, the operator was asked before
  proceeding.
- A live flag-on run fetches The Night Watch's Rijksmuseum record without
  error; a rights-reserved or failing fetch demonstrably degrades (log line
  present, `holder` resolves null, page renders as today).
- `npm test` green; flag-off renders byte-identical.
