# Single-Institution Work Pages Implementation Plan — Phase 3

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Flag-on work-articles lead with the holder's record of the work —
image in the hero slot, museum credit, a labeled link out to the museum's own
page (where its deep-zoom viewer lives) — and the legend reads as a two-party
statement.

**Architecture:** A new top hero standing `holder-work` (above
`subject-document`); the holder entry is built from the Phase 2 record and
seeded first into the lede band; `src/emit-html.js` renders the zoom link-out
on that standing and swaps the masthead credit for the two-party line when
the page has a holder.

**Scope:** Phase 3 of 7. Depends on Phases 1–2.

**Codebase verified:** 2026-08-16 (re-verified against plan review same
day). `heroRank`/`pickHero` are the whole of `src/hero.js` (75 lines; tiers
documented in its comment block); `standing` is set where entries are made,
never re-derived (`hero.js:13-15`). The masthead is built by the
non-exported `hero()` (`src/emit-html.js:1234`; the credit-bar line is
`:1247`); `sourcesUsed(bands)` at `:121`; partner display names come from
`PARTNERS` (`src/partners.js`). **Two render paths, and both must ship
this:** batch calls `buildHtml({title, bands, inline, provenance, home,
reach, siteOrigin})` (`src/emit-html.js:1258`); the streaming server never
calls `buildHtml` — it uses `streamOpen`/`streamBand`/`streamHeroExtras`/
`streamClose` (`serve.js:41-46`), and `streamOpen` flushes the masthead from
inside the spine callback (`serve.js:350`) BEFORE the holder record can
resolve, filling the legend late via a template (`src/emit-html.js:1451`).
Lede entries assemble around `ledePickedPromise` (`src/discover.js:963`) and
`ledeExtrasPromise` (`:1258`). Images: streaming proxies via `imgPath` in
`serve.js:102`; batch inlines — both consume `entry.imageUrl`, so the entry
needs no renderer-specific handling. Renderer tests live in
`test/render.test.js` (drives `buildHtml`/`sourcesUsed` over hand-built
bands) and `test/stream.test.js`.

**Design decision this phase implements (recorded 2026-08-16):** link OUT to
the holder's own viewer; never embed deep zoom. The href is the museum-stated
object page from the Phase 2 record — verified, never constructed.

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## Task 1: The `holder-work` standing

**Files:**
- Modify: `src/hero.js` (both the comment block and `heroRank`)
- Test: extend the file that currently tests `heroRank`/`pickHero` (locate
  with `grep -rl heroRank test/`; if none tests it, create `test/hero.test.js`)

**Step 1: Failing tests:**

```js
test('the holder’s record of the work outranks every other standing, even a subject document', () => {
  const holder = { standing: 'holder-work', imageUrl: 'x' }
  const doc = { standing: 'subject-document' }
  assert.ok(heroRank(holder) < heroRank(doc))
  assert.equal(pickHero([doc, holder]).hero, holder)
})

test('a holder record without an image does not take the float', () => {
  const bare = { standing: 'holder-work' }
  assert.equal(pickHero([bare]).hero, null)
})
```

**Step 2: Implement.** In `heroRank` add, above the `subject-document` line:

```js
if (entry.standing === 'holder-work') return -1
```

