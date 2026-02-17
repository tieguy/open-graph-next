// DPLA (Digital Public Library of America) API Module
// Note: Requires API key from dp.la

const DPLA_API = 'https://api.dp.la/v2';

// API key - users will need to register for their own key
// For development, use empty string and expect limited/no results
let apiKey = '';

/**
 * Set the DPLA API key
 * @param {string} key - DPLA API key
 */
export function setApiKey(key) {
  apiKey = key;
}

/**
 * Search DPLA for items
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchItems(query, limit = 10) {
  if (!apiKey) {
    console.warn('DPLA API key not set - skipping DPLA search');
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    page_size: limit.toString(),
    api_key: apiKey
  });

  const response = await fetch(`${DPLA_API}/items?${params}`);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      console.warn('DPLA API key invalid or expired');
      return [];
    }
    throw new Error(`DPLA API error: ${response.status}`);
  }

  const data = await response.json();

  return (data.docs || []).map(doc => {
    const resource = doc.sourceResource || {};

    return {
      source: 'dpla',
      type: resource.type?.[0] || 'item',
      id: doc.id,
      title: Array.isArray(resource.title) ? resource.title[0] : resource.title || 'Untitled',
      description: Array.isArray(resource.description)
        ? resource.description[0]
        : resource.description || null,
      url: doc.isShownAt || `https://dp.la/item/${doc.id}`,
      thumbnail: doc.object || null,
      metadata: {
        creator: resource.creator,
        date: resource.date?.displayDate,
        provider: doc.provider?.name,
        dataProvider: doc.dataProvider
      }
    };
  });
}
