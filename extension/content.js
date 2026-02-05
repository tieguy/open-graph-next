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
