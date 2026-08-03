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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message.type);

  switch (message.type) {
    case 'WIKIPEDIA_PAGE_LOADED':
      handlePageLoaded(message).then(sendResponse);
      return true;

    case 'GET_CURRENT_PAGE':
      // If we don't have current page, query the active tab's content script
      if (!currentPage) {
        queryActiveTabForPage().then(page => {
          sendResponse({ page });
        });
        return true;
      }
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
 * Query the active tab's content script for page info
 */
async function queryActiveTabForPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('wikipedia.org/wiki/')) {
      return null;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
      if (response) {
        await handlePageLoaded(response);
        return currentPage;
      }
    } catch (e) {
      // Content script not loaded - inject it
      console.log('Injecting content script into tab');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      // Wait a moment for script to initialize, then query again
      await new Promise(r => setTimeout(r, 100));
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
      if (response) {
        await handlePageLoaded(response);
        return currentPage;
      }
    }
  } catch (error) {
    console.log('Could not query active tab:', error.message);
  }
  return null;
}

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

  await chrome.storage.local.set({ currentPage });
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
  console.log('Tier 2 identifiers:', JSON.stringify(identifiers, null, 2));
  const results = await querySourcesByIdentifiers(identifiers);
  console.log('Tier 2 results:', JSON.stringify(results, null, 2));

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
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Restore state on startup
chrome.storage.local.get('currentPage').then(result => {
  if (result.currentPage) {
    currentPage = result.currentPage;
    console.log('Restored current page:', currentPage.title);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Jenifesto installed:', details.reason);
  // Clear cache on update to pick up API changes
  if (details.reason === 'update') {
    chrome.storage.local.clear().then(() => {
      console.log('Cache cleared on update');
    });
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
