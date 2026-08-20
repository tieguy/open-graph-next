# Single-Institution Work Pages Implementation Plan — Phase 4

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** One merged panel: Wikipedia's infobox facts and the holder's
catalog record, each row visibly attributed to its source, disagreements
shown side by side rather than resolved.

**Architecture:** A new pure module `src/panel.js` — `infoboxRows(html)`
parses the sanitized infobox into label/value rows; `mergedPanel(rows,
record)` aligns known fields, detects conflicts, and renders the panel
HTML, attributing holder rows to `record.institution`. `src/emit-html.js` places it on holder pages where the infobox
fallback float renders today.

**Scope:** Phase 4 of 7. Depends on Phases 2–3.

**Codebase verified:** 2026-08-16. `extractInfobox` (`src/wikipedia.js:456`)
returns `{html, images}`, or null when the article has no infobox. `html` is
the sanitized infobox `<table>` (navbars, hidden rows, Kartographer, footnote
markers, styles stripped; images hotlinked to Commons). The infobox fallback
float renders around `src/emit-html.js:1126`
per the 2026-08-08 infobox-retention design. This phase implements the
recorded 2026-08-16 revision of that design **for holder pages only** — on
every other page the furniture rule stands, so all changes are gated on the
holder context.

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## Task 1: `infoboxRows` — structured rows out of the sanitized infobox

**Files:**
- Create: `src/panel.js`
- Test: `test/panel.test.js`

**Step 1: Failing tests** (fixture is the sanitized-infobox shape — build it
by running `extractInfobox` over a saved Night Watch article body once and
trimming, or hand-write the equivalent minimal table):

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { infoboxRows, mergedPanel, FIELD_LABELS } from '../src/panel.js'

const BOX = `<table class="infobox"><tbody>
  <tr><th>Artist</th><td><a href="/wiki/Rembrandt">Rembrandt</a></td></tr>
  <tr><th>Year</th><td>1642</td></tr>
  <tr><th>Medium</th><td>Oil on canvas</td></tr>
  <tr><th>Dimensions</th><td>363 cm × 437 cm (142.9 in × 172 in)</td></tr>
  <tr><th>Location</th><td>Rijksmuseum, Amsterdam</td></tr>
</tbody></table>`

test('infoboxRows reads each label/value pair and keeps the value markup', () => {
  const rows = infoboxRows(BOX)
  assert.equal(rows.length, 5)
  assert.equal(rows[0].label, 'Artist')
  assert.match(rows[0].valueHtml, /Rembrandt/)
  assert.equal(rows[1].valueText, '1642')
})

test('a header-only or image-only row is furniture, not a fact row', () => {
  const rows = infoboxRows(`<table><tbody>
    <tr><th colspan="2">The Night Watch</th></tr>
    <tr><td colspan="2"><img src="x"></td></tr>
    <tr><th>Year</th><td>1642</td></tr>
  </tbody></table>`)
  assert.deepEqual(rows.map((r) => r.label), ['Year'])
})
```

**Step 2 → 4:** red → implement → green (commits in this phase: Tasks 1–2
`git add all-the-opens/tapestry-gen/src/panel.js
all-the-opens/tapestry-gen/test/panel.test.js`; Task 3 adds
`all-the-opens/tapestry-gen/src/emit-html.js` and
`all-the-opens/tapestry-gen/test/infobox.test.js`). Implementation notes:
parse with
the same regex-over-sanitized-HTML techniques the codebase already uses (no
DOM dependency exists and none is added); a row is a `<tr>` whose `<th>` and
`<td>` both exist and are siblings; `valueText` is the tag-stripped,
whitespace-collapsed text of `valueHtml` (used for conflict comparison,
never rendered).

**Step 5: Commit.**

## Task 2: `mergedPanel` — alignment, attribution, conflicts

**Files:**
- Modify: `src/panel.js`
- Test: `test/panel.test.js`

**Step 1: Failing tests:**

```js
test('a field both sides state identically renders once, dual-attributed', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    partner: 'rijks', institution: 'Rijksmuseum',
    title: 'The Night Watch', creator: 'Rembrandt van Rijn',
    date: '1642', medium: 'Oil on canvas',
    dimensions: '379.5 cm × 453.5 cm', accession: 'SK-C-5',
    credit: null, rights: { publicDomain: true, label: 'Public domain' },
  })
  // Medium agrees: one row, both chips.
  assert.match(html, /Oil on canvas/)
  // Dimensions disagree: both values present, each attributed.
  assert.match(html, /363 cm/)
  assert.match(html, /379\.5 cm/)
  // Holder-only fields appear under the holder's name.
  assert.match(html, /SK-C-5/)
})

