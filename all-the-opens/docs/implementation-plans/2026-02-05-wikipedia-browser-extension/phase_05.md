# Phase 5: Tier 3 - Keyword Search

**Goal:** User-initiated search for sources without identifier matches

**Dependencies:** Phase 4 (Tier 2 queries)

---

### Task 1: Create Search API Modules

**Files:**
- Create: `extension/api/dpla.js`
- Create: `extension/api/arxiv.js`
- Create: `extension/api/commons.js`
- Modify: `extension/api/internet-archive.js` (add search)

**Step 1: Create DPLA API module**

Create `extension/api/dpla.js`:

```javascript
// DPLA (Digital Public Library of America) API Module
// Note: Requires API key from dp.la

const DPLA_API = 'https://api.dp.la/v2';

// API key - users will need to register for their own key
// For development, use empty string and expect limited/no results
let apiKey = '';

/**
 * Set the DPLA API key
 * @param {string} key - DPLA API key
 */
export function setApiKey(key) {
  apiKey = key;
}

/**
 * Search DPLA for items
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchItems(query, limit = 10) {
  if (!apiKey) {
    console.warn('DPLA API key not set - skipping DPLA search');
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    page_size: limit.toString(),
    api_key: apiKey
  });

  const response = await fetch(`${DPLA_API}/items?${params}`);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      console.warn('DPLA API key invalid or expired');
      return [];
    }
    throw new Error(`DPLA API error: ${response.status}`);
  }

  const data = await response.json();

  return (data.docs || []).map(doc => {
    const resource = doc.sourceResource || {};

    return {
      source: 'dpla',
      type: resource.type?.[0] || 'item',
      id: doc.id,
      title: Array.isArray(resource.title) ? resource.title[0] : resource.title || 'Untitled',
      description: Array.isArray(resource.description)
        ? resource.description[0]
        : resource.description || null,
      url: doc.isShownAt || `https://dp.la/item/${doc.id}`,
      thumbnail: doc.object || null,
      metadata: {
        creator: resource.creator,
        date: resource.date?.displayDate,
        provider: doc.provider?.name,
        dataProvider: doc.dataProvider
      }
    };
  });
}
```

**Step 2: Create arXiv API module**

Create `extension/api/arxiv.js`:

```javascript
// arXiv API Module
// Note: arXiv API returns XML, requires 3+ second delay between requests

const ARXIV_API = 'https://export.arxiv.org/api/query';

// Rate limiting: track last request time
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3500; // 3.5 seconds to be safe

/**
 * Wait for rate limit if needed
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

/**
 * Parse arXiv Atom XML response
 * @param {string} xmlText - XML response text
 * @returns {Array} Parsed entries
 */
function parseArxivResponse(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const entries = doc.querySelectorAll('entry');
  const results = [];

  for (const entry of entries) {
    const id = entry.querySelector('id')?.textContent || '';
    const arxivId = id.replace('http://arxiv.org/abs/', '');

    results.push({
      source: 'arxiv',
      type: 'paper',
      id: arxivId,
      title: entry.querySelector('title')?.textContent?.trim() || 'Untitled',
      description: entry.querySelector('summary')?.textContent?.trim()?.substring(0, 200) || null,
      url: id,
      thumbnail: null,
      metadata: {
        authors: Array.from(entry.querySelectorAll('author name')).map(n => n.textContent),
        published: entry.querySelector('published')?.textContent,
        updated: entry.querySelector('updated')?.textContent,
        categories: Array.from(entry.querySelectorAll('category')).map(c => c.getAttribute('term'))
      }
    });
  }

  return results;
}

