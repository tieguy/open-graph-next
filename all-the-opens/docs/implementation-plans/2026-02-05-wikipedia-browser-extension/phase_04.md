# Phase 4: Tier 2 - Identifier-Based Queries

**Goal:** Query sources using extracted identifiers, display "Same Entity" results

**Dependencies:** Phase 3 (Wikidata query)

---

### Task 1: Create Source API Modules

**Files:**
- Create: `extension/api/openlibrary.js`
- Create: `extension/api/internet-archive.js`
- Create: `extension/api/viaf.js`
- Create: `extension/api/gbif.js`
- Create: `extension/api/inaturalist.js`

**Step 1: Create OpenLibrary API module**

Create `extension/api/openlibrary.js`:

```javascript
// OpenLibrary API Module
// Fetches author and work data by OpenLibrary ID

const OPENLIBRARY_API = 'https://openlibrary.org';

/**
 * Fetch author by OpenLibrary author ID
 * @param {string} olid - OpenLibrary author ID (e.g., "OL23919A")
 * @returns {Promise<Object>} Author data
 */
export async function fetchAuthor(olid) {
  const response = await fetch(`${OPENLIBRARY_API}/authors/${olid}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`OpenLibrary API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'openlibrary',
    type: 'author',
    id: olid,
    title: data.name || data.personal_name || olid,
    description: data.bio?.value || data.bio || null,
    url: `${OPENLIBRARY_API}/authors/${olid}`,
    thumbnail: data.photos?.[0] ? `https://covers.openlibrary.org/a/id/${data.photos[0]}-M.jpg` : null,
    metadata: {
      birthDate: data.birth_date,
      deathDate: data.death_date,
      workCount: data.work_count
    }
  };
}

/**
 * Fetch work by OpenLibrary work ID
 * @param {string} olid - OpenLibrary work ID (e.g., "OL45883W")
 * @returns {Promise<Object>} Work data
 */
export async function fetchWork(olid) {
  const response = await fetch(`${OPENLIBRARY_API}/works/${olid}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`OpenLibrary API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'openlibrary',
    type: 'work',
    id: olid,
    title: data.title || olid,
    description: data.description?.value || data.description || null,
    url: `${OPENLIBRARY_API}/works/${olid}`,
    thumbnail: data.covers?.[0] ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg` : null,
    metadata: {
      firstPublishDate: data.first_publish_date,
      subjects: data.subjects?.slice(0, 5) || []
    }
  };
}

/**
 * Determine if an OpenLibrary ID is for an author or work and fetch accordingly
 * @param {string} olid - OpenLibrary ID
 * @returns {Promise<Object|null>} Entity data or null
 */
export async function fetchByOlid(olid) {
  // OL IDs ending in 'A' are authors, 'W' are works, 'M' are editions
  if (olid.endsWith('A')) {
    return fetchAuthor(olid);
  } else if (olid.endsWith('W')) {
    return fetchWork(olid);
  } else if (olid.endsWith('M')) {
    // Edition - fetch the work instead
    // For now, just link to the edition
    return {
      source: 'openlibrary',
      type: 'edition',
      id: olid,
      title: `Edition ${olid}`,
      url: `${OPENLIBRARY_API}/books/${olid}`,
      thumbnail: `https://covers.openlibrary.org/b/olid/${olid}-M.jpg`
    };
  }
  return null;
}
```

**Step 2: Create Internet Archive API module**

Create `extension/api/internet-archive.js`:

```javascript
// Internet Archive API Module
// Fetches item metadata by identifier

const IA_API = 'https://archive.org';

/**
 * Fetch item metadata from Internet Archive
 * @param {string} identifier - Internet Archive item identifier
 * @returns {Promise<Object>} Item data
 */
