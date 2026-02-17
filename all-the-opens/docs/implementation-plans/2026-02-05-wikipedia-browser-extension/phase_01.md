# Wikipedia Browser Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a Firefox browser extension with sidebar that shows related resources from cultural heritage sources when visiting Wikipedia articles.

**Architecture:** Firefox MV3 extension with content script (extracts Wikidata Q-ID), background script (orchestrates API queries), and sidebar panel (renders results). Tiered progressive loading: Wikidata first, then identifier-linked sources, then optional keyword search.

**Tech Stack:** Firefox WebExtensions API (MV3), vanilla JavaScript, browser.storage for caching

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-02-05

---

## Phase 1: Extension Scaffold

**Goal:** Minimal Firefox extension with sidebar that activates on Wikipedia

### Task 1: Create Extension Directory Structure

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/content.js`
- Create: `extension/sidebar/panel.html`
- Create: `extension/sidebar/panel.js`
- Create: `extension/sidebar/panel.css`

**Step 1: Create directory structure**

```bash
mkdir -p extension/sidebar extension/icons
```

**Step 2: Create manifest.json**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Jenifesto",
  "version": "0.1.0",
  "description": "Discover related resources across cultural heritage archives when browsing Wikipedia",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "*://*.wikipedia.org/*",
    "*://*.wikidata.org/*",
    "https://openlibrary.org/*",
    "https://archive.org/*",
    "https://viaf.org/*",
    "https://api.dp.la/*",
    "https://export.arxiv.org/*",
    "https://commons.wikimedia.org/*",
    "https://api.si.edu/*",
    "https://collectionapi.metmuseum.org/*",
    "https://api.gbif.org/*",
    "https://api.inaturalist.org/*"
  ],
  "sidebar_action": {
    "default_title": "Jenifesto",
    "default_panel": "sidebar/panel.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    },
    "open_at_install": false
  },
  "background": {
    "scripts": ["background.js"]
  },
  "content_scripts": [
    {
      "matches": ["*://*.wikipedia.org/wiki/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png"
  }
}
```

**Step 3: Verify manifest syntax**

```bash
cd extension && python3 -c "import json; json.load(open('manifest.json'))" && echo "Valid JSON"
```

Expected: `Valid JSON`

**Step 4: Commit**

```bash
git add extension/manifest.json
git commit -m "chore(extension): add manifest.json for Firefox MV3 sidebar extension"
```

---

### Task 2: Create Placeholder Icons

**Files:**
- Create: `extension/icons/icon-16.png`
- Create: `extension/icons/icon-32.png`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-96.png`

**Step 1: Create simple placeholder icons using ImageMagick**

```bash
cd extension/icons

# Create colored square placeholders (will be replaced with real icons later)
convert -size 16x16 xc:'#1a5490' icon-16.png
convert -size 32x32 xc:'#1a5490' icon-32.png
convert -size 48x48 xc:'#1a5490' icon-48.png
convert -size 96x96 xc:'#1a5490' icon-96.png
```

If ImageMagick not available, create minimal 1x1 PNGs with Python:

```bash
python3 << 'EOF'
import struct
import zlib

def create_png(filename, size, color=(26, 84, 144)):
    # Minimal PNG: IHDR + IDAT + IEND
    width, height = size, size

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

    # Image data: rows of RGB pixels with filter byte
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte
        raw_data += bytes(color) * width

    compressed = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xffffffff
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)

    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

    with open(filename, 'wb') as f:
        f.write(signature + ihdr + idat + iend)

for size in [16, 32, 48, 96]:
    create_png(f'icon-{size}.png', size)
    print(f'Created icon-{size}.png')
EOF
```

**Step 2: Verify icons exist**

```bash
ls -la extension/icons/
```

Expected: Four PNG files

**Step 3: Commit**

```bash
git add extension/icons/
git commit -m "chore(extension): add placeholder icons"
```

---

### Task 3: Create Background Script Stub

**Files:**
- Create: `extension/background.js`

**Step 1: Create background.js**

Create `extension/background.js`:

```javascript
// Jenifesto Background Script
// Handles message passing between content script and sidebar

console.log('Jenifesto background script loaded');

