# Jenifesto Browser Extension: Wikipedia Sidebar

## Summary

This document describes a Firefox browser extension that augments Wikipedia articles with a live-updated sidebar displaying related resources from 11 cultural heritage and scientific sources (Internet Archive, OpenLibrary, DPLA, Wikimedia Commons, VIAF, Library of Congress, Smithsonian, Met Museum, arXiv, iNaturalist, GBIF, and OpenStreetMap). Unlike the current Jenifesto prototype which uses pre-cached data for a single topic, this extension performs real-time API queries triggered by the user's current Wikipedia article.

The extension uses a three-tiered progressive loading strategy: first extracting the article's Wikidata identifier and displaying known external IDs, then automatically querying sources that have matching identifiers ("Same Entity" results), and finally offering user-triggered keyword search across remaining sources ("Related Topics"). The architecture leverages Firefox's Manifest V3 service worker model with a content script extracting article context, a background worker orchestrating parallel API calls with caching, and a sidebar panel rendering results. A key secondary goal is surfacing data quality opportunities—highlighting when OpenLibrary or other sources contain records that lack corresponding Wikidata identifiers, or when Wikidata references broken external links.

## Definition of Done

**Deliverable:** A Firefox browser extension that displays a sidebar panel when visiting Wikipedia, showing related resources from 11 cultural heritage sources using tiered progressive loading.

**Success criteria:**
- Sidebar opens when visiting any Wikipedia article
- Tier 1: Wikidata entity and identifiers load automatically
- Tier 2: "Same entity" matches from identifier-linked sources load automatically
- Tier 3: "Related topics" keyword search available on user action
- Results grouped by source with clear visual distinction between tiers
- Works on articles without Wikidata IDs (falls back to keyword search)
- Surfaces data quality opportunities (missing identifiers, broken links)

**Out of scope:**
- Editing workflows (OAuth, write operations)
- Graph visualization (list view only)
- Wikipedia edge cases (disambiguation, redirects, non-English)
- Chrome/Safari parity (Firefox-first)
- Settings/preferences UI
- Offline-first support

**Purpose:** Proof-of-concept demonstrating live, lazy-loading discovery of related resources across open knowledge infrastructure, surfacing opportunities for improved Wikidata and OpenLibrary linking.

## Glossary

- **Wikidata Q-ID**: Unique identifier for entities in Wikidata (e.g., `Q1` for "universe"). Wikipedia articles often link to corresponding Wikidata entries.
- **Manifest V3 (MV3)**: Third generation of browser extension architecture requiring service workers instead of persistent background pages.
- **Service Worker**: Background script that runs in response to events and may terminate when idle, requiring state persistence strategies.
- **Content Script**: JavaScript injected into web pages that can access and manipulate the page DOM, used here to extract Wikidata identifiers from Wikipedia articles.
- **Authority Identifier**: Standardized ID used by libraries and cultural heritage organizations to uniquely identify entities (e.g., VIAF, LCCN, OpenLibrary ID).
- **VIAF**: Virtual International Authority File, a consortium aggregating authority records from national libraries worldwide.
- **LCCN**: Library of Congress Control Number, identifier used by the US Library of Congress.
- **DPLA**: Digital Public Library of America, aggregates metadata from US libraries, archives, and museums.
- **Progressive Loading**: UI pattern where content appears incrementally as data becomes available, rather than blocking until all data is fetched.
- **TTL (Time To Live)**: Cache expiration duration, after which cached data is considered stale and must be refreshed.
- **Rate Limiting**: Restricting API request frequency to comply with service provider limits and avoid being blocked.
- **Host Permission**: Browser extension permission required to access content from specific domains.

## Architecture

Firefox browser extension with three components: content script extracts article context, background service worker orchestrates API queries, sidebar panel renders results.

**Extension structure:**
```
jenifesto-extension/
├── manifest.json          # MV3 config, permissions, sidebar_action
├── background.js          # Service worker - API orchestration, caching
├── content.js             # Extracts Wikidata Q-ID from Wikipedia pages
├── sidebar/
│   ├── panel.html         # Side panel shell
│   ├── panel.js           # UI rendering, message handling
│   └── panel.css          # Dark theme styling
└── icons/                 # Extension icons (16, 32, 48, 128px)
```

**Permissions required:**
- `sidebarAction` - Firefox sidebar API
- `activeTab` - Access current tab URL/content
- `storage` - Cache API responses
- Host permissions: `*://*.wikipedia.org/*`, `*.wikidata.org/*`, plus each source API domain

**Tiered loading strategy:**

```
User opens sidebar on Wikipedia article
  │
  ├─► Tier 1: Content script extracts Wikidata Q-ID
  │     └─► Background queries Wikidata REST API
  │           └─► Sidebar shows: entity summary, known identifiers
  │
  ├─► Tier 2: Background extracts identifiers from Wikidata response
  │     └─► Parallel queries to sources with matching IDs
  │           └─► Sidebar shows: "Same Entity" results per source
  │
  └─► Tier 3: User clicks "Search more sources"
        └─► Keyword search on remaining sources
              └─► Sidebar shows: "Related Topics" results
```

**Fallback (no Wikidata Q-ID):**
- Skip Tier 1 & 2
- Show: "No Wikidata entry for this article"
- Auto-trigger Tier 3 keyword search using article title
- Surface editing opportunity: "Link this article to Wikidata"

**Data quality surface:**
- Missing identifiers: "Found in OpenLibrary but Wikidata lacks OL identifier"
- Broken links: "Wikidata references non-existent OpenLibrary ID"
- Displayed in collapsible "Improve This Data" section