export async function fetchItem(identifier) {
  const response = await fetch(`${IA_API}/metadata/${identifier}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Internet Archive API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.metadata) {
    return null;
  }

  const meta = data.metadata;

  // Get thumbnail - try itemimage or construct from identifier
  let thumbnail = null;
  if (data.misc?.image) {
    thumbnail = `${IA_API}/services/img/${identifier}`;
  }

  return {
    source: 'internet_archive',
    type: meta.mediatype || 'item',
    id: identifier,
    title: meta.title || identifier,
    description: Array.isArray(meta.description) ? meta.description[0] : meta.description,
    url: `${IA_API}/details/${identifier}`,
    thumbnail: thumbnail,
    metadata: {
      mediatype: meta.mediatype,
      creator: Array.isArray(meta.creator) ? meta.creator : [meta.creator].filter(Boolean),
      date: meta.date || meta.year,
      collection: Array.isArray(meta.collection) ? meta.collection : [meta.collection].filter(Boolean),
      downloads: data.item_size
    }
  };
}

/**
 * Search Internet Archive for items
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchItems(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    output: 'json',
    rows: limit.toString(),
    fl: ['identifier', 'title', 'description', 'mediatype', 'creator', 'date'].join(',')
  });

  const response = await fetch(`${IA_API}/advancedsearch.php?${params}`);

  if (!response.ok) {
    throw new Error(`Internet Archive search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.response?.docs || []).map(doc => ({
    source: 'internet_archive',
    type: doc.mediatype || 'item',
    id: doc.identifier,
    title: doc.title || doc.identifier,
    description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
    url: `${IA_API}/details/${doc.identifier}`,
    thumbnail: `${IA_API}/services/img/${doc.identifier}`,
    metadata: {
      mediatype: doc.mediatype,
      creator: doc.creator,
      date: doc.date
    }
  }));
}
```

**Step 3: Create VIAF API module**

Create `extension/api/viaf.js`:

```javascript
// VIAF API Module
// Fetches authority records from Virtual International Authority File

const VIAF_API = 'https://viaf.org/viaf';

/**
 * Fetch authority record from VIAF
 * @param {string} viafId - VIAF identifier
 * @returns {Promise<Object>} Authority record data
 */
