// LCCN API Module
// Fetches authority records from Library of Congress Name Authority File

const LCCN_API = 'https://id.loc.gov/authorities/names';

/**
 * Fetch authority record from Library of Congress
 * @param {string} lccnId - LCCN identifier (e.g., "n79022889")
 * @returns {Promise<Object>} Authority record data
 */
export async function fetchRecord(lccnId) {
  try {
    const response = await fetch(`${LCCN_API}/${lccnId}.json`);

    console.log('LCCN response status:', response.status);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`LCCN API error: ${response.status}`);
    }

    const data = await response.json();

    // id.loc.gov returns expanded JSON-LD: an array of resource objects
    if (!Array.isArray(data) || data.length === 0) {
      console.log('LCCN: Unexpected response format');
      return null;
    }

    const entityUri = `${LCCN_API}/${lccnId}`;

    // Find the main entity resource
    const entity = data.find(obj => obj['@id'] === entityUri) || data[0];

    const title = extractLabel(data, entityUri) || lccnId;
    const entityType = classifyType(entity['@type'] || []);

    // Extract variant labels
    const variants = extractVariants(data, entityUri);

    return {
      source: 'lccn',
      type: entityType,
      id: lccnId,
      title: title,
      description: variants.length > 0
        ? `Also known as: ${variants.slice(0, 3).join('; ')}`
        : `${entityType} record in Library of Congress`,
      url: entityUri,
      thumbnail: null,
      metadata: {
        entityType: entityType,
        variants: variants,
        note: extractNote(data, entityUri)
      }
    };
  } catch (error) {
    console.error('LCCN fetch error:', error);
    throw error;
  }
}

// MADS/RDF namespace prefix
const MADS = 'http://www.loc.gov/mads/rdf/v1#';

/**
 * Extract the authoritative label from the JSON-LD graph
 */
function extractLabel(graph, entityUri) {
  const entity = graph.find(obj => obj['@id'] === entityUri);
  if (!entity) return null;

  // Try authoritativeLabel
  const authLabel = entity[`${MADS}authoritativeLabel`];
  if (authLabel) {
    const label = Array.isArray(authLabel) ? authLabel[0] : authLabel;
    return label['@value'] || label;
  }

  // Try SKOS prefLabel
  const prefLabel = entity['http://www.w3.org/2004/02/skos/core#prefLabel'];
  if (prefLabel) {
    const label = Array.isArray(prefLabel) ? prefLabel[0] : prefLabel;
    return label['@value'] || label;
  }

  // Try rdfs:label
  const rdfsLabel = entity['http://www.w3.org/2000/01/rdf-schema#label'];
  if (rdfsLabel) {
    const label = Array.isArray(rdfsLabel) ? rdfsLabel[0] : rdfsLabel;
    return label['@value'] || label;
  }

  return null;
}

/**
 * Extract variant labels from the JSON-LD graph
 */
function extractVariants(graph, entityUri) {
  const variants = [];

  for (const obj of graph) {
    // Look for variant resources that reference the main entity
    const types = obj['@type'] || [];
    if (types.some(t => t.includes('Variant'))) {
      const varLabel = obj[`${MADS}variantLabel`];
      if (varLabel) {
        const label = Array.isArray(varLabel) ? varLabel[0] : varLabel;
        const value = label['@value'] || label;
        if (typeof value === 'string') variants.push(value);
      }
    }
  }

  return variants;
}

/**
 * Extract editorial note from the JSON-LD graph
 */
function extractNote(graph, entityUri) {
  const entity = graph.find(obj => obj['@id'] === entityUri);
  if (!entity) return null;

  const note = entity[`${MADS}editorialNote`]
    || entity[`${MADS}note`];
  if (note) {
    const val = Array.isArray(note) ? note[0] : note;
    return val['@value'] || val;
  }
  return null;
}

/**
 * Classify entity type from MADS/RDF types
 */
function classifyType(types) {
  for (const t of types) {
    const local = t.replace(/.*[#/]/, '').toLowerCase();
    if (local.includes('personal')) return 'person';
    if (local.includes('corporate')) return 'organization';
    if (local.includes('geographic')) return 'place';
    if (local.includes('title') || local.includes('name/title')) return 'work';
    if (local.includes('conference')) return 'event';
    if (local.includes('topic')) return 'subject';
    if (local.includes('family')) return 'family';
  }
  return 'authority';
}
