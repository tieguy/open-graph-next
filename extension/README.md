# Jenifesto Browser Extension

A Firefox browser extension that surfaces related resources from cultural heritage archives when browsing Wikipedia.

## Features

- **Tiered Loading**: Progressive discovery of related content
  - Tier 1: Wikidata entity and identifiers
  - Tier 2: Same-entity matches via linked identifiers
  - Tier 3: Related topics via keyword search
- **11 Source APIs**: OpenLibrary, Internet Archive, VIAF, GBIF, iNaturalist, DPLA, arXiv, Wikimedia Commons, and more
- **Data Quality Surface**: Highlights missing Wikidata identifiers and broken links with edit suggestions

## Installation

### Development

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the sidebar
3. Click "Load Temporary Add-on..."
4. Select `manifest.json` from this directory

### From AMO (when published)

Visit addons.mozilla.org and search for "Jenifesto"

## Usage

1. Navigate to any Wikipedia article
2. Open the sidebar (View > Sidebar > Jenifesto)
3. The sidebar automatically loads related resources
4. Click "Search more sources" for additional results

## Development

### Project Structure

```
extension/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker / event page
├── content.js          # Wikipedia content script
├── api/                # API modules for each source
│   ├── wikidata.js
│   ├── openlibrary.js
│   ├── internet-archive.js
│   ├── viaf.js
│   ├── gbif.js
│   ├── inaturalist.js
│   ├── dpla.js
│   ├── arxiv.js
│   ├── commons.js
│   └── sources.js      # Orchestrator
├── utils/
│   ├── cache.js        # Storage with TTL
│   └── data-quality.js # Issue detection
├── sidebar/
│   ├── panel.html
│   ├── panel.js
│   └── panel.css
└── icons/
```

### API Keys

DPLA requires an API key. Register at dp.la and set in the extension options (when implemented).

### Building

No build step required - pure ES modules loaded directly by Firefox.

## License

MIT
