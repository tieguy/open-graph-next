// Artworks *by* the subject, held by partner museums.
//
// Added 2026-08-06. This is the third case of a pattern the project already
// had twice: `src/works.js` asks OpenLibrary for the books the subject wrote,
// and the ORCID lookup asks OpenAlex for the papers they published. An artist's
// paintings were the obvious missing third, and their absence was measurable.
//
// ## Why a query and not an anchor
//
// Every other visual lookup here follows the article's own wikilinks outward.
// On an artist's article that route very nearly fails, and the reason is
// structural rather than fixable in the ranking: **`proseLinks` strips
// `<table>` blocks**, and on an artist article the links to individual
// paintings live in galleries and works-tables, not in prose. Measured on
// enwiki's Rembrandt, 2026-08-06:
//
//   all links in the article        35 carry a museum id  (Met 11 · Rijks 14 · AIC 1 · IIIF 9)
//   survive the <table> strip       14                    (Met  2 · Rijks  5 · AIC 1 · IIIF 6)
//   reach the partner lookup          3
//   rendered as cards                2
//
// The strip is not a bug — it is what keeps navboxes, infoboxes and succession
// boxes from flooding every page — so the answer is to stop routing this
// question through the article's links at all. Wikidata already knows what the
// subject made and who holds it: `?work wdt:P170 ?subject` plus the same
// object-level identifiers the anchor lookup reads. Asked of the same six
// artists, that question answers 553 works for Rembrandt, 218 for Monet, 141
// for Hokusai, 96 for Van Gogh, 35 for Tissot and 12 for Vermeer.
//
// It also works on every artist article rather than only on ones with tidy
// galleries, and it costs ONE WDQS request — the article's own link structure
// never enters into it.
//
// ## Diversity is deliberate, and it is the whole point
//
// Rembrandt's 553 break down as 489 IIIF, 39 Met, 29 Rijksmuseum, 2 AIC. Take
// the first six in any natural order and you get six IIIF cards from the same
// two institutions — on the page whose entire argument is how many different
// friends hold this material. `pickDiverse` therefore round-robins across
// partners before it takes a second card from any of them.

import { getJson } from './http.js'

/**
 * How many rows to ask for.
 *
 * High enough that truncation is rare — the most prolific artist measured on
 * 2026-08-06 was Rembrandt at 553 works with a partner identifier, and Monet
 * 218 — because the row count IS the shelf's disclosure ("6 of 553"), and a
 * silently truncated total would print a false claim. When the query does hit
 * the ceiling `subjectArtworks` reports `truncated`, so the caller can say "at
 * least" rather than a number it cannot stand behind.
 */
const ROW_LIMIT = 1000

/** The partners that answer an object-level identifier, and their properties. */
const PARTNERS = [
  ['met', 'P3634'],
  ['rijks', 'P13234'],
  ['aic', 'P4610'],
  // Restricted holder-shelf queries only: the unrestricted UNION string is
  // deliberately untouched (its URL is pinned — widening it re-keys every
  // ordinary page's cached response, a separate decision).
  ['cleveland', 'P11110'],
  ['iiif', 'P6108'],
]

/**
 * Who holds it, in a reader's words, for the card's why line and ⓘ fold.
 *
 * Here rather than in the renderer's SOURCE map on purpose: this is the
 * lookup's own knowledge of which partner it asked, and a pipeline module that
 * imported the renderer would break the one invariant every module here keeps.
 * The entry's `source` still drives the icon and the credit; this only names
 * the institution inside a sentence the lookup itself writes.
 */
// Keyed by the entry's `source`, not by the partner key above: the Art
// Institute answers to `aic` in Wikidata and renders as `artic` on a card.
export const MUSEUM_NAME = {
  met: 'the Met',
  rijks: 'the Rijksmuseum',
  artic: 'the Art Institute of Chicago',
  // Not one institution: a P6108 manifest arrives from whichever library or
  // museum holds the object, and the manifest itself names which.
  iiif: 'the institution that holds it',
  cleveland: 'the Cleveland Museum of Art',
}

