# Article Tapestry — Apollo 11 as an enriched canvas

Date: 2026-07-23
Status: phases 1–3 implemented (spine + media resolvers + citation gutter) — see `tapestry-gen/README.md`

## Summary

A second rendering of the existing Apollo 11 dataset, independent of the D3 rabbit-hole
graph. Where the graph argues *"look how vast and interconnected this is"* — abstract, and
persuasive only to someone who already cares about authority control — this argues *"here
is what the article you already read could be."* It is legible to a Wikimedia audience with
no explanation.

The artifact is a generated `.tapestry` file rendered by a vendored build of the Internet
Archive's Tapestry viewer: the Apollo 11 article laid out as a linear spine, with the open
ecosystem's media on one side and the article's own citations on the other.

**It is generated, not authored.** That is the whole point. A hand-placed canvas invites
the obvious objection — *"sure, if you position everything by hand"* — and the answer is
that nothing here is positioned by hand. The article's own wikilinks decide what goes
where, resolved through Wikidata QIDs to items in our dataset. Nobody decided the JFK
speech audio belongs beside the Background section: the article said Kennedy belongs there,
Wikidata said `Q9696` is Kennedy, and the Internet Archive's recording is about `Q9696`.
The layout is a consequence of the identifier graph. Point it at a different article and it
still works.

## Relationship to existing work

- Shares `web-demo/data/apollo-11/` as the single source of truth. The generator only reads
  it; the D3 demo is untouched.
- The QID backfill (below) writes back into the dataset, which improves the D3 demo too.
- `web-demo/` keeps its no-build-step invariant. The build step introduced here belongs to
  the vendored viewer and the generator only.

## Verified groundwork

Already done and confirmed, not assumed — see `tapestry/README.md` for detail:

- **The viewer is vendored and serving.** `tapestry/viewer/`, built from upstream commit
  `c0a1350`, with three required patches: a missing `pixi-filters` dependency in
  `core-client`, `--base=./` for subdirectory serving, and a router fix (upstream's single
  `<Route path="/">` renders nothing when the app is mounted anywhere but a domain root).
  Static files only — no Postgres, Redis, S3, or auth.
- **The v7 `root.json` shape is pinned**, resolved through the full v0→v7 inheritance
  chain and checked against the real `parseRootJson`: v0–v6 reject on the version literal,
  v7 accepts.
- **Remote media needs no bundling.** `import-service.ts` falls through to the original URL
  when a source is not a zip entry. `tapestry/smoke-test.tapestry` is a zip containing only
  `root.json`, with a remote Commons image, and it parses.

- **The viewer renders a generated tapestry.** Confirmed in a browser on 2026-07-23:
  `smoke-test.tapestry` loads via `?source=` and PixiJS draws the remote Commons image on
  the dark canvas. The full chain — hand-built v7 JSON → zip with no bundled media →
  vendored viewer → rendered canvas — works end to end.

Nothing the design rests on is now inferred; the format, the no-bundling path, and the
renderer have each been exercised.

## Layout

Three lanes, so the two kinds of adjacency never blur together:

```
   citations          article spine              resolved media
   (minor, 320)       (text, 560)                (hero 1240 / standard 600)
  ┌──────────┐       ┌──────────────┐       ┌────────────────────────────┐
  │ OpenLib  │       │ Background   │       │                            │
  │ ISBN ref │──────▶│              │       │   ia-jfk-moon-speech       │  hero
  │          │       │ "Kennedy     │◀─────▶│   (audio, 1240×200)        │
  ├──────────┤       │  proposed…"  │       ├─────────────┬──────────────┤
  │ IA/Way   │──────▶│              │       │ wiki-jfk    │ wiki-apollo8 │  standard
  │ back ref │       │              │       │ (600×400)   │ (600×400)    │
  └──────────┘       └──────────────┘       └─────────────┴──────────────┘
```

Evidence on the left, claim in the middle, what the ecosystem holds on the right.

**Vertical.** Sections stack top-down in article order. Band height is
`max(text, media stack)` plus a fixed gutter, accumulated. Roughly 700–1400px per band;
~8 sections lands near a 10,000px canvas — fine for a canvas meant to be stepped through
rather than scrolled.

**Text volume.** The first sentence or two of each section, not the full article. Apollo 11
runs ~15k words; full text would make panning the dominant experience and drag in
infoboxes, tables, and reference markers needing removal.

**Prologue and coda.** The place-linked items have no wikilink in the prose and are
identifiable by `linkedVia` containing `coordinates` or `geonames` (9 and 4 occurrences).
They split by hop distance from the seed:

- *Prologue* (one hop — the site itself): the two OSM entries. An establishing shot, a map
  before the first sentence, like a book's endpaper.
