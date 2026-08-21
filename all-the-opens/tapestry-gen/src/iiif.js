// The P6108 lookup: Wikidata states an item's IIIF manifest outright, and the
// manifest — served by whatever institution holds the object — supplies the
// image, the label, and the credit. IIIF has no cross-institution search;
// this is the demo's answer to that gap: the graph is the directory, the
// protocol is the door, and every IIIF publisher is reachable with no
// per-partner code at all. Presentation API v2 and v3 both arrive here, and so
// does Shared Canvas (Presentation 1.0, 2013), which predates every field the
// later versions added for this and states its facts in `metadata` instead.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'
import { stripTags } from './html.js'

/** The first human-readable string in any of IIIF's label shapes:
 * "x", ["x"], {"@value":"x"}, {en:["x"]}, {none:["x"]}. */
export function iiifString(value) {
  if (value == null) return null
  if (typeof value === 'string') return stripTags(value).trim() || null
  if (Array.isArray(value)) return iiifString(value[0])
  if (typeof value === 'object') {
    if (value['@value'] != null) return iiifString(value['@value'])
    const lang = value.en ?? value.none ?? Object.values(value)[0]
    return iiifString(lang)
  }
  return null
}

/**
 * IIIF's `metadata` block as a label -> value map, empty when a manifest
 * states none. Presentation 1.0 and 2.1 write both halves as plain strings;
 * 3.0 wraps each in a language map, and `iiifString` flattens either.
 *
 * This block is where publishers put what the older versions gave them no
 * field for. Measured across the 120 live `ids.si.edu` manifests on
 * 2026-08-18 (LUI-181): the holder is named in "Data Source" in 118 of them
 * while the top-level attribution says only "Smithsonian Institution", the
 * object's real title sits in "Title" in 117, and an ARK sits in "Guid" in
 * 117. The first value stated for a label wins.
 */
export function iiifMetadata(manifest) {
  const pairs = Array.isArray(manifest?.metadata) ? manifest.metadata : []
  const map = new Map()
  for (const pair of pairs) {
    const label = iiifString(pair?.label)
    const value = iiifString(pair?.value)
    if (label && value && !map.has(label)) map.set(label, value)
  }
  return map
}

// The spec never standardised these spellings, so each list is the publisher's
// own vocabulary rather than the spec's, longest-observed first.
const TITLE_LABELS = ['Title', 'title', 'Object Title']
const HOLDER_LABELS = ['Data Source', 'Repository', 'Institution', 'Holding Institution']
const PAGE_LABELS = ['Link', 'Record Link', 'Object URL']
const ARK_LABELS = ['Guid', 'ARK', 'Identifier']

/** The first value any of `labels` carries, or null. */
const metaValue = (meta, labels) => {
  for (const label of labels) {
    const value = meta.get(label)
    if (value) return value
  }
  return null
}

/**
 * True when a manifest's label only repeats its own identifier, so the label
 * names the file rather than the object: `FS-F1950.19_Stitched` for a scroll
 * called Dwelling in the Fuchun Mountains. A card must not print the filename
 * when the manifest states the title one block lower.
 */
