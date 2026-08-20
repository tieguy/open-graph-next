// The P6108 lookup: Wikidata states an item's IIIF manifest outright, and the
// manifest — served by whatever institution holds the object — supplies the
// image, the label, and the credit. IIIF has no cross-institution search;
// this is the demo's answer to that gap: the graph is the directory, the
// protocol is the door, and every IIIF publisher is reachable with no
// per-partner code at all. Presentation API v2 and v3 both arrive here.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'

/** The first human-readable string in any of IIIF's label shapes:
 * "x", ["x"], {"@value":"x"}, {en:["x"]}, {none:["x"]}. */
export function iiifString(value) {
  if (value == null) return null
  if (typeof value === 'string') return value.replace(/<[^>]+>/g, '').trim() || null
  if (Array.isArray(value)) return iiifString(value[0])
  if (typeof value === 'object') {
    if (value['@value'] != null) return iiifString(value['@value'])
    const lang = value.en ?? value.none ?? Object.values(value)[0]
    return iiifString(lang)
  }
  return null
}

/** An Image API base URL from a v2 or v3 service reference, or null. */
const serviceBase = (service) => {
  const s = Array.isArray(service) ? service[0] : service
  return s?.['@id'] ?? s?.id ?? null
}

/**
 * A displayable image URL from a manifest: the stated thumbnail when there
 * is one, else the first canvas's image service asked for a 400px wide
 * rendition, else the first canvas's plain image body. Null when the
 * manifest carries no image at all — a card must not invent a visual.
 */
export function iiifThumbnail(manifest) {
  const thumb = Array.isArray(manifest.thumbnail) ? manifest.thumbnail[0] : manifest.thumbnail
  const thumbUrl = thumb?.['@id'] ?? thumb?.id ?? null
  if (thumbUrl) return thumbUrl
  // v2: sequences → canvases → images → resource.service
  const v2 = manifest.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource
  if (v2) {
    const base = serviceBase(v2.service)
    return base ? `${base}/full/400,/0/default.jpg` : (v2['@id'] ?? null)
  }
  // v3: items (canvases) → items (annotation pages) → items → body
  const v3 = manifest.items?.[0]?.items?.[0]?.items?.[0]?.body
  if (v3) {
    const base = serviceBase(v3.service)
    return base ? `${base}/full/400,/0/default.jpg` : (v3.id ?? null)
  }
  return null
}

/** Who to credit: v3 requiredStatement/provider, v2 attribution. */
export function iiifCredit(manifest) {
  return (
    iiifString(manifest.requiredStatement?.value) ??
    iiifString(manifest.provider?.[0]?.label) ??
    iiifString(manifest.attribution) ??
    null
  )
}

/**
 * The terms the holding institution states in its own manifest.
 *
 * IIIF Presentation 3.0 calls this `rights` and requires a single URI from CC or
 * rightsstatements.org — which is exactly the vocabulary `ccFromUri` reads. 2.1
 * called it `license` and was looser about the value, so an unrecognized one
 * yields null rather than a guess. Sampled 2026-08-06 across real P6108
 * manifests, SMK answered `publicdomain/mark` and Yale `publicdomain/zero`:
 * this is a partner that states its terms cleanly and was simply not being read.
 */
export function iiifRights(manifest) {
  const v3 = Array.isArray(manifest?.rights) ? manifest.rights[0] : manifest?.rights
  const v2 = Array.isArray(manifest?.license) ? manifest.license[0] : manifest?.license
  return ccFromUri(typeof v3 === 'string' ? v3 : null) ?? ccFromUri(typeof v2 === 'string' ? v2 : null)
}

/** Where a reader lands: the object's own page when the manifest names one.
 * When manifestUrl is provided, serves as a fallback only when the manifest
 * states no homepage or related link. Passing manifestUrl defeats the no-object-page
 * gate in contexts where an explicitly stated page is required (e.g., holder-record.js).
 */
export function iiifHomepage(manifest, manifestUrl) {
  const home = Array.isArray(manifest.homepage) ? manifest.homepage[0] : manifest.homepage
  const related = Array.isArray(manifest.related) ? manifest.related[0] : manifest.related
  return home?.id ?? home?.['@id'] ?? related?.['@id'] ?? related ?? manifestUrl ?? null
}

/** A manifest as a page entry, or null when it yields nothing showable. */
export function iiifEntryFrom(manifest, manifestUrl, fallbackTitle) {
  if (!manifest || typeof manifest !== 'object') return null
  const title = iiifString(manifest.label) ?? fallbackTitle
  if (!title) return null
  const imageUrl = iiifThumbnail(manifest)
  return {
    source: 'iiif',
    title,
    description: iiifString(manifest.summary ?? manifest.description) ?? 'A digitised object, served by the library or museum that holds it',
    imageUrl,
    href: iiifHomepage(manifest, manifestUrl),
    attribution: {
      author: iiifCredit(manifest),
      license: null,
    },
    rights: { copy: licenseView(iiifRights(manifest)) },
    _via: 'P6108',
  }
}

export async function iiifEntry(manifestUrl, fallbackTitle) {
  return iiifEntryFrom(await getJson(manifestUrl), manifestUrl, fallbackTitle)
}
