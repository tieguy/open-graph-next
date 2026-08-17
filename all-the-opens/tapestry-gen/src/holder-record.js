// Catalog records normalized to one shape, gated on the museum's own rights flag.
//
// Pure transforms (metRecordFrom, aicRecordFrom, rijksRecordFrom, iiifRecordFrom)
// normalize catalog responses to one shape; URL builders (metRecordUrl, aicRecordUrl)
// and the fetchHolderRecord dispatcher touch the network.
//
// Each transform normalizes a partner's catalog response to the holder-record contract shape.
// Missing fields are null; a null or non-object response yields null;
// otherwise the record exists and its gate may fail.
//
// Traps and constraints worth remembering:
// - Rijksmuseum subject_to rights (the public-domain mark) not subject_of.subject_to (CC0 metadata);
// - IIIF iiifHomepage never passed with manifest URL as fallback (would defeat no-object-page gate);
// - AIC width-800 rule: all IIIF images built at width 800, never the manifest thumbnail;
// - Institution from PARTNERS[partner].name, never hardcoded display strings.

import { ccFromUri } from './rights.js'
import { iiifString, iiifHomepage } from './iiif.js'
import {
  rijksTitle,
  rijksDate,
  rijksObjectNumber,
  rijksPageUrl,
  rijksRights,
  imageBaseFrom,
  rijksRecordObjects,
} from './rijks.js'
import { PARTNERS } from './partners.js'
import { getJson } from './http.js'

/**
 * Normalize empty string to null.
 */
const nullIfEmpty = (v) => (typeof v === 'string' && !v.trim() ? null : v ?? null)

/**
 * Build the URL for fetching a Met catalog record.
 */
export function metRecordUrl(id) {
  return `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
}

/**
 * Build the URL for fetching an AIC catalog record.
 */
export function aicRecordUrl(id) {
  return `https://api.artic.edu/api/v1/artworks/${id}?fields=id,title,artist_display,date_display,image_id,is_public_domain,medium_display,dimensions,main_reference_number,credit_line`
}

/**
 * Build the URL for fetching a Cleveland Museum of Art catalog record.
 */
export function clevelandRecordUrl(id) {
  return `https://openaccess-api.clevelandart.org/api/artworks/${encodeURIComponent(id)}`
}

/**
 * Gate check: returns null if record passes all gate legs, else the name of the first failed leg.
 * Gate legs, in order: record exists, institution (present and single), public-domain rights, image URL, object page.
 */
export function gateFailure(record) {
  if (!record || typeof record !== 'object') return 'no-record'

  // Institution must be present
  if (!record.institution) {
    // For IIIF, distinguish "several providers" from "no institution" (v2 or missing)
    if (record.partner === 'iiif' && record._providers > 1) {
      return 'several-institutions'
    }
    return 'no-institution'
  }

  // Rights must be public domain
  if (record.rights?.publicDomain !== true) return 'non-pd-rights'

  // Must have an image URL
  if (!record.imageUrl) return 'no-image'

  // Must have an object page (homepage/related link)
  if (!record.href) return 'no-object-page'

  // All gates pass
  return null
}

/**
 * The Met's catalog record as a normalized holder-record shape.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function metRecordFrom(obj) {
  if (!obj || typeof obj !== 'object') return null

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
      uri: isPublicDomain ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null,
    },
    imageUrl,
    href: nullIfEmpty(obj.objectURL),
    institution: PARTNERS.met.name,
  }
}

/**
 * The Art Institute of Chicago's catalog record as a normalized holder-record shape.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function aicRecordFrom(body) {
  if (!body || typeof body !== 'object') return null

  const d = body?.data

  const iiif = body.config?.iiif_url ?? 'https://www.artic.edu/iiif/2'
  const isPublicDomain = d?.is_public_domain === true

  // Build IIIF image URL at width 800 if image_id and public domain
  let imageUrl = null
  if (isPublicDomain && d?.image_id) {
    imageUrl = `${iiif}/${d.image_id}/full/800,/0/default.jpg`
  }

  return {
    partner: 'artic',
    id: String(d?.id ?? ''),
    title: nullIfEmpty(d?.title),
    creator: nullIfEmpty(d?.artist_display?.split('\n')[0]),
    date: nullIfEmpty(d?.date_display),
    medium: nullIfEmpty(d?.medium_display),
    dimensions: nullIfEmpty(d?.dimensions),
    accession: nullIfEmpty(d?.main_reference_number),
    credit: nullIfEmpty(d?.credit_line),
    rights: {
      publicDomain: isPublicDomain,
      label: isPublicDomain ? 'CC0' : null,
      uri: isPublicDomain ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null,
    },
    imageUrl,
    href: d?.id ? `https://www.artic.edu/artworks/${d.id}` : null,
    institution: PARTNERS.artic.name,
  }
}

/**
 * The Cleveland Museum of Art's catalog record as a normalized holder-record shape.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 * The record rides a {data} wrapper; share_license_status is the museum's own
 * per-object CC0 flag, and images.web is the ~650px display derivative.
 */
export function clevelandRecordFrom(body) {
  if (!body || typeof body !== 'object') return null

  const d = body?.data
  if (!d || typeof d !== 'object') return null

  const isPublicDomain = d.share_license_status === 'CC0'
  const imageUrl = isPublicDomain ? nullIfEmpty(d.images?.web?.url) : null

  return {
    partner: 'cleveland',
    id: String(d.id ?? ''),
    title: nullIfEmpty(d.title),
    creator: nullIfEmpty(d.creators?.[0]?.description),
    date: nullIfEmpty(d.creation_date),
    medium: nullIfEmpty(d.technique),
    dimensions: nullIfEmpty(d.measurements),
    accession: nullIfEmpty(d.accession_number),
    credit: nullIfEmpty(d.creditline),
    rights: {
      publicDomain: isPublicDomain,
      label: isPublicDomain ? 'CC0' : null,
      uri: isPublicDomain ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null,
    },
    imageUrl,
    href: nullIfEmpty(d.url),
    institution: PARTNERS.cleveland.name,
  }
}

