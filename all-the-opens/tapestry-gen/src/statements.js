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

/** Properties this pivot reads, and the shape they come back in. */
const VARS = ['met', 'aic', 'gbif', 'inat', 'coord']

export function wdqsUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    `SELECT ?item ?met ?aic ?gbif ?inat ?coord WHERE { VALUES ?item { ${values} } ` +
    'OPTIONAL { ?item wdt:P3634 ?met } OPTIONAL { ?item wdt:P4610 ?aic } ' +
    'OPTIONAL { ?item wdt:P846 ?gbif } OPTIONAL { ?item wdt:P3151 ?inat } ' +
    'OPTIONAL { ?item wdt:P625 ?coord } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
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

export function inatEntryFrom(taxon) {
  if (!taxon?.name) return null
  const photo = taxon.default_photo ?? {}
  return {
    source: 'inaturalist',
    title: taxon.preferred_common_name
      ? `${taxon.preferred_common_name} (${taxon.name})`
      : taxon.name,
    description: taxon.observations_count
      ? `${taxon.observations_count.toLocaleString()} community observations`
      : 'Community observations',
    imageUrl: photo.medium_url ?? null,
    href: `https://www.inaturalist.org/taxa/${taxon.id}`,
    attribution: { author: photo.attribution ?? null, license: 'via P3151 iNaturalist taxon' },
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

/**
 * A place as a map card: a keyless Wikimedia static render of OpenStreetMap
 * data, linked to the OSM view. Needs no fetch — the tile URL is the image.
 */
export function mapEntry(coord, label) {
  const lat = coord.lat.toFixed(4)
  const lon = coord.lon.toFixed(4)
  return {
    source: 'openstreetmap',
    title: label ? `Map: ${label}` : 'Map',
    description: `${lat}, ${lon}`,
    imageUrl: `https://maps.wikimedia.org/img/osm-intl,8,${lat},${lon},400x260.png`,
    href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`,
    attribution: { author: '© OpenStreetMap contributors', license: 'via P625 coordinates' },
    _via: 'P625',
  }
}

/**
 * Entries for one anchored entity's statements. Museums and species carry
 * their own visuals; the map is built only when the caller says this section
 * still has room for one (`withMap`) — a map per anchor per section reads as
 * wallpaper, not discovery.
 */
export async function statementEntries(qid, statements, { label, withMap }) {
  const out = []
  const jobs = [
    statements.met && metEntry(statements.met),
    statements.aic && aicEntry(statements.aic),
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
  const coord = withMap ? parseEarthPoint(statements.coord) : null
  if (coord) out.push(mapEntry(coord, label))
  return out
}
