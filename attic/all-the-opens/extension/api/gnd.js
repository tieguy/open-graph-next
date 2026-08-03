// GND API Module
// Fetches authority records from German National Library (Deutsche Nationalbibliothek)

const GND_API = 'https://d-nb.info/gnd';

/**
 * Fetch authority record from GND
 * @param {string} gndId - GND identifier
 * @returns {Promise<Object>} Authority record data
 */
export async function fetchRecord(gndId) {
  try {
    const response = await fetch(`${GND_API}/${gndId}`, {
      headers: { 'Accept': 'application/ld+json' }
    });

    console.log('GND response status:', response.status);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`GND API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('GND data type:', data['@type']);

    // Find the main entity in the JSON-LD graph
    const entities = Array.isArray(data['@graph']) ? data['@graph'] : [data];
    const entity = entities.find(e => e['@id']?.includes(`/gnd/${gndId}`)) || entities[0];

    if (!entity) {
      console.log('GND: No entity found in response');
      return null;
    }

    const title = entity.preferredName
      || entity.preferredNameForThePerson
      || entity.preferredNameForTheCorporateBody
      || entity.preferredNameForThePlaceOrGeographicName
      || entity.preferredNameForTheSubjectHeading
      || entity.preferredNameForTheWork
      || gndId;

    const description = entity.biographicalOrHistoricalInformation
      || buildDescription(entity);

    const entityType = normalizeType(entity['@type']);

    return {
      source: 'gnd',
      type: entityType,
      id: gndId,
      title: title,
      description: description || `${entityType} record in German National Library`,
      url: `${GND_API}/${gndId}`,
      thumbnail: entity.depiction?.thumbnail || null,
      metadata: {
        entityType: entityType,
        dateOfBirth: firstValue(entity.dateOfBirth),
        dateOfDeath: firstValue(entity.dateOfDeath),
        placeOfBirth: labelOf(entity.placeOfBirth),
        placeOfDeath: labelOf(entity.placeOfDeath),
        professions: arrayOf(entity.professionOrOccupation).map(labelOf).filter(Boolean)
      }
    };
  } catch (error) {
    console.error('GND fetch error:', error);
    throw error;
  }
}

/**
 * Build a description from available fields when biographicalOrHistoricalInformation is absent
 */
function buildDescription(entity) {
  const parts = [];
  const birth = firstValue(entity.dateOfBirth);
  const death = firstValue(entity.dateOfDeath);
  if (birth || death) {
    parts.push(`${birth || '?'}–${death || ''}`);
  }
  const professions = arrayOf(entity.professionOrOccupation).map(labelOf).filter(Boolean);
  if (professions.length > 0) {
    parts.push(professions.join(', '));
  }
  return parts.length > 0 ? parts.join('. ') : null;
}

/**
 * Normalize GND @type to a simple string
 */
function normalizeType(type) {
  const types = Array.isArray(type) ? type : [type];
  for (const t of types) {
    if (!t) continue;
    const local = t.replace(/.*[#/]/, '').toLowerCase();
    if (local.includes('person')) return 'person';
    if (local.includes('corporate') || local.includes('organisation')) return 'organization';
    if (local.includes('place') || local.includes('geographic')) return 'place';
    if (local.includes('work')) return 'work';
    if (local.includes('event') || local.includes('conference')) return 'event';
    if (local.includes('subject')) return 'subject';
    if (local.includes('family')) return 'family';
  }
  return 'authority';
}

/** Extract first value from a field that may be a string, array, or object */
function firstValue(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return firstValue(field[0]);
  return field['@value'] || field['@id'] || null;
}

/** Extract label from a value that may be a string or object with preferredName */
function labelOf(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  return field.preferredName || field.label || field['@value'] || null;
}

/** Ensure a value is an array */
function arrayOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
