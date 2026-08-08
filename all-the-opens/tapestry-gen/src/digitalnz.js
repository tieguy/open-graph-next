// The DigitalNZ pivot: 150+ New Zealand libraries, archives and museums
// (Turnbull/NLNZ, Massey, VUW, Auckland Museum, Ngā Taonga, Papers Past)
// behind one API — this demo's first non-US/EU partner (LUI-145). Same shape
// as DPLA: the anchor is a real key, not a label. Wikidata states the
// entity's Library of Congress authority (P244); NLNZ is not an independent
// VIAF contributor and catalogs through LC/NACO (checked on VIAF's
// contributor list 2026-08-08), so the same authorized heading DPLA already
// resolves is also the right search string here — `lcHeading` is reused
// rather than reimplemented. An anchor with no LC authority does not pivot.
//
// Verified live 2026-08-08 (see LUI-145): `text="John Stuart Yeates"`
// answered a KEYLESS request with 8 records, so — unlike DPLA and Europeana —
// this API may not strictly require a key. This module still gates on
// DIGITALNZ_API_KEY, for the same reason DPLA/Europeana do: a registered key
// can negotiate a higher rate than unauthenticated traffic (DigitalNZ's own
// stated policy — see hostLimit's comment in src/mw.js), and the demo must
// still run keyless for anyone who clones it, silently absent without one.
//
// **Unverified against a live response as of this commit.** This session had
// no outbound network access at all (confirmed: even api.dp.la and
// example.com were unreachable through the egress proxy), so the field
// names below — `search.results`, `content_partner`, `landing_url`,
// `thumbnail_url`, `usage` — follow the DigitalNZ v3 Records API's published
// shape and the Metadata Dictionary as best known, cross-checked only
// against the `usage` values LUI-145 quotes from a real query. Confirm
// against a real response before this ships, per CLAUDE.md's "verify with
// spike.js, not with reasoning about the diff."

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'
import { lcHeading } from './dpla.js'

export const DIGITALNZ_PER_ANCHOR = 4

export function digitalnzUrl(heading, key) {
  return (
    'https://api.digitalnz.org/v3/records.json' +
    `?text=${encodeURIComponent(`"${heading}"`)}` +
    '&fields=id,title,content_partner,landing_url,thumbnail_url,large_thumbnail_url,usage' +
    `&per_page=${DIGITALNZ_PER_ANCHOR}&api_key=${key}`
  )
}

/**
 * Where a reader goes to browse a heading this page declined to sample —
 * DPLA's `dplaBrowseUrl` twin. Deliberately the same `text=` query the API
 * ran, quoted the same way, so the count sentence in src/breadth.js names the
 * set the link actually opens.
 */
export function digitalnzBrowseUrl(heading) {
  return `https://digitalnz.org/records?text=${encodeURIComponent(`"${heading}"`)}`
}

const first = (v) => (Array.isArray(v) ? v[0] : v)

/**
 * DigitalNZ's own usage rollup: plain-English capability words
 * (`Share`/`Modify`/`Use commercially`/`Attribution`/`NonCommercial`/
 * `NoDerivatives`), not a URI or slug, so it needs its own reading rather
 * than an extension of `ccFromUri`. Only the two unambiguous ends of it are
 * read, per LUI-145's explicit rule ("`Unknown` gets nothing; a mark is
 * never a guess"):
 *
 * - `All rights reserved` says plainly what `rightsstatements.org`'s InC
 *   vocabulary already says, so it is routed through `ccFromUri` with that
 *   literal URI rather than adding a new entry to rights.js's license
 *   table — the same reuse `metEntryFrom`/`aicEntryFrom` already do for a
 *   fixed CC0 URI.
 * - `Unknown` and anything else, including the affirmative combination
 *   (`Share`+`Modify`+`Use commercially`) alone, get no mark. DigitalNZ
 *   states what a reader MAY DO, not which license grants it or whether
 *   attribution is required — a CC0/public-domain glyph there would assert a
 *   permission nobody stated. That combination is instead said in words in
 *   the card's credit line, the same choice already made for GBIF and
 *   OpenStreetMap, whose vocabularies don't map onto a glyph honestly
 *   either (see the partner audit in tapestry-gen/CLAUDE.md).
 */
export function digitalnzRights(usage) {
  const set = new Set(Array.isArray(usage) ? usage : [])
  if (set.has('All rights reserved')) {
    return licenseView(ccFromUri('http://rightsstatements.org/vocab/InC/1.0/'))
  }
  return null
}

/** The plain-words credit DigitalNZ's affirmative usage terms support, or null. */
function usageWords(usage) {
  const set = new Set(Array.isArray(usage) ? usage : [])
  const words = [
    set.has('Share') && 'shared',
    set.has('Modify') && 'modified',
    set.has('Use commercially') && 'used commercially',
  ].filter(Boolean)
  return words.length ? `May be ${words.join(', ')}` : null
}

/** One DigitalNZ record as a page entry; null when it cannot be shown honestly. */
export function digitalnzEntryFrom(record, heading, anchorLabel) {
  const title = record?.title
  if (!title || !(record?.id || record?.landing_url)) return null
  const provider = first(record.content_partner) ?? null
  const rights = digitalnzRights(record.usage)
  const words = usageWords(record.usage)
  return {
    source: 'digitalnz',
    title,
    description: provider ?? 'A DigitalNZ partner institution',
    imageUrl: record.large_thumbnail_url ?? record.thumbnail_url ?? null,
    // DigitalNZ's own durable record page, not `landing_url` — the same
    // choice `dplaEntryFrom` makes for `dp.la/item/…` over a partner host
    // that may rot out from under the aggregator.
    href: record.id ? `https://digitalnz.org/records/${record.id}` : record.landing_url,
    attribution: {
      // Names the CONTRIBUTING institution (Turnbull, Massey), never just
      // "DigitalNZ" — LUI-145's explicit provenance requirement, the same
      // argument the Commons-is-a-door decision already made.
      author: [provider, rights?.label ?? words].filter(Boolean).join(' · ') || provider,
      license: null,
    },
    rights: { copy: rights },
    why: `Filed under “${heading}” — the subject heading libraries catalog ${anchorLabel ?? 'this'} under`,
    topic: anchorLabel ?? heading,
    _via: 'P244',
  }
}

/**
 * Items DigitalNZ's partners cataloged under an anchor's authorized heading.
 * @returns {{entries: object[], total: number, heading: string}|null}
 */
export async function digitalnzEntries(lcId, anchorLabel, key) {
  const heading = await lcHeading(lcId)
  if (!heading) return null
  const body = await getJson(digitalnzUrl(heading, key))
  const results = body.search?.results ?? []
  const entries = results.map((r) => digitalnzEntryFrom(r, heading, anchorLabel)).filter(Boolean)
  return { heading, total: body.search?.result_count ?? results.length, entries }
}
