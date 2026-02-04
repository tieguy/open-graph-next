# Jenifesto - Rabbit Hole Browser

Last verified: 2026-02-03

## Purpose

Speculative design prototype demonstrating what cooperative knowledge infrastructure could feel like. A D3.js force-directed graph that connects Apollo 11 resources across Internet Archive, Wikipedia, Wikimedia Commons, OpenLibrary, Smithsonian, OpenStreetMap, iNaturalist, and GBIF.

## Tech Stack

- Vanilla JavaScript (ES modules)
- D3.js v7 (CDN)
- Static site (no build step, no backend)

## Commands

- `python -m http.server 8000` - Serve locally (or any static server)

## Project Structure

- `index.html` - Single page shell
- `main.js` - Graph visualization logic
- `style.css` - Dark theme styles
- `data/apollo-11/` - Curated dataset (see Data Contracts below)
- `docs/design-plans/` - Design documentation
- `docs/implementation-plans/` - Implementation tracking

## Data Contracts

All data is pre-cached JSON. No live API calls.

**Node schema** (`data/{topic}/items/*.json`):
```
{id, source, title, description, thumbnail?, url, potential?}
```
- `source`: `internet_archive | wikipedia | wikimedia_commons | openlibrary | smithsonian | dpla | arxiv | met_museum | openstreetmap | inaturalist | gbif`
- `potential`: Object with source-keyed counts plus `total` (for leaf nodes)

**Connections** (`data/{topic}/connections.json`):
```
{[nodeId]: [{targetId, type, label}]}
```
- `type`: `person | subject | location | time | creator`

**Seed** (`data/{topic}/seed.json`): Starting node for the graph.

## Key Decisions

- Pre-cached data over live APIs: Reliability during demos, no rate limits
- Single topic dataset (Apollo 11): Manageable curation scope for prototype
- Leaf nodes show "potential counts": Evokes the vastness beyond cached data

## Invariants

- Node IDs are prefixed with source abbreviation (e.g., `wiki-`, `ia-`, `ol-`)
- Every node has at minimum: id, source, title
- Connections reference only IDs that exist in items/

## Gotchas

- Source icons use official favicons loaded from source domains
- Graph accumulates - no way to collapse/remove nodes
- Potential counts are fictional/estimated, not real API queries
