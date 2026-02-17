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
    const response = await chrome.runtime.sendMessage(pageData);
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

// Listen for requests from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_INFO') {
    if (!isArticlePage()) {
      sendResponse(null);
      return;
    }

    getWikidataQid().then(qid => {
      sendResponse({
        type: 'WIKIPEDIA_PAGE_LOADED',
        title: getArticleTitle(),
        url: window.location.href,
        qid: qid
      });
    });
    return true; // async response
  }
});
