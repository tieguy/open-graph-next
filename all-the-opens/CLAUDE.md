# Jenifesto - Rabbit Hole Browser

Last verified: 2026-08-02

## Purpose

Speculative design prototypes for cooperative knowledge infrastructure, over one
curated Apollo 11 dataset that spans Internet Archive, Wikipedia, Wikimedia
Commons, OpenLibrary, Smithsonian, OpenStreetMap, iNaturalist, and GBIF. Two
renderings of the same data:

- **`web-demo/`** — a D3.js force-directed graph ("look how vast and
  interconnected this is").
- **`tapestry-gen/`** — a generator that renders the data as *"the article,
  enriched"*: the Wikipedia article as a spine, with the ecosystem's media and
  cited sources placed by the article's own wikilinks (resolved through Wikidata
  QIDs). Primary output is a self-contained HTML page. See `tapestry-gen/CLAUDE.md`.

## Tech Stack

- `web-demo/`: vanilla ES-module JS + D3.js v7 (CDN), static, no build step.
- `tapestry-gen/`: Node 22+, zero npm dependencies (built-in `fetch`,
  `zlib.crc32`); disk-cached, byte-reproducible.

## Commands

- `python -m http.server 8000 -d web-demo` — serve the D3 demo.
- `cd tapestry-gen && npm run generate` — build the HTML render (and a `.tapestry`).
- `cd tapestry-gen && WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Article Title"` —
  build a live-discovery render.
- `cd tapestry-gen && npm test` — run the generator's test suite.
- `node site/build.js` — assemble the publishable site into `_site/`.
- `python3 -m http.server 8000 -d _site` — preview it.
- Open `tapestry-gen/demo/apollo-11.html` in a browser (self-contained).

## Project Structure

- `web-demo/` — D3 graph demo (`index.html`, `main.js`, `style.css`,
  `data/apollo-11/` the shared dataset).
- `tapestry-gen/` — the article-tapestry generator; `demo/apollo-11.html` is the
  committed HTML render.
- `tapestry/` — **gitignored**: a vendored Internet Archive Tapestry viewer plus
  generated `.tapestry` artifacts. An interesting experiment set aside in favour
  of the HTML render; the generator still emits `.tapestry` but it lives here.
- `extension/` — Firefox browser extension.
- `site/` — the published index (`index.html`) and `build.js`, which assembles
  `_site/` (gitignored) from the committed renders plus a copy of `web-demo/`.
  The renders keep their generated names on disk; `build.js` maps them to the
  URLs a reader should see, so `spike-` never appears in a published path.
- `docs/design-plans/` — design documentation.

## Data Contracts

`web-demo/data/apollo-11/` is the single source of truth, read by both renderings.

**Node** (`items/*.json`): `{id, source, title, description, thumbnail?, url,
identifiers?, potential?}` — `source` is one of the eight source slugs; IDs are
prefixed with a source abbreviation (`wiki-`, `ia-`, `ol-`, `commons-`,
`smithsonian-`, `osm-`, …).

**Connections** (`connections.json`): `{[nodeId]: [{targetId, type, label,
linkedVia?}]}` — `type` ∈ `person|subject|location|time|creator`; `linkedVia` is
the authority systems backing the edge (line thickness = array length).

**Seed** (`seed.json`): the starting node.

## Key Decisions

- Pre-cached data over live APIs — reliability in demos, no rate limits.
- Single topic (Apollo 11) — manageable curation scope.
- The HTML render is the primary article-tapestry output: CSS handles layout that
  hand-computed `.tapestry` pixel geometry could not (no dead whitespace, no
  squashed images, responsive). The `.tapestry` emitter is retained but secondary.

## Invariants

- Node IDs are unique and source-prefixed; every node has at least `id, source, title`.
- Connections reference only IDs present in `items/` (except the seed `wiki-apollo-11`,
  which has no item file — a known latent bug both renderings must tolerate).

## Gotchas

- **The dataset's external identifiers were fabricated** (IA / OpenLibrary /
  Smithsonian URLs were dead or pointed at unrelated works). They have been
  re-curated to verified real ones — which also fixes the D3 demo, since it reads
  the same files. Wikipedia and Commons items were always genuine.
- `potential` counts are fictional; never use them as a ranking/sizing signal.
- The D3 demo's Smithsonian and GBIF favicons are now dead (Wikimedia stopped
  serving the 32px thumbnails they used); `tapestry-gen` uses working replacements.
- Issue tracking moved from chainlink to Linear (2026-07-15).
