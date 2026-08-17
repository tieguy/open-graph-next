import { ccFromUri } from './rights.js'
import { iiifString } from './iiif.js'
import {
  rijksTitle,
  rijksDate,
  rijksObjectNumber,
  rijksPageUrl,
  rijksRights,
} from './rijks.js'

/**
 * Normalize empty string to null.
 */
const nullIfEmpty = (v) => (typeof v === 'string' && !v.trim() ? null : v ?? null)

/**
 * The Met's catalog record as a normalized holder-record shape.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function metRecordFrom(obj) {
  if (!obj?.title) return null

  const isPublicDomain = obj.isPublicDomain === true
  const imageUrl = isPublicDomain ? (obj.primaryImageSmall || obj.primaryImage || null) : null

  return {
    partner: 'met',
    id: String(obj.objectID ?? ''),
    title: nullIfEmpty(obj.title),
    creator: nullIfEmpty(obj.artistDisplayName),
    date: nullIfEmpty(obj.objectDate),
    medium: nullIfEmpty(obj.medium),
    dimensions: nullIfEmpty(obj.dimensions),
    accession: nullIfEmpty(obj.accessionNumber),
    credit: nullIfEmpty(obj.creditLine),
    rights: {
      publicDomain: isPublicDomain,
      label: isPublicDomain ? 'CC0' : null,
    },
    imageUrl,
    href: nullIfEmpty(obj.objectURL),
    institution: 'The Metropolitan Museum of Art',
  }
}

/**
 * The Art Institute of Chicago's catalog record as a normalized holder-record shape.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function aicRecordFrom(body) {
  const d = body?.data
  if (!d?.title) return null

  const iiif = body.config?.iiif_url ?? 'https://www.artic.edu/iiif/2'
  const isPublicDomain = d.is_public_domain === true

  // Build IIIF image URL at width 800 if image_id and public domain
  let imageUrl = null
  if (isPublicDomain && d.image_id) {
    imageUrl = `${iiif}/${d.image_id}/full/800,/0/default.jpg`
  }

  return {
    partner: 'artic',
    id: String(d.id ?? ''),
    title: nullIfEmpty(d.title),
    creator: nullIfEmpty(d.artist_display?.split('\n')[0]),
    date: nullIfEmpty(d.date_display),
    medium: nullIfEmpty(d.medium_display),
    dimensions: nullIfEmpty(d.dimensions),
    accession: nullIfEmpty(d.main_reference_number),
    credit: nullIfEmpty(d.credit_line),
    rights: {
      publicDomain: isPublicDomain,
      label: isPublicDomain ? 'CC0' : null,
    },
    imageUrl,
    href: `https://www.artic.edu/artworks/${d.id}`,
    institution: 'Art Institute of Chicago',
  }
}

/**
 * Rijksmuseum's catalog record as a normalized holder-record shape.
 * Composes from existing exported helpers.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function rijksRecordFrom(obj, vis, digital, id) {
  const title = rijksTitle(obj)
  if (!title) return null

  const rights = rijksRights(vis)
  const isPublicDomain = rights?.code === 'CC0' || rights?.code === 'PDM'

  // Build IIIF image URL at width 800 if digital and public domain
  let imageUrl = null
  if (isPublicDomain && digital) {
    const url = Array.isArray(digital?.access_point)
      ? digital.access_point[0]?.id
      : digital?.access_point?.id
    if (typeof url === 'string') {
      const m = /^(https?:\/\/[^\s]+?)\/full\/[^/]+\/[^/]+\/\w+\.\w+$/.exec(url.trim())
      if (m) {
        imageUrl = `${m[1]}/full/800,/0/default.jpg`
      }
    }
  }

  const href = rijksPageUrl(obj, id)

  return {
    partner: 'rijks',
    id: String(id ?? ''),
    title,
    creator: null, // Rijksmuseum data doesn't provide artist in the shape we have
    date: rijksDate(obj),
    medium: null, // Rijksmuseum data doesn't provide medium in the shape we have
    dimensions: null, // Rijksmuseum data doesn't provide dimensions in the shape we have
    accession: rijksObjectNumber(obj),
    credit: null, // Rijksmuseum data doesn't provide credit line in the shape we have
    rights: {
      publicDomain: isPublicDomain,
      label: rights?.label ?? null,
    },
    imageUrl,
    href,
    institution: 'Rijksmuseum',
  }
}

/**
 * Extract institution label from IIIF v3 provider array.
 * Gate requirement: exactly one provider entry.
 * v2 never qualifies (attribution is free text).
 */