## Existing Patterns

Investigation found reusable patterns in the current Jenifesto codebase:

**Item caching** (`main.js:335-359`):
- Map-based cache with null fallback for missing items
- Simple fetch abstraction with error handling
- Adaptation: Replace file fetch with API calls, add TTL expiration

**Sidebar rendering** (`main.js:166-331`):
- Single `updateSidebar(node)` function updates all sections
- Conditional visibility via classList
- Authority identifier display with clickable links
- Adaptation: Same pattern works for extension sidebar

**Source configuration** (`main.js:5-101`):
- SOURCES object with colors, icons, display names
- CONNECTION_TYPES for relationship categories
- IDENTIFIER_URLS for authority system links
- Adaptation: Reuse configuration objects directly

**Data contracts** (from `data/CLAUDE.md`):
- Node schema: `{id, source, title, description?, thumbnail?, url, identifiers?}`
- ID prefixing by source: `wiki-`, `ia-`, `ol-`, etc.
- Adaptation: Same schema for API response normalization

## Implementation Phases

### Phase 1: Extension Scaffold
**Goal:** Minimal Firefox extension with sidebar that activates on Wikipedia

**Components:**
- `manifest.json` with MV3 structure, `sidebar_action`, Wikipedia host permission
- `content.js` stub that detects Wikipedia article pages
- `sidebar/panel.html` with basic shell structure
- `sidebar/panel.css` with dark theme from Jenifesto
- `background.js` stub service worker

**Dependencies:** None

**Done when:** Extension loads in Firefox, sidebar opens on Wikipedia articles, shows placeholder content

### Phase 2: Wikidata Q-ID Extraction
**Goal:** Content script extracts Wikidata identifier from Wikipedia pages

**Components:**
- `content.js` Q-ID extraction (from page's Wikidata link or API fallback)
- Message passing: content script → background → sidebar
- Sidebar displays: article title, Q-ID (or "not found" state)

**Dependencies:** Phase 1

**Done when:** Sidebar shows Wikidata Q-ID for articles that have one, graceful fallback for articles without

### Phase 3: Tier 1 - Wikidata Query
**Goal:** Fetch entity data from Wikidata and display identifiers

**Components:**
- `background.js` Wikidata REST API integration
- Response parsing: extract labels, descriptions, external identifiers
- `sidebar/panel.js` renders entity summary and identifier list
- Basic caching in `chrome.storage.local` (24hr TTL)

**Dependencies:** Phase 2

**Done when:** Sidebar shows Wikidata entity info with list of known identifiers (VIAF, LCCN, OpenLibrary ID, etc.)

### Phase 4: Tier 2 - Identifier-Based Queries
**Goal:** Query sources using extracted identifiers, display "Same Entity" results

**Components:**
- API modules for each source:
  - OpenLibrary (`/authors/{id}.json`, `/works/{id}.json`)
  - Internet Archive (`/metadata/{id}`)
  - VIAF (`/viaf/{id}/viaf.json`)
  - Library of Congress (`id.loc.gov`)
  - GBIF (`/v1/species/{id}`)
  - iNaturalist (`/v1/taxa/{id}`)
- `background.js` orchestration: parallel queries, per-source error handling
- `sidebar/panel.js` "Same Entity" section with per-source grouping
- Loading states per source (independent spinners)

**Dependencies:** Phase 3

**Done when:** Sources with matching identifiers show results, failures don't block other sources

### Phase 5: Tier 3 - Keyword Search
**Goal:** User-initiated search for sources without identifier matches

**Components:**
- "Search more sources" button in sidebar
- API modules for search endpoints:
  - Internet Archive advanced search
  - DPLA search API
  - arXiv query API
  - Wikimedia Commons search
  - Smithsonian/Met search
- `sidebar/panel.js` "Related Topics" section (visually distinct from Tier 2)
- Rate limiting queue (respect per-API limits)

**Dependencies:** Phase 4

**Done when:** User can trigger keyword search, results appear in separate section, rate limits respected

### Phase 6: Data Quality Surface
**Goal:** Display editing opportunities for missing/broken links

**Components:**
- Detection logic: identifier found in Tier 3 but missing from Wikidata
- Detection logic: Tier 2 query returns 404 (broken identifier)
- "Improve This Data" collapsible section in sidebar
- Links to relevant editing interfaces (Wikidata, OpenLibrary)

**Dependencies:** Phase 4, Phase 5

**Done when:** Missing identifiers and broken links surfaced with actionable links

### Phase 7: Polish and Error Handling
**Goal:** Robust error states, visual refinement

**Components:**
- Per-source error messages with retry buttons
- Offline detection and cached-only mode
- Empty state handling (hide sources with 0 results)
- Visual polish: source icons, hover states, smooth transitions
- Service worker lifecycle handling (state persistence across wake)

**Dependencies:** Phase 6

**Done when:** Extension handles errors gracefully, looks polished, works reliably

## Additional Considerations

**Rate limiting:** Each API has different limits. Queue requests per-domain, exponential backoff on 429 responses, give up after 3 retries.

**Caching strategy:**
- Wikidata responses: 24hr TTL (stable data)
- Search results: 1hr TTL (may change)
- Cache key: `{qid}:{source}:{tier}`

**Service worker lifecycle (MV3):** Service workers can terminate after 5 minutes idle. Store in-flight query state in `chrome.storage.session`, resume on wake.

**Chrome compatibility (future):** Firefox uses `browser.*` namespace and `sidebar_action`. Chrome uses `chrome.*` and `sidePanel`. Abstraction layer needed for cross-browser support, but deferred for proof-of-concept.