/**
 * Search arXiv for papers
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchPapers(query, limit = 10) {
  await waitForRateLimit();

  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: limit.toString(),
    sortBy: 'relevance',
    sortOrder: 'descending'
  });

  const response = await fetch(`${ARXIV_API}?${params}`);

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status}`);
  }

  const xmlText = await response.text();
  return parseArxivResponse(xmlText);
}
```

**Step 3: Create Wikimedia Commons API module**

Create `extension/api/commons.js`:

```javascript
// Wikimedia Commons API Module
// Searches for media files on Commons

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Search Wikimedia Commons for files
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchFiles(query, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '6', // File namespace
    srlimit: limit.toString(),
    format: 'json',
    origin: '*'
  });

  const response = await fetch(`${COMMONS_API}?${params}`);

  if (!response.ok) {
    throw new Error(`Commons API error: ${response.status}`);
  }

  const data = await response.json();
  const searchResults = data.query?.search || [];

  if (searchResults.length === 0) {
    return [];
  }

  // Get image info for thumbnails
  const titles = searchResults.map(r => r.title).join('|');
  const infoParams = new URLSearchParams({
    action: 'query',
    titles: titles,
    prop: 'imageinfo',
    iiprop: 'url|thumburl|extmetadata',
    iiurlwidth: '200',
    format: 'json',
    origin: '*'
  });

  const infoResponse = await fetch(`${COMMONS_API}?${infoParams}`);
  const infoData = await infoResponse.json();
  const pages = infoData.query?.pages || {};

  // Map page info by title
  const pageInfoByTitle = {};
  for (const page of Object.values(pages)) {
    if (page.title && page.imageinfo) {
      pageInfoByTitle[page.title] = page.imageinfo[0];
    }
  }

  return searchResults.map(result => {
    const info = pageInfoByTitle[result.title] || {};
    const title = result.title.replace('File:', '');

    return {
      source: 'wikimedia_commons',
      type: 'file',
      id: result.pageid.toString(),
      title: title,
      description: result.snippet?.replace(/<[^>]+>/g, '') || null,
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(result.title)}`,
      thumbnail: info.thumburl || null,
      metadata: {
        size: result.size,
        timestamp: result.timestamp,
        artist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '')
      }
    };
  });
}
```

**Step 4: Verify syntax for all search modules**

```bash
for f in extension/api/dpla.js extension/api/arxiv.js extension/api/commons.js; do
  node --check "$f" && echo "OK: $f"
done
```

Expected: "OK" for each file

**Step 5: Commit**

```bash
git add extension/api/dpla.js extension/api/arxiv.js extension/api/commons.js
git commit -m "feat(extension): add search API modules for DPLA, arXiv, Commons"
```

---

### Task 2: Create Tier 3 Search Orchestrator

**Files:**
- Modify: `extension/api/sources.js`

**Step 1: Update sources.js with search functions**

Replace the entire contents of `extension/api/sources.js`:

```javascript
// Source Query Orchestrator
// Coordinates queries to multiple sources based on identifiers and keyword search

import { fetchByOlid } from './openlibrary.js';
import { fetchItem as fetchIAItem, searchItems as searchIA } from './internet-archive.js';
import { fetchRecord as fetchViafRecord } from './viaf.js';
import { fetchSpecies as fetchGbifSpecies, searchSpecies as searchGbif } from './gbif.js';
import { fetchTaxon as fetchInatTaxon, searchTaxa as searchInat } from './inaturalist.js';
import { searchItems as searchDpla } from './dpla.js';
import { searchPapers as searchArxiv } from './arxiv.js';
import { searchFiles as searchCommons } from './commons.js';

// Map identifier types to fetch functions (Tier 2)
const IDENTIFIER_FETCHERS = {
  openlibrary: fetchByOlid,
  internet_archive: fetchIAItem,
  viaf: fetchViafRecord,
  gbif: fetchGbifSpecies,
  inaturalist: fetchInatTaxon
};

// Map source types to search functions (Tier 3)
const SEARCH_FUNCTIONS = {
  internet_archive: searchIA,
  gbif: searchGbif,
  inaturalist: searchInat,
  dpla: searchDpla,
  arxiv: searchArxiv,
  wikimedia_commons: searchCommons
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
  },
  dpla: {
    name: 'DPLA',
    color: '#0068a6',
    icon: 'https://dp.la/favicon.ico'
  },
  arxiv: {
    name: 'arXiv',
    color: '#b31b1b',
    icon: 'https://arxiv.org/favicon.ico'
  },
  wikimedia_commons: {
    name: 'Wikimedia Commons',
    color: '#006699',
    icon: 'https://commons.wikimedia.org/favicon.ico'
  }
};

/**
 * Query sources by identifiers (Tier 2)
 * @param {Object} identifiers - Map of identifier type to {value, label, url}
 * @returns {Promise<Object>} Results grouped by source
 */
