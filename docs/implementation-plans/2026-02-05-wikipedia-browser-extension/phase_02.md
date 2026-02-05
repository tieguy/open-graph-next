# Phase 2: Wikidata Q-ID Extraction

**Goal:** Content script extracts Wikidata identifier from Wikipedia pages

**Dependencies:** Phase 1 (extension scaffold)

---

### Task 1: Extract Q-ID from Wikipedia Page

**Files:**
- Modify: `extension/content.js`

**Step 1: Update content.js to extract Wikidata Q-ID**

Replace the entire contents of `extension/content.js`:

```javascript
// Jenifesto Content Script
// Runs on Wikipedia pages to extract article information and Wikidata Q-ID

console.log('Jenifesto content script loaded on:', window.location.href);

// Check if we're on an article page (not Special:, Talk:, etc.)
function isArticlePage() {
  const path = window.location.pathname;
  if (!path.startsWith('/wiki/')) return false;

  const pageName = path.replace('/wiki/', '');
  const skipPrefixes = [
    'Special:', 'Talk:', 'User:', 'User_talk:', 'Wikipedia:',
    'File:', 'MediaWiki:', 'Template:', 'Help:', 'Category:',
    'Portal:', 'Draft:', 'Module:', 'TimedText:', 'Book:'
  ];
  return !skipPrefixes.some(prefix => pageName.startsWith(prefix));
}

// Extract article title from page
function getArticleTitle() {
  const heading = document.querySelector('#firstHeading');
  if (heading) return heading.textContent.trim();
  return document.title.replace(' - Wikipedia', '').trim();
}

// Extract Wikidata Q-ID from the page
// Method 1: Look for the Wikidata link in the sidebar
function extractQidFromPage() {
  // Try the Wikidata item link in the sidebar (most reliable)
  const wikidataLink = document.querySelector('#t-wikibase a');
  if (wikidataLink) {
    const href = wikidataLink.getAttribute('href');
    const match = href.match(/\/wiki\/(Q\d+)/);
    if (match) {
      console.log('Jenifesto: Found Q-ID from sidebar link:', match[1]);
      return match[1];
    }
  }

  // Method 2: Try the Wikidata link in footer/tools
  const allWikidataLinks = document.querySelectorAll('a[href*="wikidata.org/wiki/Q"]');
  for (const link of allWikidataLinks) {
    const href = link.getAttribute('href');
    const match = href.match(/(Q\d+)/);
    if (match) {
      console.log('Jenifesto: Found Q-ID from page link:', match[1]);
      return match[1];
    }
  }

  console.log('Jenifesto: No Q-ID found on page');
  return null;
}

// Fallback: Fetch Q-ID from Wikipedia API
async function fetchQidFromApi(pageTitle) {
  const lang = window.location.hostname.split('.')[0]; // e.g., 'en' from 'en.wikipedia.org'
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`;

  const params = new URLSearchParams({
    action: 'query',
    titles: pageTitle,
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    format: 'json',
    origin: '*'
  });

  try {
    const response = await fetch(`${apiUrl}?${params}`);
    const data = await response.json();
    const pages = Object.values(data.query.pages);

    if (pages.length > 0 && pages[0].pageprops?.wikibase_item) {
      const qid = pages[0].pageprops.wikibase_item;
      console.log('Jenifesto: Found Q-ID from API:', qid);
      return qid;
    }
  } catch (error) {
    console.error('Jenifesto: API fetch failed:', error);
  }

  return null;
}

// Get the canonical page title for API queries
function getCanonicalTitle() {
  // Use the URL path which has underscores
  const path = window.location.pathname;
  const pageName = path.replace('/wiki/', '');
  return decodeURIComponent(pageName);
}

// Main function to get Q-ID (tries page first, then API)
async function getWikidataQid() {
  // First try extracting from page (faster, no network request)
  let qid = extractQidFromPage();

  // If not found, try the API
  if (!qid) {
    const title = getCanonicalTitle();
    qid = await fetchQidFromApi(title);
  }

  return qid;
}