export function labelRepeatsId(label, manifest, manifestUrl) {
  if (!label) return false
  const id = manifest?.['@id'] ?? manifest?.id ?? manifestUrl
  if (typeof id !== 'string') return false
  const tail = id.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
  return label === id || label === tail
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

/** `iiifString` without the tag stripping, for callers that must read the
 * markup itself rather than the words inside it. */
function iiifRaw(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return iiifRaw(value[0])
  if (typeof value === 'object') {
    if (value['@value'] != null) return iiifRaw(value['@value'])
    const lang = value.en ?? value.none ?? Object.values(value)[0]
    return iiifRaw(lang)
  }
  return null
}

const ANCHOR = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
/** Hosts that serve licence badges and deeds, never an institution's name. */
const LICENCE_HOST = /creativecommons\.org|rightsstatements\.org|licensebuttons\.net/i
/** Anchor text that is a URL or an address rather than a name. */
const NOT_A_NAME_TEXT = /^https?:\/\/|@|^[\w.-]+\.[a-z]{2,}(\/|$)/i

/**
 * The institution's own name out of an HTML attribution.
 *
 * Presentation 2 gave publishers no `provider` field, so a museum that wants
 * to be named links itself inside the free-text `attribution` — and vendor
 * software puts a machine-generated run of licence codes and repeated
 * collection strings in front of that link. KMSKA Antwerp's manifest for
 * object 34343 opens "CC0, CC0, Public domain," and repeats its Dutch
 * collection name four times before linking "Royal Museum of Fine Arts
 * Antwerp - Flemish Community" (fetched 2026-08-21). Reading the words alone
 * credits a card to that whole blob.
 *
 * The first anchor that is neither a licence badge nor a bare URL is the
 * museum naming itself. An attribution with no link at all yields null, so a
 * plain rights notice still reads exactly as the publisher wrote it.
 */
export function creditFromHtml(html) {
  if (typeof html !== 'string' || !html.includes('<a')) return null
  for (const [, href, inner] of html.matchAll(ANCHOR)) {
    if (LICENCE_HOST.test(href)) continue
    const text = stripTags(inner).trim()
    if (!text || NOT_A_NAME_TEXT.test(text)) continue
    return text
  }
  return null
}

/** Free text that credits nobody: a rights notice, not an institution's name. */
const RIGHTS_NOTICE = /[\u00a9\u00ae]|\ball rights\b|reserved|copyright|https?:\/\//i

/**
 * Who to credit: the museum that holds the object, then the body that signs
 * the manifest.
 *
 * A large institution signs every manifest with the umbrella's name and states
 * the holding museum one block lower, so reading only the top-level field
 * credits the parent for a scroll it does not hold. Every ids.si.edu manifest
 * says `attribution: "Smithsonian Institution"`; the manifest for FS-F1950.19
 * says `metadata["Data Source"]: "National Museum of Asian Art"` (fetched
 * 2026-08-21). Both are true, and the museum is the one a reader wants, so the
 * museum leads and the signing body follows it in parentheses.
 *
 * Two cases refuse that composition. When either name already contains the
 * other, composing would print it twice, so the stated text stands. When the
 * top-level field is a rights notice rather than a name — v2 `attribution` is
 * free text and much of it reads "© X. All rights reserved." — composing reads
 * as nonsense, so again the stated text stands alone.
 */
export function iiifCredit(manifest) {
  const stated =
    iiifString(manifest.requiredStatement?.value) ??
    iiifString(manifest.provider?.[0]?.label) ??
    creditFromHtml(iiifRaw(manifest.attribution)) ??
    iiifString(manifest.attribution) ??
    null
  const holder = metaValue(iiifMetadata(manifest), HOLDER_LABELS)
  if (!holder) return stated
  if (!stated) return holder
  if (stated.includes(holder) || holder.includes(stated)) return stated
  return RIGHTS_NOTICE.test(stated) ? stated : `${holder} (${stated})`
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
  return (
    home?.id ?? home?.['@id'] ?? related?.['@id'] ?? related ??
    metaHomepage(iiifMetadata(manifest)) ?? manifestUrl ?? null
  )
}

/**
 * An object page from `metadata`: a stated absolute link, else an ARK through
 * the Name-to-Thing resolver, which is what an ARK is for. Publishers state
 * ARKs both ways — the Smithsonian's "Guid" arrives already resolved as
 * `http://n2t.net/ark:/65665/...` (fetched 2026-08-21), while others state the
 * bare `ark:/` name — so an absolute URL is served as stated and a bare name
 * gets the resolver prefix. Anything else is left alone: an accession number is
 * not a URL, and guessing one would send a reader somewhere nobody promised.
 */
const metaHomepage = (meta) => {
  const link = metaValue(meta, PAGE_LABELS)
  if (link && /^https?:\/\//.test(link)) return link
  const ark = metaValue(meta, ARK_LABELS)
  if (!ark) return null
  if (/^https?:\/\//.test(ark)) return ark
  return ark.startsWith('ark:/') ? `https://n2t.net/${ark}` : null
}

/** A manifest as a page entry, or null when it yields nothing showable. */
export function iiifEntryFrom(manifest, manifestUrl, fallbackTitle) {
  if (!manifest || typeof manifest !== 'object') return null
  const stated = iiifString(manifest.label)
  const fromMetadata = metaValue(iiifMetadata(manifest), TITLE_LABELS)
  const title = (
    labelRepeatsId(stated, manifest, manifestUrl)
      ? fromMetadata ?? stated
      : stated ?? fromMetadata
  ) ?? fallbackTitle
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
