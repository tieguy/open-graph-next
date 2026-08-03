// Internet Archive API Module
// Fetches item metadata by identifier

const IA_API = 'https://archive.org';

/**
 * Fetch item metadata from Internet Archive
 * @param {string} identifier - Internet Archive item identifier
 * @returns {Promise<Object>} Item data
 */
export async function fetchItem(identifier) {
  const response = await fetch(`${IA_API}/metadata/${identifier}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Internet Archive API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.metadata) {
    return null;
  }

  const meta = data.metadata;

  // Get thumbnail - try itemimage or construct from identifier
  let thumbnail = null;
  if (data.misc?.image) {
    thumbnail = `${IA_API}/services/img/${identifier}`;
  }

  return {
    source: 'internet_archive',
    type: meta.mediatype || 'item',
    id: identifier,
    title: meta.title || identifier,
    description: Array.isArray(meta.description) ? meta.description[0] : meta.description,
    url: `${IA_API}/details/${identifier}`,
    thumbnail: thumbnail,
    metadata: {
      mediatype: meta.mediatype,
      creator: Array.isArray(meta.creator) ? meta.creator : [meta.creator].filter(Boolean),
      date: meta.date || meta.year,
      collection: Array.isArray(meta.collection) ? meta.collection : [meta.collection].filter(Boolean),
      downloads: data.item_size
    }
  };
}

/**
 * Search Internet Archive for items
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchItems(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    output: 'json',
    rows: limit.toString(),
    fl: ['identifier', 'title', 'description', 'mediatype', 'creator', 'date'].join(',')
  });

  const response = await fetch(`${IA_API}/advancedsearch.php?${params}`);

  if (!response.ok) {
    throw new Error(`Internet Archive search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.response?.docs || []).map(doc => ({
    source: 'internet_archive',
    type: doc.mediatype || 'item',
    id: doc.identifier,
    title: doc.title || doc.identifier,
    description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
    url: `${IA_API}/details/${doc.identifier}`,
    thumbnail: `${IA_API}/services/img/${doc.identifier}`,
    metadata: {
      mediatype: doc.mediatype,
      creator: doc.creator,
      date: doc.date
    }
  }));
}
