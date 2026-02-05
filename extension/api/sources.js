// Source Query Orchestrator
// Coordinates queries to multiple sources based on identifiers and keyword search

import { fetchByOlid } from './openlibrary.js';
import { fetchItem as fetchIAItem, searchItems as searchIA } from './internet-archive.js';
import { fetchRecord as fetchViafRecord } from './viaf.js';
import { fetchRecord as fetchGndRecord } from './gnd.js';
import { fetchRecord as fetchLccnRecord } from './lccn.js';
import { fetchSpecies as fetchGbifSpecies, searchSpecies as searchGbif } from './gbif.js';
import { fetchTaxon as fetchInatTaxon, searchTaxa as searchInat } from './inaturalist.js';
import { searchItems as searchDpla } from './dpla.js';
import { searchPapers as searchArxiv } from './arxiv.js';
import { searchFiles as searchCommons } from './commons.js';

// Map identifier types to fetch functions (Tier 2)
const IDENTIFIER_FETCHERS = {
  openlibrary: fetchByOlid,
  internet_archive: fetchIAItem,
  viaf: fetchViafRecord,
  gnd: fetchGndRecord,
  lccn: fetchLccnRecord,
  gbif: fetchGbifSpecies,
  inaturalist: fetchInatTaxon
};

// Map source types to search functions (Tier 3)
const SEARCH_FUNCTIONS = {
  internet_archive: searchIA,
  gbif: searchGbif,
  inaturalist: searchInat,
  dpla: searchDpla,
  arxiv: searchArxiv,
  wikimedia_commons: searchCommons
};

// Source display configuration with fallback colors
export const SOURCE_CONFIG = {
  openlibrary: {
    name: 'OpenLibrary',
    color: '#418541',
    icon: 'https://openlibrary.org/static/images/openlibrary-logo-tighter.svg'
  },
  internet_archive: {
    name: 'Internet Archive',
    color: '#6b8cae',
    icon: 'https://archive.org/images/glogo.png'
  },
  viaf: {
    name: 'VIAF',
    color: '#8b6b4e',
    icon: null  // VIAF changed their site, old icon URL no longer works
  },
  gnd: {
    name: 'GND',
    color: '#003366',
    icon: 'https://d-nb.info/favicon.ico'
  },
  lccn: {
    name: 'Library of Congress',
    color: '#003153',
    icon: 'https://id.loc.gov/static/images/Fav.ico'
  },
  gbif: {
    name: 'GBIF',
    color: '#4e9a47',
    icon: 'https://www.gbif.org/favicon-16x16.png'
  },
  inaturalist: {
    name: 'iNaturalist',
    color: '#74ac00',
    icon: 'https://static.inaturalist.org/sites/1-favicon.ico'
  },
  dpla: {
    name: 'DPLA',
    color: '#0068a6',
    icon: 'https://dp.la/static/images/dpla-icons/dpla-icon.png'
  },
  arxiv: {
    name: 'arXiv',
    color: '#b31b1b',
    icon: 'https://arxiv.org/favicon.ico'
  },
  wikimedia_commons: {
    name: 'Wikimedia Commons',
    color: '#006699',
    icon: 'https://commons.wikimedia.org/static/favicon/commons.ico'
  },
  wikidata: {
    name: 'Wikidata',
    color: '#006699',
    icon: 'https://www.wikidata.org/static/favicon/wikidata.ico'
  },
  wikipedia: {
    name: 'Wikipedia',
    color: '#000000',
    icon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico'
  }
};

/**
 * Query sources by identifiers (Tier 2)
 * @param {Object} identifiers - Map of identifier type to {value, label, url}
 * @returns {Promise<Object>} Results grouped by source
 */
export async function querySourcesByIdentifiers(identifiers) {
  const results = {
    successful: {},
    failed: {},
    noIdentifier: []
  };

  const queries = [];

  for (const [type, fetcher] of Object.entries(IDENTIFIER_FETCHERS)) {
    const identifier = identifiers[type];
    if (identifier) {
      queries.push({ type, identifier: identifier.value, fetcher });
    } else {
      results.noIdentifier.push(type);
    }
  }

  const queryResults = await Promise.allSettled(
    queries.map(async ({ type, identifier, fetcher }) => {
      const data = await fetcher(identifier);
      return { type, data };
    })
  );

  for (let i = 0; i < queryResults.length; i++) {
    const result = queryResults[i];
    const { type } = queries[i];

    if (result.status === 'fulfilled' && result.value.data) {
      results.successful[type] = result.value.data;
    } else if (result.status === 'rejected') {
      results.failed[type] = result.reason.message;
    } else {
      results.failed[type] = 'Not found';
    }
  }

  return results;
}

/**
 * Search sources by keyword (Tier 3)
 * @param {string} query - Search query
 * @param {Array<string>} excludeSources - Sources to skip (already have Tier 2 results)
 * @param {number} limitPerSource - Max results per source
 * @returns {Promise<Object>} Results grouped by source
 */
export async function searchSourcesByKeyword(query, excludeSources = [], limitPerSource = 5) {
  const results = {
    successful: {},
    failed: {},
    skipped: []
  };

  const searches = [];

  for (const [type, searchFn] of Object.entries(SEARCH_FUNCTIONS)) {
    if (excludeSources.includes(type)) {
      results.skipped.push(type);
      continue;
    }
    searches.push({ type, searchFn });
  }

  const searchResults = await Promise.allSettled(
    searches.map(async ({ type, searchFn }) => {
      const data = await searchFn(query, limitPerSource);
      return { type, data };
    })
  );

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const { type } = searches[i];

    if (result.status === 'fulfilled' && result.value.data?.length > 0) {
      results.successful[type] = result.value.data;
    } else if (result.status === 'rejected') {
      results.failed[type] = result.reason.message;
    }
    // If fulfilled with empty array, just don't include it
  }

  return results;
}

/**
 * Get display info for a source
 * @param {string} sourceType - Source type key
 * @returns {Object} Source display configuration
 */
export function getSourceConfig(sourceType) {
  return SOURCE_CONFIG[sourceType] || {
    name: sourceType,
    color: '#666666',
    icon: null
  };
}

/**
 * Get list of searchable sources
 * @returns {Array<string>} Source type keys
 */
export function getSearchableSources() {
  return Object.keys(SEARCH_FUNCTIONS);
}
