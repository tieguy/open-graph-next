// VIAF API Module
// Fetches authority records from Virtual International Authority File

const VIAF_API = 'https://viaf.org/viaf';

/**
 * Fetch authority record from VIAF
 * @param {string} viafId - VIAF identifier
 * @returns {Promise<Object>} Authority record data
 */
export async function fetchRecord(viafId) {
  const response = await fetch(`${VIAF_API}/${viafId}/viaf.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`VIAF API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract preferred name from mainHeadings
  let title = viafId;
  if (data.mainHeadings?.data) {
    const headings = Array.isArray(data.mainHeadings.data)
      ? data.mainHeadings.data
      : [data.mainHeadings.data];
    if (headings.length > 0) {
      title = headings[0].text || headings[0];
    }
  }

  // Extract source links
  const sources = [];
  if (data.sources?.source) {
    const sourceList = Array.isArray(data.sources.source)
      ? data.sources.source
      : [data.sources.source];
    for (const src of sourceList) {
      if (src['@nsid']) {
        sources.push({
          code: src['#text'] || src,
          id: src['@nsid']
        });
      }
    }
  }

  return {
    source: 'viaf',
    type: data.nameType || 'authority',
    id: viafId,
    title: title,
    description: `Authority record from ${sources.length} national libraries`,
    url: `${VIAF_API}/${viafId}`,
    thumbnail: null,
    metadata: {
      nameType: data.nameType,
      sources: sources.slice(0, 5),
      birthDate: data.birthDate,
      deathDate: data.deathDate
    }
  };
}
