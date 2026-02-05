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