/**
 * Whether it is worth asking the graph what this subject made.
 *
 * The same shape of gate as `needsPlaceDefunctQuery` and `needsRightsQuery` in
 * src/statements.js, and for the same reason: WDQS sits on the lede's critical
 * path, and without this the lookup spends one request per page asking what
 * paintings a butterfly, a river or a court case produced. Only a person
 * creates artworks, so P31 → Q5 is the whole test, and the subject's claims
 * are already in hand — this costs nothing to ask.
 *
 * **Deliberately narrow.** A workshop, a studio or an artists' collective is
 * not Q5 and so gets no artworks shelf. That is a trade, not an oversight: the
 * alternative is a class walk, which is exactly the transitive query CLAUDE.md
 * records as having cost 16–37s and blown the timeout when mappability tried
 * it. If a workshop page ever matters, add its class here explicitly rather
 * than reaching for P279*.
 */
export function needsArtworksQuery(subjectClaims) {
  return (subjectClaims?.P31 ?? []).some((c) => c?.mainsnak?.datavalue?.value?.id === 'Q5')
}

/**
 * One query: everything the subject made that a partner holds.
 *
 * UNION rather than stacked OPTIONALs, for the reason CLAUDE.md already gives
 * about the rights query: every property here is multi-valued, so OPTIONALs
 * would return their cross product — a work in three IIIF collections and the
 * Met would arrive as four identical-looking rows. Branches that answer alone
 * keep the row count additive.
 *
 * `?sitelink` is the ordering signal, not a filter: a work with an English
 * Wikipedia article of its own is more likely to be one a reader recognizes.
 * It does NOT mean the work is visible on the article being rendered — that is
 * the whole point, these are the paintings the Wikipedia article does not show.
 */
