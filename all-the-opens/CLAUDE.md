# Jenifesto - the article, enriched

Last verified: 2026-08-03

## Purpose

Speculative design prototypes for cooperative knowledge infrastructure. The one
active project is **`tapestry-gen/`** — a generator that renders a Wikipedia
article as *"the article, enriched"*: the article as a spine, with the open
ecosystem's media and cited sources placed by the article's own wikilinks and
citations (resolved through Wikidata QIDs and authority identifiers). Primary
output is a self-contained HTML page. See `tapestry-gen/CLAUDE.md`.

Earlier renderings — the D3.js force-directed graph (`web-demo/`), the Firefox
extension, and the Netlify site build — were retired to the repo-root `attic/`
on 2026-08-03. The published index at all-the-opens.netlify.app is stale as of
that date.

## Tech Stack

Node 22+, one npm dependency (m3api, for MediaWiki requests — see
`tapestry-gen/src/mw.js`); disk-cached, byte-reproducible.

## Commands

- `cd tapestry-gen && npm run generate` — build the Apollo 11 HTML render (and a
  `.tapestry`).
- `cd tapestry-gen && WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Article Title"` —
  build a live-discovery render for any article.
- `cd tapestry-gen && npm test` — run the generator's test suite.
- Open `tapestry-gen/demo/apollo-11.html` in a browser (self-contained).

## Project Structure

- `tapestry-gen/` — the generator; `demo/apollo-11.html` is the committed HTML
  render; `data/apollo-11/` is the curated dataset (moved here from the retired
  web-demo, whose copy-paths are now broken by design).
- `tapestry/` — **gitignored**: a vendored Internet Archive Tapestry viewer plus
  generated `.tapestry` artifacts. Set aside in favour of the HTML render; the
  generator still emits `.tapestry` here.
- `docs/design-plans/`, `docs/implementation-plans/` — design documentation.

## Data Contracts

`tapestry-gen/data/apollo-11/` is the curated dataset.

**Node** (`items/*.json`): `{id, source, title, description, thumbnail?, url,
identifiers?, potential?}` — `source` is one of the eight source slugs; IDs are
prefixed with a source abbreviation (`wiki-`, `ia-`, `ol-`, `commons-`,
`smithsonian-`, `osm-`, …).

**Connections** (`connections.json`): `{[nodeId]: [{targetId, type, label,
linkedVia?}]}` — `type` ∈ `person|subject|location|time|creator`; `linkedVia` is
the authority systems backing the edge (line thickness = array length).

**Seed** (`seed.json`): the starting node.

## Key Decisions

- Pre-cached data over live APIs for the curated render — reliability in demos,
  no rate limits. `spike.js` is the live-discovery path.
- The HTML render is the primary output: CSS handles layout that hand-computed
  `.tapestry` pixel geometry could not (no dead whitespace, no squashed images,
  responsive). The `.tapestry` emitter is retained but secondary.

## Invariants

- Node IDs are unique and source-prefixed; every node has at least `id, source, title`.
- Connections reference only IDs present in `items/` (except the seed `wiki-apollo-11`,
  which has no item file — a known latent bug the generator must tolerate).

## Gotchas

- The dataset's external identifiers were once fabricated (IA / OpenLibrary /
  Smithsonian) and have been re-curated to verified real ones. Wikipedia and
  Commons items were always genuine.
- `potential` counts are fictional; never use them as a ranking/sizing signal.
- Issue tracking moved from chainlink to Linear (2026-07-15).
