// The J. Paul Getty Museum (P2582). The Linked Art endpoint (data.getty.edu)
// answers real and bogus ids alike with the same 404 — the refusing-to-talk
// shape from the probe control — so the record surface is the OBJECT PAGE's
// embedded schema.org JSON-LD (probe note 12 in
// ../../docs/reaching-open-collections.md, 2026-08-17): one
// <script type="application/ld+json"> block carrying title, creator, date,
// medium, accession, a per-object license URI, an IIIF thumbnail and the
// page's own URL. A bogus id answers 200 with a generic page and NO JSON-LD
// block, which is what keeps the two distinguishable.
//
// `size` (the dimensions string, the Met/AIC shape) is present on most
// objects and absent on some — sampled 2026-08-17: present on 103JNH, 108NVJ,
// 103R3F, absent on 1078D0 — so the record maps it and carries null where the
// page omits it. A credit line is genuinely absent: `creditText` is the
// license boilerplate, not an object credit, and stays unread.

/** The object page — both the record surface and the card's link-out. */
export function gettyPageUrl(id) {
  return `https://www.getty.edu/art/collection/object/${encodeURIComponent(id)}`
}

/**
 * The embedded schema.org record, or null. Null for a page with no JSON-LD
 * block (the bogus-id shape) and for a block that does not parse — a
 * half-served page must cost this card, never crash the band.
 */
export function gettyLd(html) {
  if (typeof html !== 'string') return null
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try {
    const ld = JSON.parse(m[1])
    return ld && typeof ld === 'object' ? ld : null
  } catch {
    return null
  }
}

/**
 * A display-size image from the record's IIIF thumbnail. The page states a
 * !300,300 thumbnail on a level-2 IIIF Image service, so the size segment is
 * rewritten to !800,800 — the AIC's width rule, spec-defined syntax rather
 * than a guessed URL shape. A thumbnail whose path does not carry the
 * expected size segment is returned unchanged: small, but true.
 */
export function gettyImageUrl(thumbnailUrl) {
  if (typeof thumbnailUrl !== 'string' || !thumbnailUrl) return null
  return thumbnailUrl.replace(/\/full\/![\d,]+\//, '/full/!800,800/')
}
