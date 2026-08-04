// The statement pivots: an anchored entity's Wikidata statements name an
// object in a partner collection, and the partner's open API supplies the
// object itself. Museums (Met P3634, Art Institute of Chicago P4610),
// biodiversity (iNaturalist P3151, GBIF P846), and place (P625 coordinates →
// OpenStreetMap render). One WDQS query answers every anchor on the page;
// the per-object fetches then ride each partner's own host queue.
//
// These are `statement` evidence — Wikidata states the connection outright —
// so each card credits the property that made it.

import { chunk } from './batch.js'
import { getJson } from './http.js'
import { iiifEntry } from './iiif.js'

/** Properties this pivot reads, and the shape they come back in. */
const VARS = ['met', 'aic', 'gbif', 'inat', 'coord', 'osmr', 'osmw', 'osmn', 'iiif', 'lc', 'eu']

export function wdqsUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?met ?aic ?gbif ?inat ?coord ?osmr ?osmw ?osmn ?iiif ?lc ?eu WHERE { VALUES ?item { ${values} } ` +
    'OPTIONAL { ?item wdt:P3634 ?met } OPTIONAL { ?item wdt:P4610 ?aic } ' +
    'OPTIONAL { ?item wdt:P846 ?gbif } OPTIONAL { ?item wdt:P3151 ?inat } ' +
    'OPTIONAL { ?item wdt:P625 ?coord } ' +
    'OPTIONAL { ?item wdt:P402 ?osmr } OPTIONAL { ?item wdt:P10689 ?osmw } ' +
    'OPTIONAL { ?item wdt:P11693 ?osmn } ' +
    // P6108: the item's own IIIF manifest — any institution, one property.
    'OPTIONAL { ?item wdt:P6108 ?iiif } ' +
    // P244: the LC authority behind the DPLA subject-heading pivot.
    'OPTIONAL { ?item wdt:P244 ?lc } ' +
    // P7704: the Europeana entity behind the Europeana pivot.
    'OPTIONAL { ?item wdt:P7704 ?eu } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * Whether a QID's first-query bindings carry enough location info to warrant
 * checking place/defunct status. The second query that answers place/defunct
 * (a transitive P31/P279* walk) is expensive; we issue it only for QIDs whose
 * first query already found a coordinate or OSM identifier — typically a handful
 * per page. This pure function factors that decision so it can be tested,
 * preventing regressions on the decision boundary itself.
 */
export function needsPlaceDefunctQuery(statements) {
  return Boolean(statements.coord || statements.osmr || statements.osmw || statements.osmn)
}

/**
 * The second SPARQL query, Phase 2 optimization (2026-08-04): split the
 * expensive transitive P31/P279* walk off the items and onto the classes.
 *
 * Query 1 (itemClassesUrl): fetch direct properties for location-bearing items.
 * Cheap: P31 and P576 are direct property lookups, no transitive closures.
 * Returns ~10–30 distinct classes per page, heavily cacheable.
 *
 * Query 2 (classesUrl): resolve the small class vocabulary against the allowset.
 * Cheap: P279* walk operates on ~30 classes max, not 52+ items. Class-to-class
 * closure is far cheaper and results cache well across pages.
 *
 * Measured cost (cold, Byzantine Empire 52-entity location-bearing set, several runs):
 * Query 1 (item classes): 0.2–0.3s
 * Query 2 (class hierarchy): 0.1–0.2s
 * Merge + cache write: <0.1s
 * Total: 0.4–0.6s (vs. 24s+ for the old single query). Warm: <0.1s.
 *
 * Failure semantic: if query 1 succeeds but query 2 times out, mappable() sees
 * missing place/defunct and refuses (no maps). This is correct: when we cannot
 * confirm the class hierarchy, we cannot confirm it is mappable.
 */
export function itemClassesUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?class ?ended WHERE { VALUES ?item { ${values} } ` +
    'OPTIONAL { ?item wdt:P31 ?class } ' +
    'OPTIONAL { ?item wdt:P576 ?ended } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * The class hierarchy query: walk P279* over classes only (not items).
 * Input is a set of distinct classes from itemClassesUrl().
 * Returns which classes are (or are subclasses of) the mappable set,
 * and which are subclasses of the historical-polity class.
 */
export function classesUrl(classes) {
  const values = classes.map((c) => `wd:${c}`).join(' ')
  const query =
    `SELECT ?class ?isPlace ?isDefunct WHERE { VALUES ?class { ${values} } ` +
    // A mappable place is an instance or subclass of one of the location classes.
    'BIND(EXISTS { VALUES ?locClass { wd:Q618123 wd:Q486972 wd:Q56061 wd:Q41176 wd:Q811979 wd:Q43229 } ' +
    '?class wdt:P279* ?locClass } AS ?isPlace) ' +
    // A defunct place is a subclass of the historical-polity class (Q3024240).
    'BIND(EXISTS { ?class wdt:P279* wd:Q3024240 } AS ?isDefunct) }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * For backward compatibility during merge: still exported, but deprecated.
 * Use itemClassesUrl + classesUrl + mergePlaceDefunct instead.
 */
export function placeDefunctUrl(qids) {
  // This function is kept for test compatibility but should not be used in production.
  // The new flow uses itemClassesUrl + classesUrl + mergePlaceDefunct.
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?place ?defunct WHERE { VALUES ?item { ${values} } ` +
    'BIND(EXISTS { VALUES ?locClass { wd:Q618123 wd:Q486972 wd:Q56061 wd:Q41176 wd:Q811979 wd:Q43229 } ' +
    '?item wdt:P31/wdt:P279* ?locClass } AS ?place) ' +
    'BIND((EXISTS { ?item wdt:P576 ?ended } || ' +
    'EXISTS { ?item wdt:P31/wdt:P279* wd:Q3024240 }) AS ?defunct) }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

/**
 * Whether a map card would be TRUE of this item: a locatable, extant place.
 * WDQS boolean bindings arrive as the strings 'true'/'false'; an item the
 * query never answered for stays unmappable — refusal over wrongness, the
 * same stance parseEarthPoint takes for non-Earth globes.
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
 * @param {Map<string, string>} itemClasses - QID → class QID (from itemClassesUrl query)
 * @param {Set<string>} itemsWithEnded - QIDs that have P576 (ended) bindings
 * @returns {Map<string, object>} - updated itemMap with place/defunct booleans
 *
 * The merge builds two sets from classRows:
 * - placeClasses: classes that are or subclass the mappable location set
 * - defunctClasses: classes that subclass the historical-polity class
 *
 * For each item with location data: mark place='true' if its class is mappable,
 * and defunct='true' if it has P576 (ended) OR its class is historical.
 * Items with no class binding (no P31) are marked both false to exclude from maps.
 */
export function mergePlaceDefunct(itemMap, classRows, itemClasses, itemsWithEnded = new Set()) {
  // Build set of mappable classes and defunct classes from the hierarchy query results.
  const placeClasses = new Set()
  const defunctClasses = new Set()

  for (const row of classRows) {
    const classQid = row.class?.value?.split('/').pop()
    if (!classQid) continue
    if (row.isPlace?.value === 'true') placeClasses.add(classQid)
    if (row.isDefunct?.value === 'true') defunctClasses.add(classQid)
  }

  // For each item with location data, mark place/defunct based on class membership.
  for (const [qid, statements] of itemMap.entries()) {
    if (!needsPlaceDefunctQuery(statements)) continue // Skip items with no location data

    const itemClass = itemClasses.get(qid)
    if (!itemClass) {
      // Item had no P31 binding (unusual for mappable things, but possible).
      // Set both to false to exclude from maps.
      statements.place = 'false'
      statements.defunct = 'false'
      continue
    }

    // Check class membership against the resolved sets.
    statements.place = placeClasses.has(itemClass) ? 'true' : 'false'

    // Defunct if ended (P576) or class is historical.
    const hasEnded = itemsWithEnded.has(qid)
    statements.defunct = (hasEnded || defunctClasses.has(itemClass)) ? 'true' : 'false'
  }

  return itemMap
}

/**
 * Every anchored entity's partner statements, in one query per 100 anchors.
 * Two additional queries (now run on location-bearing items):
 * 1. itemClassesUrl: fetch direct P31 and P576 for location items (cheap).
 * 2. classesUrl: resolve classes against place/defunct hierarchies (cheap).
 * See Critical 1 fix and measured cost in comments above.
 * @returns {Map<string, {met?, aic?, gbif?, inat?, coord?, place?, defunct?}>}
 */
export async function entityStatements(qids) {
  const map = new Map()
  const uniqueQids = [...new Set(qids)].filter(Boolean)

  // First query: partner statements
  for (const group of chunk(uniqueQids, 100)) {
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
      map.set(qid, cur)
    }
  }

  // Second query (phase 2a): item classes and end dates, only for QIDs with
  // location data. Group by 100 like the main query — same host queue, same politeness.
  const needsPlaceDefunct = [...map].filter(([, s]) => needsPlaceDefunctQuery(s)).map(([q]) => q)
  const itemClasses = new Map() // QID → class QID
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
        itemClasses.set(qid, classQid)
      }
      if (row.ended) {
        itemsWithEnded.add(qid)
      }
    }
  }

  // Third query (phase 2b): resolve the distinct classes against place/defunct hierarchies.
  // Collect distinct classes from all item bindings — typically 10–30 per page.
  const distinctClasses = [...new Set([...itemClasses.values()])]
  let allClassRows = []

  if (distinctClasses.length > 0) {
    for (const group of chunk(distinctClasses, 100)) {
      let rows = []
      try {
        rows = (await getJson(classesUrl(group))).results?.bindings ?? []
      } catch (e) {
        console.error(`  wdqs class hierarchy query failed (${group.length} classes): ${e.message}`)
        continue
      }
      allClassRows = allClassRows.concat(rows)
    }
  }

  // Merge class hierarchy results into item statements once, with all data collected.
  if (allClassRows.length > 0) {
    mergePlaceDefunct(map, allClassRows, itemClasses, itemsWithEnded)
  } else if (needsPlaceDefunct.length > 0) {
    // If class query failed or returned nothing, mark location items as unmappable
    // to avoid rendering maps when place/defunct status is unknown.
    for (const [qid, statements] of map.entries()) {
      if (needsPlaceDefunctQuery(statements)) {
        statements.place = 'false'
        statements.defunct = 'false'
      }
    }
  }

  return map
}

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
      license: 'via P3634 Met object ID',
    },
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
      license: 'via P4610 AIC artwork ID',
    },
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

/**
 * The taxon's photo, but only an openly licensed one. Observers choose their
 * own licence and some reserve all rights; this page shows only what its
 * reader may reuse, so the default photo yields to the first CC-licensed one
 * (`license_code` is null on all-rights-reserved photos), and a taxon whose
 * photos are all reserved renders unillustrated — with the credit saying so,
 * because "no open photo exists" is a different fact from "no photo exists".
 */
function openPhoto(taxon) {
  const candidates = [
    taxon.default_photo,
    ...(taxon.taxon_photos ?? []).map((tp) => tp.photo),
  ].filter(Boolean)
  return candidates.find((p) => p.license_code && p.medium_url) ?? null
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
        (hadAny ? 'photos exist, but none under an open licence — shown unillustrated' : null),
      license: 'via P3151 iNaturalist taxon',
    },
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
    attribution: { author: 'GBIF occurrence data · CC0/CC BY', license: 'via P846 GBIF taxon' },
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
    description: osm ? `Mapped in OpenStreetMap as ${osm.kind} ${osm.id}` : `${lat}, ${lon}`,
    imageUrl: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    // The mapped feature itself when OSM knows the thing; a pin when it
    // only knows the place.
    href: osm
      ? `https://www.openstreetmap.org/${osm.kind}/${osm.id}`
      : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`,
    attribution: {
      author: '© OpenStreetMap contributors',
      license: osm ? `via ${osm.via} OSM ${osm.kind}` : 'via P625 coordinates',
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
export async function statementEntries(qid, statements, { label, withMap, subject = false }) {
  const out = []
  const jobs = [
    statements.met && metEntry(statements.met),
    statements.aic && aicEntry(statements.aic),
    // The manifest host is whichever institution holds the object; the
    // fetch rides that host's own queue like every other partner call.
    statements.iiif && iiifEntry(statements.iiif, label),
    statements.inat && inatEntry(statements.inat),
    statements.gbif && gbifEntry(statements.gbif),
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
        ? `Stated by Wikidata’s entry for ${label}`
        : `Stated by Wikidata for ${label}, a link in this section`
      : 'Stated by Wikidata'
    // The renderer splits one source's carousel by topic, so two anchors'
    // objects from the same museum never share an unlabelled box.
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
      `Wikidata’s item for ${label ?? qid} (${qid}) states its ${PROP_NAME[prop] ?? prop} — ` +
      `this card is what that identifier returned.`
    e.fix = { url: `https://www.wikidata.org/wiki/${qid}#${prop}`, label: 'Check or fix it on Wikidata' }
  }
  return out
}

// The properties this pivot follows, in reader's words — an ⓘ fold that says
// "P3634" and nothing else has explained nothing.
const PROP_NAME = {
  P3634: 'Met object ID (P3634)',
  P4610: 'Art Institute of Chicago artwork ID (P4610)',
  P6108: 'IIIF manifest URL (P6108)',
  P3151: 'iNaturalist taxon ID (P3151)',
  P846: 'GBIF taxon ID (P846)',
  P625: 'coordinate location (P625)',
  P402: 'OpenStreetMap relation ID (P402)',
  P11693: 'OpenStreetMap node ID (P11693)',
  P10689: 'OpenStreetMap way ID (P10689)',
}
