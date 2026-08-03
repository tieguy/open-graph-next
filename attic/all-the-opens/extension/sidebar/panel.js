// Jenifesto Sidebar Panel Script

console.log('Jenifesto sidebar panel loaded');

// DOM elements
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

  hideAllSections();

  if (!page) {
    return;
  }

  if (page.qid) {
    showLoading('Loading Wikidata...');
  } else {
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
    const response = await chrome.runtime.sendMessage({
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
      // Note: On retry, we re-fetch all sources (not just the failed one).
      // This refreshes all data and ensures consistency across the UI.
      if (tier === '2' && currentEntity) {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_TIER2_RESULTS',
          identifiers: currentEntity.identifiers
        });
        if (response.results) {
          displayTier2Results(response.results);
        }
      } else if (tier === '3' && currentPage) {
        const response = await chrome.runtime.sendMessage({
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
    const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_PAGE' });
    updatePageInfo(response.page);

    if (response.page?.qid) {
      const wikidataResponse = await chrome.runtime.sendMessage({ type: 'GET_WIKIDATA' });
      if (wikidataResponse.data) {
        displayWikidataEntity(wikidataResponse.data);

        showLoading('Loading related sources...');
        const tier2Response = await chrome.runtime.sendMessage({
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

    const issuesResponse = await chrome.runtime.sendMessage({ type: 'GET_DATA_QUALITY_ISSUES' });
    if (issuesResponse.issues?.length > 0) {
      displayDataQualityIssues(issuesResponse.issues);
    }
  } catch (error) {
    console.error('Sidebar error:', error);
    updatePageInfo(null);
  }
}

chrome.runtime.onMessage.addListener((message) => {
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
