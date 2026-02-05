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
