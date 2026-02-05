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