export async function querySourcesByIdentifiers(identifiers) {
  const results = {
    successful: {},
    failed: {},
    noIdentifier: []
  };

  const queries = [];

  for (const [type, fetcher] of Object.entries(IDENTIFIER_FETCHERS)) {
    const identifier = identifiers[type];
    if (identifier) {
      queries.push({ type, identifier: identifier.value, fetcher });
    } else {
      results.noIdentifier.push(type);
    }
  }

  const queryResults = await Promise.allSettled(
    queries.map(async ({ type, identifier, fetcher }) => {
      const data = await fetcher(identifier);
      return { type, data };
    })
  );

  for (let i = 0; i < queryResults.length; i++) {
    const result = queryResults[i];
    const { type } = queries[i];

    if (result.status === 'fulfilled' && result.value.data) {
      results.successful[type] = result.value.data;
    } else if (result.status === 'rejected') {
      results.failed[type] = result.reason.message;
    } else {
      results.failed[type] = 'Not found';
    }
  }

  return results;
}

/**
 * Search sources by keyword (Tier 3)
 * @param {string} query - Search query
 * @param {Array<string>} excludeSources - Sources to skip (already have Tier 2 results)
 * @param {number} limitPerSource - Max results per source
 * @returns {Promise<Object>} Results grouped by source
 */
