// iNaturalist API Module
// Fetches taxa data from iNaturalist

const INAT_API = 'https://api.inaturalist.org/v1';

/**
 * Fetch taxon by iNaturalist taxon ID
 * @param {string} taxonId - iNaturalist taxon ID
 * @returns {Promise<Object>} Taxon data
 */
export async function fetchTaxon(taxonId) {
  const response = await fetch(`${INAT_API}/taxa/${taxonId}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`iNaturalist API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const taxon = data.results[0];

  return {
    source: 'inaturalist',
    type: 'taxon',
    id: taxonId,
    title: taxon.preferred_common_name || taxon.name,
    description: taxon.wikipedia_summary || null,
    url: `https://www.inaturalist.org/taxa/${taxonId}`,
    thumbnail: taxon.default_photo?.medium_url || taxon.default_photo?.square_url || null,
    metadata: {
      scientificName: taxon.name,
      rank: taxon.rank,
      observationsCount: taxon.observations_count,
      iconic_taxon_name: taxon.iconic_taxon_name
    }
  };
}

/**
 * Search iNaturalist for taxa
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of search results
 */
export async function searchTaxa(query, limit = 10) {
  const params = new URLSearchParams({
    q: query,
    per_page: limit.toString()
  });

  const response = await fetch(`${INAT_API}/taxa?${params}`);

  if (!response.ok) {
    throw new Error(`iNaturalist search error: ${response.status}`);
  }

  const data = await response.json();

  return (data.results || []).map(taxon => ({
    source: 'inaturalist',
    type: 'taxon',
    id: taxon.id.toString(),
    title: taxon.preferred_common_name || taxon.name,
    description: taxon.wikipedia_summary?.substring(0, 150) || null,
    url: `https://www.inaturalist.org/taxa/${taxon.id}`,
    thumbnail: taxon.default_photo?.square_url || null,
    metadata: {
      scientificName: taxon.name,
      rank: taxon.rank
    }
  }));
}
