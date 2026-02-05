// Wikidata API Module
// Fetches entity data and extracts external identifiers

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

// Map of Wikidata property IDs to identifier names
const IDENTIFIER_PROPERTIES = {
  P214: { name: 'viaf', label: 'VIAF' },
  P244: { name: 'lccn', label: 'Library of Congress' },
  P648: { name: 'openlibrary', label: 'OpenLibrary' },
  P724: { name: 'internet_archive', label: 'Internet Archive' },
  P227: { name: 'gnd', label: 'GND' },
  P213: { name: 'isni', label: 'ISNI' },
  P496: { name: 'orcid', label: 'ORCID' },
  P846: { name: 'gbif', label: 'GBIF' },
  P3151: { name: 'inaturalist', label: 'iNaturalist' },
  P245: { name: 'ulan', label: 'ULAN' },
  P1566: { name: 'geonames', label: 'GeoNames' },
  P625: { name: 'coordinates', label: 'Coordinates' }
};

/**
 * Fetch entity data from Wikidata
 * @param {string} qid - Wikidata entity ID (e.g., "Q43656")
 * @returns {Promise<Object>} Entity data with labels, descriptions, and identifiers
 */
export async function fetchEntity(qid) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'labels|descriptions|claims|sitelinks',
    languages: 'en',
    format: 'json',
    origin: '*'
  });

  const response = await fetch(`${WIKIDATA_API}?${params}`, {
    headers: {
      'User-Agent': 'Jenifesto/0.1 (browser extension)'
    }
  });

  if (!response.ok) {
    throw new Error(`Wikidata API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Wikidata API error: ${data.error.info}`);
  }

  const entity = data.entities[qid];
  if (!entity || entity.missing) {
    throw new Error(`Entity not found: ${qid}`);
  }

  return parseEntity(entity);
}

/**
 * Parse raw Wikidata entity into structured data
 * @param {Object} entity - Raw entity from API
 * @returns {Object} Parsed entity data
 */
function parseEntity(entity) {
  const result = {
    id: entity.id,
    label: entity.labels?.en?.value || entity.id,
    description: entity.descriptions?.en?.value || null,
    identifiers: {},
    sitelinks: {}
  };

  // Extract external identifiers from claims
  if (entity.claims) {
    for (const [propId, propInfo] of Object.entries(IDENTIFIER_PROPERTIES)) {
      const claims = entity.claims[propId];
      if (claims && claims.length > 0) {
        const value = claims[0].mainsnak?.datavalue?.value;
        if (value) {
          // Handle different value types
          if (typeof value === 'string') {
            result.identifiers[propInfo.name] = {
              value: value,
              label: propInfo.label,
              property: propId
            };
          } else if (value.id) {
            // Wikibase entity reference
            result.identifiers[propInfo.name] = {
              value: value.id,
              label: propInfo.label,
              property: propId
            };
          } else if (value.latitude && value.longitude) {
            // Coordinates
            result.identifiers[propInfo.name] = {
              value: `${value.latitude},${value.longitude}`,
              label: propInfo.label,
              property: propId
            };
          }
        }
      }
    }
  }

  // Extract Wikipedia sitelinks
  if (entity.sitelinks) {
    for (const [site, link] of Object.entries(entity.sitelinks)) {
      if (site.endsWith('wiki') && !site.includes('quote') && !site.includes('source')) {
        result.sitelinks[site] = link.title;
      }
    }
  }

  return result;
}

/**
 * Get URL for an identifier
 * @param {string} type - Identifier type (e.g., "viaf", "openlibrary")
 * @param {string} value - Identifier value
 * @returns {string|null} URL or null if no URL pattern exists
 */
export function getIdentifierUrl(type, value) {
  const urlPatterns = {
    viaf: (id) => `https://viaf.org/viaf/${id}`,
    lccn: (id) => `https://id.loc.gov/authorities/names/${id}`,
    openlibrary: (id) => `https://openlibrary.org/works/${id}`,
    internet_archive: (id) => `https://archive.org/details/${id}`,
    gnd: (id) => `https://d-nb.info/gnd/${id}`,
    isni: (id) => `https://isni.org/isni/${id.replace(/\s/g, '')}`,
    orcid: (id) => `https://orcid.org/${id}`,
    gbif: (id) => `https://www.gbif.org/species/${id}`,
    inaturalist: (id) => `https://www.inaturalist.org/taxa/${id}`,
    ulan: (id) => `https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid=${id}`,
    geonames: (id) => `https://www.geonames.org/${id}`
  };

  const pattern = urlPatterns[type];
  return pattern ? pattern(value) : null;
}
