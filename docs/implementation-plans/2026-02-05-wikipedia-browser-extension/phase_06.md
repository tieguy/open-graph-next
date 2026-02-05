# Phase 6: Data Quality Surface

**Goal:** Display editing opportunities for missing/broken links

**Dependencies:** Phase 4 (Tier 2), Phase 5 (Tier 3)

---

### Task 1: Create Data Quality Detection Module

**Files:**
- Create: `extension/utils/data-quality.js`

**Step 1: Create data-quality.js**

Create `extension/utils/data-quality.js`:

```javascript
// Data Quality Detection Module
// Identifies missing identifiers and broken links

/**
 * Types of data quality issues
 */
export const ISSUE_TYPES = {
  MISSING_IDENTIFIER: 'missing_identifier',
  BROKEN_LINK: 'broken_link',
  NO_WIKIDATA: 'no_wikidata'
};

/**
 * Wikidata properties for each source
 */
const SOURCE_PROPERTIES = {
  openlibrary: { property: 'P648', label: 'OpenLibrary ID' },
  internet_archive: { property: 'P724', label: 'Internet Archive ID' },
  viaf: { property: 'P214', label: 'VIAF ID' },
  gbif: { property: 'P846', label: 'GBIF taxon ID' },
  inaturalist: { property: 'P3151', label: 'iNaturalist taxon ID' }
};

/**
 * Generate Wikidata edit URL for adding a property
 * @param {string} qid - Wikidata entity ID
 * @param {string} property - Property ID (e.g., "P648")
 * @returns {string} URL to Wikidata edit interface
 */
function getWikidataEditUrl(qid, property) {
  return `https://www.wikidata.org/wiki/${qid}#${property}`;
}

/**
 * Generate OpenLibrary merge URL
 * @returns {string} URL to OpenLibrary merge tool
 */
function getOpenLibraryMergeUrl() {
  return 'https://openlibrary.org/merges';
}

/**
 * Detect missing identifiers (found in Tier 3 but not in Wikidata)
 * @param {Object} tier2Results - Results from Tier 2 queries
 * @param {Object} tier3Results - Results from Tier 3 search
 * @param {string} qid - Wikidata entity ID
 * @returns {Array} Array of missing identifier issues
 */
export function detectMissingIdentifiers(tier2Results, tier3Results, qid) {
  const issues = [];

  if (!tier3Results?.successful) return issues;

  // Sources that had no Tier 2 result (no identifier in Wikidata)
  // but DID have Tier 3 results (found via search)
  const tier2Sources = new Set(Object.keys(tier2Results?.successful || {}));

  for (const [sourceType, results] of Object.entries(tier3Results.successful)) {
    // Only flag sources that support identifier linking
    const sourceInfo = SOURCE_PROPERTIES[sourceType];
    if (!sourceInfo) continue;

    // If we found results in Tier 3 but not Tier 2, the identifier is missing
    if (!tier2Sources.has(sourceType) && results.length > 0) {
      issues.push({
        type: ISSUE_TYPES.MISSING_IDENTIFIER,
        source: sourceType,
        property: sourceInfo.property,
        propertyLabel: sourceInfo.label,
        message: `Found in ${results[0].sourceConfig?.name || sourceType} but Wikidata lacks ${sourceInfo.label}`,
        editUrl: qid ? getWikidataEditUrl(qid, sourceInfo.property) : null,
        foundResults: results.slice(0, 3) // Show up to 3 potential matches
      });
    }
  }

  return issues;
}

/**
 * Detect broken links (identifier in Wikidata but 404 from source)
 * @param {Object} tier2Results - Results from Tier 2 queries
 * @param {Object} identifiers - Original identifiers from Wikidata
 * @param {string} qid - Wikidata entity ID
 * @returns {Array} Array of broken link issues
 */
export function detectBrokenLinks(tier2Results, identifiers, qid) {
  const issues = [];

  if (!tier2Results?.failed) return issues;

  for (const [sourceType, errorMessage] of Object.entries(tier2Results.failed)) {
    // Check if this was a "not found" error (404)
    if (errorMessage === 'Not found' || errorMessage.includes('404')) {
      const identifier = identifiers[sourceType];
      const sourceInfo = SOURCE_PROPERTIES[sourceType];

      if (identifier && sourceInfo) {
        issues.push({
          type: ISSUE_TYPES.BROKEN_LINK,
          source: sourceType,
          property: sourceInfo.property,
          propertyLabel: sourceInfo.label,
          identifierValue: identifier.value,
          message: `Wikidata references ${sourceInfo.label} "${identifier.value}" but it no longer exists`,
          editUrl: qid ? getWikidataEditUrl(qid, sourceInfo.property) : null
        });
      }
    }
  }

  return issues;
}