export async function fetchRecord(viafId) {
  const response = await fetch(`${VIAF_API}/${viafId}/viaf.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`VIAF API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract preferred name from mainHeadings
  let title = viafId;
  if (data.mainHeadings?.data) {
    const headings = Array.isArray(data.mainHeadings.data)
      ? data.mainHeadings.data
      : [data.mainHeadings.data];
    if (headings.length > 0) {
      title = headings[0].text || headings[0];
    }
  }

  // Extract source links
  const sources = [];
  if (data.sources?.source) {
    const sourceList = Array.isArray(data.sources.source)
      ? data.sources.source
      : [data.sources.source];
    for (const src of sourceList) {
      if (src['@nsid']) {
        sources.push({
          code: src['#text'] || src,
          id: src['@nsid']
        });
      }
    }
  }

  return {
    source: 'viaf',
    type: data.nameType || 'authority',
    id: viafId,
    title: title,
    description: `Authority record from ${sources.length} national libraries`,
    url: `${VIAF_API}/${viafId}`,
    thumbnail: null,
    metadata: {
      nameType: data.nameType,
      sources: sources.slice(0, 5),
      birthDate: data.birthDate,
      deathDate: data.deathDate
    }
  };
}
```

**Step 4: Create GBIF API module**

Create `extension/api/gbif.js`:

```javascript
// GBIF API Module
// Fetches species data from Global Biodiversity Information Facility

const GBIF_API = 'https://api.gbif.org/v1';

/**
 * Fetch species by GBIF taxon key
 * @param {string} taxonKey - GBIF taxon key
 * @returns {Promise<Object>} Species data
 */
export async function fetchSpecies(taxonKey) {
  const response = await fetch(`${GBIF_API}/species/${taxonKey}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`GBIF API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'gbif',
    type: 'species',
    id: taxonKey,
    title: data.scientificName || data.canonicalName || taxonKey,
    description: data.vernacularName ? `Common name: ${data.vernacularName}` : null,
    url: `https://www.gbif.org/species/${taxonKey}`,
    thumbnail: null, // GBIF doesn't provide thumbnails in species endpoint
    metadata: {
      kingdom: data.kingdom,
      phylum: data.phylum,
      class: data.class,
      order: data.order,
      family: data.family,
      genus: data.genus,
      taxonomicStatus: data.taxonomicStatus,
      rank: data.rank
    }
  };
}

/**
 * Search GBIF for species
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchSpecies(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString()
  });

  const response = await fetch(`${GBIF_API}/species/search?${params}`);

  if (!response.ok) {
    throw new Error(`GBIF search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.results || []).map(item => ({
    source: 'gbif',
    type: 'species',
    id: item.key.toString(),
    title: item.scientificName || item.canonicalName,
    description: item.vernacularName ? `Common name: ${item.vernacularName}` : null,
    url: `https://www.gbif.org/species/${item.key}`,
    thumbnail: null,
    metadata: {
      kingdom: item.kingdom,
      rank: item.rank
    }
  }));
}
```

**Step 5: Create iNaturalist API module**

Create `extension/api/inaturalist.js`:

```javascript
// iNaturalist API Module
// Fetches taxa data from iNaturalist

const INAT_API = 'https://api.inaturalist.org/v1';

/**
 * Fetch taxon by iNaturalist taxon ID
 * @param {string} taxonId - iNaturalist taxon ID
 * @returns {Promise<Object>} Taxon data
 */
export async function fetchTaxon(taxonId) {
  const response = await fetch(`${INAT_API}/taxa/${taxonId}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`iNaturalist API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const taxon = data.results[0];

  return {
    source: 'inaturalist',
    type: 'taxon',
    id: taxonId,
    title: taxon.preferred_common_name || taxon.name,
    description: taxon.wikipedia_summary || null,
    url: `https://www.inaturalist.org/taxa/${taxonId}`,
    thumbnail: taxon.default_photo?.medium_url || taxon.default_photo?.square_url || null,
    metadata: {
      scientificName: taxon.name,
      rank: taxon.rank,
      observationsCount: taxon.observations_count,
      iconic_taxon_name: taxon.iconic_taxon_name
    }
  };
}

/**
 * Search iNaturalist for taxa
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchTaxa(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    per_page: limit.toString()
  });

  const response = await fetch(`${INAT_API}/taxa?${params}`);

  if (!response.ok) {
    throw new Error(`iNaturalist search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.results || []).map(taxon => ({
    source: 'inaturalist',
    type: 'taxon',
    id: taxon.id.toString(),
    title: taxon.preferred_common_name || taxon.name,
    description: taxon.wikipedia_summary?.substring(0, 150) || null,
    url: `https://www.inaturalist.org/taxa/${taxon.id}`,
    thumbnail: taxon.default_photo?.square_url || null,
    metadata: {
      scientificName: taxon.name,
      rank: taxon.rank
    }
  }));
}
```

**Step 6: Verify syntax for all modules**

```bash
for f in extension/api/*.js; do node --check "$f" && echo "OK: $f"; done
```

Expected: "OK" for each file

**Step 7: Commit**

```bash
git add extension/api/
git commit -m "feat(extension): add API modules for OpenLibrary, IA, VIAF, GBIF, iNaturalist"
```

---

### Task 2: Create Source Query Orchestrator

**Files:**
- Create: `extension/api/sources.js`

**Step 1: Create sources.js**

Create `extension/api/sources.js`:

```javascript
// Source Query Orchestrator
// Coordinates queries to multiple sources based on available identifiers

import { fetchByOlid } from './openlibrary.js';
import { fetchItem as fetchIAItem } from './internet-archive.js';
import { fetchRecord as fetchViafRecord } from './viaf.js';
import { fetchSpecies as fetchGbifSpecies } from './gbif.js';
import { fetchTaxon as fetchInatTaxon } from './inaturalist.js';

// Map identifier types to fetch functions
const IDENTIFIER_FETCHERS = {
  openlibrary: fetchByOlid,
  internet_archive: fetchIAItem,
  viaf: fetchViafRecord,
  gbif: fetchGbifSpecies,
  inaturalist: fetchInatTaxon
};

// Source display configuration
export const SOURCE_CONFIG = {
  openlibrary: {
    name: 'OpenLibrary',
    color: '#418541',
    icon: 'https://openlibrary.org/favicon.ico'
  },
  internet_archive: {
    name: 'Internet Archive',
    color: '#6b8cae',
    icon: 'https://archive.org/favicon.ico'
  },
  viaf: {
    name: 'VIAF',
    color: '#8b6b4e',
    icon: 'https://viaf.org/viaf/images/viaf.ico'
  },
  gbif: {
    name: 'GBIF',
    color: '#4e9a47',
    icon: 'https://www.gbif.org/favicon.ico'
  },
  inaturalist: {
    name: 'iNaturalist',
    color: '#74ac00',
    icon: 'https://www.inaturalist.org/favicon.ico'
  }
};

/**
 * Query all sources that have matching identifiers
 * @param {Object} identifiers - Map of identifier type to {value, label, url}
 * @returns {Promise<Object>} Results grouped by source
 */
export async function querySourcesByIdentifiers(identifiers) {
  const results = {
    successful: {},
    failed: {},
    noIdentifier: []
  };

  // Determine which sources we can query
  const queries = [];

  for (const [type, fetcher] of Object.entries(IDENTIFIER_FETCHERS)) {
    const identifier = identifiers[type];
    if (identifier) {
      queries.push({
        type,
        identifier: identifier.value,
        fetcher
      });
    } else {
      results.noIdentifier.push(type);
    }
  }

  // Execute all queries in parallel
  const queryResults = await Promise.allSettled(
    queries.map(async ({ type, identifier, fetcher }) => {
      const data = await fetcher(identifier);
      return { type, data };
    })
  );

  // Process results
  for (let i = 0; i < queryResults.length; i++) {
    const result = queryResults[i];
    const { type } = queries[i];

    if (result.status === 'fulfilled' && result.value.data) {
      results.successful[type] = result.value.data;
    } else if (result.status === 'rejected') {
      results.failed[type] = result.reason.message;
    } else {
      // Fulfilled but null data (404)
      results.failed[type] = 'Not found';
    }
  }

  return results;
}

/**
 * Get display info for a source
 * @param {string} sourceType - Source type key
 * @returns {Object} Source display configuration
 */
export function getSourceConfig(sourceType) {
  return SOURCE_CONFIG[sourceType] || {
    name: sourceType,
    color: '#666666',
    icon: null
  };
}
```

**Step 2: Verify syntax**

```bash
node --check extension/api/sources.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add extension/api/sources.js
git commit -m "feat(extension): add source query orchestrator"
```

---

### Task 3: Update Background Script for Tier 2 Queries

**Files:**
- Modify: `extension/background.js`

**Step 1: Update background.js to perform Tier 2 queries**

Replace the entire contents of `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing and API orchestration for tiered loading

import { fetchEntity, getIdentifierUrl } from './api/wikidata.js';
import { querySourcesByIdentifiers, getSourceConfig } from './api/sources.js';
import { getCached, setCache } from './utils/cache.js';

console.log('Jenifesto background script loaded');

// Cache TTLs
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SOURCE_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour

// Current page state
let currentPage = null;

// Listen for messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message.type);

  if (message.type === 'WIKIPEDIA_PAGE_LOADED') {
    handlePageLoaded(message).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_CURRENT_PAGE') {
    sendResponse({ page: currentPage });
    return;
  }

  if (message.type === 'GET_WIKIDATA') {
    if (!currentPage?.qid) {
      sendResponse({ error: 'No Q-ID available' });
      return;
    }
    fetchWikidataForPage(currentPage.qid).then(
      data => sendResponse({ data }),
      error => sendResponse({ error: error.message })
    );
    return true;
  }

  if (message.type === 'GET_TIER2_RESULTS') {
    if (!message.identifiers) {
      sendResponse({ error: 'No identifiers provided' });
      return;
    }
    fetchTier2Results(currentPage?.qid, message.identifiers).then(
      results => sendResponse({ results }),
      error => sendResponse({ error: error.message })
    );
    return true;
  }
});

