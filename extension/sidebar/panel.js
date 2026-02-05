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
