// The Europeana pivot: ~3,000 European museums, libraries and archives
// behind one API. The anchor is a stated identifier, not a label match:
// Wikidata's P7704 names the entity's Europeana URI, and the search asks for
// items Europeana's enrichment links to exactly that entity. Only openly
// licensed items are requested (`reusability=open`) — the demo shows what a
// reader may reuse, and the disclosure counts what the filter left out is
// not knowable in one request, so the card credit names each item's licence
// instead.
//
// Requires EUROPEANA_API_KEY; without it the pivot is silently absent — the
// demo must run for anyone who clones it, keyless.

import { getJson } from './http.js'

export const EUROPEANA_PER_ANCHOR = 4

export function europeanaUrl(entityId, key) {
  // Wikidata's P7704 values keep the legacy `/base/` path segment; the
  // enrichment URIs in Europeana's own index dropped it. With the segment
  // left in, every entity quietly matches nothing.
  const canonical = entityId.replace(/^(agent|concept|place|timespan)\/base\//, '$1/')
  return (
    'https://api.europeana.eu/record/v2/search.json' +
    `?wskey=${key}` +
    `&query=${encodeURIComponent(`"http://data.europeana.eu/${canonical}"`)}` +
    '&reusability=open' +
    `&rows=${EUROPEANA_PER_ANCHOR}` +
    '&profile=minimal'
  )
}

/** A rights URI as the short name a reader knows. */
export function rightsName(uri) {
  if (!uri) return null
  if (/publicdomain\/mark/.test(uri)) return 'Public Domain'
  if (/publicdomain\/zero/.test(uri)) return 'CC0'
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)/.exec(uri)
  if (cc) return `CC ${cc[1].toUpperCase().replace(/-/g, ' ')}`
  return null
}

const first = (v) => (Array.isArray(v) ? v[0] : v)

/** One Europeana item as a page entry; null when it cannot be shown honestly. */
export function europeanaEntryFrom(item, anchorLabel) {
  const title = first(item?.title)
  if (!title || !item?.guid) return null
  const provider = first(item.dataProvider) ?? null
  const rights = rightsName(first(item.rights))
  return {
    source: 'europeana',
    title,
    description: provider ?? 'A Europeana partner institution',
    imageUrl: first(item.edmPreview) ?? null,
    href: item.guid,
    attribution: {
      author: [provider, rights].filter(Boolean).join(' · ') || null,
      // The property that found it is in the ⓘ fold; the credit line is for
      // the institution and the licence, which is what a reuser needs.
      license: null,
    },
    why: `Europeana’s member institutions link this to ${anchorLabel ?? 'something named here'}`,
    topic: anchorLabel ?? null,
    _via: 'P7704',
  }
}

/**
 * Openly licensed items Europeana links to an entity.
 * @returns {{entries: object[], total: number}}
 */
export async function europeanaEntries(entityId, anchorLabel, key) {
  const body = await getJson(europeanaUrl(entityId, key))
  const items = body.items ?? []
  return {
    total: body.totalResults ?? items.length,
    entries: items.map((i) => europeanaEntryFrom(i, anchorLabel)).filter(Boolean),
  }
}