function iiifInstitution(provider) {
  if (!Array.isArray(provider) || provider.length !== 1) return null
  const label = iiifString(provider[0]?.label)
  return label
}

/**
 * Extract homepage from IIIF manifest (v3 homepage or v2 related).
 * Never passes manifest URL as fallback (would defeat no-object-page gate).
 */
function iiifHomepageUrl(manifest) {
  const home = Array.isArray(manifest.homepage) ? manifest.homepage[0] : manifest.homepage
  const related = Array.isArray(manifest.related) ? manifest.related[0] : manifest.related
  return home?.id ?? home?.['@id'] ?? related?.['@id'] ?? related ?? null
}

/**
 * Extract image URL from IIIF manifest at width 800.
 */
function iiifImageUrl(manifest) {
  const getServiceBase = (service) => {
    const s = Array.isArray(service) ? service[0] : service
    return s?.['@id'] ?? s?.id ?? null
  }

  // v3: items (canvases) → items (annotation pages) → items → body
  const v3 = manifest.items?.[0]?.items?.[0]?.items?.[0]?.body
  if (v3) {
    const base = getServiceBase(v3.service)
    return base ? `${base}/full/800,/0/default.jpg` : null
  }

  // v2: sequences → canvases → images → resource.service
  const v2 = manifest.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource
  if (v2) {
    const base = getServiceBase(v2.service)
    return base ? `${base}/full/800,/0/default.jpg` : null
  }

  return null
}

/**
 * Extract requiredStatement (v3) or attribution (v2) with markup stripped.
 */
function iiifRequiredStatement(manifest) {
  // v3: requiredStatement
  if (manifest.requiredStatement) {
    const label = iiifString(manifest.requiredStatement?.label)
    const value = iiifString(manifest.requiredStatement?.value)
    return label || value || null
  }

  // v2: attribution
  if (manifest.attribution) {
    return iiifString(manifest.attribution)
  }

  return null
}

/**
 * IIIF manifest as a normalized holder-record shape.
 * Gate: v3 only, exactly one provider, CC0 or PDM rights, imageUrl, homepage
 */
export function iiifRecordFrom(manifest) {
  if (!manifest || typeof manifest !== 'object') return null

  const title = iiifString(manifest.label)
  if (!title) return null

  // Gate: institution (v3 provider with exactly one entry, v2 fails)
  const institution = iiifInstitution(manifest.provider)
  if (!institution) return null

  // Gate: rights must be CC0 or PDM
  const v3rights = Array.isArray(manifest?.rights) ? manifest.rights[0] : manifest?.rights
  const v2license = Array.isArray(manifest?.license) ? manifest.license[0] : manifest?.license
  const rightsUri = typeof v3rights === 'string' ? v3rights : typeof v2license === 'string' ? v2license : null
  const rights = ccFromUri(rightsUri)
  const isPublicDomain = rights?.code === 'CC0' || rights?.code === 'PDM'

  if (!isPublicDomain) return null

  // Gate: imageUrl
  const imageUrl = iiifImageUrl(manifest)
  if (!imageUrl) return null

  // Gate: homepage/related (must be explicitly stated, no manifest URL fallback)
  const href = iiifHomepageUrl(manifest)
  if (!href) return null

  return {
    partner: 'iiif',
    id: '', // P6108's value IS the manifest URL, handled upstream
    title,
    creator: null,
    date: null,
    medium: null,
    dimensions: null,
    accession: null,
    credit: null,
    rights: {
      publicDomain: true,
      label: rights?.label ?? null,
    },
    imageUrl,
    href,
    institution,
    requiredStatement: iiifRequiredStatement(manifest),
  }
}
