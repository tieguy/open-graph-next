# Phase 7: Polish and Error Handling

**Goal:** Robust error states, visual refinement

**Dependencies:** Phase 6 (data quality)

---

### Task 1: Add Per-Source Error States with Retry

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.css with error state styles**

Add the following to the end of `extension/sidebar/panel.css`:

```css
/* Source error state */
.source-error {
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.source-error-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.source-error-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.source-error-text {
  font-size: 12px;
  color: #991b1b;
}

.source-error-name {
  font-weight: 500;
}

.retry-btn {
  font-size: 11px;
  padding: 4px 8px;
  background-color: white;
  border: 1px solid #fecaca;
  border-radius: 4px;
  color: #991b1b;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s ease;
}

.retry-btn:hover {
  background-color: #fef2f2;
}

.retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Offline notice */
.offline-notice {
  background-color: var(--warning-yellow);
  border: 1px solid var(--warning-border);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.offline-notice-icon {
  font-size: 16px;
}

.offline-notice-text {
  font-size: 12px;
  color: var(--text-primary);
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 24px 16px;
  color: var(--text-muted);
}

.empty-state-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-state-text {
  font-size: 13px;
}

/* Smooth transitions */
.section {
  transition: opacity 0.2s ease;
}

.section.loading {
  opacity: 0.6;
}

/* Result card hover improvements */
.result-card,
.result-card-compact {
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.result-card:active,
.result-card-compact:active {
  transform: scale(0.98);
}

/* Thumbnail loading state */
.result-thumbnail {
  background-color: var(--bg-tertiary);
}

.result-thumbnail[src] {
  background-color: transparent;
}

/* Badge improvements */
.qid-badge {
  transition: background-color 0.15s ease;
}

/* Collapsible sections */
.section-header-collapsible {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
  margin: -4px 0;
}

.section-header-collapsible:hover .section-title {
  color: var(--text-secondary);
}

.collapse-icon {
  font-size: 10px;
  color: var(--text-muted);
  transition: transform 0.2s ease;
}

.section.collapsed .collapse-icon {
  transform: rotate(-90deg);
}

.section.collapsed .section-content {
  display: none;
}

/* Scrollbar styling */
.content::-webkit-scrollbar {
  width: 6px;
}

.content::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

.content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.content::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
```

**Step 2: Update panel.js with error handling and retry**

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
let tier2Errors = {};
let tier3Loaded = false;
let dataQualityIssues = [];
let isOnline = navigator.onLine;

// Online/offline detection
window.addEventListener('online', () => {
  isOnline = true;
  updateOfflineNotice();
});

window.addEventListener('offline', () => {
  isOnline = false;
  updateOfflineNotice();
});

