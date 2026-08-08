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

import { getHeader, getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'

export const DPLA_PER_ANCHOR = 4

/**
 * How many rows the ONE DPLA request asks for, so the pick can be made here
 * rather than taken from the top of the index (2026-08-08, LUI-144).
 *
 * The request count is unchanged — this is a bigger response to a call already
 * being made, and it is the whole reason ranking is affordable. Measured on
 * "Armstrong, Neil, 1930-2012": the heading holds 60 items, about 50 of them
 * genuinely Apollo 11 (the flag and footprints on the Moon, the P30 maneuver
 * card carried on the mission), and the four DPLA returns first are the only
 * junk in the set — a Ricci poster, a portrait, a balloonist, a Columbian
 * exposition record. Nothing was wrong with the heading; we were reading the
 * first page of an unordered list.
 */
export const DPLA_FETCH_WINDOW = 50

/** Subject ids (sh…, sj…, gf…) live under /subjects/, name authorities under /names/. */
export const lcBranch = (id) => (/^(sh|sj|gf)/.test(id) ? 'subjects' : 'names')

const lcUrl = (id) => `https://id.loc.gov/authorities/${lcBranch(id)}/${id}`

/**
 * The authorized heading for an LC authority id, read off the JSON-LD graph.
 * Returns null when the service answers strangely — a missing heading just
 * means no pivot, never a guessed one.
 *
 * Matched on the WHOLE authority URI, never on "@id ends with /<id>". LC ships
 * the identifier twice: once as the authority record, which carries the
 * heading, and once as `id.loc.gov/rwo/agents/<id>` for the real-world thing it
 * names, which carries none. The loose match hit both and `find` took whichever
 * came first — and that order varies per record, so n80014970 (Cambodia)
 * resolved while n79006404 (France) returned null, silently costing the page
 * every DPLA card under that anchor. 8 of 14 sampled ids lost that coin flip.
 */
export function lcHeadingFromGraph(graph, id) {
  if (!Array.isArray(graph) || typeof id !== 'string') return null
  const uri = `/authorities/${lcBranch(id)}/${id}`
  const node = graph.find((n) => typeof n?.['@id'] === 'string' && n['@id'].endsWith(uri))
  const label =
    node?.['http://www.w3.org/2004/02/skos/core#prefLabel']?.[0]?.['@value'] ??
    node?.['http://www.loc.gov/mads/rdf/v1#authoritativeLabel']?.[0]?.['@value'] ??
    null
  return typeof label === 'string' ? label : null
}

/**
 * The percent-encoded heading LC sends beside the plain one, as text.
 *
 * `x-preflabel` is unusable for anything but ASCII: HTTP headers are Latin-1
 * and LC writes UTF-8 bytes, so "Cœdès, George" arrives as "CÅdÃ¨s, George"
 * and would go to DPLA as a subject-name query matching nothing — a silent
 * empty shelf that reads exactly like an anchor nobody holds anything under.
 * `x-preflabel-encoded` is LC's own answer to that, and round-trips exactly.
 */
export function decodeLcHeading(encoded) {
  if (typeof encoded !== 'string' || !encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    // A malformed sequence is not a heading, and must not throw mid-page.
    return null
  }
}

/**
 * The authorized heading, asked the cheap way first.
 *
 * id.loc.gov answers a HEAD with the heading in a header, on a 303, so the
 * usual 88–120 KB of JSON-LD buys nothing this caller reads. That matters
 * because the LC lookup is the single longest serial chain on a cold page (27
 * requests on Angkor Wat) and `id.loc.gov` publishes `Crawl-delay: 3` — the
 * request has to get cheaper rather than more concurrent. The body is fetched
 * only when the header is missing, which is the rare case.
 */
export async function lcHeading(id) {
  const fromHeader = decodeLcHeading(await getHeader(lcUrl(id), 'x-preflabel-encoded'))
  if (fromHeader) return fromHeader
  return lcHeadingFromGraph(await getJson(`${lcUrl(id)}.json`), id)
}

export function dplaUrl(heading, key) {
  return (
    'https://api.dp.la/v2/items?sourceResource.subject.name=' +
    `"${encodeURIComponent(heading)}"` +
    '&fields=id,sourceResource.title,dataProvider,object,isShownAt,sourceResource.rights,rights' +
    `&page_size=${DPLA_FETCH_WINDOW}&api_key=${key}`
  )
}

// Words too common to tell one record from another. Deliberately tiny: this
// is not a stoplist for English, only for the handful of tokens that appear in
// so many headings and titles that scoring on them says nothing.
const STOP = new Set(['the', 'and', 'of', 'in', 'a', 'an', 'for', 'to', 'on', 'at'])

/** Significant lowercase word tokens: no punctuation, no short words, no years. */
const tokens = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d{4}$/.test(w))

/**
 * The fold key for near-duplicates: a normalized title prefix, across holders.
 *
 * `uniqueEntries` below folds an exact title per holder, which is not enough.
 * The Armstrong heading returns TEN records titled "Ceremony for Apollo 11
 * astronauts Armstrong, Aldrin, and Coll…" and five "Hollywood Blvd. and Vine
 * Street" — 60 items hold only 42 distinct title-prefixes — so ranking alone
 * would have filled the shelf with four copies of one ceremony photo, which is
 * a worse shelf than the arbitrary one it replaced. Cross-holder because the
 * duplicates genuinely arrive from different contributors: Angkor Wat's
 * Cambodia shelf has been shipping two identical "Inventaire descriptif des
 * monuments du Cambodge" records from two providers.
 *
 * 40 characters is a judgment call with a known failure: two genuinely
 * different items sharing a long prefix fold into one. That direction is the
 * safe one — the shelf shows one of them instead of both, and the count beside
 * it still says how many exist.
 */