- *Coda* (two or more hops — things related to the site rather than to Apollo 11): the
  wildlife refuge, iNaturalist, GBIF. Same coordinates, entirely different domain — the
  rabbit-hole payoff, and the better ending.

Making the wikilink rule's failure visible and labelled is more honest than quietly forcing
these into "Aftermath". *Open: confirm hop distances actually fall this way in
`connections.json`; if not, fall back to sorting by source.*

**Sizing.** Tapestry items carry absolute `size` and there is no layout engine, so size
splits in two:

- *Aspect ratio* — from the primary resolved media where it exists (Commons `imageinfo`
  returns real dimensions), with per-type defaults otherwise: audio a wide short bar, book
  portrait, map square, webpage 16:10. Audio, books and maps have no intrinsic visual size
  at all.
- *Extent* — never intrinsic; an 8000px Commons original cannot be 8000px on canvas. A size
  class fits the aspect ratio into it:

| role | class | width |
| --- | --- | --- |
| first resolved item in a section | hero | 1240 |
| video, image, book, map, webpage | standard | 600 |
| citation embeds | minor | 320 |

One hero per section, so the spine reads evenly top to bottom.

**Groups and presentation steps.** Each section becomes a Tapestry `group`; each
presentation step targets that `groupId`. ArrowRight zooms to fit the whole band, text and
media together, so the article reads as a sequence of spreads. `startView` frames the
prologue.

## Rels

Colour carries connection `type` (person / subject / location / creator). Weight carries
corroboration: one authority system → `light`, two or three → `medium`, four or more →
`heavy`. `wiki-apollo-11 → wiki-buzz-aldrin` is backed by VIAF, LC, ISNI and Wikidata and
draws heavy; the six `manual` edges draw light, and honestly so — they are the ones no
authority system supports.

**Cross-band rels only**, as a first cut. Within a band, proximity already says what a rel
would say, and 40 edges across a 10,000px canvas is spaghetti. The cross-band ones are also
the interesting ones: long arcs asserting that the article's sections are more entangled
than the prose admits. Direction maps cleanly — 38 of 40 edges are one-way, so arrowhead on
`to` only.

**A legend text frame in the prologue is load-bearing, not decoration.** Rels have no label
field, so "crew member" and "launch vehicle" are lost, and `linkedVia` collapses entirely
into line thickness. Without a key, the encoding is decoration rather than argument.

## Pipeline

A Node script in `tapestry-gen/`. Node for `fetch`, zip writing, and directory reads,
adding no runtime dependency to the demo itself. Every network stage writes to a disk cache,
so reruns are offline and byte-reproducible — consistent with the project's existing
"pre-cached data over live APIs" decision.

1. **Load** — read `items/*.json`, `connections.json`, `seed.json`.
2. **Backfill QIDs** — 19 of 36 items lack `identifiers.wikidata`, the key the placement
   rule turns on. Resolve via the Wikidata API and write back to the dataset.
3. **Fetch article** — Wikipedia API: section structure, each section's first sentences, its
   outbound wikilinks, and the `<ref>` payloads attached to those sentences.
4. **Place** — intersect section wikilink QIDs with item QIDs.
5. **Resolve media** — per-source resolvers. This is *selection*, not lookup: an IA item has
   dozens of files, Commons has renditions, and the chosen primary drives both source and
   inferred dimensions.
6. **Resolve citations** — ISBN → OpenLibrary, bare URL → Wayback, DOI → landing page.
7. **Lay out** — deterministic geometry from section order and lane.
8. **Emit** — `root.json`, rels, groups, presentation steps; zip to `apollo-11.tapestry`.

### Resolver contract

```
resolve(item) → { type: 'image'|'video'|'audio'|'book'|'pdf'|'webpage',
                  source: string,              // direct media URL
                  aspect: {width, height}|null, // intrinsic where knowable
                  attribution: {license, author, url} }
```

### The main cost

Every one of the 36 items has a `url` pointing at a *landing page*, never at media —
`ia-apollo11-footage` resolves to an `/details/` page, `commons-earthrise` to a `File:`
description page. There are zero direct media URLs anywhere in the dataset. "The footage
actually plays" is not free; it requires resolvers against the IA metadata API, Commons
`imageinfo`, OpenLibrary, and Smithsonian. This is the bulk of the build.

### Attribution

Built in, not bolted on. The article text is CC BY-SA 4.0 and every Commons image carries
its own license. The `imageinfo` call we are already making returns `extmetadata` with
license and author, so the resolver carries it and the emitter renders it. A demo arguing
for cooperative knowledge infrastructure should model the reciprocity correctly.

## Known data issues