Extend the tier comment block with the new tier: *-1. The holding
institution's record of the very work this article is about, on a
single-institution page — the page's reason for existing.* Do not renumber
the documented tiers. `pickHero`'s `worthIt` gate already requires a visual
(a holder record only reaches the page with `rights.publicDomain` and an
image, per Phase 2's gate) — the second test pins the no-image case anyway.

**Step 3–4:** `npm test` red → green. **Step 5: Commit** (`git add` exactly
`src/hero.js` and the test file touched, under their
`all-the-opens/tapestry-gen/` paths).

## Task 2: Build and seed the holder entry

**Files:**
- Modify: `src/discover.js` (holder promise from Phase 2; lede entry
  assembly around `ledeExtrasPromise`, `src/discover.js:1258`)

**Step 1:** In the holder promise, after a record passes the rights gate,
build the entry in the house entry shape (read a neighboring producer, e.g.
what `statementEntries` emits, and match its fields exactly — at minimum
`source` (the PARTNERS key), `title`, `description`, `imageUrl`, `href`,
`standing: 'holder-work'`, and the provenance pair `trace`/`fix` pointing at
the statement it rests on: `https://www.wikidata.org/wiki/<subjectQid>#<property>`
with a trace sentence in the house voice, e.g. *"Wikidata's record of this
painting names the Rijksmuseum's own object id (P13234), and this is the
museum's record it names."*).

**Step 2:** Seed it as the FIRST entry of the lede band's entry list (find
where the lede's entries are concatenated near `ledeExtrasPromise`,
`src/discover.js:1258`). First position matters twice: `pickHero` breaks
ties on order, and article order decides ownership downstream.

**Step 3: Verify operationally:**

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
grep -c 'holder-work\|rijksmuseum' demo/spike-the-night-watch.html
```

Expected: the lede float is the Rijksmuseum record of The Night Watch (open
the render and look); flag-off render still byte-identical to baseline.

**Step 4: Commit** (`git add all-the-opens/tapestry-gen/src/discover.js`
only).

## Task 3: The zoom link-out and the two-party legend

**Files:**
- Modify: `src/emit-html.js` (hero markup where the floated rail card is
  built — locate the hero/rail rendering used by `bandParts`; the masthead
  builder `hero()` at `:1234`; the late-fill template machinery at `:1451`)
- Modify: `serve.js` (thread `holder` into `streamHeroExtras`)
- Test: `test/render.test.js` (batch path, pure helpers) and
  `test/stream.test.js` (the late-filled masthead); rendered output also
  verified by spike render + grep.

**Step 1** (tests for this task's pure helpers go in `test/render.test.js`,
the file that already drives `buildHtml` and `sourcesUsed` over hand-built
bands): add a pure helper and test it:

```js
// The labeled door to the holder's own viewer. Text names the museum so the
// link reads as the partnership gesture it is.
export function zoomLink(entry, institutionName) {
  if (entry.standing !== 'holder-work' || !entry.href) return ''
  return `<a class="zoom" href="${escapeHtml(entry.href)}">Zoom into the brushwork at ${escapeHtml(institutionName)} →</a>`
}
```

Test: emits for a `holder-work` entry, empty string for every other
standing. (Exact copy may be adjusted to the house voice during review;
what is load-bearing: names the institution — `record.institution`, which
for a manifest-held work is the manifest's own provider — uses the
record's verified href, renders only on `holder-work`.)

**Step 2:** Render it inside the hero card markup when the hero's standing
is `holder-work`, below the source bar. Style `.zoom` in `STYLE` consistent
with the wiki-skin language (a plain #36c link line, no button chrome).
When the record carries a `requiredStatement`, render its text with the
credit — the IIIF spec makes displaying it mandatory for a client showing
the resource (recorded in the design doc's Decisions).

**Step 2b: The institution's name everywhere the page names its partner.**
FIVE rendered places name the source, and on a holder page every one must
say `record.institution`, never the PARTNERS display name (for `iiif` that
literal is "IIIF collections", which the design forbids): the masthead
(Step 3), the batch legend (`buildHtml`, `src/emit-html.js:1273-1276`),
the STREAMING legend — a second copy of the same line inside
`streamHeroExtras` (`:1435`), the deployed path — the hero card's own
source bar (`:110`), and the visibility panel's partner rows
(`visibilityReport` prints `SOURCE[r.slug]?.name`, `:231`, over
`src/gap.js`'s tally; the panel's COUNTS are untouched — only the display
name is overridden). Thread one display-name override keyed by the
holder's source through all five sites, gated on the holder context (for
streaming, it rides the `holder` option Step 3b adds to
`streamHeroExtras`). Tests: `test/render.test.js` pins legend, card bar,
and panel row on a holder page and byte-unchanged output on a non-holder
page; `test/stream.test.js` pins the streamed legend chip alongside the
masthead fill.

**Step 2c: The hero must survive a short lede.** `src/emit-html.js:960-963`
un-floats any hero when the lede's prose is under `FLOAT_MIN_PROSE` —
correct for ordinary cards, wrong for the page's reason for existing, and
painting articles are frequently stubs. The change is one condition: add
`&& hero.standing !== 'holder-work'` to the `:960` demotion branch. (The
infobox needs no such branch — it is a different variable the demotion
never touches — but the comment at `:971-974` records the REASONING
precedent: a stub wrapping under its infobox is what a real stub looks
like, and the same holds for the work itself.) Record the reasoning in a
comment beside the new condition. Add
a SHORT-lede work-article to the acceptance list (pick one from WDQS: a
P13234/P3634/P4610 painting item whose enwiki article is a stub) and
verify the hero still leads it.

**Step 3 — batch path:** where the credit bar builds (inside `hero()`,
`src/emit-html.js:1247`), when the render context carries a holder (add
`holder` to `buildHtml`'s options — its signature is `{title, bands, inline,
provenance, home, reach, siteOrigin}`; `spike.js` passes it from the
`discover()` result), replace "Today, help came from: …" with:

```
This page: Wikipedia + <institution name>
```

using `holder.record.institution` — which is `PARTNERS[partner].name` for
the museums and the manifest's own stated provider for `iiif` (the gate
guarantees it exists and names exactly one institution; the masthead must
never read "Wikipedia + IIIF collections"). The visibility panel's
measurements are untouched — what the article reaches has not changed —
but its partner-row display name is overridden per Step 2b.

**Step 3b — streaming path (the deployed site):** `streamOpen` flushes the
masthead before the holder record resolves, so the two-party line cannot be
an argument to `streamOpen`. Render the credit bar with a stable element id
and fill it late from `streamHeroExtras(bands, {…, holder})` via a
`<template>` + mount script, exactly the mechanism the legend already uses
(`src/emit-html.js:1451`). `serve.js` passes the resolved holder at the
point it calls `streamHeroExtras`. Add a `test/stream.test.js` case: with a
holder, the streamed extras contain the two-party fill; without one, they
do not.

**Step 4: Verify:** flag-on Night Watch spike shows the zoom link with the
Rijksmuseum's name and the two-party masthead; the same page served by a
local `HOLDER_PAGE=1 npm run serve` shows the filled masthead too;
flag-off byte-identical; flag-on Ludwig Prandtl byte-identical to its
flag-off render; `npm test` green.

**Step 5: Commit:**

```bash
git add all-the-opens/tapestry-gen/src/emit-html.js all-the-opens/tapestry-gen/serve.js all-the-opens/tapestry-gen/test/render.test.js all-the-opens/tapestry-gen/test/stream.test.js
git commit -m "A holder page leads with the work, links out to the museum's own viewer, and credits two parties"
```

## Phase done when

- Hero tests pass (`holder-work` outranks all; no image → no float).
- Flag-on spike of The Night Watch leads with the Rijksmuseum record, zoom
  link-out present, masthead reads "This page: Wikipedia + Rijksmuseum" —
  in BOTH renderers (spike file; streamed page from a local server) — and
  the legend chip and hero source bar also carry the institution's name.
- A short-lede (stub) work-article still leads with the holder hero — the
  `FLOAT_MIN_PROSE` exemption verified on a real stub.
- Flag-off spike byte-identical to the pre-phase baseline; flag-on render
  of a non-work article byte-identical to its flag-off render; `npm test`
  green.
