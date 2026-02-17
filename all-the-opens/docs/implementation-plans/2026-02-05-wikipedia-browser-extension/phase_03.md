# Phase 3: Tier 1 - Wikidata Query

**Goal:** Fetch entity data from Wikidata and display identifiers

**Dependencies:** Phase 2 (Q-ID extraction)

---

### Task 1: Create Wikidata API Module

**Files:**
- Create: `extension/api/wikidata.js`

**Step 1: Create api directory**

```bash
mkdir -p extension/api
```

**Step 2: Create wikidata.js**

Create `extension/api/wikidata.js`:

```javascript
// Wikidata API Module
// Fetches entity data and extracts external identifiers

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

// Map of Wikidata property IDs to identifier names
const IDENTIFIER_PROPERTIES = {
  P214: { name: 'viaf', label: 'VIAF' },
  P244: { name: 'lccn', label: 'Library of Congress' },
  P648: { name: 'openlibrary', label: 'OpenLibrary' },
  P724: { name: 'internet_archive', label: 'Internet Archive' },
  P227: { name: 'gnd', label: 'GND' },
  P213: { name: 'isni', label: 'ISNI' },
  P496: { name: 'orcid', label: 'ORCID' },
  P846: { name: 'gbif', label: 'GBIF' },
  P3151: { name: 'inaturalist', label: 'iNaturalist' },
  P245: { name: 'ulan', label: 'ULAN' },
  P1566: { name: 'geonames', label: 'GeoNames' },
  P625: { name: 'coordinates', label: 'Coordinates' }
};

/**
 * Fetch entity data from Wikidata
 * @param {string} qid - Wikidata entity ID (e.g., "Q43656")
 * @returns {Promise<Object>} Entity data with labels, descriptions, and identifiers
 */
export async function fetchEntity(qid) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'labels|descriptions|claims|sitelinks',
    languages: 'en',
    format: 'json',
    origin: '*'
  });

  const response = await fetch(`${WIKIDATA_API}?${params}`, {
    headers: {
      'User-Agent': 'Jenifesto/0.1 (browser extension)'
    }
  });

  if (!response.ok) {
    throw new Error(`Wikidata API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Wikidata API error: ${data.error.info}`);
  }

  const entity = data.entities[qid];
  if (!entity || entity.missing) {
    throw new Error(`Entity not found: ${qid}`);
  }

  return parseEntity(entity);
}

/**
 * Parse raw Wikidata entity into structured data
 * @param {Object} entity - Raw entity from API
 * @returns {Object} Parsed entity data
 */
function parseEntity(entity) {
  const result = {
    id: entity.id,
    label: entity.labels?.en?.value || entity.id,
    description: entity.descriptions?.en?.value || null,
    identifiers: {},
    sitelinks: {}
  };

  // Extract external identifiers from claims
  if (entity.claims) {
    for (const [propId, propInfo] of Object.entries(IDENTIFIER_PROPERTIES)) {
      const claims = entity.claims[propId];
      if (claims && claims.length > 0) {
        const value = claims[0].mainsnak?.datavalue?.value;
        if (value) {
          // Handle different value types
          if (typeof value === 'string') {
            result.identifiers[propInfo.name] = {
              value: value,
              label: propInfo.label,
              property: propId
            };
          } else if (value.id) {
            // Wikibase entity reference
            result.identifiers[propInfo.name] = {
              value: value.id,
              label: propInfo.label,
              property: propId
            };
          } else if (value.latitude && value.longitude) {
            // Coordinates
            result.identifiers[propInfo.name] = {
              value: `${value.latitude},${value.longitude}`,
              label: propInfo.label,
              property: propId
            };
          }
        }
      }
    }
  }

  // Extract Wikipedia sitelinks
  if (entity.sitelinks) {
    for (const [site, link] of Object.entries(entity.sitelinks)) {
      if (site.endsWith('wiki') && !site.includes('quote') && !site.includes('source')) {
        result.sitelinks[site] = link.title;
      }
    }
  }

  return result;
}

/**
 * Get URL for an identifier
 * @param {string} type - Identifier type (e.g., "viaf", "openlibrary")
 * @param {string} value - Identifier value
 * @returns {string|null} URL or null if no URL pattern exists
 */
export function getIdentifierUrl(type, value) {
  const urlPatterns = {
    viaf: (id) => `https://viaf.org/viaf/${id}`,
    lccn: (id) => `https://id.loc.gov/authorities/names/${id}`,
    openlibrary: (id) => `https://openlibrary.org/works/${id}`,
    internet_archive: (id) => `https://archive.org/details/${id}`,
    gnd: (id) => `https://d-nb.info/gnd/${id}`,
    isni: (id) => `https://isni.org/isni/${id.replace(/\s/g, '')}`,
    orcid: (id) => `https://orcid.org/${id}`,
    gbif: (id) => `https://www.gbif.org/species/${id}`,
    inaturalist: (id) => `https://www.inaturalist.org/taxa/${id}`,
    ulan: (id) => `https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid=${id}`,
    geonames: (id) => `https://www.geonames.org/${id}`
  };

  const pattern = urlPatterns[type];
  return pattern ? pattern(value) : null;
}
```

**Step 3: Verify syntax**

```bash
node --check extension/api/wikidata.js
```

Expected: No output (valid syntax)

**Step 4: Commit**

```bash
git add extension/api/
git commit -m "feat(extension): add Wikidata API module for entity fetching"
```

---

### Task 2: Create Cache Module

**Files:**
- Create: `extension/utils/cache.js`

**Step 1: Create utils directory**

```bash
mkdir -p extension/utils
```

**Step 2: Create cache.js**

Create `extension/utils/cache.js`:

```javascript
// Cache Module
// Handles caching with TTL (Time To Live) using browser.storage.local