const foldKey = (title) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 40)

/**
 * Which of a heading's items the shelf shows — the pick DPLA's index order was
 * making for us until 2026-08-08 (LUI-144).
 *
 * Score is `2 x (distinct anchor/heading tokens present in the title) + 1 if
 * the item has a thumbnail`, ties broken by DPLA's own order, then folded for
 * near-duplicates and capped.
 *
 * **It reorders and dedupes; it never filters.** The caller's `total` stays the
 * heading's true count, so "4 of 60" remains true — which is why this is not
 * done with DPLA's `q=` parameter. Measured on the same heading: `q="Neil
 * Armstrong"` cuts the count from 60 to 23, so the denominator in a disclosure
 * this project makes on every shelf would silently shrink, and it still ranked
 * "Bussed balloonist" fourth. Every item in a facet carries the heading
 * equally, so DPLA relevance has nothing to discriminate on; the signal has to
 * come from the fields we already ask for.
 *
 * The thumbnail is worth less than one matching token, deliberately: an
 * illustrated near-miss beats a text-only near-miss, but no amount of picture
 * outranks actually being about the subject. The cost is real and named — the
 * US Government Publishing Office's text records ("Here men from the planet
 * Earth first set foot upon the Moon") rank below illustrated ones, and they
 * are some of the best items under the heading.
 *
 * Worst case, where no title shares a token with the anchor, every score is 0
 * or 1 and the order falls back to DPLA's own — no worse than before.
 */
export function rankDplaEntries(entries, { heading, anchorLabel, cap = DPLA_PER_ANCHOR } = {}) {
  const want = new Set([...tokens(anchorLabel), ...tokens(heading)])
  const scored = entries.map((e, i) => {
    const hits = new Set(tokens(e.title).filter((w) => want.has(w))).size
    return { e, i, score: hits * 2 + (e.imageUrl ? 1 : 0) }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const seen = new Set()
  const picked = []
  for (const { e } of scored) {
    const k = foldKey(e.title)
    if (seen.has(k)) continue
    seen.add(k)
    picked.push(e)
    if (picked.length >= cap) break
  }
  return picked
}

/**
 * Where a reader goes to browse a heading this page declined to sample.
 *
 * `subject` is the facet DPLA's own search UI reads, and it is the same field
 * the API query above asks on — so the browse lands on the set the count came
 * from. Confirmed in a browser 2026-08-05; it cannot be checked from a script,
 * because dp.la answers 202 with an empty body to anything that is not one.
 * If a future change ever breaks it, the fallback is the plain `?q="<heading>"`
 * phrase search — which finds more than the heading alone, so the count
 * sentence in src/breadth.js would have to be softened to match.
 */
export function dplaBrowseUrl(heading) {
  return `https://dp.la/search?subject=${encodeURIComponent(`"${heading}"`)}`
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
    // out from under the aggregator, while the dp.la page always resolves
    // and carries the onward link itself.
    //
    // **A link check cannot confirm that, and the failure is benign.** dp.la
    // sits behind an AWS WAF JS challenge: every /item/ and /search path
    // answers `202` with an EMPTY BODY and `x-amzn-waf-action: challenge`, to
    // a browser User-Agent as readily as to a script, and for an id that
    // cannot exist as readily as a real one. Only the homepage answers
    // normally. An audit on 2026-08-06 found 494 dp.la links across the six
    // showcase pages in exactly that state; the links were then confirmed by
    // hand in a real browser, which solves the challenge and lands on the
    // record. So a future audit reporting several hundred dead DPLA links has
    // most likely rediscovered the WAF, not a bug — check one by hand before
    // touching this line.
    href: doc.id ? `https://dp.la/item/${doc.id}` : doc.isShownAt,
    attribution: {
      author: provider,
      license: null,
    },
    // DPLA aggregates whatever its contributors state, and most of them state
    // free text — "No known copyright restrictions", or a paragraph of local
    // terms. Only a real rights URI becomes a glyph; everything else yields
    // null, which is the difference between marking a card and inventing a
    // permission for it. Both field spellings are read because contributors
    // use both, `edm:rights` at the top level and the descriptive one under
    // sourceResource.
    rights: {
      copy: licenseView(ccFromUri(first(doc.rights)) ?? ccFromUri(first(doc['sourceResource.rights']))),
    },
    why:
      `Filed under “${heading}” — the subject heading American libraries use ` +
      `for ${anchorLabel ?? 'this'}`,
    topic: anchorLabel ?? heading,
    _via: 'P244',
  }
}

/**
 * Items DPLA's partners cataloged under an anchor's authorized heading.
 * @returns {{entries: object[], total: number, heading: string}|null}
 */
export async function dplaEntries(lcId, anchorLabel, key) {
  const heading = await lcHeading(lcId)
  if (!heading) return null
  const body = await getJson(dplaUrl(heading, key))
  const docs = body.docs ?? []
  // Map, fold exact repeats, then rank and cap. `total` is the heading's own
  // count and is deliberately NOT the number ranked over: the shelf says "4 of
  // 60", and 60 is how many DPLA holds, not how many rows this request read.
  const all = uniqueEntries(docs.map((d) => dplaEntryFrom(d, heading, anchorLabel)).filter(Boolean))
  const entries = rankDplaEntries(all, { heading, anchorLabel })
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