/**
 * Rijksmuseum's catalog record as a normalized holder-record shape.
 * Composes from existing exported helpers.
 * Gate: rights.publicDomain true, imageUrl present, href present, institution present.
 */
export function rijksRecordFrom(obj, vis, digital, id) {
  if (!obj || typeof obj !== 'object') return null

  const rights = rijksRights(vis)
  const isPublicDomain = rights?.code === 'CC0' || rights?.code === 'PDM'

  // Build IIIF image URL at width 800 if digital and public domain
  let imageUrl = null
  if (isPublicDomain && digital) {
    const base = imageBaseFrom(digital)
    imageUrl = base ? `${base}/full/800,/0/default.jpg` : null
  }

  return {
    partner: 'rijks',
    id: String(id ?? ''),
    title: rijksTitle(obj),
    creator: null, // not yet extracted from the Linked Art hops as of 2026-08-16
    date: rijksDate(obj),
    medium: null, // not yet extracted from the Linked Art hops as of 2026-08-16
    dimensions: null, // not yet extracted from the Linked Art hops as of 2026-08-16
    accession: rijksObjectNumber(obj),
    credit: null, // not yet extracted from the Linked Art hops as of 2026-08-16
    rights: {
      publicDomain: isPublicDomain,
      label: rights?.label ?? null,
      uri: rights?.url ?? null,
    },
    imageUrl,
    href: rijksPageUrl(obj, id),
    institution: PARTNERS.rijks.name,
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
 * Composes label and value when both exist: "label: value"
 */
function iiifRequiredStatement(manifest) {
  // v3: requiredStatement
  if (manifest.requiredStatement) {
    const label = iiifString(manifest.requiredStatement?.label)
    const value = iiifString(manifest.requiredStatement?.value)
    // Compose "label: value" when both exist, else return whichever is present
    if (label && value) return `${label}: ${value}`
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
 * Gate: v3 only, exactly one provider, CC0 or PDM rights, imageUrl, homepage.
 * manifestUrl is the P6108 value, used as the record id.
 */
export function iiifRecordFrom(manifest, manifestUrl) {
  if (!manifest || typeof manifest !== 'object') return null

  // Gate: rights must be CC0 or PDM
  const v3rights = Array.isArray(manifest?.rights) ? manifest.rights[0] : manifest?.rights
  const v2license = Array.isArray(manifest?.license) ? manifest.license[0] : manifest?.license
  const rightsUri = typeof v3rights === 'string' ? v3rights : typeof v2license === 'string' ? v2license : null
  const rights = ccFromUri(rightsUri)
  const isPublicDomain = rights?.code === 'CC0' || rights?.code === 'PDM'

  // Gate: imageUrl
  const imageUrl = iiifImageUrl(manifest)

  // Gate: homepage/related (must be explicitly stated, no manifest URL fallback)
  // Never pass manifestUrl to iiifHomepage — its fallback would defeat the no-object-page gate.
  const href = iiifHomepage(manifest)

  // Gate: institution (v3 provider with exactly one entry, v2 fails)
  // Track provider count for gateFailure to distinguish no-institution vs several-institutions
  const providers = Array.isArray(manifest?.provider) ? manifest.provider : manifest?.provider ? [manifest.provider] : []
  const institution = iiifInstitution(manifest.provider)

  return {
    partner: 'iiif',
    id: manifestUrl ?? '',
    title: iiifString(manifest.label),
    creator: null,
    date: null,
    medium: null,
    dimensions: null,
    accession: null,
    credit: null,
    rights: {
      publicDomain: isPublicDomain,
      label: rights?.label ?? null,
      uri: rightsUri,
    },
    imageUrl,
    href,
    institution,
    requiredStatement: iiifRequiredStatement(manifest),
    _providers: providers.length, // Internal: track provider count for gateFailure
  }
}

/**
 * Fetch a holder's catalog record from the museum's API.
 * Returns a normalized record (passing or failing the gate), or null on fetch failure.
 *
 * Failure semantics:
 * - A throw on the gate-field path → log to stderr → null.
 * - rijks: a failed secondary hop leaves those fields null (implemented in rijksRecordObjects);
 *   this catch is all-or-nothing — it also swallows a transform bug, logged as 'holder record failed'.
 */
export async function fetchHolderRecord(holder) {
  try {
    if (holder.partner === 'met') return metRecordFrom(await getJson(metRecordUrl(holder.id)))
    if (holder.partner === 'artic') return aicRecordFrom(await getJson(aicRecordUrl(holder.id)))
    if (holder.partner === 'cleveland') return clevelandRecordFrom(await getJson(clevelandRecordUrl(holder.id)))
    if (holder.partner === 'rijks') return rijksRecordFrom(...(await rijksRecordObjects(holder.id)))
    if (holder.partner === 'iiif') return iiifRecordFrom(await getJson(holder.id), holder.id)
    console.error(`  holder record: no fetcher for partner ${holder.partner}`)
    return null
  } catch (e) {
    console.error(`  holder record failed (${holder.partner} ${holder.id}): ${e.message}`)
    return null
  }
}