/**
 * Detect if article is not linked to Wikidata
 * @param {string|null} qid - Wikidata entity ID (null if not linked)
 * @param {string} articleTitle - Wikipedia article title
 * @param {string} articleUrl - Wikipedia article URL
 * @returns {Object|null} Issue object or null
 */
export function detectNoWikidata(qid, articleTitle, articleUrl) {
  if (qid) return null;

  // Extract language code from URL
  const langMatch = articleUrl?.match(/https?:\/\/(\w+)\.wikipedia\.org/);
  const lang = langMatch ? langMatch[1] : 'en';

  return {
    type: ISSUE_TYPES.NO_WIKIDATA,
    message: 'This Wikipedia article is not linked to Wikidata',
    editUrl: `https://www.wikidata.org/wiki/Special:NewItem?site=${lang}wiki&page=${encodeURIComponent(articleTitle)}`,
    articleTitle,
    articleUrl
  };
}

/**
 * Get all data quality issues
 * @param {Object} params - Parameters
 * @returns {Array} All detected issues
 */
export function getAllIssues({
  qid,
  articleTitle,
  articleUrl,
  identifiers,
  tier2Results,
  tier3Results
}) {
  const issues = [];

  // Check for no Wikidata link
  const noWikidataIssue = detectNoWikidata(qid, articleTitle, articleUrl);
  if (noWikidataIssue) {
    issues.push(noWikidataIssue);
    return issues; // If no Wikidata, other checks don't apply
  }

  // Check for broken links
  const brokenLinks = detectBrokenLinks(tier2Results, identifiers, qid);
  issues.push(...brokenLinks);

  // Check for missing identifiers
  const missingIds = detectMissingIdentifiers(tier2Results, tier3Results, qid);
  issues.push(...missingIds);

  return issues;
}
```

**Step 2: Verify syntax**

```bash
node --check extension/utils/data-quality.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add extension/utils/data-quality.js
git commit -m "feat(extension): add data quality detection module"
```

---

### Task 2: Update Background Script to Track Issues

**Files:**
- Modify: `extension/background.js`

**Step 1: Update background.js to detect and broadcast issues**

Replace the entire contents of `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing and API orchestration for tiered loading

import { fetchEntity, getIdentifierUrl } from './api/wikidata.js';
import { querySourcesByIdentifiers, searchSourcesByKeyword, getSourceConfig } from './api/sources.js';
import { getCached, setCache } from './utils/cache.js';
import { getAllIssues, detectBrokenLinks, detectMissingIdentifiers } from './utils/data-quality.js';

console.log('Jenifesto background script loaded');

// Cache TTLs
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const SOURCE_CACHE_TTL = 1 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL = 1 * 60 * 60 * 1000;

// Current state
let currentPage = null;
let currentEntity = null;
let currentTier2Results = null;
let currentTier3Results = null;

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
      const excludeSources = Object.keys(currentTier2Results?.successful || {});
      performTier3Search(message.query, excludeSources).then(
        results => sendResponse({ results }),
        error => sendResponse({ error: error.message })
      );
      return true;

    case 'GET_DATA_QUALITY_ISSUES':
      const issues = computeDataQualityIssues();
      sendResponse({ issues });
      return;
  }
});

/**
 * Handle page loaded message from content script
 */
