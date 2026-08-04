// The DPLA pivot: America's union catalog — tens of millions of items from
// libraries, archives and museums, one API. The anchor is a real key, not a
// label: Wikidata states the entity's Library of Congress authority (P244),
// id.loc.gov turns that into the AUTHORIZED heading string, and DPLA is
// asked for items its partner catalogers filed under exactly that heading.
// An anchor without an LC authority simply does not pivot — that is the
// difference between "items about Eagle, the lunar module" and eleven
// thousand photographs of birds.
//
// Requires DPLA_API_KEY (free: POST to https://api.dp.la/v2/api_key/{email}
// and it arrives by mail). Without it the pivot is silently absent — the
// demo must run for anyone who clones it, keyless.

import { getJson } from './http.js'

export const DPLA_PER_ANCHOR = 4

/**
 * The authorized heading for an LC authority id, from id.loc.gov. Subject
 * ids (sh…, sj…, gf…) live under /subjects/, name authorities (n…, no…,
 * nb…, nr…) under /names/. Returns null when the service answers strangely
 * — a missing heading just means no pivot, never a guessed one.
 */
export function lcHeadingFromGraph(graph, id) {
  if (!Array.isArray(graph)) return null
  const node = graph.find((n) => typeof n?.['@id'] === 'string' && n['@id'].endsWith(`/${id}`))
  const label =
    node?.['http://www.w3.org/2004/02/skos/core#prefLabel']?.[0]?.['@value'] ??
    node?.['http://www.loc.gov/mads/rdf/v1#authoritativeLabel']?.[0]?.['@value'] ??
    null
  return typeof label === 'string' ? label : null
}

export async function lcHeading(id) {
  const branch = /^(sh|sj|gf)/.test(id) ? 'subjects' : 'names'
  return lcHeadingFromGraph(await getJson(`https://id.loc.gov/authorities/${branch}/${id}.json`), id)
}

export function dplaUrl(heading, key) {
  return (
    'https://api.dp.la/v2/items?sourceResource.subject.name=' +
    `"${encodeURIComponent(heading)}"` +
    '&fields=id,sourceResource.title,dataProvider,object,isShownAt' +
    `&page_size=${DPLA_PER_ANCHOR}&api_key=${key}`
  )
}

const first = (v) => (Array.isArray(v) ? v[0] : v)

/** One DPLA doc as a page entry; null when it cannot be shown honestly. */
export function dplaEntryFrom(doc, heading, anchorLabel) {
  const title = first(doc?.['sourceResource.title'])
  if (!title || !(doc?.id || doc?.isShownAt)) return null
  const provider = first(doc.dataProvider)?.name ?? first(doc.dataProvider) ?? null
  return {
    source: 'dpla',
    title,
    description: provider ?? 'A DPLA partner institution',
    imageUrl: doc.object ? first(doc.object) : null,
    // DPLA's own item page, not the provider's isShownAt: partner hosts rot
    // out from under the aggregator (the California Historical Society's
    // whole domain now serves a Stanford proxy's certificate), while the
    // dp.la page always resolves and carries the onward link itself.
    href: doc.id ? `https://dp.la/item/${doc.id}` : doc.isShownAt,
    attribution: {
      author: provider,
      license: 'via P244 LC authority',
    },
    why:
      `Catalogued under “${heading}” — the Library of Congress heading ` +
      `Wikidata states for ${anchorLabel ?? 'this entity'}`,
    topic: anchorLabel ?? heading,
    _via: 'P244',
  }
}

/**
 * Items DPLA's partners catalogued under an anchor's authorized heading.
 * @returns {{entries: object[], total: number, heading: string}|null}
 */
export async function dplaEntries(lcId, anchorLabel, key) {
  const heading = await lcHeading(lcId)
  if (!heading) return null
  const body = await getJson(dplaUrl(heading, key))
  const docs = body.docs ?? []
  const entries = uniqueEntries(docs.map((d) => dplaEntryFrom(d, heading, anchorLabel)).filter(Boolean))
  return { heading, total: body.count ?? docs.length, entries }
}

/**
 * Multi-part records (an interview's reels, a scrapbook's pages) come back as
 * near-identical docs; one shelf showing the same title twice reads as a bug,
 * so only the first of each title-per-holder is kept.
 */
export function uniqueEntries(entries) {
  const seen = new Set()
  return entries.filter((e) => {
    const k = `${e.title}|${e.description}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
