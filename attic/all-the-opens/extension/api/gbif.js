// GBIF API Module
// Fetches species data from Global Biodiversity Information Facility

const GBIF_API = 'https://api.gbif.org/v1';

/**
 * Fetch species by GBIF taxon key
 * @param {string} taxonKey - GBIF taxon key
 * @returns {Promise<Object>} Species data
 */
export async function fetchSpecies(taxonKey) {
  const response = await fetch(`${GBIF_API}/species/${taxonKey}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`GBIF API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'gbif',
    type: 'species',
    id: taxonKey,
    title: data.scientificName || data.canonicalName || taxonKey,
    description: data.vernacularName ? `Common name: ${data.vernacularName}` : null,
    url: `https://www.gbif.org/species/${taxonKey}`,
    thumbnail: null, // GBIF doesn't provide thumbnails in species endpoint
    metadata: {
      kingdom: data.kingdom,
      phylum: data.phylum,
      class: data.class,
      order: data.order,
      family: data.family,
      genus: data.genus,
      taxonomicStatus: data.taxonomicStatus,
      rank: data.rank
    }
  };
}

/**
 * Search GBIF for species
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchSpecies(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString()
  });

  const response = await fetch(`${GBIF_API}/species/search?${params}`);

  if (!response.ok) {
    throw new Error(`GBIF search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.results || []).map(item => ({
    source: 'gbif',
    type: 'species',
    id: item.key.toString(),
    title: item.scientificName || item.canonicalName,
    description: item.vernacularName ? `Common name: ${item.vernacularName}` : null,
    url: `https://www.gbif.org/species/${item.key}`,
    thumbnail: null,
    metadata: {
      kingdom: item.kingdom,
      rank: item.rank
    }
  }));
}
