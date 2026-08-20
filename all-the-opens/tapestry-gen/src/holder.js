// Which single institution holds the work this article is about — the
// detection and selection halves of the single-institution page
// (../docs/design-plans/2026-08-16-single-institution-work-pages.md).
// Pure over a wbgetentities claims object; fetches nothing.

// Direct P31 membership, deliberately without the ancestry walk: the
// 2026-08-16 census counted the round-one population by direct P31, so
// direct membership matches the measured population and costs zero
// requests on the lede's critical path. A subclass joins by joining this map.
export const WORK_CLASSES = new Map([
  ['Q3305213', 'painting'],
  ['Q860861', 'sculpture'],
  // The manuscript family (added 2026-08-20, the operator's call): the
  // same day's census measures 221 manuscript-family items with enwiki
  // articles and holder identifiers — genuinely held works with single
  // holding institutions, the material IIIF was practically built for.
  // Five direct-P31 classes because subclass membership is often the only
  // membership stated; the medium word is reader-facing prose ("this
  // manuscript"), so all five share it.
  ['Q87167', 'manuscript'],
  ['Q48498', 'manuscript'], // illuminated manuscript
  ['Q727715', 'manuscript'], // book of hours
  ['Q213924', 'manuscript'], // codex
  ['Q284465', 'manuscript'], // lectionary
])

// Precedence order per the design: museum object-id properties first, the
// shared IIIF door last. The door is special: "not one institution but a
// door many institutions share" (src/partners.js), and 680 of 1,424
// work-articles carry only P6108 — half the population (the checked-in
// census, ../docs/data/2026-08-17-holder-census.json). So an iiif
// selection is a CANDIDATE, not yet a holder: fetchHolderRecord must
// resolve the manifest's own stated institution, and a
// manifest that does not name exactly one gets no holder page — the
// masthead must never read "Wikipedia + IIIF collections" (design doc,
// Decisions, 2026-08-16). `collection` is the museum's Wikidata item,
// matched against the subject's P195 when a work carries several museum
// ids (versions, studies). No fuzzy matching lives here or anywhere
// downstream — a work whose graph states no holder id gets no holder.
export const HOLDERS = [
  { partner: 'rijks', property: 'P13234', collection: 'Q190804' },
  { partner: 'met', property: 'P3634', collection: 'Q160236' },
  { partner: 'artic', property: 'P4610', collection: 'Q239303' },
  { partner: 'cleveland', property: 'P11110', collection: 'Q657415' },
  { partner: 'getty', property: 'P2582', collection: 'Q731126' },
  { partner: 'iiif', property: 'P6108', collection: null },
]

// Raw wbgetentities claims carry every rank, and the repo invariant is that
// nothing rests on a deprecated identifier: preferred if any, else normal.
// Returns entity-valued and string-valued properties only — a caller needing
// a coordinate, date or quantity must read the datavalue itself.
export function bestRankValues(claims, property) {
  const statements = claims?.[property] ?? []
  const live = (rank) => statements.filter((s) => s.rank === rank)
  const chosen = live('preferred').length ? live('preferred') : live('normal')
  return chosen
    .map((s) => s.mainsnak?.datavalue?.value)
    .filter((v) => v != null)
    .map((v) => (typeof v === 'object' && 'id' in v ? v.id : v))
    .filter((v) => typeof v !== 'object') // Filter out non-entity objects like quantity/time/globecoordinate
}

export function workClass(claims) {
  for (const qid of bestRankValues(claims, 'P31')) {
    const medium = WORK_CLASSES.get(qid)
    if (medium) return medium
  }
  return null
}

export function selectHolder(claims) {
  const collections = new Set(bestRankValues(claims, 'P195'))
  const present = HOLDERS.map((h) => {
    const [id] = bestRankValues(claims, h.property)
    return id == null ? null : { partner: h.partner, property: h.property, id, _collection: h.collection }
  }).filter(Boolean)
  if (!present.length) return null
  const hangsThere = present.find((h) => h._collection && collections.has(h._collection))
  const { _collection, ...picked } = hangsThere ?? present[0]
  return picked
}

// Which of an anchor’s partner statements a single-institution page may
// dispatch. Applied BEFORE any request is built — no request is made, not
// merely no card rendered; politeness is part of the point. A museum holder
// keeps only its own property’s lookup, so an anchor carrying the holder’s
// id still cards; a manifest holder keeps none — an anchor’s P6108 points
// at whatever institution holds THAT object, and a two-party page must not
// fetch third institutions’ records. Everything else — the Smithsonian’s
// P195+P217 pair, taxa, occurrence maps, coordinates — drops with them.
// The values are src/statements.js’s binding names (P4610 binds as ‘aic’
// there — the documented seam; the partner key stays ‘artic’ everywhere
// else). No entry for ‘iiif’ is deliberate.
export const HOLDER_STATEMENT_VARS = new Map([
  ['rijks', 'rijks'],
  ['met', 'met'],
  ['artic', 'aic'],
  ['cleveland', 'cleveland'],
  ['getty', 'getty'],
])

export function holderStatements(stmts, holder) {
  if (!holder) return stmts
  const keep = HOLDER_STATEMENT_VARS.get(holder.partner)
  if (!keep || !(keep in stmts)) return {}
  return { [keep]: stmts[keep] }
}
