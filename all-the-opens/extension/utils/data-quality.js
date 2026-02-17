// Data Quality Detection Module
// Identifies missing identifiers and broken links

/**
 * Types of data quality issues
 */
export const ISSUE_TYPES = {
  MISSING_IDENTIFIER: 'missing_identifier',
  BROKEN_LINK: 'broken_link',
  NO_WIKIDATA: 'no_wikidata'
};

/**
 * Wikidata properties for each source
 */
const SOURCE_PROPERTIES = {
  openlibrary: { property: 'P648', label: 'OpenLibrary ID' },
  internet_archive: { property: 'P724', label: 'Internet Archive ID' },
  viaf: { property: 'P214', label: 'VIAF ID' },
  gbif: { property: 'P846', label: 'GBIF taxon ID' },
  inaturalist: { property: 'P3151', label: 'iNaturalist taxon ID' }
};

/**
 * Generate Wikidata edit URL for adding a property
 * @param {string} qid - Wikidata entity ID
 * @param {string} property - Property ID (e.g., "P648")
 * @returns {string} URL to Wikidata edit interface
 */
function getWikidataEditUrl(qid, property) {
  return `https://www.wikidata.org/wiki/${qid}#${property}`;
}

/**
 * Generate OpenLibrary merge URL
 * @returns {string} URL to OpenLibrary merge tool
 */
function getOpenLibraryMergeUrl() {
  return 'https://openlibrary.org/merges';
}

/**
 * Detect missing identifiers (found in Tier 3 but not in Wikidata)
 * @param {Object} tier2Results - Results from Tier 2 queries
 * @param {Object} tier3Results - Results from Tier 3 search
 * @param {string} qid - Wikidata entity ID
 * @returns {Array} Array of missing identifier issues
 */
export function detectMissingIdentifiers(tier2Results, tier3Results, qid) {
  const issues = [];

  if (!tier3Results?.successful) return issues;

  // Sources that had no Tier 2 result (no identifier in Wikidata)
  // but DID have Tier 3 results (found via search)
  const tier2Sources = new Set(Object.keys(tier2Results?.successful || {}));

  for (const [sourceType, results] of Object.entries(tier3Results.successful)) {
    // Only flag sources that support identifier linking
    const sourceInfo = SOURCE_PROPERTIES[sourceType];
    if (!sourceInfo) continue;

    // If we found results in Tier 3 but not Tier 2, the identifier is missing
    if (!tier2Sources.has(sourceType) && results.length > 0) {
      issues.push({
        type: ISSUE_TYPES.MISSING_IDENTIFIER,
        source: sourceType,
        property: sourceInfo.property,
        propertyLabel: sourceInfo.label,
        message: `Found in ${results[0].sourceConfig?.name || sourceType} but Wikidata lacks ${sourceInfo.label}`,
        editUrl: qid ? getWikidataEditUrl(qid, sourceInfo.property) : null,
        foundResults: results.slice(0, 3) // Show up to 3 potential matches
      });
    }
  }

  return issues;
}

/**
 * Detect broken links (identifier in Wikidata but 404 from source)
 * @param {Object} tier2Results - Results from Tier 2 queries
 * @param {Object} identifiers - Original identifiers from Wikidata
 * @param {string} qid - Wikidata entity ID
 * @returns {Array} Array of broken link issues
 */
export function detectBrokenLinks(tier2Results, identifiers, qid) {
  const issues = [];

  if (!tier2Results?.failed) return issues;

  for (const [sourceType, errorMessage] of Object.entries(tier2Results.failed)) {
    // Check if this was a "not found" error (404)
    if (errorMessage === 'Not found' || errorMessage.includes('404')) {
      const identifier = identifiers[sourceType];
      const sourceInfo = SOURCE_PROPERTIES[sourceType];

      if (identifier && sourceInfo) {
        issues.push({
          type: ISSUE_TYPES.BROKEN_LINK,
          source: sourceType,
          property: sourceInfo.property,
          propertyLabel: sourceInfo.label,
          identifierValue: identifier.value,
          message: `Wikidata references ${sourceInfo.label} "${identifier.value}" but it no longer exists`,
          editUrl: qid ? getWikidataEditUrl(qid, sourceInfo.property) : null
        });
      }
    }
  }

  return issues;
}

/**
 * Detect if article is not linked to Wikidata
 * @param {string|null} qid - Wikidata entity ID (null if not linked)
 * @param {string} articleTitle - Wikipedia article title
 * @param {string} articleUrl - Wikipedia article URL
 * @returns {Object|null} Issue object or null
 */
export function detectNoWikidata(qid, articleTitle, articleUrl) {
  if (qid) return null;

  // Extract language code from URL
  const langMatch = articleUrl?.match(/https?:\/\/(\w+)\.wikipedia\.org/);
  const lang = langMatch ? langMatch[1] : 'en';

  return {
    type: ISSUE_TYPES.NO_WIKIDATA,
    message: 'This Wikipedia article is not linked to Wikidata',
    editUrl: `https://www.wikidata.org/wiki/Special:NewItem?site=${lang}wiki&page=${encodeURIComponent(articleTitle)}`,
    articleTitle,
    articleUrl
  };
}

/**
 * Get all data quality issues
 * @param {Object} params - Parameters
 * @returns {Array} All detected issues
 */
export function getAllIssues({
  qid,
  articleTitle,
  articleUrl,
  identifiers,
  tier2Results,
  tier3Results
}) {
  const issues = [];

  // Check for no Wikidata link
  const noWikidataIssue = detectNoWikidata(qid, articleTitle, articleUrl);
  if (noWikidataIssue) {
    issues.push(noWikidataIssue);
    return issues; // If no Wikidata, other checks don't apply
  }

  // Check for broken links
  const brokenLinks = detectBrokenLinks(tier2Results, identifiers, qid);
  issues.push(...brokenLinks);

  // Check for missing identifiers
  const missingIds = detectMissingIdentifiers(tier2Results, tier3Results, qid);
  issues.push(...missingIds);

  return issues;
}
