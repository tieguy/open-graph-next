// The statement pivots: an anchored entity's Wikidata statements name an
// object in a partner collection, and the partner's open API supplies the
// object itself. Museums (Met P3634, Art Institute of Chicago P4610,
// Rijksmuseum P13234),
// biodiversity (iNaturalist P3151, GBIF P846), and place (P625 coordinates →
// OpenStreetMap render). One WDQS query answers every anchor's partner
// statements; two small follow-ups decide which anchors are mappable places,
// and the per-object fetches then ride each partner's own host queue.
//
// These are `statement` evidence — Wikidata states the connection outright.
// The property that made each card is named in its ⓘ fold, not in the credit
// line: a reader looking at "The Met · public domain (CC0)" wants to know who
// holds it and whether they may reuse it, and "via P3634" answers neither.

import { chunk } from './batch.js'
import { getJson, readFacts, writeFacts } from './http.js'
import { iiifEntry } from './iiif.js'
import { ccFromSlug, ccFromUri, licenseView } from './rights.js'
import { rijksEntry } from './rijks.js'
import { isSmithsonianCollection, siCollectionName, smithsonianEntry } from './smithsonian.js'

/** Properties this pivot reads, and the shape they come back in. */
const VARS = ['met', 'aic', 'rijks', 'gbif', 'inat', 'coord', 'osmr', 'osmw', 'osmn', 'iiif', 'lc', 'eu', 'sicoll', 'siinv']