// Notify background script about this page
async function notifyBackgroundScript() {
  if (!isArticlePage()) {
    console.log('Jenifesto: Not an article page, skipping');
    return;
  }

  // Get Q-ID (may involve async API call)
  const qid = await getWikidataQid();

  const pageData = {
    type: 'WIKIPEDIA_PAGE_LOADED',
    title: getArticleTitle(),
    url: window.location.href,
    qid: qid
  };

  console.log('Jenifesto: Sending page data to background:', pageData);

  try {
    const response = await browser.runtime.sendMessage(pageData);
    console.log('Jenifesto: Background acknowledged:', response);
  } catch (error) {
    console.error('Jenifesto: Failed to send message:', error);
  }
}

// Run when page is ready
if (document.readyState === 'complete') {
  notifyBackgroundScript();
} else {
  window.addEventListener('load', notifyBackgroundScript);
}

// Also listen for SPA-style navigation (Wikipedia uses History API)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    console.log('Jenifesto: URL changed, re-extracting data');
    notifyBackgroundScript();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
```

**Step 2: Verify syntax**

```bash
node --check extension/content.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): extract Wikidata Q-ID from Wikipedia pages"
```

---

### Task 2: Update Background Script to Broadcast Updates

**Files:**
- Modify: `extension/background.js`

**Step 1: Update background.js to notify sidebar of updates**

Replace the entire contents of `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing between content script and sidebar

console.log('Jenifesto background script loaded');

// Listen for messages from content script or sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, 'from:', sender.url || 'extension');

  if (message.type === 'WIKIPEDIA_PAGE_LOADED') {
    const pageData = {
      title: message.title,
      url: message.url,
      qid: message.qid,
      timestamp: Date.now()
    };

    // Store the current page data
    browser.storage.local.set({ currentPage: pageData });

    // Notify sidebar if it's open (fire and forget)
    browser.runtime.sendMessage({
      type: 'PAGE_UPDATED',
      page: pageData
    }).catch(() => {
      // Sidebar not open, ignore error
    });

    sendResponse({ success: true });
    return;
  }

  if (message.type === 'GET_CURRENT_PAGE') {
    browser.storage.local.get('currentPage').then(result => {
      sendResponse({ page: result.currentPage || null });
    });
    return true; // Async response
  }
});

// Log when extension is installed
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
git commit -m "feat(extension): background script broadcasts page updates to sidebar"
```

---

### Task 3: Update Sidebar to Display Q-ID

**Files:**
- Modify: `extension/sidebar/panel.html`
- Modify: `extension/sidebar/panel.css`
- Modify: `extension/sidebar/panel.js`

**Step 1: Update panel.html with Q-ID display structure**

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
      <h2 class="section-title">Wikidata</h2>
      <div id="wikidata-info" class="wikidata-info">
        <!-- Wikidata info will be populated here -->
      </div>
    </section>

    <section id="results" class="section hidden">
      <h2 class="section-title">Related Resources</h2>
      <div id="results-list" class="results-list">
        <!-- Results will be populated here -->
      </div>
    </section>

    <section id="no-wikidata" class="section hidden">
      <div class="notice notice-warning">
        <p>This article is not linked to Wikidata.</p>
        <p class="notice-subtext">Related resources will be found via keyword search.</p>
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

**Step 2: Update panel.css with new styles**

Replace the entire contents of `extension/sidebar/panel.css`:

```css
/* Jenifesto Sidebar Panel Styles */
/* Based on Jenifesto's scholarly light theme */

:root {
  --bg-primary: #faf8f5;
  --bg-secondary: #f0ede8;
  --bg-tertiary: #e8e4dc;
  --text-primary: #2c2c2c;
  --text-secondary: #555555;
  --text-muted: #777777;
  --accent-blue: #1a5490;
  --accent-blue-light: #2a6ab0;
  --border-color: #d4d0c8;
  --verified-green: #2e7d32;
  --curation-amber: #b86e00;
  --warning-yellow: #f5f0e0;
  --warning-border: #e0d8c0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.header {
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 12px 16px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-blue);
  margin: 0;
}

/* Main content */
.content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

/* Sections */
.section {
  margin-bottom: 20px;
}