// Listen for messages from content script or sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, 'from:', sender.url || 'extension');

  if (message.type === 'WIKIPEDIA_PAGE_LOADED') {
    // Store the current page data
    browser.storage.local.set({
      currentPage: {
        title: message.title,
        url: message.url,
        qid: message.qid,
        timestamp: Date.now()
      }
    });

    // Acknowledge receipt
    sendResponse({ success: true });
  }

  if (message.type === 'GET_CURRENT_PAGE') {
    // Sidebar requesting current page data
    browser.storage.local.get('currentPage').then(result => {
      sendResponse({ page: result.currentPage || null });
    });
    // Return true to indicate async response
    return true;
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
git commit -m "feat(extension): add background script stub with message handling"
```

---

### Task 4: Create Content Script Stub

**Files:**
- Create: `extension/content.js`

**Step 1: Create content.js**

Create `extension/content.js`:

```javascript
// Jenifesto Content Script
// Runs on Wikipedia pages to extract article information

console.log('Jenifesto content script loaded on:', window.location.href);

// Check if we're on an article page (not Special:, Talk:, etc.)
function isArticlePage() {
  const path = window.location.pathname;
  // Article pages are /wiki/ArticleName without colons (except File:, Category:, etc.)
  if (!path.startsWith('/wiki/')) return false;

  const pageName = path.replace('/wiki/', '');
  // Skip special namespaces
  const skipPrefixes = ['Special:', 'Talk:', 'User:', 'User_talk:', 'Wikipedia:', 'File:', 'MediaWiki:', 'Template:', 'Help:', 'Category:', 'Portal:', 'Draft:', 'Module:'];
  return !skipPrefixes.some(prefix => pageName.startsWith(prefix));
}

// Extract article title from page
function getArticleTitle() {
  // Try the heading first
  const heading = document.querySelector('#firstHeading');
  if (heading) return heading.textContent.trim();

  // Fallback to page title
  return document.title.replace(' - Wikipedia', '').trim();
}

// Notify background script about this page
function notifyBackgroundScript() {
  if (!isArticlePage()) {
    console.log('Jenifesto: Not an article page, skipping');
    return;
  }

  const pageData = {
    type: 'WIKIPEDIA_PAGE_LOADED',
    title: getArticleTitle(),
    url: window.location.href,
    qid: null // Will be extracted in Phase 2
  };

  console.log('Jenifesto: Sending page data to background:', pageData);

  browser.runtime.sendMessage(pageData).then(
    response => console.log('Jenifesto: Background acknowledged:', response),
    error => console.error('Jenifesto: Failed to send message:', error)
  );
}

// Run when page is ready
if (document.readyState === 'complete') {
  notifyBackgroundScript();
} else {
  window.addEventListener('load', notifyBackgroundScript);
}
```

**Step 2: Verify syntax**

```bash
node --check extension/content.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): add content script stub for Wikipedia pages"
```

---

### Task 5: Create Sidebar Panel

**Files:**
- Create: `extension/sidebar/panel.html`
- Create: `extension/sidebar/panel.js`
- Create: `extension/sidebar/panel.css`

**Step 1: Create panel.html**

Create `extension/sidebar/panel.html`:

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

    <section id="results" class="section hidden">
      <h2 class="section-title">Related Resources</h2>
      <div id="results-list" class="results-list">
        <!-- Results will be populated here -->
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

**Step 2: Create panel.css**

Create `extension/sidebar/panel.css`:

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

.page-qid {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}

.placeholder {
  color: var(--text-muted);
  font-style: italic;
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

**Step 3: Create panel.js**

Create `extension/sidebar/panel.js`:

```javascript
// Jenifesto Sidebar Panel Script

console.log('Jenifesto sidebar panel loaded');

// DOM elements
const pageInfoEl = document.getElementById('page-info');
const resultsSection = document.getElementById('results');
const resultsListEl = document.getElementById('results-list');

// Update the page info display
function updatePageInfo(page) {
  if (!page) {
    pageInfoEl.innerHTML = '<p class="placeholder">Navigate to a Wikipedia article to begin exploring.</p>';
    resultsSection.classList.add('hidden');
    return;
  }

  pageInfoEl.innerHTML = `
    <div class="page-title">${escapeHtml(page.title)}</div>
    ${page.qid ? `<div class="page-qid">${escapeHtml(page.qid)}</div>` : ''}
  `;
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

**Step 4: Verify all files exist**

```bash
ls -la extension/sidebar/
```

Expected: panel.html, panel.js, panel.css

**Step 5: Commit**

```bash
git add extension/sidebar/
git commit -m "feat(extension): add sidebar panel with placeholder UI"
```

---

### Task 6: Test Extension in Firefox

**Step 1: Open Firefox and load extension**

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in left sidebar
4. Click "Load Temporary Add-on..."
5. Select `extension/manifest.json`

**Step 2: Verify extension loads**

Expected:
- Extension appears in list with name "Jenifesto"
- No errors in the extension card

**Step 3: Open sidebar**

1. Click View menu > Sidebar > Jenifesto (or use keyboard shortcut)
2. Or right-click toolbar and select "Jenifesto"

Expected:
- Sidebar opens with "Jenifesto" header
- Shows placeholder text "Navigate to a Wikipedia article..."

**Step 4: Test on Wikipedia**

1. Navigate to https://en.wikipedia.org/wiki/Apollo_11
2. Check browser console (F12) for Jenifesto log messages

Expected in console:
- "Jenifesto content script loaded on: https://en.wikipedia.org/wiki/Apollo_11"
- "Jenifesto: Sending page data to background..."
- "Jenifesto: Background acknowledged: {success: true}"

Expected in sidebar:
- Shows "Apollo 11" as current article

**Step 5: Document any issues**

If extension fails to load, check `about:debugging` for error messages.

**Step 6: Commit verification notes**

No code changes - this is a manual verification step.

---

### Phase 1 Complete

**Done when:**
- Extension loads in Firefox without errors
- Sidebar opens and displays placeholder content
- Content script runs on Wikipedia article pages
- Background script receives messages from content script
- Sidebar displays current article title