function updateOfflineNotice() {
  const existing = document.querySelector('.offline-notice');
  if (!isOnline && !existing) {
    const notice = document.createElement('div');
    notice.className = 'offline-notice';
    notice.innerHTML = `
      <span class="offline-notice-icon">📡</span>
      <span class="offline-notice-text">You're offline. Showing cached results only.</span>
    `;
    document.querySelector('.content').prepend(notice);
  } else if (isOnline && existing) {
    existing.remove();
  }
}

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
  tier2Errors = {};
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

  updateOfflineNotice();
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
  tier2Errors = results.failed || {};

  // Show successful results
  if (successfulSources.length > 0) {
    sameEntitySectionEl.classList.remove('hidden');
    sameEntityListEl.innerHTML = successfulSources.map(([sourceType, data]) =>
      renderResultCard(data, false)
    ).join('');
  }

  // Show errors with retry buttons (only for network errors, not 404s)
  const retryableErrors = Object.entries(tier2Errors).filter(
    ([, msg]) => !msg.includes('Not found') && !msg.includes('404')
  );

  if (retryableErrors.length > 0) {
    const errorHtml = retryableErrors.map(([source, message]) => `
      <div class="source-error" data-source="${escapeHtml(source)}">
        <div class="source-error-info">
          <span class="source-error-text">
            <span class="source-error-name">${escapeHtml(source)}</span>: Failed to load
          </span>
        </div>
        <button class="retry-btn" data-source="${escapeHtml(source)}" data-tier="2">
          Retry
        </button>
      </div>
    `).join('');

    // Append errors after results
    if (successfulSources.length > 0) {
      sameEntityListEl.innerHTML += errorHtml;
    } else {
      sameEntitySectionEl.classList.remove('hidden');
      sameEntityListEl.innerHTML = errorHtml;
    }
  }

  // Show empty state if nothing found and no errors
  if (successfulSources.length === 0 && retryableErrors.length === 0) {
    // Check if all results were 404s (not found is okay, not an error)
    const all404 = Object.values(tier2Errors).every(
      msg => msg.includes('Not found') || msg.includes('404')
    );
    if (!all404 && Object.keys(tier2Errors).length > 0) {
      // Some errors occurred
    }
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

  if (successfulSources.length === 0) {
    // Show empty state
    relatedTopicsSectionEl.classList.remove('hidden');
    relatedTopicsListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">No related resources found</div>
      </div>
    `;
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

  // Show any Tier 3 errors
  const tier3Errors = Object.entries(results.failed || {});
  if (tier3Errors.length > 0) {
    relatedTopicsListEl.innerHTML += tier3Errors.map(([source, message]) => `
      <div class="source-error" data-source="${escapeHtml(source)}">
        <div class="source-error-info">
          <span class="source-error-text">
            <span class="source-error-name">${escapeHtml(source)}</span>: Failed to search
          </span>
        </div>
        <button class="retry-btn" data-source="${escapeHtml(source)}" data-tier="3">
          Retry
        </button>
      </div>
    `).join('');
  }
}

function displayDataQualityIssues(issues) {
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
        ? `<img src="${escapeHtml(data.thumbnail)}" alt="" class="result-thumbnail" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="result-thumbnail-placeholder">
            ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="" onerror="this.style.display='none'">` : ''}
          </div>`
      }
      <div class="result-content">
        <div class="result-title">${escapeHtml(data.title)}</div>
        ${data.description ? `<div class="result-description">${escapeHtml(data.description)}</div>` : ''}
        ${!compact ? `
          <div class="result-source">
            ${config.icon ? `<img src="${escapeHtml(config.icon)}" alt="" class="result-source-icon" onerror="this.style.display='none'">` : ''}
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
  searchMoreBtn.disabled = true;

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
    displayError('Search failed. Please try again.');
  } finally {
    searchMoreBtn.disabled = false;
  }
}

// Event delegation for retry buttons
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('retry-btn')) {
    const source = e.target.dataset.source;
    const tier = e.target.dataset.tier;

    e.target.disabled = true;
    e.target.textContent = 'Retrying...';

    try {
      if (tier === '2' && currentEntity) {
        const response = await browser.runtime.sendMessage({
          type: 'GET_TIER2_RESULTS',
          identifiers: currentEntity.identifiers
        });
        if (response.results) {
          displayTier2Results(response.results);
        }
      } else if (tier === '3' && currentPage) {
        const response = await browser.runtime.sendMessage({
          type: 'SEARCH_TIER3',
          query: currentPage.title
        });
        if (response.results) {
          displayTier3Results(response.results);
        }
      }
    } catch (error) {
      console.error('Retry failed:', error);
      e.target.textContent = 'Failed';
      setTimeout(() => {
        e.target.textContent = 'Retry';
        e.target.disabled = false;
      }, 2000);
    }
  }
});

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

**Step 3: Verify syntax**

```bash
node --check extension/sidebar/panel.js
```

Expected: No output (valid syntax)

**Step 4: Commit**

```bash
git add extension/sidebar/
git commit -m "feat(extension): add error states, retry buttons, offline detection, visual polish"
```

---

### Task 2: Add Source Icons

**Files:**
- Modify: `extension/api/sources.js`

**Step 1: Verify all source icons are correct**

The SOURCE_CONFIG in `extension/api/sources.js` already includes favicon URLs. Let's verify they're all valid and add fallbacks.

Update the SOURCE_CONFIG in `extension/api/sources.js` to include fallback colors for when icons fail:

```javascript
// Source display configuration with fallback colors
export const SOURCE_CONFIG = {
  openlibrary: {
    name: 'OpenLibrary',
    color: '#418541',
    icon: 'https://openlibrary.org/static/images/openlibrary-logo-tighter.svg',
    fallbackIcon: null
  },
  internet_archive: {
    name: 'Internet Archive',
    color: '#6b8cae',
    icon: 'https://archive.org/images/glogo.png',
    fallbackIcon: null
  },
  viaf: {
    name: 'VIAF',
    color: '#8b6b4e',
    icon: 'https://viaf.org/viaf/images/viaf.ico',
    fallbackIcon: null
  },
  gbif: {
    name: 'GBIF',
    color: '#4e9a47',
    icon: 'https://www.gbif.org/favicon-16x16.png',
    fallbackIcon: null
  },
  inaturalist: {
    name: 'iNaturalist',
    color: '#74ac00',
    icon: 'https://static.inaturalist.org/sites/1-favicon.ico',
    fallbackIcon: null
  },
  dpla: {
    name: 'DPLA',
    color: '#0068a6',
    icon: 'https://dp.la/static/images/dpla-icons/dpla-icon.png',
    fallbackIcon: null
  },
  arxiv: {
    name: 'arXiv',
    color: '#b31b1b',
    icon: 'https://arxiv.org/favicon.ico',
    fallbackIcon: null
  },
  wikimedia_commons: {
    name: 'Wikimedia Commons',
    color: '#006699',
    icon: 'https://commons.wikimedia.org/static/favicon/commons.ico',
    fallbackIcon: null
  },
  wikidata: {
    name: 'Wikidata',
    color: '#006699',
    icon: 'https://www.wikidata.org/static/favicon/wikidata.ico',
    fallbackIcon: null
  },
  wikipedia: {
    name: 'Wikipedia',
    color: '#000000',
    icon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico',
    fallbackIcon: null
  }
};
```

**Step 2: Commit**

```bash
git add extension/api/sources.js
git commit -m "feat(extension): improve source icon URLs"
```

---

### Task 3: Create Extension README

**Files:**
- Create: `extension/README.md`

**Step 1: Create README.md**

Create `extension/README.md`:

```markdown
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
```

**Step 2: Commit**

```bash
git add extension/README.md
git commit -m "docs(extension): add README with installation and usage instructions"
```

---

### Task 4: Final Integration Test

**Step 1: Reload extension**

1. Go to `about:debugging`
2. Reload Jenifesto extension

**Step 2: Full flow test**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Open sidebar
3. Verify Wikidata loads
4. Verify Tier 2 results appear (if identifiers exist)
5. Click "Search more sources"
6. Verify Tier 3 results appear
7. Verify data quality issues appear (if any)

**Step 3: Error handling test**

1. Disable network (in devtools or system)
2. Navigate to new article
3. Verify offline notice appears
4. Verify retry buttons work when back online

**Step 4: Navigation test**

1. Navigate between several Wikipedia articles
2. Verify sidebar updates each time
3. Verify no stale data from previous pages

**Step 5: Performance check**

1. Verify cached data loads instantly on revisit
2. Verify no excessive console errors

---

### Task 5: Final Commit

**Step 1: Commit all implementation plan files**

```bash
git add docs/implementation-plans/2026-02-05-wikipedia-browser-extension/
git commit -m "docs: complete implementation plan for Wikipedia browser extension"
```

---

### Phase 7 Complete

**Done when:**
- Per-source error states with retry buttons
- Offline detection and notice
- Empty state for no results
- Smooth transitions and hover states
- Thumbnail error handling (hidden on fail)
- Retry functionality works for both Tier 2 and Tier 3
- Source icons display correctly with fallbacks
- Extension README documents installation and usage
- Full integration test passes
- All implementation plan files committed
