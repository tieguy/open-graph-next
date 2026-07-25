# tapestry-gen

Last verified: 2026-07-25

## Purpose

A second rendering of the shared Apollo 11 dataset as *"the article, enriched"* —
the Wikipedia article as a linear spine, the open ecosystem's media on one side,
its cited sources on the other. It is **generated, not authored**: the article's
own wikilinks, resolved through Wikidata QIDs, decide where each item lands, so
the placement *is* the argument and generalises to any article. Primary output is
a self-contained HTML page; a `.tapestry` (Internet Archive Tapestry format) is
also emitted but secondary (see Key Decisions). Fuller narrative in `README.md`.

## Contracts

- **Reads** `../web-demo/data/apollo-11/` — the single source of truth shared with
  the D3 demo. Read-only, except deliberate dataset re-curation.
- **Writes** `demo/apollo-11.html` (the committed demo) and
  `../tapestry/apollo-11.tapestry` (gitignored).
- **Network** all goes through `.cache/` (gitignored), keyed by request URL —
  reruns are offline and byte-reproducible. Delete `.cache/` to refetch.

## Pipeline (output-agnostic core → renderer)

`dataset` → `wikipedia` (sections, prose, wikilinks, QIDs, lead images, infobox
links, section wikitext) → `place` (wikilink→QID placement, tier-2 via
connections, prologue/coda for place-only items) → `resolve` (media) +
`citations` (per-section `<ref>` templates) + `imagesize` → `emit-html` (or the
Tapestry `layout`/`emit`/`zip`).

## Key Decisions

- **HTML is primary.** CSS reflow solves what hand-computed `.tapestry` pixel
  geometry could not (dead whitespace, squashed images, non-responsive). Only
  `layout.js`/`emit.js`/`zip.js`/`vendor/parse-root.mjs` are Tapestry-specific;
  everything else is output-agnostic and reused by the HTML render.
- **Reachability-ranked citations.** A section's shown sources prefer what a
  reader can open: borrowable/readable book > archived page > DOI > catalog-only
  book > bare live link. Cited books link to their Internet Archive copy via
  OpenLibrary.
- **True image dimensions** are read from JPEG/PNG headers (`imagesize`) so covers
  and photos are never squashed by a guessed aspect.
- **OpenLibrary covers are inlined** as data URIs — they redirect through
  archive.org, so a live dependency would break whenever IA is down.

## Invariants

- Pipeline modules never assume an output format; the renderer is the only
  format-specific layer.
- Every rendered image is sized from real dimensions (API or header), not a guess.

## Gotchas

- First run needs network (fills `.cache`); reruns are offline.
- OpenLibrary rate-limits back-to-back requests — the volume lookup retries with
  backoff.
- OSM place items resolve to keyless `maps.wikimedia.org` static-map thumbnails.
- The dataset's IA/OpenLibrary/Smithsonian identifiers were fabricated and have
  been re-curated to real ones (see `../CLAUDE.md`).

## Key Files

- `generate.js` — pipeline entry point + coverage report.
- `src/place.js` — placement rules. `src/citations.js` — citation extraction,
  reachability ranking, OpenLibrary access. `src/resolve.js` — media resolvers.
- `src/emit-html.js` — the HTML render. `src/emit.js` / `layout.js` / `zip.js` —
  the Tapestry emitter.
