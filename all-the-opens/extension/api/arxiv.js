// arXiv API Module
// Note: arXiv API returns XML, requires 3+ second delay between requests

const ARXIV_API = 'https://export.arxiv.org/api/query';

// Rate limiting: track last request time
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3500; // 3.5 seconds to be safe

/**
 * Wait for rate limit if needed
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

/**
 * Parse arXiv Atom XML response
 * @param {string} xmlText - XML response text
 * @returns {Array} Parsed entries
 */
function parseArxivResponse(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const entries = doc.querySelectorAll('entry');
  const results = [];

  for (const entry of entries) {
    const id = entry.querySelector('id')?.textContent || '';
    const arxivId = id.replace('http://arxiv.org/abs/', '');

    results.push({
      source: 'arxiv',
      type: 'paper',
      id: arxivId,
      title: entry.querySelector('title')?.textContent?.trim() || 'Untitled',
      description: entry.querySelector('summary')?.textContent?.trim()?.substring(0, 200) || null,
      url: id,
      thumbnail: null,
      metadata: {
        authors: Array.from(entry.querySelectorAll('author name')).map(n => n.textContent),
        published: entry.querySelector('published')?.textContent,
        updated: entry.querySelector('updated')?.textContent,
        categories: Array.from(entry.querySelectorAll('category')).map(c => c.getAttribute('term'))
      }
    });
  }

  return results;
}

/**
 * Search arXiv for papers
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchPapers(query, limit = 10) {
  await waitForRateLimit();

  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: limit.toString(),
    sortBy: 'relevance',
    sortOrder: 'descending'
  });

  const response = await fetch(`${ARXIV_API}?${params}`);

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status}`);
  }

  const xmlText = await response.text();
  return parseArxivResponse(xmlText);
}
