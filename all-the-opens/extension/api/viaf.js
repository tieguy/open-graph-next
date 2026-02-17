// VIAF API Module
// Fetches authority records from Virtual International Authority File

const VIAF_API = 'https://viaf.org/viaf';

/**
 * Fetch authority record from VIAF
 * @param {string} viafId - VIAF identifier
 * @returns {Promise<Object>} Authority record data
 */
export async function fetchRecord(viafId) {
  try {
    const response = await fetch(`${VIAF_API}/${viafId}`, {
      headers: { 'Accept': 'application/json' }
    });

    console.log('VIAF response status:', response.status);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`VIAF API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('VIAF data keys:', Object.keys(data));

    const cluster = data['ns1:VIAFCluster'];

    if (!cluster) {
      console.log('VIAF: No cluster found in response');
      return null;
    }

    // Extract preferred name from mainHeadings
    let title = viafId;
    const mainHeadings = cluster['ns1:mainHeadings']?.['ns1:data'];
    if (mainHeadings) {
      const headingsList = Array.isArray(mainHeadings) ? mainHeadings : [mainHeadings];
      if (headingsList.length > 0) {
        title = headingsList[0]['ns1:text'] || title;
      }
    }

    // Extract source count
    const sources = cluster['ns1:sources']?.['ns1:source'];
    const sourceCount = Array.isArray(sources) ? sources.length : (sources ? 1 : 0);

    const nameType = cluster['ns1:nameType'] || 'authority';

    return {
      source: 'viaf',
      type: nameType.toLowerCase(),
      id: viafId,
      title: title,
      description: `${nameType} record linked to ${sourceCount} national libraries`,
      url: `${VIAF_API}/${viafId}`,
      thumbnail: null,
      metadata: {
        nameType: nameType,
        sourceCount: sourceCount,
        nationality: cluster['ns1:nationalityOfEntity']?.['ns1:data']?.['ns1:text']
      }
    };
  } catch (error) {
    console.error('VIAF fetch error:', error);
    throw error;
  }
}
