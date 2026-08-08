// The DigitalNZ pivot: 150+ New Zealand libraries, archives and museums
// (Turnbull/NLNZ, Massey, VUW, Auckland Museum, Ngā Taonga, Papers Past)
// behind one API — this demo's first non-US/EU partner (LUI-145). Same shape
// as DPLA: the anchor is a real key, not a label. Wikidata states the
// entity's Library of Congress authority (P244); NLNZ is not an independent
// VIAF contributor and catalogs through LC/NACO (checked on VIAF's
// contributor list 2026-08-08), so LC's record carries the NZ heading. An
// anchor with no LC authority does not pivot.
//
// **The search is a subject filter, strictly — not full text** (live-verified
// 2026-08-08, LUI-145). The DPLA analogy holds only if the heading lands on a
// subject field: DPLA queries `sourceResource.subject.name`, where LCSH
// headings actually live, but DigitalNZ's `text=` is generic full text over
// titles and descriptions, and quoting the authorized heading into it
// returned ZERO records for the very article this pivot was built for. What
// works is `and/or[subject][]=` with the heading form NZ catalogers actually
// use — which is LC's *variant*, not its authorized form (see src/lc.js). So
// this asks the API only for records whose own subject field states one of
// LC's forms, and every card's claim ("cataloged under this heading") is
// verifiably true of that record. The cost is real and accepted for now:
// records without a person-level subject — including openly licensed images
// where the name appears only in the title — never surface. Whether a
// looser, honestly-weaker match is worth it is deliberately NOT decided
// per-partner; it is filed to be answered across sources or not at all
// (LUI-146, and the generalization value in VALUES.md).
//
// **A key is optional here, unlike DPLA and Europeana** (verified 2026-08-08):
// the v3 API answers keyless requests, under a shared unauthenticated cap
// DigitalNZ's docs describe without numbering (see hostLimit's comment in
// src/mw.js — the default of 1 stands). One sharp edge the first draft of
// this module got wrong: `api_key=` with an EMPTY or invalid value is a 403,
// so keyless means omitting the parameter entirely, never passing ''.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'
import { lcLabels } from './lc.js'

export const DIGITALNZ_PER_ANCHOR = 4

/** The subject-filter query for a set of heading forms; key omitted when absent. */
export function digitalnzUrl(forms, key) {
  const filters = forms.map((f) => `or[subject][]=${encodeURIComponent(f)}`).join('&')
  return (
    'https://api.digitalnz.org/v3/records.json?' +
    filters +
    '&fields=id,title,content_partner,landing_url,thumbnail_url,large_thumbnail_url,usage,subject' +
    `&per_page=${DIGITALNZ_PER_ANCHOR}` +
    (key ? `&api_key=${key}` : '')
  )
}

/**
 * Where a reader goes to browse a heading this page declined to sample —
 * DPLA's `dplaBrowseUrl` twin. The website exposes no subject-filter URL that
 * a script can verify, so this opens the site's own search for the exact
 * quoted heading; for the fixture (Yeates) the API answers the same single
 * record for both, but in general a full-text phrase search can find MORE
 * than the subject field alone — a browse that over-shows is acceptable
 * where one that under-shows would not be.
 */
export function digitalnzBrowseUrl(heading) {
  return `https://digitalnz.org/records?text=${encodeURIComponent(`"${heading}"`)}`
}

const first = (v) => (Array.isArray(v) ? v[0] : v)

/**
 * The strict test a record must pass to become a card: its OWN subject field
 * states one of the LC record's heading forms. The or[subject][] query
 * already asked for exactly this, so a miss here should not happen — it is
 * kept because the claim each card makes rests on it, and a filter that
 * merely trusts the query would let an API quirk turn into a false sentence.
 * Returns the form that matched, which is the heading the card names.
 */
export function subjectMatch(record, forms) {
  const subjects = Array.isArray(record?.subject) ? record.subject : []
  return forms.find((f) => subjects.includes(f)) ?? null
}

/**
 * DigitalNZ's own usage rollup: plain-English capability words
 * (`Share`/`Modify`/`Use commercially`/`All rights reserved`/`Unknown`), not
 * a URI or slug, so it needs its own reading rather than an extension of
 * `ccFromUri`. Three values are read; a LICENSE mark is still never a guess:
 *
 * - `All rights reserved` says plainly what `rightsstatements.org`'s InC
 *   vocabulary already says, so it is routed through `ccFromUri` with that
 *   literal URI rather than adding a new entry to rights.js's license
 *   table — the same reuse `metEntryFrom`/`aicEntryFrom` already do for a
 *   fixed CC0 URI.
 * - `Unknown` carries the ? mark (2026-08-08, with CNE/UND and Wikidata's
 *   "not yet determined"): the aggregator honestly recorded an open
 *   question, and the card says so instead of staying silent — silence here
 *   was indistinguishable from a partner that publishes no rights fields at
 *   all. The Turnbull hero on the Yeates fixture is exactly this case.
 * - The affirmative combination (`Share`+`Modify`+`Use commercially`) alone
 *   still gets no mark. DigitalNZ states what a reader MAY DO, not which
 *   license grants it or whether attribution is required — a CC0/
 *   public-domain glyph there would assert a permission nobody stated. It is
 *   said in words in the card's credit line, the same choice already made
 *   for GBIF and OpenStreetMap, whose vocabularies don't map onto a glyph
 *   honestly either (see the partner audit in tapestry-gen/CLAUDE.md).
 */
export function digitalnzRights(usage) {
  const set = new Set(Array.isArray(usage) ? usage : [])
  if (set.has('All rights reserved')) {
    return licenseView(ccFromUri('http://rightsstatements.org/vocab/InC/1.0/'))
  }
  if (set.has('Unknown')) {
    // Not a LICENSES entry: this is DigitalNZ's own vocabulary, and there is
    // no URI to link — the fold's text (rightsDetail in emit-html.js) is
    // keyed on the code and says whose non-answer it is.
    return { code: 'UNKNOWN', label: 'rights unknown', marks: ['unknown'], url: null }
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

/**
 * One DigitalNZ record as a page entry; null when it cannot be shown
 * honestly. `heading` is the LC form this record's own subject field matched.
 */
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
    why: `Filed under “${heading}” — the heading this record’s own catalog entry states for ${anchorLabel ?? 'this subject'}`,
    topic: anchorLabel ?? heading,
    _via: 'P244',
  }
}

/**
 * Items DigitalNZ's partners cataloged under an anchor's LC heading forms.
 * @returns {{entries: object[], total: number, heading: string}|null}
 */
export async function digitalnzEntries(lcId, anchorLabel, key) {
  const labels = await lcLabels(lcId)
  if (!labels) return null
  const forms = [labels.heading, ...labels.variants]
  const body = await getJson(digitalnzUrl(forms, key))
  const results = body.search?.results ?? []
  const entries = []
  let heading = null
  for (const record of results) {
    const form = subjectMatch(record, forms)
    if (!form) continue
    heading ??= form
    const entry = digitalnzEntryFrom(record, form, anchorLabel)
    if (entry) entries.push(entry)
  }
  if (!entries.length) return null
  return { heading, total: body.search?.result_count ?? results.length, entries }
}
