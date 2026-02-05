# Data Domain

Last verified: 2026-02-03

## Purpose

Pre-cached knowledge graph data for offline demo reliability. Each topic subdirectory contains a complete explorable dataset.

## Contracts

- **Exposes**: JSON files loaded by fetch() in main.js
- **Guarantees**: All targetIds in connections.json have matching items/*.json
- **Expects**: Topic subdirectories follow consistent structure

## Structure

```
data/{topic}/
  seed.json          # Starting node
  connections.json   # Graph edges keyed by source node ID
  items/*.json       # Individual node data
```

## Adding a Topic

1. Create `data/{topic}/` directory
2. Add `seed.json` with starting node
3. Curate items in `items/` directory
4. Define connections in `connections.json`
5. Ensure all connection targetIds have corresponding item files

## Invariants

- Node IDs must be unique across entire dataset
- ID format: `{source-abbrev}-{slug}` (e.g., `wiki-neil-armstrong`)
- Source abbreviations: `ia`, `wiki`, `commons`, `ol`, `smithsonian`, `dpla`, `arxiv`, `met`, `osm`, `inat`, `gbif`