/**
 * Handle page loaded message from content script
 */
async function handlePageLoaded(message) {
  currentPage = {
    title: message.title,
    url: message.url,
    qid: message.qid,
    timestamp: Date.now()
  };

  await browser.storage.local.set({ currentPage });

  // Notify sidebar of page change
  broadcastMessage({ type: 'PAGE_UPDATED', page: currentPage });

  // If we have a Q-ID, start the tiered loading
  if (currentPage.qid) {
    try {
      // Tier 1: Fetch Wikidata
      const wikidataEntity = await fetchWikidataForPage(currentPage.qid);
      broadcastMessage({ type: 'WIKIDATA_LOADED', entity: wikidataEntity });

      // Tier 2: Query sources with identifiers
      if (Object.keys(wikidataEntity.identifiers).length > 0) {
        broadcastMessage({ type: 'TIER2_LOADING' });

        const tier2Results = await fetchTier2Results(currentPage.qid, wikidataEntity.identifiers);
        broadcastMessage({ type: 'TIER2_LOADED', results: tier2Results });
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      broadcastMessage({ type: 'LOAD_ERROR', error: error.message });
    }
  }

  return { success: true };
}

/**
 * Fetch Wikidata entity with caching
 */
async function fetchWikidataForPage(qid) {
  const cacheKey = `wikidata_${qid}`;
  const cached = await getCached(cacheKey);

  if (cached) {
    console.log('Wikidata cache hit:', qid);
    return cached;
  }

  console.log('Wikidata cache miss, fetching:', qid);
  const entity = await fetchEntity(qid);

  // Add URLs to identifiers
  for (const [type, info] of Object.entries(entity.identifiers)) {
    info.url = getIdentifierUrl(type, info.value);
  }

  await setCache(cacheKey, entity, WIKIDATA_CACHE_TTL);
  return entity;
}

/**
 * Fetch Tier 2 results from sources with caching
 */
async function fetchTier2Results(qid, identifiers) {
  const cacheKey = `tier2_${qid}`;
  const cached = await getCached(cacheKey);

  if (cached) {
    console.log('Tier 2 cache hit:', qid);
    return cached;
  }

  console.log('Tier 2 cache miss, querying sources:', qid);
  const results = await querySourcesByIdentifiers(identifiers);

  // Add source config to successful results
  for (const [type, data] of Object.entries(results.successful)) {
    data.sourceConfig = getSourceConfig(type);
  }

  await setCache(cacheKey, results, SOURCE_CACHE_TTL);
  return results;
}

/**
 * Broadcast message to sidebar (fire and forget)
 */
function broadcastMessage(message) {
  browser.runtime.sendMessage(message).catch(() => {
    // Sidebar not open, ignore
  });
}

// Restore state on startup
browser.storage.local.get('currentPage').then(result => {
  if (result.currentPage) {
    currentPage = result.currentPage;
    console.log('Restored current page:', currentPage.title);
  }
});

browser.runtime.onInstalled.addListener((details) => {
  console.log('Jenifesto installed:', details.reason);
});
```

**Step 2: Verify syntax**

```bash
node --check extension/background.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): background script performs Tier 2 source queries"
```

---

### Task 4: Update Sidebar to Display Tier 2 Results

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.html with Tier 2 results section**

Replace the entire contents of `extension/sidebar/panel.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jenifesto</title>
  <link rel="stylesheet" href="panel.css">