test('an infobox row with no holder counterpart passes through under Wikipedia’s name', () => {
  const html = mergedPanel(infoboxRows(BOX), { partner: 'rijks', institution: 'Rijksmuseum', rights: {} })
  assert.match(html, /Location/)
})
```

**Step 2: Implement.** The load-bearing rules (each mirrors a recorded
design decision):

- `FIELD_LABELS` maps normalized infobox labels → record fields:
  `artist→creator`, `year→date`, `medium→medium`, `dimensions→dimensions`,
  `type→medium` only if medium absent, `location→null` (never merged —
  the holder IS the location; the row passes through). Deliberately
  incomplete; an unmapped label passes through, never a wrong merge.
- **Conflict = mapped field present on both sides with normalized texts that
  differ** (lowercase, collapse whitespace, strip trailing parentheticals is
  NOT done — a real difference must show). Render both rows adjacent, each
  with its source chip. Never pick a winner, never annotate which is
  "right".
- Attribution chips: Wikipedia rows get the text label `Wikipedia`; holder
  rows get **`record.institution`** — never the PARTNERS display name (for
  a manifest-held work that literal is "IIIF collections", which the
  design forbids anywhere the page names its partner). Reuse the partner
  favicon mechanism from card credits (`src/icons.js` committed bytes) for
  museum holders if that is a small lift; a text chip is acceptable for
  this phase and is the only option for manifest holders.
- Record fields with no infobox counterpart append at the end (accession,
  credit line, the museum's rights label).
- Output is one `<table class="infobox holder-panel">`-shaped block so the
  wiki-skin styling applies; new styles go in `STYLE` beside the existing
  infobox rules.

**Step 3 → 4:** green. **Step 5: Commit.**

## Task 3: Place the panel on holder pages

**Files:**
- Modify: `src/emit-html.js` — the panel replaces `infobox` where it is
  CHOSEN, not where it is rendered: the deciding branch is
  `if (infobox && hero) { if (heroRank(hero) <= 3) infobox = null }` at
  `:975-983`, and a holder hero (rank −1) always trips it, so on a holder
  page bypass that suppression and hand the merged panel to the render
  site (`infoboxAside`, `:1126` region) instead of the plain box.

**Step 1:** On a holder page (context from Phase 3), the lede renders the
merged panel where the plain infobox would have rendered or been withheld:
the hero float is the work (Phase 3), and the panel sits as the lede's
infobox slot — always present on holder pages (the merge is the point, not a
fallback), built from `infoboxRows(extractInfobox(html)?.html)` + `holder.record` —
`extractInfobox` returns null when the article carries no infobox, and a
holder page without one renders the panel from `holder.record` alone.
Non-holder pages keep the 2026-08-08 behavior byte-for-byte, apart from the
panel's stylesheet rules, which ride the shared STYLE constant on every page
(the render suite's forward-guard hash pins them).

The panel keeps the infobox's furniture status EXCEPT that its holder rows
are the partner's data: the holder partner is already in `sourcesUsed` via
the hero card, so the legend needs no new entry for the panel itself.

**Step 1b: Test the placement purely** — `test/infobox.test.js` already
drives `bandParts` over `extractInfobox` output; add cases in that file's
style: with a holder context the lede's infobox slot holds the merged
panel; without one, the output is byte-identical to what the existing
tests pin (the 2026-08-08 behavior).

**Step 2: Verify:** flag-on Night Watch spike shows one panel with
dual-attributed rows and a visible dimensions disagreement (Wikipedia says
363 × 437 cm; the museum's record states its own figures — whatever the live
values are, both must render when they differ). Flag-off byte-identical
apart from the shared stylesheet rules;
`npm test` green.

**Step 3: Commit.**

## Phase done when

- `panel.test.js` passes: row parsing, dual attribution, pass-through,
  side-by-side conflict.
- Flag-on Night Watch renders the merged panel. The conflict acceptance
  runs on a Met page — `HOLDER_PAGE=1 node spike.js "Washington Crossing
  the Delaware (1851 paintings)"` — whose record states dimensions; a real
  conflicting field shows both values, labeled. (The Rijksmuseum record's
  creator/medium/dimensions are not yet extracted from the Linked Art hops,
  so the Night Watch panel has no conflict-capable field beyond the date,
  which agrees.)
- Flag-off renders byte-identical apart from the panel's shared stylesheet
  rules (pinned by the render suite's forward-guard hash); flag-on render of
  a non-work article byte-identical to its flag-off render; `npm test` green.