export function wdqsUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?met ?aic ?rijks ?gbif ?inat ?coord ?osmr ?osmw ?osmn ?iiif ?lc ?eu ?sicoll ?siinv WHERE { VALUES ?item { ${values} } ` +
    'OPTIONAL { ?item wdt:P3634 ?met } OPTIONAL { ?item wdt:P4610 ?aic } ' +
    // P13234: the Rijksmuseum's own object id (added 2026-08-06) — same
    // object-level shape as the Met and AIC ids above, and the best-answering
    // of the three on art-heavy articles. See src/rijks.js.
    'OPTIONAL { ?item wdt:P13234 ?rijks } ' +
    'OPTIONAL { ?item wdt:P846 ?gbif } OPTIONAL { ?item wdt:P3151 ?inat } ' +
    'OPTIONAL { ?item wdt:P625 ?coord } ' +
    'OPTIONAL { ?item wdt:P402 ?osmr } OPTIONAL { ?item wdt:P10689 ?osmw } ' +
    'OPTIONAL { ?item wdt:P11693 ?osmn } ' +
    // P6108: the item's own IIIF manifest — any institution, one property.
    'OPTIONAL { ?item wdt:P6108 ?iiif } ' +
    // P244: the LC authority behind the DPLA subject-heading pivot.
    'OPTIONAL { ?item wdt:P244 ?lc } ' +
    // P7704: the Europeana entity behind the Europeana pivot.
    'OPTIONAL { ?item wdt:P7704 ?eu } ' +
    // The Smithsonian, alone among the museums here, states no external-id
    // property on its objects — Columbia, the Apollo 11 command module, carries
    // none of P3634/P4610/P13234/P6108. It carries P195 (which museum holds it)
    // and P217 (that museum's accession number), and the Open Access API
    // indexes the accession number. The pair must come from ONE optional block:
    // read separately, an object in a Smithsonian collection could be paired
    // with another museum's inventory number. See src/smithsonian.js.
    'OPTIONAL { ?item wdt:P195 ?sicoll ; wdt:P217 ?siinv } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * Whether a QID's bindings carry enough location info to be worth asking about.
 * Nothing but a map card consumes place/defunct, so an anchor with neither a
 * coordinate nor an OSM identifier could not use the answer. This pure function
 * factors that decision out so it can be tested, which keeps the follow-up
 * batches bounded by construction rather than by hope. It admits an item with
 * an OSM id but no coordinate, which can never draw a map (parseEarthPoint
 * needs the P625 literal); that costs a row in a cheap query and keeps the
 * gate a plain statement of "has location evidence".
 */
export function needsPlaceDefunctQuery(statements) {
  return Boolean(statements.coord || statements.osmr || statements.osmw || statements.osmn)
}

/**
 * Whether it is worth asking Wikidata for this anchor's copyright status.
 *
 * The same shape of gate as `needsPlaceDefunctQuery`, and for the same reason:
 * a page's picked anchors are mostly people, places, concepts and events, and
 * a copyright status is a property of a **work**. Asking about all of them
 * would spend a WDQS query answering "no" for a battle and a river.
 *
 * The three properties admitted here are the ones that only an object has —
 * the Met's record of it, the Art Institute's, or its own IIIF manifest. That
 * is deliberately narrower than "anything that might be a work": a false
 * negative costs one card its rights marks, a wider gate costs every page a
 * slower lede. The subject QID is asked about unconditionally by the caller,
 * because the article's own subject is where a reader most wants the answer
 * and it is one item.
 *
 * Notably NOT admitted: `eu` (Europeana). A Europeana entity URI names a
 * person or a topic, and the items returned under it are *about* that entity
 * rather than being it — so the anchor's copyright status would be a claim
 * about the wrong thing.
 */
export function needsRightsQuery(statements) {
  return Boolean(statements?.met || statements?.aic || statements?.rijks || statements?.iiif)
}

/**
 * Mappability is answered by two small follow-up queries rather than by
 * enriching the partner-statement query, because the transitive walk is what
 * costs: asked of the items, `P31/P279*` over a real page's anchors measured
 * 16–37s cold and blew the 15s timeout every time; and because that walk rode
 * the query answering EVERY partner pivot, a timeout cost the page its Met,
 * AIC, GBIF, iNat, IIIF, DPLA and Europeana cards as well as its maps.
 *
 * Query 1 (itemClassesUrl) asks only direct P31/P576 of the location-bearing
 * anchors — no closure, measured 0.19–0.32s cold. Query 2 (classesUrl) walks
 * P279* over just the distinct classes that came back (~10–30 per page, a
 * small and near-static vocabulary that caches well), measured 0.32–0.50s
 * cold. Both numbers are from salted queries, so WDQS could not serve a
 * cached result. For scale, the deleted item-level walk measured 16–37s on
 * the same real anchors, blowing the 15s timeout on every run.
 *
 * The structural guarantee, and the thing to preserve: no transitive walk is
 * ever asked of items, only of classes. A test asserts query 1 contains no
 * P279 and query 2 contains no EXISTS.
 *
 * Failure semantic: either query failing leaves place/defunct unset, mappable()
 * refuses, and the page loses maps only — never a partner pivot.
 */
// Q618123 geographical feature · Q486972 human settlement · Q56061
// administrative territorial entity · Q41176 building · Q811979 architectural
// structure · Q43229 organization — the last is what keeps an institution's
// headquarters, like the EFEO, mappable.
const LOCATABLE_CLASSES = new Set([
  'Q618123',
  'Q486972',
  'Q56061',
  'Q41176',
  'Q811979',
  'Q43229',
])
const HISTORICAL_COUNTRY = 'Q3024240'

export function itemClassesUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?class ?ended WHERE { VALUES ?item { ${values} } ` +
    'OPTIONAL { ?item wdt:P31 ?class } ' +
    'OPTIONAL { ?item wdt:P576 ?ended } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * The class hierarchy query: walk P279* over classes only, never items.
 * Input is the distinct classes from itemClassesUrl(). Returns one row per
 * (class, ancestor) pair — the classification against the allowsets happens
 * in JS, in mergePlaceDefunct, for the reason the body comment gives.
 */
export function classesUrl(classes) {
  const values = classes.map((c) => `wd:${c}`).join(' ')
  // Ask for each class's ancestors and intersect against the allowsets in JS,
  // rather than asking WDQS the membership question directly. An
  // `EXISTS { VALUES ?locClass {…} ?class wdt:P279* ?locClass }` makes
  // Blazegraph re-plan the walk per class and per target: measured cold on
  // twenty real classes it costs 11–24s, against getJson's 15s timeout.
  // The same twenty answered as a plain ancestor walk in 0.32–0.50s. The walk
  // returns far more rows — 237KB for twenty classes, 821KB for a full chunk
  // of a hundred, but 6.3KB and 22.9KB gzipped on the wire — and that is the
  // trade: bytes are cheap, Blazegraph CPU is the donated resource, and a
  // query that times out costs every map on the page.
  const query = `SELECT ?class ?super WHERE { VALUES ?class { ${values} } ?class wdt:P279* ?super }`
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * Whether a map card would be TRUE of this item: a locatable, extant place.
 * `place`/`defunct` are the strings 'true'/'false', not booleans — a leftover
 * of the deleted design that asked WDQS the question directly and got xsd
 * booleans on the wire. mergePlaceDefunct writes them in JS now, so the
 * convention is purely internal; it is kept only because changing it would
 * touch every call site for no behavioral gain. An item nothing answered for
 * stays unmappable — refusal over wrongness, the same stance parseEarthPoint
 * takes for non-Earth globes.
 */
export function mappable(statements) {
  return statements.place === 'true' && statements.defunct !== 'true'
}

/**
 * The OSM feature an entity's statements name, most specific first: a way or
 * node outlines the thing itself (a building, a monument), a relation may be
 * anything from a campus to a country. Null when only coordinates exist.
 */
export function osmFeature(statements) {
  if (statements.osmw) return { kind: 'way', id: statements.osmw, via: 'P10689', zoom: 15 }
  if (statements.osmn) return { kind: 'node', id: statements.osmn, via: 'P11693', zoom: 16 }
  if (statements.osmr) return { kind: 'relation', id: statements.osmr, via: 'P402', zoom: 11 }
  return null
}

/**
 * A P625 WKT literal as {lat, lon}, or null. A leading `<entity>` prefix
 * names a non-Earth globe — Tranquility Base is a real place with real
 * coordinates that OpenStreetMap has never surveyed — so those return null
 * rather than a confidently wrong map of the Atlantic.
 */
export function parseEarthPoint(wkt) {
  if (!wkt || /^</.test(wkt.trim())) return null
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(wkt)
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null
}

/**
 * Pure merge function: combine item-class bindings and class-hierarchy results
 * into place/defunct booleans for each item.
 *
 * @param {Map<string, object>} itemMap - map from QID to statement object (from main query)
 * @param {Array} classRows - bindings from classesUrl query
 * @param {Map<string, Set<string>>} itemClasses - QID → its P31 classes (from itemClassesUrl)
 * @param {Set<string>} itemsWithEnded - QIDs that have P576 (ended) bindings
 * @returns {Map<string, object>} - updated itemMap with place/defunct booleans
 *
 * The merge builds two sets from classRows:
 * - placeClasses: classes that are or subclass the mappable location set
 * - defunctClasses: classes that subclass the historical-polity class
 *
 * For each item with location data: place='true' if ANY of its P31 classes
 * reaches the allowset, defunct='true' if it has P576 (ended) or ANY of its
 * classes reaches the historical-polity class. Any, not one — an item averages
 * ~2.7 P31 values and the EFEO is both a research institute and a publisher.
 * Items with no class binding (no P31) are marked both false to exclude from maps.
 */
export function mergePlaceDefunct(itemMap, classRows, itemClasses, itemsWithEnded = new Set()) {
  return applyVerdicts(itemMap, classVerdicts(classRows), itemClasses, itemsWithEnded)
}

/**
 * The hierarchy query's rows reduced to one verdict per class — which is the
 * only part of a 237KB answer worth keeping, and small enough to cache.
 *
 * A class is mappable if any ancestor is in the allowset, defunct if any is
 * Q3024240. `P279*` includes the class itself, so a class that IS an allowset
 * member qualifies without a special case — and, usefully here, every class
 * asked about appears in at least one row, so a class that reaches nothing
 * still gets an explicit `{place:false}` rather than being indistinguishable
 * from one nobody asked about.
 *
 * @returns {Map<string, {place: boolean, defunct: boolean}>}
 */
export function classVerdicts(classRows) {
  const out = new Map()
  for (const row of classRows) {
    const classQid = row.class?.value?.split('/').pop()
    const superQid = row.super?.value?.split('/').pop()
    if (!classQid || !superQid) continue
    const cur = out.get(classQid) ?? { place: false, defunct: false }
    if (LOCATABLE_CLASSES.has(superQid)) cur.place = true
    if (superQid === HISTORICAL_COUNTRY) cur.defunct = true
    out.set(classQid, cur)
  }
  return out
}

/**
 * Item verdicts from class verdicts. Split from `mergePlaceDefunct` so the
 * class half can come from a cache instead of a query — see resolveMappability.
 */
export function applyVerdicts(itemMap, verdicts, itemClasses, itemsWithEnded = new Set()) {
  const placeClasses = { has: (c) => verdicts.get(c)?.place === true }
  const defunctClasses = { has: (c) => verdicts.get(c)?.defunct === true }

  // For each item with location data, mark place/defunct based on class membership.
  for (const [qid, statements] of itemMap.entries()) {
    if (!needsPlaceDefunctQuery(statements)) continue // Skip items with no location data

    const classes = itemClasses.get(qid)
    if (!classes?.size) {
      // Item had no P31 binding (unusual for mappable things, but possible).
      // Writing 'false' is belt-and-braces: mappable() already refuses on
      // undefined, so this branch and the one in entityStatements below are
      // both no-ops. They state the refusal rather than leaving it implied.
      statements.place = 'false'
      statements.defunct = 'false'
      continue
    }

    // Any qualifying class makes it a place — mirroring the EXISTS this
    // assembly replaces, which was true if any P31 reached the allowset.
    statements.place = [...classes].some((c) => placeClasses.has(c)) ? 'true' : 'false'

    // Defunct if ended (P576) or any class is historical.
    const hasEnded = itemsWithEnded.has(qid)
    statements.defunct =
      hasEnded || [...classes].some((c) => defunctClasses.has(c)) ? 'true' : 'false'
  }

  return itemMap
}

/**
 * Every candidate's partner statements, in one query per 100 — the CHEAP half.
 *
 * Split out from `entityStatements` on 2026-08-05 so the pipeline can ask this
 * of every anchor a page could use, rather than only the two per section it
 * picked blind. That inversion is the point: a section used to choose two
 * anchors before knowing whether either had anything, and if both came back
 * empty the section stayed empty even when its third link held a Met object.
 * Measured on Apollo 11: 49 anchors in 0.37s becomes 331 in 0.93s — four
 * chunks instead of one, on a page that takes tens of seconds cold.
 *
 * The expensive half (the class walk) deliberately does NOT widen with it;
 * see resolveMappability.
 *
 * @returns {Map<string, {met?, aic?, gbif?, inat?, coord?, lc?, eu?, iiif?}>}
 */
export async function partnerStatements(qids) {
  const map = new Map()
  for (const group of chunk([...new Set(qids)].filter(Boolean), 100)) {
    let rows = []
    try {
      rows = (await getJson(wdqsUrl(group))).results?.bindings ?? []
    } catch (e) {
      console.error(`  wdqs statements failed (${group.length} entities): ${e.message}`)
      continue
    }
    for (const row of rows) {
      const qid = row.item?.value?.split('/').pop()
      if (!qid) continue
      const cur = map.get(qid) ?? {}
      for (const v of VARS) if (row[v] && cur[v] == null) cur[v] = row[v].value
      // `si` is the inventory number ONLY when the collection holding it is a
      // Smithsonian one, collapsed here so everything downstream can treat it
      // as an ordinary item-level identifier. Read separately, `siinv` is no
      // such thing — the Rijksmuseum states P217 on its objects too, and a bare
      // accession number belongs to whichever museum assigned it. Taken from
      // this row, so the pair cannot be crossed between two rows of the same
      // item (one museum's collection with another's number).
      if (cur.si == null && row.sicoll && row.siinv && isSmithsonianCollection(row.sicoll.value)) {
        cur.si = row.siinv.value
        cur.siName = siCollectionName(row.sicoll.value)
      }
      map.set(qid, cur)
    }
  }
  return map
}

/**
 * Decide mappability for a SUBSET of an already-fetched statement map — the
 * expensive half, and the reason the two are separate.
 *
 * `only` is the anchors actually picked. Widening the partner query to every
 * candidate would otherwise drag this along with it: Apollo 11 goes from 16
 * location-bearing items to 95, and its class walk from 0.63s to 1.11s, for
 * maps on anchors no section will ever render. Measured 2026-08-05.
 *
 * The sub-map holds the SAME statement objects as the parent, and
 * mergePlaceDefunct writes into those objects, so the parent map sees the
 * result without this function reaching into it. Items outside `only` are left
 * with place/defunct unset, which mappable() reads as a refusal — the honest
 * state for a question nobody asked.
 */
export async function resolveMappability(map, only) {
  const subset = new Map()
  for (const qid of new Set(only)) {
    const s = map.get(qid)
    if (s) subset.set(qid, s)
  }
  // Exactly the items this call will ask about — carried as a map, not a list
  // of ids, because it is also what gets written back to. Nothing outside it
  // may be touched.
  //
  // `s.place === undefined` skips anything a previous call already settled.
  // The lede resolves its own anchors ahead of the page so its band can render
  // first, and the page-wide call that follows covers those anchors again;
  // re-walking their classes would spend two more queries to learn what is
  // already written on the very same statement objects.
  const pending = new Map()
  for (const [qid, s] of subset) {
    if (needsPlaceDefunctQuery(s) && s.place === undefined) pending.set(qid, s)
  }
  const needsPlaceDefunct = [...pending.keys()]
  const itemClasses = new Map() // QID → Set of its P31 class QIDs
  const itemsWithEnded = new Set() // QIDs that have P576 bindings

  for (const group of chunk(needsPlaceDefunct, 100)) {
    let rows = []
    try {
      rows = (await getJson(itemClassesUrl(group))).results?.bindings ?? []
    } catch (e) {
      console.error(`  wdqs item classes query failed (${group.length} entities): ${e.message}`)
      continue
    }
    for (const row of rows) {
      const qid = row.item?.value?.split('/').pop()
      if (!qid) continue
      if (row.class) {
        const classQid = row.class.value.split('/').pop()
        // Every P31 is kept: an item is a place if ANY of its classes is one.
        // Keeping a single value would let SPARQL's unspecified row order pick
        // the answer — the EFEO is both a research institute and a publisher.
        if (!itemClasses.has(qid)) itemClasses.set(qid, new Set())
        itemClasses.get(qid).add(classQid)
      }
      if (row.ended) {
        itemsWithEnded.add(qid)
      }
    }
  }

  // Third query (phase 2b): resolve the distinct classes against place/defunct
  // hierarchies — but only the ones no earlier page has already resolved.
  //
  // Wikidata's class hierarchy is a small, near-static vocabulary and articles
  // draw on the same corner of it: measured across seven articles, 25–72% of a
  // page's classes had already been answered for an earlier one. None of that
  // was reused, because `getJson` keys on the URL and `classesUrl` embeds the
  // whole set, so one new class re-queried all forty. Keyed per class, a warm
  // machine skips the query entirely — worth ~0.43s of the 0.63s mappability
  // costs, on the lede's critical path.
  //
  // Only the verdict is stored, not the rows: the walk returns 237KB for
  // twenty classes and all that survives is two booleans each.
  const distinctClasses = [...new Set([...itemClasses.values()].flatMap((s) => [...s]))]
  const verdicts = await readFacts('class', distinctClasses)
  const unknown = distinctClasses.filter((c) => !verdicts.has(c))

  if (unknown.length > 0) {
    const learned = new Map()
    for (const group of chunk(unknown, 100)) {
      let rows = []
      try {
        rows = (await getJson(classesUrl(group))).results?.bindings ?? []
      } catch (e) {
        console.error(`  wdqs class hierarchy query failed (${group.length} classes): ${e.message}`)
        continue
      }
      const answered = classVerdicts(rows)
      // A class the walk returned no row for reaches nothing, which is a real
      // answer and must be cached as one — otherwise it is re-asked forever.
      for (const c of group) learned.set(c, answered.get(c) ?? { place: false, defunct: false })
    }
    for (const [c, v] of learned) verdicts.set(c, v)
    await writeFacts('class', learned)
  }

  // Merge class hierarchy results into item statements once, with all data
  // collected. `pending`, never `subset` and never `map`: mergePlaceDefunct
  // writes place='false' onto every location-bearing item it is handed that
  // has no class binding, and an item this call did not ask about has none —
  // so handing it the wider map does not leave that item alone, it OVERWRITES
  // a verdict some earlier call already reached.
  //
  // That cost Brown v. Board its lede map, and worse, did it as a race: the
  // lede resolves its own anchors first so it can render first, then the
  // page-wide call stomped "Supreme Court of the United States" back to
  // place='false' while the lede band was still reading the same object.
  if (verdicts.size > 0) {
    applyVerdicts(pending, verdicts, itemClasses, itemsWithEnded)
  } else if (needsPlaceDefunct.length > 0) {
    // If class query failed or returned nothing, mark location items as unmappable
    // to avoid rendering maps when place/defunct status is unknown.
    for (const [, statements] of pending) {
      statements.place = 'false'
      statements.defunct = 'false'
    }
  }

  return map
}

// `entityStatements` — both halves in one call — was kept here for a day after
// the split as "the shape this module exposed before", and deleted 2026-08-05
// with no caller and no test ever having referenced it. The same commit that
// made the split retired `prioritizeCitations` for being dead while four tests
// kept it looking alive; keeping this one on the weaker excuse of a doc comment
// was the same mistake with better manners. `partnerStatements` then
// `resolveMappability` is the only way this is used, because picking anchors
// happens between them.

// ---- per-partner object fetchers → entries --------------------------------

export function metEntryFrom(obj) {
  if (!obj?.title) return null
  return {
    source: 'met',
    title: obj.title,
    description: [obj.artistDisplayName, obj.objectDate].filter(Boolean).join(' · '),
    imageUrl: obj.primaryImageSmall || null,
    href: obj.objectURL ?? null,
    attribution: {
      author: obj.isPublicDomain ? 'The Met · public domain (CC0)' : 'The Met · rights reserved',
      license: null,
    },
    // The Met's Open Access flag IS a CC0 dedication of the image, stated by
    // the Met — so it is `copy`. A rights-reserved object gets no mark at all
    // rather than a © it did not claim: the Met asserting rights over its
    // photograph says nothing about the object's own status.
    rights: obj.isPublicDomain
      ? { copy: licenseView(ccFromUri('https://creativecommons.org/publicdomain/zero/1.0/')) }
      : undefined,
    _via: 'P3634',
  }
}

export async function metEntry(id) {
  return metEntryFrom(await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`))
}

export function aicEntryFrom(body) {
  const d = body?.data
  if (!d?.title) return null
  const iiif = body.config?.iiif_url ?? 'https://www.artic.edu/iiif/2'
  return {
    source: 'artic',
    title: d.title,
    description: [d.artist_display?.split('\n')[0], d.date_display].filter(Boolean).join(' · '),
    imageUrl: d.image_id ? `${iiif}/${d.image_id}/full/400,/0/default.jpg` : null,
    href: `https://www.artic.edu/artworks/${d.id}`,
    attribution: {
      author: d.is_public_domain ? 'Art Institute of Chicago · public domain' : 'Art Institute of Chicago',
      license: null,
    },
    // The AIC publishes public-domain images under CC0 and says so in its own
    // terms; `is_public_domain` is the flag it exposes for exactly that.
    rights: d.is_public_domain
      ? { copy: licenseView(ccFromUri('https://creativecommons.org/publicdomain/zero/1.0/')) }
      : undefined,
    _via: 'P4610',
  }
}

export async function aicEntry(id) {
  return aicEntryFrom(
    await getJson(
      `https://api.artic.edu/api/v1/artworks/${id}?fields=id,title,artist_display,date_display,image_id,is_public_domain`,
    ),
  )
}

// Wikipedia's own bar (Commons' licensing policy): CC0, public domain, CC BY,
// and CC BY-SA are free content; CC BY-NC and CC BY-ND are not — NC and ND
// are each a stronger restriction than the -SA Wikipedia itself runs under.
// A photo licensed either is real and citable, and is PREFERRED over an
// NC/ND one below, but is not excluded outright: the mark on the card states
// the true license either way (see `rights.copy` below), so a reader is never
// told an NC photo is free — an NC photo shown truthfully is a better outcome
// than no photo where nothing freer exists for this taxon.
const OPEN_PHOTO_LICENSES = new Set(['cc0', 'pd', 'cc-by', 'cc-by-sa'])

/**
 * The taxon's photo: the first one licensed no more restrictively than
 * Wikipedia's own CC BY-SA, or — failing that — the first one carrying ANY
 * license, so a taxon photographed only under NC/ND terms still gets its
 * picture rather than going unillustrated for a restriction the card marks
 * honestly anyway. Observers choose their own license per photo, and
 * `taxon_photos` arrives in iNaturalist's own order — not raw upload order,
 * and not something this pipeline can second-guess — so both passes walk
 * that order rather than re-ranking it. A taxon whose photos are all
 * reserved (no license at all) renders unillustrated, with the credit saying
 * so, because "no licensed photo exists" is a different fact from "no photo
 * exists".
 */
function openPhoto(taxon) {
  const candidates = [
    taxon.default_photo,
    ...(taxon.taxon_photos ?? []).map((tp) => tp.photo),
  ].filter(Boolean)
  return (
    candidates.find((p) => OPEN_PHOTO_LICENSES.has(p.license_code) && p.medium_url) ??
    candidates.find((p) => p.license_code && p.medium_url) ??
    null
  )
}

export function inatEntryFrom(taxon) {
  if (!taxon?.name) return null
  const photo = openPhoto(taxon)
  const hadAny = Boolean(taxon.default_photo || taxon.taxon_photos?.length)
  return {
    source: 'inaturalist',
    title: taxon.preferred_common_name
      ? `${taxon.preferred_common_name} (${taxon.name})`
      : taxon.name,
    description: taxon.observations_count
      ? `${taxon.observations_count.toLocaleString()} community observations`
      : 'Community observations',
    imageUrl: photo?.medium_url ?? null,
    href: `https://www.inaturalist.org/taxa/${taxon.id}`,
    attribution: {
      author:
        photo?.attribution ??
        (hadAny ? 'photos exist, but none under an open license — shown unillustrated' : null),
      license: null,
    },
    // The photo's own license, chosen by the observer who took it — the card
    // shows a photo only when that license exists, so a mark here is never a
    // guess. iNaturalist's codes are the same slugs OpenAlex uses (`cc-by-nc`
    // is by far the commonest on the site), so one parser serves both.
    rights: { copy: licenseView(ccFromSlug(photo?.license_code)) },
    _via: 'P3151',
  }
}

export async function inatEntry(id) {
  const body = await getJson(`https://api.inaturalist.org/v1/taxa/${id}`)
  return inatEntryFrom(body.results?.[0])
}

export function gbifEntryFrom(species, id) {
  if (!species?.scientificName) return null
  return {
    source: 'gbif',
    title: `Where ${species.canonicalName ?? species.scientificName} has been recorded`,
    description: `Global occurrence records · ${species.scientificName}`,
    // The world occurrence-density map, as one tile. Hotlinkable (CC0 data,
    // CORS open) and it IS the finding: the shape of everywhere this
    // organism has been observed.
    imageUrl: `https://api.gbif.org/v2/map/occurrence/density/0/0/0@2x.png?taxonKey=${id}&style=purpleYellow.point`,
    href: `https://www.gbif.org/species/${id}`,
    // NOT "CC0 or CC BY", which this said until the 2026-08-06 partner audit
    // and which was simply false: sampled across four taxa, 85–94% of the
    // occurrence records behind these maps are **CC BY-NC**, with CC0 and CC BY
    // the small remainder. The line omitted the commonest license, and the
    // omitted one is the restrictive one — the worst direction to be wrong in.
    // No glyph: a tile aggregates records under all three licenses, so any
    // single mark would be a guess about which record a reader is looking at.
    attribution: { author: 'GBIF occurrence records · CC BY-NC, CC BY or CC0', license: null },
    _via: 'P846',
  }
}

export async function gbifEntry(id) {
  return gbifEntryFrom(await getJson(`https://api.gbif.org/v1/species/${id}`), id)
}

/** Standard slippy-map tile arithmetic: the z/x/y tile containing a point. */
export function tileFor(lat, lon, z = 8) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latR = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n)
  return { z, x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) }
}

