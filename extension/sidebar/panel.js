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
