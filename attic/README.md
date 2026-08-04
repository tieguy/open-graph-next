# Attic

Retired work, kept browsable. Moved here 2026-08-03 when the repo narrowed its
focus to `all-the-opens/tapestry-gen`. Nothing in here is maintained; paths that
reached outside their own directory are broken by design.

- `accords/` — orientation documents for humans + LLM agents (incl. the
  wikied-checker skill for WikiEd students).
- `legal-graph/` — early planning notes, never built.
- `all-the-opens/web-demo/` — the D3.js force-directed graph rendering of the
  Apollo 11 dataset.
- `all-the-opens/extension/` — the Firefox extension.
- `all-the-opens/site/` + `netlify.toml` — the build for the published Netlify
  index (all-the-opens.netlify.app, manual CLI deploys; now stale).
- `all-the-opens/tapestry-gen-curated/` — the curated-dataset half of
  tapestry-gen, retired 2026-08-04 once the website became the only thing that
  mattered: `generate.js`, the Apollo 11 dataset (`data-apollo-11/`, formerly
  co-owned by the D3 demo above), the placement rules (`src/place.js`), the
  media resolvers, the image-header sizing, and the Internet Archive Tapestry
  emitter (`src/emit.js`, `src/layout.js`, `src/zip.js`,
  `vendor/parse-root.mjs`). It ran clean the day it was retired — 51s, valid
  v7 output — but nothing depended on it: the deployed container never copied
  it, no test invoked it, and both its outputs were gitignored. `generate.js`
  imports several modules that stayed behind in the live tree, so it will not
  run from here without repair. Its own README, and the narrative of how
  placement worked, are kept alongside it. Note the dataset's
  IA/OpenLibrary/Smithsonian identifiers were once fabricated and were
  re-curated to real ones; its Wikipedia and Commons items were always genuine.
- `merge-wikidata-SIFT.sh` — the script that once merged wikidata-SIFT into this
  repo. wikidata-SIFT split back out to its own repo (`../wikidata-SIFT`)
  the same day this attic was created; its full history remains here.
