// The DPLA pivot: America's union catalog — tens of millions of items from
// libraries, archives and museums, one API. There is no per-item Wikidata
// identifier to pivot on at scale, so the anchor is the subject HEADING: an
// anchored entity's label matched against the LCSH-derived subject headings
// DPLA's partner catalogers assigned. That is a cataloger's statement about
// the item, not Wikidata's — the card says so, and the credit names the
// holding institution.
//
// Requires DPLA_API_KEY (free: POST to https://api.dp.la/v2/api_key/{email}
// and it arrives by mail). Without it the pivot is silently absent — the
// demo must run for anyone who clones it, keyless.

import { getJson } from './http.js'

export const DPLA_PER_ANCHOR = 4

export function dplaUrl(subject, key) {
  return (
    'https://api.dp.la/v2/items?sourceResource.subject.name=' +
    `"${encodeURIComponent(subject)}"` +
    '&fields=sourceResource.title,dataProvider,object,isShownAt' +
    `&page_size=${DPLA_PER_ANCHOR}&api_key=${key}`
  )
}

const first = (v) => (Array.isArray(v) ? v[0] : v)

/** One DPLA doc as a page entry; null when it cannot be shown honestly. */
export function dplaEntryFrom(doc, subject) {
  const title = first(doc?.['sourceResource.title'])
  if (!title || !doc?.isShownAt) return null
  const provider = first(doc.dataProvider)?.name ?? first(doc.dataProvider) ?? null
  return {
    source: 'dpla',
    title,
    description: provider ?? 'A DPLA partner institution',
    imageUrl: doc.object ? first(doc.object) : null,
    href: doc.isShownAt,
    attribution: {
      author: provider,
      license: 'via LCSH subject heading',
    },
    why: `Catalogued under the subject “${subject}” by DPLA’s partners`,
    topic: subject,
    _via: 'subject',
  }
}

/**
 * Items DPLA's partners catalogued under this exact subject heading.
 * @returns {{entries: object[], total: number}}
 */
export async function dplaEntries(subject, key) {
  const body = await getJson(dplaUrl(subject, key))
  const docs = body.docs ?? []
  return {
    total: body.count ?? docs.length,
    entries: docs.map((d) => dplaEntryFrom(d, subject)).filter(Boolean),
  }
}