/**
 * A place as a map card: the single OSM tile containing the point, linked to
 * the full OSM view. maps.wikimedia.org is NOT used — it is a
 * Wikimedia-projects-only service and refuses outside referrers. The OSM
 * tile is fetched server-side under our User-Agent and inlined as a data URI
 * (see the entry points' inline logic), which is both the polite, cacheable
 * form of the OSMF tile policy's light use and the only rendering that never
 * asks the reader's browser to hotlink anyone.
 */
export function mapEntry(coord, label, osm = null) {
  const lat = coord.lat.toFixed(4)
  const lon = coord.lon.toFixed(4)
  // Zoom follows what is known: a mapped way or node is a thing with an
  // outline (street scale); a relation could be a campus or a county
  // (district scale); bare coordinates get regional context. A museum card
  // showing all of Chicagoland is a map of the wrong fact.
  const { z, x, y } = tileFor(coord.lat, coord.lon, osm?.zoom ?? 8)
  return {
    source: 'openstreetmap',
    title: label ? `Map: ${label}` : 'Map',
    // The card says what a reader gets, not which OSM object id backs it —
    // that is in the ⓘ fold, where a number is useful rather than baffling.
    description: osm
      ? 'Traced by OpenStreetMap’s volunteer mappers'
      : `Placed at ${lat}, ${lon} by OpenStreetMap`,
    imageUrl: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    // The mapped feature itself when OSM knows the thing; a pin when it
    // only knows the place.
    href: osm
      ? `https://www.openstreetmap.org/${osm.kind}/${osm.id}`
      : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`,
    attribution: {
      author: '© OpenStreetMap contributors',
      license: 'map data ODbL — share alike, credit the mappers',
    },
    _via: osm?.via ?? 'P625',
  }
}

/**
 * Entries for one anchored entity's statements. Museums and species carry
 * their own visuals; the map is built only when the caller says this section
 * still has room for one (`withMap`) — a map per anchor per section reads as
 * wallpaper, not discovery.
 */
/**
 * Every partner here whose object is named by ONE statement, bound straight
 * to a WDQS var in `VARS` above and fetched with no other input than that
 * value (and, for IIIF, the label a manifest's own metadata can't supply).
 * This is the list to extend for a new museum/collection/taxon partner: add
 * the property to `VARS`/`wdqsUrl`'s OPTIONAL clauses, a row to `PROP_NAME`,
 * a fetcher module, and one entry here. It is NOT the list for a partner
 * found by a pair of properties (Smithsonian, below) or reached by search
 * rather than direct id (DPLA/Europeana/DigitalNZ, in `discover.js`) — see
 * `docs/adding-a-data-source.md` for which shape fits.
 */
const MUSEUM_PIVOTS = [
  { var: 'met', property: 'P3634', fetch: (v) => metEntry(v) },
  { var: 'aic', property: 'P4610', fetch: (v) => aicEntry(v) },
  { var: 'rijks', property: 'P13234', fetch: (v) => rijksEntry(v) },
  // The manifest host is whichever institution holds the object; the
  // fetch rides that host's own queue like every other partner call.
  { var: 'iiif', property: 'P6108', fetch: (v, label) => iiifEntry(v, label) },
  { var: 'inat', property: 'P3151', fetch: (v) => inatEntry(v) },
  { var: 'gbif', property: 'P846', fetch: (v) => gbifEntry(v) },
]

export async function statementEntries(qid, statements, { label, withMap, subject = false }) {
  const out = []
  const jobs = [
    ...MUSEUM_PIVOTS.map((p) => statements[p.var] && p.fetch(statements[p.var], label)),
    // Keyed, so absent for a clone with no SMITHSONIAN_API_KEY — the same
    // silent degradation DPLA and Europeana take, and for the same reason: the
    // demo must run for anyone who checks it out. The collection gate keeps
    // this from firing on every museum object with an inventory number; the
    // Rijksmuseum states P217 too, and its objects are not the Smithsonian's.
    process.env.SMITHSONIAN_API_KEY &&
      statements.si &&
      smithsonianEntry(statements.si, statements.siName, process.env.SMITHSONIAN_API_KEY),
  ].filter(Boolean)
  for (const job of jobs) {
    try {
      const entry = await job
      if (entry) out.push(entry)
    } catch (e) {
      console.error(`  statement pivot failed (${qid}): ${e.message}`)
    }
  }
  // Each card names the anchor whose Wikidata entry stated the connection —
  // a Met painting beside a section is a non sequitur until the card says
  // which linked thing it is the museum's record of.
  for (const e of out) {
    e.why = label
      ? subject
        ? `This is ${label}’s own record of it`
        : `About ${label}, which this section links to`
      : 'Connected to something this section links to'
    // The renderer splits one source's carousel by topic, so two anchors'
    // objects from the same museum never share an unlabeled box.
    e.topic = label ?? null
  }
  // A map is only built for a locatable, extant place: a language with a
  // coordinate, or an empire with a P625 centroid, would render a confident
  // modern map of the wrong fact. An OSM identifier does not override the
  // gate — OSM maps the territory, Wikidata says whether the item IS one.
  const coord = withMap && mappable(statements) ? parseEarthPoint(statements.coord) : null
  // The map card's title already names its place; a why line would repeat it.
  if (coord) out.push(mapEntry(coord, label, osmFeature(statements)))
  // The exact chain, card by card: the statement that produced this record,
  // and the statement's own anchor on Wikidata — which is also where a reader
  // who spots wrong metadata goes to fix it.
  for (const e of out) {
    const prop = /^P\d+$/.exec(e._via)?.[0]
    if (!prop) continue
    e.trace =
      `Wikidata — the shared database behind Wikipedia’s infoboxes — records ${PROP_NAME[prop] ?? prop} ` +
      `on its entry for ${label ?? qid}. We asked for that record, and this is what came back.`
    e.fix = { url: `https://www.wikidata.org/wiki/${qid}#${prop}`, label: 'Check or fix it on Wikidata' }
  }
  return out
}

// The properties this pivot follows, in reader's words — an ⓘ fold that says
// "P3634" and nothing else has explained nothing.
const PROP_NAME = {
  P3634: 'Met object ID (P3634)',
  P4610: 'Art Institute of Chicago artwork ID (P4610)',
  P13234: 'Rijksmuseum object ID (P13234)',
  P6108: 'IIIF manifest URL (P6108)',
  P3151: 'iNaturalist taxon ID (P3151)',
  P846: 'GBIF taxon ID (P846)',
  P625: 'coordinate location (P625)',
  P402: 'OpenStreetMap relation ID (P402)',
  P11693: 'OpenStreetMap node ID (P11693)',
  P10689: 'OpenStreetMap way ID (P10689)',
  // Not an external-id property like the rest: the Smithsonian states none on
  // its objects, so the card is found by which museum holds the thing and that
  // museum's own accession number. Named as the pair, because either alone
  // would be a different and weaker claim.
  P217: 'collection (P195) and inventory number (P217)',
}
