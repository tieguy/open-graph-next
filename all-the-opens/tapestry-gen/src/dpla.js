// The DPLA lookup: America's union catalog — tens of millions of items from
// libraries, archives and museums, one API. The anchor is a real key, not a
// label: Wikidata states the entity's Library of Congress authority (P244),
// id.loc.gov turns that into the AUTHORIZED heading string, and DPLA is
// asked for items its partner catalogers filed under exactly that heading.
// An anchor without an LC authority is simply not looked up — that is the
// difference between "items about Eagle, the lunar module" and eleven
// thousand photographs of birds.
//
// Requires DPLA_API_KEY (free: POST to https://api.dp.la/v2/api_key/{email}
// and it arrives by mail). Without it the lookup is silently absent — the
// demo must run for anyone who clones it, keyless.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'
import { corroborated, rankShelfEntries, uniqueEntries } from './relevance.js'
// LC authority lookup is shared with DigitalNZ and lives in its own module.
// This lookup wants the cheap authorized form; see lc.js for why there are two.
import { lcHeading } from './lc.js'

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

export function dplaUrl(heading, key) {
  return (
    'https://api.dp.la/v2/items?sourceResource.subject.name=' +
    `"${encodeURIComponent(heading)}"` +
    // `sourceResource.subject` bare is "not an allowable value for 'fields'"
    // (a bad_request that costs the whole shelf) — the projection wants the
    // leaf, and flattens it to a string when a record has one subject and an
    // array when it has several. Verified live 2026-08-08.
    '&fields=id,sourceResource.title,sourceResource.subject.name,dataProvider,object,isShownAt,sourceResource.rights,rights' +
    `&page_size=${DPLA_FETCH_WINDOW}&api_key=${key}`
  )
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
  const phrase = `"${heading}"`
  return `https://dp.la/search?subject=${encodeURIComponent(phrase)}`
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
    // The record's own subject headings, for the corroboration test only —
    // never rendered. The flattened projection is a bare string for a
    // single-subject record, an array for the rest.
    _subjects: [doc['sourceResource.subject.name'] ?? []]
      .flat()
      .filter((s) => typeof s === 'string'),
  }
}

/**
 * Items DPLA's partners cataloged under an anchor's authorized heading.
 *
 * `ctx` is the corroboration context (src/relevance.js). When present and
 * the anchor is not the article's own subject, records whose subjects touch
 * the article nowhere beyond this anchor are dropped BEFORE ranking — they
 * are about the anchor, not about the article, and ranking cannot rescue
 * them because their titles were never going to share the anchor's tokens.
 * LUI-144's "reorders and dedupes; never filters" rule is about the
 * DENOMINATOR, and it stands: `total` is untouched, the shelf still says
 * "N of 60", and 60 is still true. What changed is that the sample is now
 * chosen from the records that connect to the article, and a heading none
 * of whose fetched records connect yields no shelf at all.
 * @returns {{entries: object[], total: number, heading: string}|null}
 */
export async function dplaEntries(lcId, anchorLabel, key, ctx) {
  const heading = await lcHeading(lcId)
  if (!heading) return null
  const body = await getJson(dplaUrl(heading, key))
  const docs = body.docs ?? []
  // Map, corroborate, fold exact repeats, then rank and cap. `total` is the
  // heading's own count and is deliberately NOT the number ranked over: the
  // shelf says "4 of 60", and 60 is how many DPLA holds, not how many rows
  // this request read.
  let all = docs.map((d) => dplaEntryFrom(d, heading, anchorLabel)).filter(Boolean)
  if (ctx?.topic && !ctx.isSubject) {
    all = all.filter((e) => corroborated(e._subjects, ctx.topic, ctx.ownQid))
  }
  const entries = rankShelfEntries(uniqueEntries(all), {
    heading,
    anchorLabel,
    cap: DPLA_PER_ANCHOR,
  })
  return { heading, total: body.count ?? docs.length, entries }
}

