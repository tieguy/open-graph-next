# Jenifesto - Rabbit Hole Browser

Last verified: 2026-02-03

## Purpose

Speculative design prototype demonstrating what cooperative knowledge infrastructure could feel like. A D3.js force-directed graph that connects Apollo 11 resources across Internet Archive, Wikipedia, Wikimedia Commons, OpenLibrary, Smithsonian, OpenStreetMap, iNaturalist, and GBIF.

## Tech Stack

- Vanilla JavaScript (ES modules)
- D3.js v7 (CDN)
- Static site (no build step, no backend)

## Commands

- `python -m http.server 8000 -d web-demo` - Serve locally (or any static server)

## Project Structure

- `web-demo/` - D3.js force-directed graph demo
  - `index.html` - Single page shell
  - `main.js` - Graph visualization logic
  - `style.css` - Dark theme styles
  - `data/apollo-11/` - Curated dataset (see Data Contracts below)
- `extension/` - Firefox browser extension
- `docs/design-plans/` - Design documentation
- `docs/implementation-plans/` - Implementation tracking

## Data Contracts

All data is pre-cached JSON. No live API calls.

**Node schema** (`web-demo/data/{topic}/items/*.json`):
```
{id, source, title, description, thumbnail?, url, potential?}
```
- `source`: `internet_archive | wikipedia | wikimedia_commons | openlibrary | smithsonian | dpla | arxiv | met_museum | openstreetmap | inaturalist | gbif`
- `potential`: Object with source-keyed counts plus `total` (for leaf nodes)

**Connections** (`web-demo/data/{topic}/connections.json`):
```
{[nodeId]: [{targetId, type, label, linkedVia?}]}
```
- `type`: `person | subject | location | time | creator`
- `linkedVia`: Array of authority system IDs that enable this link (e.g., `["viaf", "lc", "wikidata"]`). Line thickness derived from array length.

**Seed** (`web-demo/data/{topic}/seed.json`): Starting node for the graph.

## Key Decisions

- Pre-cached data over live APIs: Reliability during demos, no rate limits
- Single topic dataset (Apollo 11): Manageable curation scope for prototype
- Leaf nodes show "potential counts": Evokes the vastness beyond cached data

## Invariants

- Node IDs are prefixed with source abbreviation (e.g., `wiki-`, `ia-`, `ol-`)
- Every node has at minimum: id, source, title
- Connections reference only IDs that exist in items/

## Chainlink Usage

This project uses `chainlink` for issue tracking. Common workflows:

**Session start:**
```
chainlink session start
chainlink session last-handoff  # See what previous session left off
chainlink next                   # Get suggested issue to work on
```

**Session end:**
```
chainlink session end -n "Handoff notes describing progress and next steps"
```

**Creating issues:**
```
chainlink create "Issue title"
chainlink create -d "Description" -p high "Issue title"
chainlink create -t bug "Bug description"      # Templates: bug, feature, refactor, research
```

**Never use:** `chainlink timer`, `chainlink start`, `chainlink stop` - the timer feature is unreliable and adds no value.

## Gotchas

- Source icons use official favicons loaded from source domains
- Graph accumulates - no way to collapse/remove nodes
- Potential counts are fictional/estimated, not real API queries