const CACHE_PREFIX = 'cache_';
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Get a cached value if it exists and hasn't expired
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null if expired/missing
 */
export async function getCached(key) {
  const cacheKey = CACHE_PREFIX + key;

  try {
    const result = await browser.storage.local.get(cacheKey);
    const cached = result[cacheKey];

    if (!cached) {
      return null;
    }

    // Check if expired
    if (cached.expiry && Date.now() > cached.expiry) {
      // Clean up expired entry
      await browser.storage.local.remove(cacheKey);
      return null;
    }

    return cached.value;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * Store a value in cache with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in milliseconds (default: 24 hours)
 */
export async function setCache(key, value, ttl = DEFAULT_TTL) {
  const cacheKey = CACHE_PREFIX + key;

  try {
    await browser.storage.local.set({
      [cacheKey]: {
        value: value,
        expiry: Date.now() + ttl,
        cached: Date.now()
      }
    });
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Remove a cached value
 * @param {string} key - Cache key
 */
export async function removeCache(key) {
  const cacheKey = CACHE_PREFIX + key;
  try {
    await browser.storage.local.remove(cacheKey);
  } catch (error) {
    console.error('Cache remove error:', error);
  }
}

/**
 * Clear all cached values
 */
export async function clearCache() {
  try {
    const all = await browser.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await browser.storage.local.remove(cacheKeys);
    }
  } catch (error) {
    console.error('Cache clear error:', error);
  }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache stats
 */
export async function getCacheStats() {
  try {
    const all = await browser.storage.local.get(null);
    const cacheEntries = Object.entries(all).filter(([k]) => k.startsWith(CACHE_PREFIX));

    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const [, entry] of cacheEntries) {
      if (entry.expiry && now > entry.expiry) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: cacheEntries.length,
      valid: validCount,
      expired: expiredCount
    };
  } catch (error) {
    console.error('Cache stats error:', error);
    return { total: 0, valid: 0, expired: 0 };
  }
}
```

**Step 3: Verify syntax**

```bash
node --check extension/utils/cache.js
```

Expected: No output (valid syntax)

**Step 4: Commit**

```bash
git add extension/utils/
git commit -m "feat(extension): add cache module with TTL support"
```

---

### Task 3: Update Background Script to Fetch Wikidata

**Files:**
- Modify: `extension/background.js`

**Step 1: Update background.js to use Wikidata API**

Replace the entire contents of `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing and API orchestration

import { fetchEntity, getIdentifierUrl } from './api/wikidata.js';
import { getCached, setCache } from './utils/cache.js';

console.log('Jenifesto background script loaded');

// Cache TTLs
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Current page state
let currentPage = null;

// Listen for messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message.type);

  if (message.type === 'WIKIPEDIA_PAGE_LOADED') {
    handlePageLoaded(message).then(sendResponse);
    return true; // Async response
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
    return true; // Async response
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

  // Store in local storage for persistence
  await browser.storage.local.set({ currentPage });

  // Notify sidebar
  browser.runtime.sendMessage({
    type: 'PAGE_UPDATED',
    page: currentPage
  }).catch(() => {});

  // If we have a Q-ID, start fetching Wikidata
  if (currentPage.qid) {
    try {
      const wikidataEntity = await fetchWikidataForPage(currentPage.qid);

      // Notify sidebar with Wikidata
      browser.runtime.sendMessage({
        type: 'WIKIDATA_LOADED',
        entity: wikidataEntity
      }).catch(() => {});
    } catch (error) {
      console.error('Failed to fetch Wikidata:', error);
      browser.runtime.sendMessage({
        type: 'WIKIDATA_ERROR',
        error: error.message
      }).catch(() => {});
    }
  }

  return { success: true };
}

/**
 * Fetch Wikidata entity with caching
 */
async function fetchWikidataForPage(qid) {
  const cacheKey = `wikidata_${qid}`;

  // Check cache first
  const cached = await getCached(cacheKey);
  if (cached) {
    console.log('Wikidata cache hit:', qid);
    return cached;
  }

  console.log('Wikidata cache miss, fetching:', qid);

  // Fetch from API
  const entity = await fetchEntity(qid);

  // Add URLs to identifiers
  for (const [type, info] of Object.entries(entity.identifiers)) {
    info.url = getIdentifierUrl(type, info.value);
  }

  // Cache the result
  await setCache(cacheKey, entity, WIKIDATA_CACHE_TTL);

  return entity;
}

// Restore state on startup
browser.storage.local.get('currentPage').then(result => {
  if (result.currentPage) {
    currentPage = result.currentPage;
    console.log('Restored current page:', currentPage.title);
  }
});

// Log installation
browser.runtime.onInstalled.addListener((details) => {
  console.log('Jenifesto installed:', details.reason);
});
```

**Step 2: Update manifest.json for ES modules**

The background script now uses ES modules. Update `extension/manifest.json` background section:

```json
{
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  }
}
```

Edit `extension/manifest.json` to add `"type": "module"` to the background section.

**Step 3: Verify syntax**

```bash
node --check extension/background.js
```

Expected: No output (valid syntax)

**Step 4: Commit**

```bash
git add extension/background.js extension/manifest.json
git commit -m "feat(extension): background script fetches and caches Wikidata entities"
```

---

### Task 4: Update Sidebar to Display Identifiers

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.html with identifier list structure**

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
      <div id="identifiers-list" class="identifiers-list">
        <!-- Identifiers will be populated here -->
      </div>
    </section>

    <section id="loading-section" class="section hidden">
      <div class="loading">
        <span class="loading-spinner"></span>
        <span class="loading-text">Loading Wikidata...</span>
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

**Step 2: Update panel.css with identifier styles**

Add the following to the end of `extension/sidebar/panel.css`:

```css
/* Entity header */
.entity-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.entity-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.entity-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

/* Identifiers list */
.identifiers-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.identifier-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-secondary);
  border-radius: 4px;
  padding: 8px 10px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.15s ease;
}