</head>
<body>
  <header class="header">
    <h1 class="header-title">Jenifesto</h1>
  </header>

  <main class="content">
    <section id="current-page" class="section">
      <h2 class="section-title">Current Article</h2>
      <div id="page-info" class="page-info">
        <p class="placeholder">Navigate to a Wikipedia article to begin exploring.</p>
      </div>
    </section>

    <section id="wikidata-section" class="section hidden">
      <h2 class="section-title">Wikidata Entity</h2>
      <div id="wikidata-info" class="wikidata-info">
        <div id="entity-header" class="entity-header"></div>
        <div id="entity-description" class="entity-description"></div>
      </div>
    </section>

    <section id="identifiers-section" class="section hidden">
      <h2 class="section-title">Known Identifiers</h2>
      <div id="identifiers-list" class="identifiers-list"></div>
    </section>

    <section id="same-entity-section" class="section hidden">
      <h2 class="section-title">Same Entity</h2>
      <p class="section-subtitle">Found via linked identifiers</p>
      <div id="same-entity-list" class="results-list"></div>
    </section>

    <section id="loading-section" class="section hidden">
      <div class="loading">
        <span class="loading-spinner"></span>
        <span id="loading-text" class="loading-text">Loading...</span>
      </div>
    </section>

    <section id="no-wikidata" class="section hidden">
      <div class="notice notice-warning">
        <p>This article is not linked to Wikidata.</p>
        <p class="notice-subtext">Related resources will be found via keyword search.</p>
      </div>
    </section>

    <section id="error-section" class="section hidden">
      <div class="notice notice-error">
        <p id="error-message">An error occurred.</p>
      </div>
    </section>
  </main>

  <footer class="footer">
    <p class="footer-text">Discovering connections across open knowledge</p>
  </footer>

  <script src="panel.js"></script>
</body>
</html>
```

**Step 2: Update panel.css with result card styles**

Add the following to the end of `extension/sidebar/panel.css`:

```css
/* Section subtitle */
.section-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: -4px;
  margin-bottom: 8px;
}