export function subjectArtworksUrl(qid, limit = ROW_LIMIT, options = {}) {
  const { property } = options
  let query
  if (property) {
    // Restricted to a single property for holder pages: no UNION, just the one binding
    const bindingName = propertyBindingName(property)
    query =
      `SELECT ?work ?workLabel ?${bindingName} ?sitelink WHERE { ` +
      `?work wdt:P170 wd:${qid} . ` +
      `?work wdt:${property} ?${bindingName} . ` +
      `OPTIONAL { ?sitelink schema:about ?work ; schema:isPartOf <https://en.wikipedia.org/> } ` +
      `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ` +
      `ORDER BY ?work LIMIT ${limit}`
  } else {
    // Unrestricted: all four properties via UNION
    query =
      `SELECT ?work ?workLabel ?met ?rijks ?aic ?iiif ?sitelink WHERE { ` +
      `?work wdt:P170 wd:${qid} . ` +
      `{ ?work wdt:P3634 ?met } UNION { ?work wdt:P13234 ?rijks } ` +
      `UNION { ?work wdt:P4610 ?aic } UNION { ?work wdt:P6108 ?iiif } ` +
      `OPTIONAL { ?sitelink schema:about ?work ; schema:isPartOf <https://en.wikipedia.org/> } ` +
      `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ` +
      // Stable order so a warm re-render is byte-identical: WDQS makes no
      // ordering promise of its own, and this shelf must not shuffle between
      // runs off the same cache.
      `ORDER BY ?work LIMIT ${limit}`
  }
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * Map a Wikidata property to its binding name in the SPARQL result.
 * This internal function handles the seam: P4610 uses 'aic' binding internally.
 */
function propertyBindingName(property) {
  // Derived from PARTNERS so the mapping cannot drift from the bindings
  // artworkRows reads. The documented seam rides along: the partner key is
  // 'artic' everywhere else but 'aic' here; the boundary passes the
  // PROPERTY, so no partner-key mapping is needed — the property is
  // unambiguous.
  const entry = PARTNERS.find(([, p]) => p === property)
  if (!entry) {
    // An unknown property would build a valid query whose binding nothing
    // reads — an empty shelf with no error. That is a programming error,
    // not a degradation.
    throw new Error(`no artworks binding for property ${property}`)
  }
  return entry[0]
}

/**
 * WDQS rows → one record per work, collecting the identifiers each one has.
 *
 * A work reachable through two partners keeps both, so `pickDiverse` can hand
 * it to whichever one still needs a slot.
 */
export function artworkRows(body) {
  const out = new Map()
  for (const row of body?.results?.bindings ?? []) {
    const uri = row.work?.value
    const qid = typeof uri === 'string' ? uri.split('/').pop() : null
    if (!qid || !/^Q\d+$/.test(qid)) continue
    const rec = out.get(qid) ?? { qid, label: null, ids: {}, sitelink: false }
    // `workLabel` falls back to the bare QID when an item has no English
    // label; a card titled "Q123456" is worse than no card, so it is refused
    // here rather than rendered.
    const label = row.workLabel?.value
    if (typeof label === 'string' && label && label !== qid) rec.label = label
    if (row.sitelink?.value) rec.sitelink = true
    for (const [key] of PARTNERS) {
      const v = row[key]?.value
      if (typeof v === 'string' && v) rec.ids[key] = v
    }
    out.set(qid, rec)
  }
  return [...out.values()].filter((r) => r.label)
}

/**
 * Up to `cap` works, spread across as many partners as possible.
 *
 * Round-robin: one pass hands each partner its best remaining work, then the
 * next pass does it again, until the cap is met or nothing is left. Within a
 * partner, works with their own Wikipedia article come first and QID order
 * breaks the tie — arbitrary but stable, which is what byte-reproducibility
 * needs. A work already taken by an earlier partner is skipped, so nothing is
 * shown twice.
 *
 * `exclude` drops works the page is already carding as anchors, so the
 * subject's shelf never repeats a painting the lede just showed.
 */
export function pickDiverse(records, { cap, exclude = new Set() } = {}) {
  const queues = new Map(
    PARTNERS.map(([key]) => [
      key,
      records
        .filter((r) => r.ids[key] && !exclude.has(r.qid))
        .sort((a, b) => Number(b.sitelink) - Number(a.sitelink) || (a.qid < b.qid ? -1 : 1)),
    ]),
  )
  const taken = new Set()
  const picked = []
  let progressed = true
  while (picked.length < cap && progressed) {
    progressed = false
    for (const [key, queue] of queues) {
      if (picked.length >= cap) break
      const next = queue.find((r) => !taken.has(r.qid))
      if (!next) continue
      taken.add(next.qid)
      picked.push({ ...next, via: key })
      progressed = true
    }
  }
  return picked
}

/** How many works the subject has in each partner, for the shelf's disclosure. */
export function artworkTotals(records) {
  const totals = {}
  for (const [key] of PARTNERS) totals[key] = records.filter((r) => r.ids[key]).length
  return { ...totals, works: records.length }
}

/**
 * The subject's artworks: one WDQS request, then one fetch per picked work on
 * its own partner's host queue.
 *
 * `fetchEntry(partnerKey, id, label)` is injected so this module stays free of
 * the per-partner fetchers (and so the pick logic above can be tested without
 * a network). A partner that throws costs its own card and never the shelf.
 *
 * On a single-institution holder page, `options.property` restricts the query
 * to that one property only (e.g., 'P13234' for Rijksmuseum). The unrestricted
 * default keeps the UNION and matches the pre-change cached responses.
 */
export async function subjectArtworks(qid, { cap, exclude, fetchEntry, property }) {
  const body = await getJson(subjectArtworksUrl(qid, ROW_LIMIT, property ? { property } : {}))
  const records = artworkRows(body)
  // Over-pick, then walk the list until `cap` cards actually exist.
  //
  // A partner that answers 403 must cost its own card and not a SLOT: taking
  // exactly `cap` candidates meant one dead IIIF manifest left the shelf a
  // card short, and IIIF manifests really do 403 — three of them did across
  // Rembrandt and Vermeer on 2026-08-06. Round-robin order is preserved, so
  // walking further down the list keeps spreading across partners rather than
  // falling back on whoever is most numerous.
  const candidates = pickDiverse(records, { cap: cap * 3, exclude })
  const entries = []
  let attempts = 0
  // Serial: each of these rides its partner's host queue anyway, and the
  // Rijksmuseum walk is three requests deep on a single host. The attempt
  // ceiling stops a partner having a bad day from turning one shelf into
  // dozens of requests.
  for (const rec of candidates) {
    if (entries.length >= cap || attempts >= cap + 4) break
    attempts += 1
    try {
      const entry = await fetchEntry(rec.via, rec.ids[rec.via], rec.label)
      if (entry) entries.push({ ...entry, _qid: rec.qid })
    } catch (e) {
      console.error(`  artwork lookup failed (${rec.qid} via ${rec.via}): ${e.message}`)
    }
  }
  return {
    entries,
    totals: artworkTotals(records),
    total: records.length,
    // The query hit its ceiling, so `total` is a floor and not a count.
    truncated: (body?.results?.bindings ?? []).length >= ROW_LIMIT,
  }
}