.identifier-item:hover {
  background-color: var(--bg-tertiary);
}

.identifier-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.identifier-value {
  font-family: monospace;
  font-size: 11px;
  color: var(--accent-blue);
}

/* Loading */
.loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 13px;
}

/* Error notice */
.notice-error {
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
```

**Step 3: Update panel.js to display Wikidata entity and identifiers**

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
const loadingSectionEl = document.getElementById('loading-section');
const noWikidataEl = document.getElementById('no-wikidata');
const errorSectionEl = document.getElementById('error-section');
const errorMessageEl = document.getElementById('error-message');

// Hide all dynamic sections
function hideAllSections() {
  wikidataSectionEl.classList.add('hidden');
  identifiersSectionEl.classList.add('hidden');
  loadingSectionEl.classList.add('hidden');
  noWikidataEl.classList.add('hidden');
  errorSectionEl.classList.add('hidden');
}

// Update the page info display
function updatePageInfo(page) {
  if (!page) {
    pageInfoEl.innerHTML = '<p class="placeholder">Navigate to a Wikipedia article to begin exploring.</p>';
    hideAllSections();
    return;
  }

  pageInfoEl.innerHTML = `
    <div class="page-title">${escapeHtml(page.title)}</div>
  `;

  if (page.qid) {
    // Show loading while we wait for Wikidata
    hideAllSections();
    loadingSectionEl.classList.remove('hidden');
  } else {
    hideAllSections();
    noWikidataEl.classList.remove('hidden');
  }
}

// Display Wikidata entity
function displayWikidataEntity(entity) {
  hideAllSections();

  // Show entity section
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

// Display error
function displayError(message) {
  hideAllSections();
  errorSectionEl.classList.remove('hidden');
  errorMessageEl.textContent = message;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Request current page data from background script
async function loadCurrentPage() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_CURRENT_PAGE' });
    console.log('Jenifesto sidebar: Got page data:', response);
    updatePageInfo(response.page);

    // If we have a Q-ID, request Wikidata
    if (response.page?.qid) {
      const wikidataResponse = await browser.runtime.sendMessage({ type: 'GET_WIKIDATA' });
      if (wikidataResponse.data) {
        displayWikidataEntity(wikidataResponse.data);
      } else if (wikidataResponse.error) {
        displayError(wikidataResponse.error);
      }
    }
  } catch (error) {
    console.error('Jenifesto sidebar: Failed to get page data:', error);
    updatePageInfo(null);
  }
}

// Listen for updates from background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Jenifesto sidebar: Received message:', message.type);

  if (message.type === 'PAGE_UPDATED') {
    updatePageInfo(message.page);
  }

  if (message.type === 'WIKIDATA_LOADED') {
    displayWikidataEntity(message.entity);
  }

  if (message.type === 'WIKIDATA_ERROR') {
    displayError(message.error);
  }
});

// Load data when panel opens
loadCurrentPage();
```

**Step 4: Verify all files**

```bash
node --check extension/sidebar/panel.js
```

Expected: No output (valid syntax)

**Step 5: Commit**

```bash
git add extension/sidebar/
git commit -m "feat(extension): sidebar displays Wikidata entity and identifiers"
```

---

### Task 5: Test Wikidata Integration

**Step 1: Reload extension in Firefox**

1. Go to `about:debugging`
2. Click "Reload" on the Jenifesto extension

**Step 2: Test on Wikipedia article**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Open sidebar

Expected:
- Loading spinner shows briefly
- Wikidata section shows "Apollo 11" label with Q43656 badge
- Description shows Wikidata description
- Identifiers section shows available identifiers (if any)

**Step 3: Test caching**

1. Close and reopen sidebar
2. Navigate to same article

Expected:
- Data loads instantly (from cache)
- Console shows "Wikidata cache hit"

**Step 4: Test on article with many identifiers**

1. Navigate to https://en.wikipedia.org/wiki/Neil_Armstrong

Expected:
- Multiple identifiers displayed (VIAF, Library of Congress, etc.)
- Each identifier is clickable and links to source

---

### Phase 3 Complete

**Done when:**
- Wikidata API module fetches entity data correctly
- Cache module stores data with 24-hour TTL
- Background script coordinates fetching and caching
- Sidebar displays entity label, description, and Q-ID
- Sidebar displays all available identifiers as clickable links
- Loading state shows while fetching
- Cached data loads instantly on repeat visits
