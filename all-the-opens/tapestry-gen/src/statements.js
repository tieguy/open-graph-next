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
 * Every anchored entity's partner statements, in one query per 100 anchors.
 * @returns {Map<string, {met?, aic?, gbif?, inat?, coord?}>}
 */
export async function entityStatements(qids) {
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
      map.set(qid, cur)
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
  const coord = withMap ? parseEarthPoint(statements.coord) : null
  // The map card's title already names its place; a why line would repeat it.
  if (coord) out.push(mapEntry(coord, label, osmFeature(statements)))
  return out
}
