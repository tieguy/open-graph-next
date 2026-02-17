// Wikimedia Commons API Module
// Searches for media files on Commons

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Search Wikimedia Commons for files
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchFiles(query, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '6', // File namespace
    srlimit: limit.toString(),
    format: 'json',
    origin: '*'
  });

  const response = await fetch(`${COMMONS_API}?${params}`);

  if (!response.ok) {
    throw new Error(`Commons API error: ${response.status}`);
  }

  const data = await response.json();
  const searchResults = data.query?.search || [];

  if (searchResults.length === 0) {
    return [];
  }

  // Get image info for thumbnails
  const titles = searchResults.map(r => r.title).join('|');
  const infoParams = new URLSearchParams({
    action: 'query',
    titles: titles,
    prop: 'imageinfo',
    iiprop: 'url|thumburl|extmetadata',
    iiurlwidth: '200',
    format: 'json',
    origin: '*'
  });

  const infoResponse = await fetch(`${COMMONS_API}?${infoParams}`);
  const infoData = await infoResponse.json();
  const pages = infoData.query?.pages || {};

  // Map page info by title
  const pageInfoByTitle = {};
  for (const page of Object.values(pages)) {
    if (page.title && page.imageinfo) {
      pageInfoByTitle[page.title] = page.imageinfo[0];
    }
  }

  return searchResults.map(result => {
    const info = pageInfoByTitle[result.title] || {};
    const title = result.title.replace('File:', '');

    return {
      source: 'wikimedia_commons',
      type: 'file',
      id: result.pageid.toString(),
      title: title,
      description: result.snippet?.replace(/<[^>]+>/g, '') || null,
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(result.title)}`,
      thumbnail: info.thumburl || null,
      metadata: {
        size: result.size,
        timestamp: result.timestamp,
        artist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '')
      }
    };
  });
}