async function handlePageLoaded(message) {
  // Reset state
  currentPage = {
    title: message.title,
    url: message.url,
    qid: message.qid,
    timestamp: Date.now()
  };
  currentEntity = null;
  currentTier2Results = null;
  currentTier3Results = null;

  await browser.storage.local.set({ currentPage });
  broadcastMessage({ type: 'PAGE_UPDATED', page: currentPage });

  if (currentPage.qid) {
    try {
      // Tier 1: Fetch Wikidata
      currentEntity = await fetchWikidataForPage(currentPage.qid);
      broadcastMessage({ type: 'WIKIDATA_LOADED', entity: currentEntity });

      // Tier 2: Query sources with identifiers
      if (Object.keys(currentEntity.identifiers).length > 0) {
        broadcastMessage({ type: 'TIER2_LOADING' });

        currentTier2Results = await fetchTier2Results(currentPage.qid, currentEntity.identifiers);
        broadcastMessage({ type: 'TIER2_LOADED', results: currentTier2Results });

        // Check for broken links immediately
        const brokenLinkIssues = detectBrokenLinks(
          currentTier2Results,
          currentEntity.identifiers,
          currentPage.qid
        );
        if (brokenLinkIssues.length > 0) {
          broadcastMessage({ type: 'DATA_QUALITY_ISSUES', issues: brokenLinkIssues });
        }
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      broadcastMessage({ type: 'LOAD_ERROR', error: error.message });
    }
  } else {
    // No Wikidata - broadcast that as an issue
    broadcastMessage({
      type: 'DATA_QUALITY_ISSUES',
      issues: [{
        type: 'no_wikidata',
        message: 'This Wikipedia article is not linked to Wikidata',
        editUrl: `https://www.wikidata.org/wiki/Special:NewItem?site=enwiki&page=${encodeURIComponent(currentPage.title)}`,
        articleTitle: currentPage.title
      }]
    });
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
    currentTier3Results = cached;
    checkForMissingIdentifiers();
    return cached;
  }

  console.log('Tier 3 cache miss, searching:', query);
  const results = await searchSourcesByKeyword(query, excludeSources, 5);

  for (const [type, items] of Object.entries(results.successful)) {
    const config = getSourceConfig(type);
    for (const item of items) {
      item.sourceConfig = config;
    }
  }

  await setCache(cacheKey, results, SEARCH_CACHE_TTL);
  currentTier3Results = results;

  // Check for missing identifiers after Tier 3 completes
  checkForMissingIdentifiers();

  return results;
}

/**
 * Check for missing identifiers after Tier 3 search
 */
function checkForMissingIdentifiers() {
  if (!currentTier3Results || !currentPage?.qid) return;

  const missingIdIssues = detectMissingIdentifiers(
    currentTier2Results,
    currentTier3Results,
    currentPage.qid
  );

  if (missingIdIssues.length > 0) {
    broadcastMessage({ type: 'DATA_QUALITY_ISSUES', issues: missingIdIssues });
  }
}

/**
 * Compute all current data quality issues
 */
function computeDataQualityIssues() {
  return getAllIssues({
    qid: currentPage?.qid,
    articleTitle: currentPage?.title,
    articleUrl: currentPage?.url,
    identifiers: currentEntity?.identifiers || {},
    tier2Results: currentTier2Results,
    tier3Results: currentTier3Results
  });
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
git commit -m "feat(extension): background script detects and broadcasts data quality issues"
```

---

### Task 3: Update Sidebar with Data Quality Section

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.html with data quality section**

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

    <section id="data-quality-section" class="section hidden">
      <h2 class="section-title">Improve This Data</h2>
      <p class="section-subtitle">Help connect the knowledge graph</p>
      <div id="data-quality-list" class="data-quality-list"></div>
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

**Step 2: Update panel.css with data quality styles**

Add the following to the end of `extension/sidebar/panel.css`:

```css
/* Data Quality Section */
.data-quality-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quality-issue {
  background-color: var(--warning-yellow);
  border: 1px solid var(--warning-border);
  border-radius: 6px;
  padding: 10px 12px;
}

.quality-issue-broken {
  background-color: #fef2f2;
  border-color: #fecaca;
}

.quality-issue-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.quality-issue-icon {
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}

.quality-issue-content {
  flex: 1;
  min-width: 0;
}

.quality-issue-message {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 6px;
}

.quality-issue-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent-blue);
  text-decoration: none;
  padding: 4px 8px;
  background-color: rgba(26, 84, 144, 0.1);
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

.quality-issue-action:hover {
  background-color: rgba(26, 84, 144, 0.2);
}

.quality-issue-matches {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}

.quality-issue-matches-label {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.quality-issue-match {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quality-issue-match a {
  color: var(--accent-blue);
  text-decoration: none;
}

.quality-issue-match a:hover {
  text-decoration: underline;
}
```

**Step 3: Update panel.js to display data quality issues**

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
const dataQualitySectionEl = document.getElementById('data-quality-section');
const dataQualityListEl = document.getElementById('data-quality-list');
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
let dataQualityIssues = [];

function hideAllSections() {
  wikidataSectionEl.classList.add('hidden');
  identifiersSectionEl.classList.add('hidden');
  sameEntitySectionEl.classList.add('hidden');
  relatedTopicsSectionEl.classList.add('hidden');
  searchMoreSectionEl.classList.add('hidden');
  dataQualitySectionEl.classList.add('hidden');
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
  dataQualityIssues = [];

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

  if (!tier3Loaded) {
    searchMoreSectionEl.classList.remove('hidden');
  }
}

function displayTier3Results(results) {
  loadingSectionEl.classList.add('hidden');
  searchMoreSectionEl.classList.add('hidden');
  tier3Loaded = true;

  const successfulSources = Object.entries(results.successful);
  if (successfulSources.length === 0) return;

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

function displayDataQualityIssues(issues) {
  // Merge with existing issues, avoiding duplicates
  for (const issue of issues) {
    const exists = dataQualityIssues.some(
      i => i.type === issue.type && i.source === issue.source
    );
    if (!exists) {
      dataQualityIssues.push(issue);
    }
  }

  if (dataQualityIssues.length === 0) return;

  dataQualitySectionEl.classList.remove('hidden');
  dataQualityListEl.innerHTML = dataQualityIssues.map(issue => {
    const isBroken = issue.type === 'broken_link';
    const icon = isBroken ? '⚠️' : '💡';

    let matchesHtml = '';
    if (issue.foundResults && issue.foundResults.length > 0) {
      matchesHtml = `
        <div class="quality-issue-matches">
          <div class="quality-issue-matches-label">Potential matches found:</div>
          ${issue.foundResults.map(r => `
            <div class="quality-issue-match">
              <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
            </div>
          `).join('')}
        </div>
      `;
    }

    return `
      <div class="quality-issue ${isBroken ? 'quality-issue-broken' : ''}">
        <div class="quality-issue-header">
          <span class="quality-issue-icon">${icon}</span>
          <div class="quality-issue-content">
            <div class="quality-issue-message">${escapeHtml(issue.message)}</div>
            ${issue.editUrl ? `
              <a href="${escapeHtml(issue.editUrl)}" target="_blank" rel="noopener" class="quality-issue-action">
                Edit on Wikidata →
              </a>
            ` : ''}
            ${matchesHtml}
          </div>
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

  showLoading('Searching more sources...');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SEARCH_TIER3',
      query: currentPage.title
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

    // Get any existing data quality issues
    const issuesResponse = await browser.runtime.sendMessage({ type: 'GET_DATA_QUALITY_ISSUES' });
    if (issuesResponse.issues?.length > 0) {
      displayDataQualityIssues(issuesResponse.issues);
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
    case 'DATA_QUALITY_ISSUES':
      displayDataQualityIssues(message.issues);
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
git commit -m "feat(extension): sidebar displays data quality issues with edit links"
```

---

### Task 4: Test Data Quality Features

**Step 1: Reload extension**

1. Go to `about:debugging`
2. Reload Jenifesto extension

**Step 2: Test broken link detection**

This requires finding or simulating a Wikidata entry with a broken external identifier (rare in practice).

**Step 3: Test missing identifier detection**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Open sidebar
3. Click "Search more sources"
4. Wait for Tier 3 to complete

Expected:
- If any Tier 3 source finds results for a source that wasn't in Tier 2
- "Improve This Data" section appears
- Shows which identifier is missing
- Shows potential matches found
- "Edit on Wikidata" link opens Wikidata property page

**Step 4: Test no-Wikidata article**

Find an article without Wikidata (difficult but they exist).

Expected:
- "Not linked to Wikidata" notice
- Data quality section shows option to create Wikidata item

---

### Phase 6 Complete

**Done when:**
- Data quality detection module identifies missing identifiers and broken links
- Background script tracks issues and broadcasts to sidebar
- "Improve This Data" section displays all detected issues
- Missing identifier issues show potential matches from Tier 3
- Broken link issues show warning style
- "Edit on Wikidata" links open correct property pages
- Issues update incrementally as data loads