/* Result card */
.result-card {
  display: flex;
  gap: 12px;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  padding: 10px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.15s ease;
}

.result-card:hover {
  background-color: var(--bg-tertiary);
}

.result-thumbnail {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
  background-color: var(--bg-tertiary);
  flex-shrink: 0;
}

.result-thumbnail-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background-color: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.result-thumbnail-placeholder img {
  width: 24px;
  height: 24px;
  opacity: 0.6;
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-description {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-source {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.result-source-icon {
  width: 12px;
  height: 12px;
}

.result-source-name {
  font-size: 10px;
  color: var(--text-muted);
}

/* Results grouped by source */
.source-group {
  margin-bottom: 12px;
}

.source-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}

.source-group-icon {
  width: 16px;
  height: 16px;
}

.source-group-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.source-group-count {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}
```

**Step 3: Update panel.js to display Tier 2 results**

Replace the entire contents of `extension/sidebar/panel.js`:

```javascript
// Jenifesto Sidebar Panel Script

console.log('Jenifesto sidebar panel loaded');

// DOM elements
const pageInfoEl = document.getElementById('page-info');
const wikidataSectionEl = document.getElementById('wikidata-section');
const entityHeaderEl = document.getElementById('entity-header');
const entityDescriptionEl = document.getElementById('entity-description');
const identifiersSectionEl = document.getElementById('identifiers-section');
const identifiersListEl = document.getElementById('identifiers-list');
const sameEntitySectionEl = document.getElementById('same-entity-section');
const sameEntityListEl = document.getElementById('same-entity-list');
const loadingSectionEl = document.getElementById('loading-section');
const loadingTextEl = document.getElementById('loading-text');
const noWikidataEl = document.getElementById('no-wikidata');
const errorSectionEl = document.getElementById('error-section');
const errorMessageEl = document.getElementById('error-message');

// State
let currentEntity = null;

// Hide all dynamic sections
function hideAllSections() {
  wikidataSectionEl.classList.add('hidden');
  identifiersSectionEl.classList.add('hidden');
  sameEntitySectionEl.classList.add('hidden');
  loadingSectionEl.classList.add('hidden');
  noWikidataEl.classList.add('hidden');
  errorSectionEl.classList.add('hidden');
}

// Show loading with custom message
function showLoading(message) {
  loadingSectionEl.classList.remove('hidden');
  loadingTextEl.textContent = message;
}

// Update the page info display
function updatePageInfo(page) {
  if (!page) {
    pageInfoEl.innerHTML = '<p class="placeholder">Navigate to a Wikipedia article to begin exploring.</p>';
    hideAllSections();
    return;
  }

  pageInfoEl.innerHTML = `<div class="page-title">${escapeHtml(page.title)}</div>`;

  if (page.qid) {
    hideAllSections();
    showLoading('Loading Wikidata...');
  } else {
    hideAllSections();
    noWikidataEl.classList.remove('hidden');
  }
}

// Display Wikidata entity
function displayWikidataEntity(entity) {
  currentEntity = entity;
  loadingSectionEl.classList.add('hidden');
  wikidataSectionEl.classList.remove('hidden');

  const wikidataUrl = `https://www.wikidata.org/wiki/${entity.id}`;
  entityHeaderEl.innerHTML = `
    <span class="entity-label">${escapeHtml(entity.label)}</span>
    <a href="${wikidataUrl}" target="_blank" rel="noopener" class="qid-badge">${entity.id}</a>
  `;

  if (entity.description) {
    entityDescriptionEl.textContent = entity.description;
    entityDescriptionEl.classList.remove('hidden');
  } else {
    entityDescriptionEl.classList.add('hidden');
  }

  // Show identifiers
  const identifierEntries = Object.entries(entity.identifiers);
  if (identifierEntries.length > 0) {
    identifiersSectionEl.classList.remove('hidden');
    identifiersListEl.innerHTML = identifierEntries.map(([type, info]) => {
      if (info.url) {
        return `
          <a href="${escapeHtml(info.url)}" target="_blank" rel="noopener" class="identifier-item">
            <span class="identifier-label">${escapeHtml(info.label)}</span>
            <span class="identifier-value">${escapeHtml(info.value)}</span>
          </a>
        `;
      } else {
        return `
          <div class="identifier-item">
            <span class="identifier-label">${escapeHtml(info.label)}</span>
            <span class="identifier-value">${escapeHtml(info.value)}</span>
          </div>
        `;
      }
    }).join('');
  }
}

// Display Tier 2 results
function displayTier2Results(results) {
  loadingSectionEl.classList.add('hidden');

  const successfulSources = Object.entries(results.successful);
  if (successfulSources.length === 0) {
    return; // No results to show
  }

  sameEntitySectionEl.classList.remove('hidden');
  sameEntityListEl.innerHTML = successfulSources.map(([sourceType, data]) => {
    const config = data.sourceConfig || { name: sourceType, icon: null };

    return `
      <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener" class="result-card">
        ${data.thumbnail
          ? `<img src="${escapeHtml(data.thumbnail)}" alt="" class="result-thumbnail" loading="lazy">`
          : `<div class="result-thumbnail-placeholder">
              ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="">` : ''}
            </div>`
        }
        <div class="result-content">
          <div class="result-title">${escapeHtml(data.title)}</div>
          ${data.description ? `<div class="result-description">${escapeHtml(data.description)}</div>` : ''}
          <div class="result-source">
            ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="" class="result-source-icon">` : ''}
            <span class="result-source-name">${escapeHtml(config.name)}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

// Display error
function displayError(message) {
  loadingSectionEl.classList.add('hidden');
  errorSectionEl.classList.remove('hidden');
  errorMessageEl.textContent = message;
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Request current page data
async function loadCurrentPage() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_CURRENT_PAGE' });
    updatePageInfo(response.page);

    if (response.page?.qid) {
      const wikidataResponse = await browser.runtime.sendMessage({ type: 'GET_WIKIDATA' });
      if (wikidataResponse.data) {
        displayWikidataEntity(wikidataResponse.data);

        // Request Tier 2 results
        showLoading('Loading related sources...');
        const tier2Response = await browser.runtime.sendMessage({
          type: 'GET_TIER2_RESULTS',
          identifiers: wikidataResponse.data.identifiers
        });
        if (tier2Response.results) {
          displayTier2Results(tier2Response.results);
        }
      } else if (wikidataResponse.error) {
        displayError(wikidataResponse.error);
      }
    }
  } catch (error) {
    console.error('Sidebar error:', error);
    updatePageInfo(null);
  }
}

// Listen for background updates
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Sidebar received:', message.type);

  switch (message.type) {
    case 'PAGE_UPDATED':
      updatePageInfo(message.page);
      break;
    case 'WIKIDATA_LOADED':
      displayWikidataEntity(message.entity);
      break;
    case 'TIER2_LOADING':
      showLoading('Loading related sources...');
      break;
    case 'TIER2_LOADED':
      displayTier2Results(message.results);
      break;
    case 'LOAD_ERROR':
      displayError(message.error);
      break;
  }
});

// Initialize
loadCurrentPage();
```

**Step 4: Verify syntax**

```bash
node --check extension/sidebar/panel.js
```

Expected: No output (valid syntax)

**Step 5: Commit**

```bash
git add extension/sidebar/
git commit -m "feat(extension): sidebar displays Tier 2 'Same Entity' results"
```

---

### Task 5: Test Tier 2 Integration

**Step 1: Reload extension**

1. Go to `about:debugging`
2. Reload Jenifesto extension

**Step 2: Test on article with multiple identifiers**

1. Navigate to https://en.wikipedia.org/wiki/Neil_Armstrong
2. Open sidebar

Expected:
- Wikidata entity loads with identifiers
- "Same Entity" section appears
- Shows results from OpenLibrary, VIAF, etc. (depending on available identifiers)
- Each result card has title, description, source icon

**Step 3: Test on article with biodiversity data**

1. Navigate to https://en.wikipedia.org/wiki/Giant_panda

Expected:
- GBIF and/or iNaturalist results appear if Wikidata has those identifiers

**Step 4: Verify caching**

1. Navigate away and back to same article
2. Results should load instantly from cache

---

### Phase 4 Complete

**Done when:**
- API modules fetch data from OpenLibrary, Internet Archive, VIAF, GBIF, iNaturalist
- Source orchestrator queries all sources with matching identifiers in parallel
- Background script caches Tier 2 results (1 hour TTL)
- Sidebar displays "Same Entity" results with thumbnails and source attribution
- Failed sources don't block display of successful ones
- Results load instantly on cache hit