export async function searchSourcesByKeyword(query, excludeSources = [], limitPerSource = 5) {
  const results = {
    successful: {},
    failed: {},
    skipped: []
  };

  const searches = [];

  for (const [type, searchFn] of Object.entries(SEARCH_FUNCTIONS)) {
    if (excludeSources.includes(type)) {
      results.skipped.push(type);
      continue;
    }
    searches.push({ type, searchFn });
  }

  const searchResults = await Promise.allSettled(
    searches.map(async ({ type, searchFn }) => {
      const data = await searchFn(query, limitPerSource);
      return { type, data };
    })
  );

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const { type } = searches[i];

    if (result.status === 'fulfilled' && result.value.data?.length > 0) {
      results.successful[type] = result.value.data;
    } else if (result.status === 'rejected') {
      results.failed[type] = result.reason.message;
    }
    // If fulfilled with empty array, just don't include it
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

/**
 * Get list of searchable sources
 * @returns {Array<string>} Source type keys
 */
export function getSearchableSources() {
  return Object.keys(SEARCH_FUNCTIONS);
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
git commit -m "feat(extension): add Tier 3 keyword search to source orchestrator"
```

---

### Task 3: Update Background Script for Tier 3

**Files:**
- Modify: `extension/background.js`

**Step 1: Update background.js with Tier 3 search handler**

Replace the entire contents of `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing and API orchestration for tiered loading

import { fetchEntity, getIdentifierUrl } from './api/wikidata.js';
import { querySourcesByIdentifiers, searchSourcesByKeyword, getSourceConfig } from './api/sources.js';
import { getCached, setCache } from './utils/cache.js';

console.log('Jenifesto background script loaded');

// Cache TTLs
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SOURCE_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour
const SEARCH_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour

// Current page state
let currentPage = null;
let currentTier2Sources = []; // Track which sources have Tier 2 results

// Listen for messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message.type);

  switch (message.type) {
    case 'WIKIPEDIA_PAGE_LOADED':
      handlePageLoaded(message).then(sendResponse);
      return true;

    case 'GET_CURRENT_PAGE':
      sendResponse({ page: currentPage });
      return;

    case 'GET_WIKIDATA':
      if (!currentPage?.qid) {
        sendResponse({ error: 'No Q-ID available' });
        return;
      }
      fetchWikidataForPage(currentPage.qid).then(
        data => sendResponse({ data }),
        error => sendResponse({ error: error.message })
      );
      return true;

    case 'GET_TIER2_RESULTS':
      if (!message.identifiers) {
        sendResponse({ error: 'No identifiers provided' });
        return;
      }
      fetchTier2Results(currentPage?.qid, message.identifiers).then(
        results => sendResponse({ results }),
        error => sendResponse({ error: error.message })
      );
      return true;

    case 'SEARCH_TIER3':
      if (!message.query) {
        sendResponse({ error: 'No query provided' });
        return;
      }
      performTier3Search(message.query, currentTier2Sources).then(
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
  currentTier2Sources = [];

  await browser.storage.local.set({ currentPage });
  broadcastMessage({ type: 'PAGE_UPDATED', page: currentPage });

  if (currentPage.qid) {
    try {
      // Tier 1: Fetch Wikidata
      const wikidataEntity = await fetchWikidataForPage(currentPage.qid);
      broadcastMessage({ type: 'WIKIDATA_LOADED', entity: wikidataEntity });

      // Tier 2: Query sources with identifiers
      if (Object.keys(wikidataEntity.identifiers).length > 0) {
        broadcastMessage({ type: 'TIER2_LOADING' });

        const tier2Results = await fetchTier2Results(currentPage.qid, wikidataEntity.identifiers);

        // Track which sources returned Tier 2 results
        currentTier2Sources = Object.keys(tier2Results.successful);

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

  for (const [type, data] of Object.entries(results.successful)) {
    data.sourceConfig = getSourceConfig(type);
  }

  await setCache(cacheKey, results, SOURCE_CACHE_TTL);
  return results;
}

/**
 * Perform Tier 3 keyword search with caching
 */
async function performTier3Search(query, excludeSources) {
  const cacheKey = `tier3_${query}_${excludeSources.sort().join(',')}`;
  const cached = await getCached(cacheKey);

  if (cached) {
    console.log('Tier 3 cache hit:', query);
    return cached;
  }

  console.log('Tier 3 cache miss, searching:', query);
  const results = await searchSourcesByKeyword(query, excludeSources, 5);

  // Add source config to results
  for (const [type, items] of Object.entries(results.successful)) {
    const config = getSourceConfig(type);
    for (const item of items) {
      item.sourceConfig = config;
    }
  }

  await setCache(cacheKey, results, SEARCH_CACHE_TTL);
  return results;
}

/**
 * Broadcast message to sidebar
 */
function broadcastMessage(message) {
  browser.runtime.sendMessage(message).catch(() => {});
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
git commit -m "feat(extension): background script handles Tier 3 keyword search"
```

---

### Task 4: Update Sidebar with Tier 3 UI

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.html with Tier 3 section**

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

    <section id="related-topics-section" class="section hidden">
      <h2 class="section-title">Related Topics</h2>
      <p class="section-subtitle">Found via keyword search</p>
      <div id="related-topics-list" class="results-list"></div>
    </section>

    <section id="search-more-section" class="section hidden">
      <button id="search-more-btn" class="search-more-btn">
        <span class="search-icon">🔍</span>
        Search more sources
      </button>
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
        <p class="notice-subtext">Click below to search for related content.</p>
      </div>
      <button id="search-no-wikidata-btn" class="search-more-btn">
        <span class="search-icon">🔍</span>
        Search all sources
      </button>
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

**Step 2: Update panel.css with search button styles**

Add the following to the end of `extension/sidebar/panel.css`:

```css
/* Search more button */
.search-more-btn {
  width: 100%;
  padding: 12px 16px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background-color 0.15s ease;
}

.search-more-btn:hover {
  background-color: var(--bg-tertiary);
}

.search-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.search-icon {
  font-size: 14px;
}

/* Source group for search results */
.source-results-group {
  margin-bottom: 16px;
}

.source-results-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}

.source-results-icon {
  width: 16px;
  height: 16px;
}

.source-results-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.source-results-count {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.source-results-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Compact result card for multiple results */
.result-card-compact {
  display: flex;
  gap: 10px;
  background-color: var(--bg-secondary);
  border-radius: 4px;
  padding: 8px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.15s ease;
}

.result-card-compact:hover {
  background-color: var(--bg-tertiary);
}

.result-card-compact .result-thumbnail {
  width: 40px;
  height: 40px;
}

.result-card-compact .result-thumbnail-placeholder {
  width: 40px;
  height: 40px;
}

.result-card-compact .result-title {
  font-size: 12px;
}

.result-card-compact .result-description {
  font-size: 10px;
  -webkit-line-clamp: 1;
}
```

**Step 3: Update panel.js with Tier 3 functionality**

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
const relatedTopicsSectionEl = document.getElementById('related-topics-section');
const relatedTopicsListEl = document.getElementById('related-topics-list');
const searchMoreSectionEl = document.getElementById('search-more-section');
const searchMoreBtn = document.getElementById('search-more-btn');
const loadingSectionEl = document.getElementById('loading-section');
const loadingTextEl = document.getElementById('loading-text');
const noWikidataEl = document.getElementById('no-wikidata');
const searchNoWikidataBtn = document.getElementById('search-no-wikidata-btn');
const errorSectionEl = document.getElementById('error-section');
const errorMessageEl = document.getElementById('error-message');

// State
let currentPage = null;
let currentEntity = null;
let tier2SourcesLoaded = [];
let tier3Loaded = false;

// Hide all dynamic sections
function hideAllSections() {
  wikidataSectionEl.classList.add('hidden');
  identifiersSectionEl.classList.add('hidden');
  sameEntitySectionEl.classList.add('hidden');
  relatedTopicsSectionEl.classList.add('hidden');
  searchMoreSectionEl.classList.add('hidden');
  loadingSectionEl.classList.add('hidden');
  noWikidataEl.classList.add('hidden');
  errorSectionEl.classList.add('hidden');
}

function showLoading(message) {
  loadingSectionEl.classList.remove('hidden');
  loadingTextEl.textContent = message;
}

function updatePageInfo(page) {
  currentPage = page;
  tier2SourcesLoaded = [];
  tier3Loaded = false;

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
      }
      return `
        <div class="identifier-item">
          <span class="identifier-label">${escapeHtml(info.label)}</span>
          <span class="identifier-value">${escapeHtml(info.value)}</span>
        </div>
      `;
    }).join('');
  }
}

function displayTier2Results(results) {
  loadingSectionEl.classList.add('hidden');

  const successfulSources = Object.entries(results.successful);
  tier2SourcesLoaded = successfulSources.map(([type]) => type);

  if (successfulSources.length > 0) {
    sameEntitySectionEl.classList.remove('hidden');
    sameEntityListEl.innerHTML = successfulSources.map(([sourceType, data]) =>
      renderResultCard(data, false)
    ).join('');
  }

  // Show search button if there are more sources to search
  if (!tier3Loaded) {
    searchMoreSectionEl.classList.remove('hidden');
  }
}

function displayTier3Results(results) {
  loadingSectionEl.classList.add('hidden');
  searchMoreSectionEl.classList.add('hidden');
  tier3Loaded = true;

  const successfulSources = Object.entries(results.successful);
  if (successfulSources.length === 0) {
    return;
  }

  relatedTopicsSectionEl.classList.remove('hidden');
  relatedTopicsListEl.innerHTML = successfulSources.map(([sourceType, items]) => {
    const config = items[0]?.sourceConfig || { name: sourceType, icon: null };

    return `
      <div class="source-results-group">
        <div class="source-results-header">
          ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="" class="source-results-icon">` : ''}
          <span class="source-results-name">${escapeHtml(config.name)}</span>
          <span class="source-results-count">${items.length} result${items.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="source-results-list">
          ${items.map(item => renderResultCard(item, true)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderResultCard(data, compact) {
  const config = data.sourceConfig || { name: data.source, icon: null };
  const cardClass = compact ? 'result-card-compact' : 'result-card';

  return `
    <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener" class="${cardClass}">
      ${data.thumbnail
        ? `<img src="${escapeHtml(data.thumbnail)}" alt="" class="result-thumbnail" loading="lazy">`
        : `<div class="result-thumbnail-placeholder">
            ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="">` : ''}
          </div>`
      }
      <div class="result-content">
        <div class="result-title">${escapeHtml(data.title)}</div>
        ${data.description ? `<div class="result-description">${escapeHtml(data.description)}</div>` : ''}
        ${!compact ? `
          <div class="result-source">
            ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="" class="result-source-icon">` : ''}
            <span class="result-source-name">${escapeHtml(config.name)}</span>
          </div>
        ` : ''}
      </div>
    </a>
  `;
}

function displayError(message) {
  loadingSectionEl.classList.add('hidden');
  errorSectionEl.classList.remove('hidden');
  errorMessageEl.textContent = message;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function performTier3Search() {
  if (!currentPage) return;

  const query = currentPage.title;
  showLoading('Searching more sources...');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SEARCH_TIER3',
      query: query
    });

    if (response.results) {
      displayTier3Results(response.results);
    } else if (response.error) {
      displayError(response.error);
    }
  } catch (error) {
    console.error('Tier 3 search error:', error);
    displayError('Search failed');
  }
}

// Event listeners
searchMoreBtn.addEventListener('click', performTier3Search);
searchNoWikidataBtn.addEventListener('click', performTier3Search);

async function loadCurrentPage() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_CURRENT_PAGE' });
    updatePageInfo(response.page);

    if (response.page?.qid) {
      const wikidataResponse = await browser.runtime.sendMessage({ type: 'GET_WIKIDATA' });
      if (wikidataResponse.data) {
        displayWikidataEntity(wikidataResponse.data);

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

browser.runtime.onMessage.addListener((message) => {
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
git commit -m "feat(extension): sidebar supports Tier 3 keyword search"
```

---

### Task 5: Test Tier 3 Search

**Step 1: Reload extension**

1. Go to `about:debugging`
2. Reload Jenifesto extension

**Step 2: Test search button**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Open sidebar
3. Wait for Tier 2 results to load
4. Click "Search more sources"

Expected:
- Loading spinner shows
- "Related Topics" section appears with grouped results
- Results from Internet Archive, Wikimedia Commons, arXiv appear
- DPLA may show no results (requires API key)

**Step 3: Test search on article without Wikidata**

Find an obscure Wikipedia article without Wikidata link (rare but exists).

Expected:
- "Not linked to Wikidata" notice
- "Search all sources" button
- Click triggers Tier 3 search directly

---

### Phase 5 Complete

**Done when:**
- Search API modules fetch from DPLA, arXiv, Wikimedia Commons
- Source orchestrator handles keyword search across multiple sources
- Background script caches Tier 3 results (1 hour TTL)
- "Search more sources" button triggers Tier 3 search
- "Related Topics" section displays grouped search results
- Works on articles without Wikidata (direct to Tier 3)
- arXiv rate limiting respected (3+ second delay)