- **The external identifiers were fabricated wholesale (discovered during phase 2).** Every
  Internet Archive, OpenLibrary and Smithsonian landing URL in the dataset was plausible but
  false — dead IA identifiers, dead Smithsonian object pages, and OpenLibrary work IDs
  pointing at unrelated books. Only Wikipedia and Commons items are genuine, because they are
  the only sources whose identifiers the D3 demo ever effectively exercised (via thumbnails
  and QIDs). Phase 2 replaced each fabricated item with a verified real one, images and all —
  the Smithsonian items down to their NASM object photos and Voyager 3D-scan posters. This
  is the deeper form of the "landing page, never media" problem below: not only did the URLs
  point at pages rather than media, several pointed at nothing at all.
- `wiki-apollo-11` is referenced as a connection source in `connections.json` but has no
  file in `items/` — it exists only in `seed.json`. This is a latent bug in the D3 demo too
  (`main.js` will fetch a 404 and fail silently). The generator must handle it; fixing the
  dataset would fix both.
- Four items have no thumbnail: both OSM entries, iNaturalist, GBIF. Thumbnails are
  optional throughout the Tapestry format, so this is not fatal.
- **Most stored thumbnail URLs are dead** (verified 2026-07-23). Wikimedia now restricts
  thumbnail rendering to an allowlist of widths and answers anything else with
  `400 Use thumbnail sizes listed on https://w.wiki/GHai`, which kills all 20 of the
  dataset's `200px-`/`220px-` URLs. All five Smithsonian `ids.si.edu` delivery-service
  URLs return 404. Internet Archive and OpenLibrary covers still resolve. **This affects
  the D3 demo too** — it renders the same URLs — so fixing the dataset fixes both. The
  generator sidesteps it by taking `thumburl` from the Wikimedia API rather than
  constructing URLs, which is the only reliable approach: hand-built thumbnail URLs are
  what broke in the first place.
- `identifiers` is present on only 17 of 36 items. Stage 2 exists to close this.
- The `potential` counts are fictional (documented in `CLAUDE.md`) and must not be used as
  a ranking or sizing signal.

## Phases

Each phase yields a tapestry that opens, so the viewer is a continuous check rather than a
final gate.

1. **Text-only spine** — QID backfill, article fetch, wikilink placement, emit. No media.
   Confirms the format is right and the viewer renders a generated file at all. *(done)*
2. **Media resolvers** — per-source, IA and Commons first (highest payoff: playable video,
   full-res images). *(done: IA video/audio as native players, Commons + lead-image
   attribution, OpenLibrary covers and Smithsonian object photos re-curated from real
   sources. Citation media deferred to phase 3.)*
3. **Citation embeds** — the left gutter. Roughly doubles the item count; a phase of its
   own, not a freebie. *(done: per-section `<ref>` citations parsed from wikitext, capped at
   three per band and ranked books-then-archived; book ISBNs show a verified OpenLibrary
   cover, every other source a quiet card with its Wayback link in the notes.)*
4. **Groups, presentation steps, cross-band rels, legend.** *(groups + presentation steps
   already exist from phase 1; rels and the legend remain.)*
5. **Prologue and coda.** *(also the natural home for OpenStreetMap **map embeds**: the two
   OSM place items could resolve to a `webpage` item pointing at
   `openstreetmap.org/export/embed.html?bbox=…`, or a static map image — currently unbuilt.)*

## Decisions and their reasons

| Decision | Why |
| --- | --- |
| Generated, not hand-authored | A hand-placed canvas concedes the objection it exists to answer |
| Wikilinks → QIDs decide placement | Makes the layout itself the argument, and it generalises to any article |
| Section order as spine, not chronology | Legible to a Wikimedia audience as *the article, enriched* |
| First sentence or two per section | Media stays the subject; the canvas stays navigable |
| Resolve media at build time | Matches the existing pre-cached-data decision; reliable in demos, no rate limits |
| Size class from media type + role | Mechanical and predictably good-looking, with no hand-tagged `prominence` field |
| Cross-band rels only | Proximity already carries within-band relationships; 40 edges would be spaghetti |
| Vendor the viewer locally | Private demo, so AGPL distribution obligation is not triggered |

## Rejected alternatives

- **Swap the D3 graph's renderer for Tapestry.** Buys real media playback at the cost of
  progressive exploration and the `linkedVia` semantics that justify the project. The graph
  and the tapestry are separate ideations of the same components; both stay.
- **Iframe the landing pages** instead of resolving media. Nearly free, but yields chrome
  inside chrome, and Wikimedia's `X-Frame-Options` would likely block framing outright.
- **Hand-tagged `prominence` field.** Best-looking result, but 36 judgment calls now and 36
  more per new topic — and it reintroduces the hand-authoring objection.
- **Chronology or claim→evidence as the spine.** Chronology is more mechanical but leaves
  undateable items (a memoir, a wildlife refuge) homeless. Claim→evidence is the most
  on-thesis but the least mechanical and the heaviest to author.
