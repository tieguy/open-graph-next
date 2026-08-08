# Infobox Retention Under the Wiki Skin — Design

## Summary

Right now, when a Wikipedia article's lede has no partner "find" strong
enough to fill the top-of-page image-and-facts slot, that slot just sits
empty — the render pipeline has always thrown the Wikipedia infobox away as
noise (`STRIP_BLOCKS`), since the article HTML is already being parsed once
for other purposes. This design stops discarding it outright: the infobox is
extracted from that same HTML, sanitized (stripped of navigation chrome,
hidden rows, embedded maps, and Wikipedia's own template CSS), and held in
reserve as a fallback exactly for the pages where no partner collection has
anything better to offer about the subject itself.

Whether the infobox actually appears is decided by a ranking rule the
codebase already uses to pick a lede's "hero" card: if the best partner find
is directly about the subject, it keeps the rail unchanged and the infobox
goes unused; if the best find is weak (a map, or something merely linked
rather than the subject itself) or there is no find at all, the infobox takes
the rail and any weak find is bumped down to lead its own shelf instead. The
infobox is deliberately treated as page furniture rather than a partner
contribution — no favicon, excluded from the site's source-tracking and
legend — with a small disclosure explaining why it's there. The same gate and
markup have to work identically in both of the project's renderers: the batch
generator that writes one self-contained HTML file, and the streaming server
that renders instantly and fills in enrichment (including the lede) as it
resolves live.

## Definition of Done

- An article whose lede has **no find about the subject itself** renders the
  Wikipedia article's own infobox in the lede rail — image, dates, facts —
  instead of an empty slot (John Stuart Yeates is the motivating case and the
  acceptance fixture).
- A lede whose best find IS about the subject (`heroRank ≤ 3`: the subject as
  a document, a partner's record of the subject, something the subject made)
  is **unchanged**: the find keeps the rail, no infobox renders. Brown v.
  Board and Rembrandt render as before.
- A weak lede hero (a map, an illustrated card for something merely linked)
  is demoted to the deck — where it still leads its shelf — and the infobox
  takes the rail.
- The infobox carries an ⓘ-fold explaining the slot: this is the Wikipedia
  article's own infobox, standing in because no friend has a top-level card
  for this subject *yet* — with a link to the partner list on the front page.
- The infobox is spine furniture, not a find: no partner favicon, absent from
  `sourcesUsed`, the legend, and the visibility panel; the footer's existing
  CC BY-SA line is its credit.
- Both renderers ship it: batch output stays self-contained (images as
  `data:` URIs), streaming mounts it with the lede band's fragment — no
  layout shift, images through the `/img/<sha1>` registry.
- Tests pass; warm-cache spike renders of Apollo 11, Brown v. Board, and
  Ludwig Prandtl are unchanged where the gate says they should be; a Yeates
  spike render shows the box.

## Glossary

- **Infobox**: The boxed panel of key facts, dates, and an image that Wikipedia places at the top of most articles, generated from a template.
- **Lede**: The introductory section of an article, before its first subheading.
- **Lede rail / rail**: The floated slot at the top of a section (the lede, in this case) where one prominent "hero" card is placed.
- **Deck**: The full-width area below a section's rail holding additional cards grouped into shelves.
- **Shelf**: A row of cards from one contribution — e.g., one partner's items for a section.
- **Hero / `pickHero` / `heroRank`**: The function and ranking that choose which single find, if any, is prominent enough to occupy a section's rail; `heroRank` tiers findings by how directly they answer the section, from "the subject as a document" down to "a map" or "something merely mentioned."
- **Band**: The pipeline's unit of a rendered section, roughly one Wikipedia article section, carrying its own rail, deck, and references fold.
- **`bandParts`**: The function in `emit-html.js` that assembles a band's rail/deck/refs output.
- **`FLOAT_MIN_PROSE`**: An existing rule that demotes a hero card from the rail back into the deck (where it leads its own shelf) when a section's prose is too short to justify a floated image beside it.
- **ⓘ-fold (`rwhy`/`rinfo`)**: The site's established pattern for a quiet, collapsible "why is this here" disclosure attached to a card or slot.
- **`STRIP_BLOCKS`**: The set of elements the parser currently discards from fetched article HTML as noise (infoboxes, navboxes, etc.); this design carves out an exception for the infobox.
- **`sourcesUsed` / legend**: The page's existing bookkeeping for which partner sources contributed cards to a render; the infobox is deliberately excluded from both, since it isn't a partner find.
- **Visibility panel**: The collapsible on-page table comparing what partners could show for an article against what Wikipedia itself currently surfaces.
- **`discover()`**: The shared function (`src/discover.js`) both renderers call to assemble a page's data.
- **`spike.js` (batch renderer)**: Produces one self-contained HTML file per article, with images inlined as `data:` URIs.
- **`serve.js` (streaming renderer)**: The live server that renders a page's spine immediately and streams in enrichment, such as the lede band, as it becomes ready.
- **`data:` URI**: An image encoded directly as text inside the HTML itself, needing no separate request — how the batch renderer keeps its output self-contained.
- **`/img/<sha1>` registry**: The streaming server's own image-serving path, keyed by a hash of the source URL, used instead of inlining so images can be cached across pages.
- **Kartographer**: The MediaWiki extension that renders interactive maps in articles; its containers can't run in a static extract, so they're stripped from the extracted infobox.
- **TemplateStyles**: The mechanism Wikipedia templates (including infoboxes) use to ship their own CSS; this design deliberately does not pass that CSS through, imitating the look by hand instead.
- **Vector**: Wikipedia's default desktop visual skin, which this project's hand-written stylesheet imitates.
- **`infoboxLinks`**: An existing function in `wikipedia.js` that already locates an infobox's table boundaries via a nested-table depth walk, reused by the new extraction code.
- **Gate**: The decision logic (based on `heroRank`) that determines whether the infobox or a partner find occupies the lede rail.
- **Byte-reproducible / warm-cache spike render**: The project's verification method — re-rendering a page from a fully warmed cache and diffing output byte-for-byte — used in place of a unit test over the full discovery path.
- **`srcset`**: The HTML image attribute offering multiple resolutions for a browser to pick from; the extraction step reduces this to a single `src`.
- **Protocol-relative URL**: A URL beginning `//host/...` that inherits whichever scheme (http/https) the page loaded with; MediaWiki emits Commons image URLs this way.
- **`<template>` fragment**: An inert block of HTML shipped as part of the streaming response and inserted into the live page by a small mount script once its data is ready.

## Architecture

The article's rendered HTML — already fetched whole by `fetchArticle`, one
parse call — contains the full infobox `<table>`, which `STRIP_BLOCKS` has
discarded since the canvas era. This design extracts it instead, sanitizes
it, and lets it stand in the lede rail whenever no partner find about the
subject earns that slot.

Three components, one per layer of the existing pipeline:

- **Extraction** (`src/wikipedia.js`): `extractInfobox(html, { wikiBase })` —
  pure. Locates the box with the same table-depth walk `infoboxLinks` uses
  (nested tables must not cut the scan short), returns sanitized table HTML
  plus the image URLs it contains, or null when the article has none.
  Sanitization: drop the `v·t·e` navbar row (`.infobox-navbar`), edit-section
  remnants, Kartographer containers (a static extract cannot run them),
  hidden rows (`.infobox-hiddenrow` — Wikipedia's own desktop default), and
  all `<style>`/`<link>` tags. Rewrite `/wiki/` article links onto `wikiBase`
  so clicking through lands on another enriched render; the image's `File:`
  link stays absolute to en.wikipedia.org — it is the attribution trail.
  Protocol-relative `//upload.wikimedia.org` URLs normalize to `https:`;
  `srcset` reduces to plain `src` (the rail is 330px; the 2× variant is not
  worth doubling the bytes).
- **Placement** (`src/emit-html.js`): in `bandParts`, first band only. Run
  `pickHero` as today; if the winner's `heroRank ≤ 3` the find keeps the rail
  and no infobox renders. Otherwise the winner returns to the deck (leading
  its shelf — the same demotion mechanism `FLOAT_MIN_PROSE` already uses) and
  the infobox takes the rail. The infobox is exempt from `FLOAT_MIN_PROSE`: a
  stub's short prose wrapping beneath its infobox is exactly what a real stub
  looks like. An ⓘ-fold (the existing `rwhy`/`rinfo` idiom) sits at the box's
  top corner with the slot explanation and the front-page link. Styling is
  ~30 hand-written lines beside the skin's other Vector imitations —
  Wikipedia's TemplateStyles are NOT passed through (see Existing Patterns);
  colored header bands survive regardless, riding inline `style` attributes.
- **Wiring** (`src/discover.js`, `spike.js`, `serve.js`): `discover()`
  exposes the extracted infobox on the lede band, so the gate can be applied
  where the entries and their standings already are. Batch collects the
  infobox image URLs into the existing `inline` map (`data:` URIs — the
  output must stay one self-contained file). Streaming registers them in the
  `/img/<sha1>` registry — server-chosen URLs only — and ships the infobox
  inside the lede band's `<template>` fragment, because the gate is
  undecidable at spine time: whether a subject-standing find exists is known
  only when the lede's pivots settle (~2.5s), and mounting then avoids both a
  flash-and-replace and any layout shift.

The decision to show the box is render-time and local to the lede band; no
new network requests anywhere. Hotlinking Commons is policy-permitted, but
both renderers keep their existing one-rule image paths.

## Existing Patterns

- **Table-boundary walking**: `infoboxLinks` (`src/wikipedia.js:346`) already
  finds the infobox's exact extent with a depth counter. `extractInfobox`
  reuses that walk rather than a second regex dialect.
- **Hero demotion**: the wiki-skin branch's `FLOAT_MIN_PROSE` rule already
  returns a hero to `rest` so it leads its shelf — "there is no third
  rendering to maintain." The weak-hero demotion uses the identical move.
- **ⓘ-fold**: the `rwhy`/`rinfo` `<details>` disclosure on cards is the
  established "explain this quietly" idiom; the infobox note wears it.
- **One hand-written stylesheet**: every Vector-looking element in the skin
  (headings, thumb frames, wikitables) is a hand-written imitation in
  `STYLE`. Keeping Wikipedia's own TemplateStyles blocks would be
  pixel-faithful but would make page styling vary per article and per
  upstream revision — the one thing the skin never does. Divergence risk is
  bounded: the recognizable theming arrives as inline `style` attributes that
  pass through under either choice.
- **Copy rules**: the ⓘ text follows the house rules — "the Wikipedia
  article," never bare "the article"; an absence is a measurement, never a
  deficiency ("no friend has one **yet**").
- **Species-box non-collision**: LUI-141 rebuilds taxoboxes from open
  sources. The gate keeps retention off those pages by construction — a
  taxon's lede hero is the partner's own record of the subject (rank 1), so
  the original taxobox never renders there.

## Implementation Phases

### Phase 1: Extraction

**Goal:** The infobox comes out of the article HTML clean, or null.

**Components:**
- `extractInfobox(html, { wikiBase })` in `src/wikipedia.js` — boundary walk,
  hazard stripping, link rewriting, URL normalization; returns
  `{ html, images }` or null.
- Tests in `test/` (pure, offline, house style): nested-table extent, navbar
  and hidden-row and Kartographer and style stripping, `/wiki/` rewrite vs.
  `File:` preservation, protocol-relative normalization, srcset reduction,
  null on no infobox.

**Dependencies:** none.

**Done when:** tests pass; `extractInfobox` on the cached Yeates parse HTML
returns a box whose image is the 1929 portrait.

### Phase 2: Placement, gate, and skin

**Goal:** The lede rail holds the box exactly when it should, looking like
Vector.

**Components:**
- Gate + demotion in `bandParts` (`src/emit-html.js`) behind a new
  `infobox` field on the lede band; `FLOAT_MIN_PROSE` exemption.
- The ⓘ-fold markup with the agreed copy and front-page link.
- `.infobox` rules in `STYLE` beside the other Vector imitations.
- Tests: subject-standing hero wins; weak hero demoted and leads its shelf;
  no-hero lede gets the box; short-prose lede still gets the box;
  `sourcesUsed`/legend unaffected; ⓘ copy present.

**Dependencies:** Phase 1.

**Done when:** tests pass; `bandParts` output for a synthetic Yeates-shaped
band shows the box in `rail` and the map in `deck`.

### Phase 3: Wiring both renderers

**Goal:** Real pages carry the box, in both output modes, with images on the
existing paths.

**Components:**
- `discover()` (`src/discover.js`) attaches `extractInfobox` output to the
  lede band.
- Batch (`spike.js` path): infobox image URLs join the `inline` map.
- Streaming (`serve.js` path): URLs join the `/img` registry; the box rides
  the lede band fragment.
- Stream tests: lede fragment carries the box when gated in; `/img` rewrite
  applied.

**Dependencies:** Phase 2.

**Done when:** tests pass; a local streamed Yeates page mounts the box with
the lede band.

### Phase 4: Acceptance

**Goal:** The house verification — renders, not reasoning about the diff.

**Components:**
- Warm-cache spike renders before/after: Apollo 11, Brown v. Board, Ludwig
  Prandtl (gate says which may change and how), plus John Stuart Yeates as
  the new fallback fixture.
- Byte-reproducibility of a warm re-render.

**Dependencies:** Phase 3.

**Done when:** Brown v. Board's lede is unchanged; Yeates shows portrait,
dates, and the ⓘ-fold; warm re-renders are byte-identical.

## Additional Considerations

**Follow-up, out of scope:** a differentiation pass on the skin (small
deliberate departures from Vector — e.g. rounded corners) so the page reads
as an experiment wearing MediaWiki's design language, not a clone of enwiki.
Requested 2026-08-08; belongs after this lands so it can adjust the infobox
frame along with everything else.

**Failure semantics:** `extractInfobox` returning null (no box, or markup the
walker cannot bound) costs the page its fallback and nothing else — the lede
simply renders as today. Rejection only withholds.

**CLAUDE.md updates on landing:** the `STRIP_BLOCKS` comment ("infoboxes …
would be noise") and the pipeline section both describe the pre-retention
world; the landing commit should note the lede exception where they live.
