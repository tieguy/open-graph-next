// OpenLibrary API Module
// Fetches author and work data by OpenLibrary ID

const OPENLIBRARY_API = 'https://openlibrary.org';

/**
 * Fetch author by OpenLibrary author ID
 * @param {string} olid - OpenLibrary author ID (e.g., "OL23919A")
 * @returns {Promise<Object>} Author data
 */
export async function fetchAuthor(olid) {
  const response = await fetch(`${OPENLIBRARY_API}/authors/${olid}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`OpenLibrary API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'openlibrary',
    type: 'author',
    id: olid,
    title: data.name || data.personal_name || olid,
    description: data.bio?.value || data.bio || null,
    url: `${OPENLIBRARY_API}/authors/${olid}`,
    thumbnail: data.photos?.[0] ? `https://covers.openlibrary.org/a/id/${data.photos[0]}-M.jpg` : null,
    metadata: {
      birthDate: data.birth_date,
      deathDate: data.death_date,
      workCount: data.work_count
    }
  };
}

/**
 * Fetch work by OpenLibrary work ID
 * @param {string} olid - OpenLibrary work ID (e.g., "OL45883W")
 * @returns {Promise<Object>} Work data
 */
export async function fetchWork(olid) {
  const response = await fetch(`${OPENLIBRARY_API}/works/${olid}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`OpenLibrary API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    source: 'openlibrary',
    type: 'work',
    id: olid,
    title: data.title || olid,
    description: data.description?.value || data.description || null,
    url: `${OPENLIBRARY_API}/works/${olid}`,
    thumbnail: data.covers?.[0] ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg` : null,
    metadata: {
      firstPublishDate: data.first_publish_date,
      subjects: data.subjects?.slice(0, 5) || []
    }
  };
}

/**
 * Determine if an OpenLibrary ID is for an author or work and fetch accordingly
 * @param {string} olid - OpenLibrary ID
 * @returns {Promise<Object|null>} Entity data or null
 */
export async function fetchByOlid(olid) {
  // OL IDs ending in 'A' are authors, 'W' are works, 'M' are editions
  if (olid.endsWith('A')) {
    return fetchAuthor(olid);
  } else if (olid.endsWith('W')) {
    return fetchWork(olid);
  } else if (olid.endsWith('M')) {
    // Edition - fetch the work instead
    // For now, just link to the edition
    return {
      source: 'openlibrary',
      type: 'edition',
      id: olid,
      title: `Edition ${olid}`,
      url: `${OPENLIBRARY_API}/books/${olid}`,
      thumbnail: `https://covers.openlibrary.org/b/olid/${olid}-M.jpg`
    };
  }
  return null;
}