.section.hidden {
  display: none;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

/* Page info */
.page-info {
  background-color: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.page-url {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.placeholder {
  color: var(--text-muted);
  font-style: italic;
}

/* Wikidata info */
.wikidata-info {
  background-color: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
}

.qid-badge {
  display: inline-block;
  background-color: var(--accent-blue);
  color: white;
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  text-decoration: none;
}

.qid-badge:hover {
  background-color: var(--accent-blue-light);
}

/* Notice boxes */
.notice {
  border-radius: 6px;
  padding: 12px;
}

.notice-warning {
  background-color: var(--warning-yellow);
  border: 1px solid var(--warning-border);
}

.notice p {
  margin: 0;
}

.notice-subtext {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px !important;
}

/* Results */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Footer */
.footer {
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  padding: 8px 16px;
}

.footer-text {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
```

**Step 3: Update panel.js to display Q-ID**

Replace the entire contents of `extension/sidebar/panel.js`:

```javascript
// Jenifesto Sidebar Panel Script

console.log('Jenifesto sidebar panel loaded');

// DOM elements
const pageInfoEl = document.getElementById('page-info');
const wikidataSectionEl = document.getElementById('wikidata-section');
const wikidataInfoEl = document.getElementById('wikidata-info');
const noWikidataEl = document.getElementById('no-wikidata');
const resultsSection = document.getElementById('results');
const resultsListEl = document.getElementById('results-list');

// Update the page info display
function updatePageInfo(page) {
  if (!page) {
    pageInfoEl.innerHTML = '<p class="placeholder">Navigate to a Wikipedia article to begin exploring.</p>';
    wikidataSectionEl.classList.add('hidden');
    noWikidataEl.classList.add('hidden');
    resultsSection.classList.add('hidden');
    return;
  }

  // Update page info
  pageInfoEl.innerHTML = `
    <div class="page-title">${escapeHtml(page.title)}</div>
    <div class="page-url">${escapeHtml(page.url)}</div>
  `;

  // Update Wikidata section
  if (page.qid) {
    wikidataSectionEl.classList.remove('hidden');
    noWikidataEl.classList.add('hidden');

    const wikidataUrl = `https://www.wikidata.org/wiki/${page.qid}`;
    wikidataInfoEl.innerHTML = `
      <a href="${wikidataUrl}" target="_blank" rel="noopener" class="qid-badge">${escapeHtml(page.qid)}</a>
    `;
  } else {
    wikidataSectionEl.classList.add('hidden');
    noWikidataEl.classList.remove('hidden');
  }
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
  } catch (error) {
    console.error('Jenifesto sidebar: Failed to get page data:', error);
    updatePageInfo(null);
  }
}

// Listen for updates from background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Jenifesto sidebar: Received message:', message);

  if (message.type === 'PAGE_UPDATED') {
    updatePageInfo(message.page);
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
git commit -m "feat(extension): sidebar displays Wikidata Q-ID with link"
```

---

### Task 4: Test Q-ID Extraction

**Step 1: Reload extension in Firefox**

1. Go to `about:debugging`
2. Click "Reload" on the Jenifesto extension

**Step 2: Test on article with Wikidata**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Open sidebar (View > Sidebar > Jenifesto)

Expected:
- Sidebar shows "Apollo 11" as title
- Wikidata section shows Q-ID badge (Q43656)
- Clicking badge opens Wikidata page

**Step 3: Test on article without Wikidata (if you can find one)**

Most Wikipedia articles have Wikidata entries, but some very new or obscure ones might not.

Expected:
- Sidebar shows article title
- "Not linked to Wikidata" notice appears

**Step 4: Test navigation between articles**

1. From Apollo 11, click a link to another article (e.g., Neil Armstrong)
2. Sidebar should update automatically

Expected:
- Sidebar updates to show new article
- Q-ID updates to new article's Q-ID

---

### Phase 2 Complete

**Done when:**
- Content script extracts Q-ID from Wikipedia sidebar link
- Falls back to API if sidebar link not found
- Background script stores and broadcasts page updates
- Sidebar displays Q-ID as clickable badge linking to Wikidata
- Shows appropriate notice when article lacks Wikidata entry
- Updates automatically when navigating between articles
