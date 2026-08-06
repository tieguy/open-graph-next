// The P13234 pivot: the Rijksmuseum's own record of its own object.
//
// Added 2026-08-06. The Rijksmuseum belongs here for the same reason the Met
// does — its 2013 Rijksstudio release was one of the launch events of museum
// open access — and on art-heavy articles it out-answers both partners the
// demo already had. Measured that day, anchors resolved from live enwiki
// articles: Rembrandt 15 P13234 against 11 P3634 and 1 P4610; The Night Watch
// 14 against 11 and 1.
//
// **No API key.** The keyed `api.rijksmuseum.nl` was shut down 2026-01-05 and
// answers `404 {"statusCode":404}`. The replacement is `data.rijksmuseum.nl` /
// `id.rijksmuseum.nl` — Linked Art, IIIF, OAI-PMH — and every request this
// module makes was verified unauthenticated. That matters beyond convenience:
// a keyed partner is one a clone of this repo cannot use (see DPLA and
// Europeana, both of which silently skip without their key). This one just
// works.
//
// ## Why it costs three requests
//
// Linked Art models the object, the visual content, and the file as three
// separate resources, so getting from a QID to a picture is a walk:
//
//   1. id.rijksmuseum.nl/<id>          HumanMadeObject  ~30 KB → title, date, `shows`
//   2. id.rijksmuseum.nl/<visualItem>  VisualItem       ~2 KB  → rights, `digitally_shown_by`
//   3. id.rijksmuseum.nl/<digital>     DigitalObject    ~0.6 KB → `access_point`
//
// and `access_point` is a plain IIIF Image API base, so the existing
// `${base}/full/400,/0/default.jpg` construction takes it from there.
//
// **The hop-2 id is derivable and we derive it anyway only as a fallback.**
// The VisualItem id is the object id with the third digit changed `0`→`2`
// (200107947 → 202107947), which held on 6/6 sampled objects across both the
// 8- and 9-digit id lengths on 2026-08-06. It is undocumented, so it is used
// only when hop 1 fails to state `shows` outright — never in place of an
// answer the museum gave us. Skipping hop 1 entirely would save 30 KB and buy
// a card with no title, which is not a card.
//
// ## Rights: the CC0 in this record is NOT about the picture
//
// The VisualItem states two Creative Commons URIs and they answer different
// questions, which is exactly the `copy` / `work` split `src/rights.js` exists
// to keep apart:
//
//   subject_to             → publicdomain/mark  the VISUAL CONTENT is public domain
//   subject_of.subject_to  → publicdomain/zero  the METADATA DESCRIPTION is CC0
//
// The second is a licence on the catalogue text (AAT 300379475, "descriptions").
// Printing it as the card's licence would promise CC0 over an image the museum
// marked public-domain instead — a different glyph and a different claim. So
// `rijksRights` reads `subject_to` and nothing else, and returns null rather
// than guessing, per the "a mark is never a guess" rule in CLAUDE.md.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'

/** Getty AAT vocabulary ids this record uses to tag its own strings. */
const ENGLISH = 'http://vocab.getty.edu/aat/300388277'
const PRIMARY_NAME = 'http://vocab.getty.edu/aat/300404670'
const ACCESSION_NUMBER = 'http://vocab.getty.edu/aat/300312355'

/** The trailing id of a `https://id.rijksmuseum.nl/<id>` reference, or null. */
export function rijksIdFrom(ref) {
  const url = typeof ref === 'string' ? ref : ref?.id
  if (typeof url !== 'string') return null
  const m = /^https?:\/\/(?:id|data)\.rijksmuseum\.nl\/([\w.-]+)$/.exec(url.trim())
  return m ? m[1] : null
}

const first = (v) => (Array.isArray(v) ? v[0] : v)
const tagged = (entry, key, id) => (entry?.[key] ?? []).some((t) => t?.id === id)

/**
 * The object's title, in English, preferring the one the museum marks primary.
 *
 * A Rijksmuseum record carries the same work under several names — a long
 * curatorial description, a short display title, and the Dutch of each. On
 * "An Old Woman Reading" the six `identified_by` entries include an 88-character
 * sentence about Rembrandt's mother and the plain "Old Woman Reading, Probably
 * the Prophetess Anna". Both are English and true; only one is a card title.
 * The museum distinguishes them itself (AAT 300404670, "primary name"), so this
 * reads that tag rather than guessing by length.
 *
 * Falls back to any English name, then to any name at all: a Dutch title is a
 * worse card than an English one and a better card than none.
 */
export function rijksTitle(obj) {
  const names = (obj?.identified_by ?? []).filter(
    (n) => n?.type === 'Name' && typeof n.content === 'string' && n.content.trim(),
  )
  const english = names.filter((n) => tagged(n, 'language', ENGLISH))
  const pick =
    english.find((n) => tagged(n, 'classified_as', PRIMARY_NAME)) ?? english[0] ?? names[0]
  return pick?.content.trim() ?? null
}

/**
 * When it was made, as the museum states it. The timespan's own Name is used
 * verbatim rather than a parsed date: "1631" and "c. 1631 - 1633" are both
 * things the museum says, and reformatting either would be this code claiming
 * a precision the record does not carry.
 */
export function rijksDate(obj) {
  const names = (first(obj?.produced_by?.timespan)?.identified_by ?? []).filter(
    (n) => n?.type === 'Name' && typeof n.content === 'string',
  )
  const pick = names.find((n) => tagged(n, 'language', ENGLISH)) ?? names[0]
  return pick?.content.trim() ?? null
}

/**
 * The museum's own accession number for the object — "SK-C-5", "RP-P-OB-60.797".
 *
 * AAT 300312355 is "accession numbers", which the record tags explicitly, so
 * this is read rather than guessed at among the several identifiers a record
 * carries.
 */
export function rijksObjectNumber(obj) {
  const found = (obj?.identified_by ?? []).find(
    (n) =>
      n?.type === 'Identifier' &&
      typeof n.content === 'string' &&
      n.content.trim() &&
      tagged(n, 'classified_as', ACCESSION_NUMBER),
  )
  return found?.content.trim() ?? null
}

/**
 * Where a reader lands — and it is NOT built from the Linked Art id.
 *
 * Reported as a 404 on a live card 2026-08-06: this used to construct
 * `www.rijksmuseum.nl/en/collection/object/<numericId>`, a URL shape that does
 * not exist. The museum's real page for The Night Watch is
 * `/en/collection/SK-C-5` — keyed by ACCESSION NUMBER, with no `/object/`
 * segment. The numeric id addresses the data (`id.rijksmuseum.nl/200107928`,
 * which serves JSON), never the web page.
 *
 * The museum also states a canonical page URL of its own, and it is worse for
 * this purpose: `/nl/collectie/object/SK-C-5--3137deb45cd7765f9a76084a16c99544`
 * is Dutch and carries an opaque hash that cannot be derived. It is kept as the
 * fallback — locale-swapped, since the English path is the same shape — for a
 * record that states no accession number.
 *
 * The accession-number form was verified 9/9 on 2026-08-06 across both
 * paintings (SK-C-5, SK-A-3066, SK-A-2391, SK-A-3340, SK-A-3934) and prints
 * (RP-P-1912-2395, RP-P-1906-695, RP-P-2004-957, RP-P-OB-60.797), so it is not
 * a pattern fitted to one department's numbering.
 */
export function rijksPageUrl(obj, id) {
  const number = rijksObjectNumber(obj)
  if (number) {
    return `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(number)}`
  }
  for (const lo of obj?.subject_of ?? []) {
    for (const carrier of lo?.digitally_carried_by ?? []) {
      if (carrier?.format !== 'text/html') continue
      const url = first(carrier.access_point)?.id
      if (typeof url === 'string' && url) return url.replace('/nl/collectie/', '/en/collection/')
    }
  }
  // The data URL is a poor page but an honest one: it resolves, and it is the
  // identifier Wikidata actually stated.
  return `https://id.rijksmuseum.nl/${encodeURIComponent(id)}`
}

/** The VisualItem this object `shows`, as an id, or null. */
export const visualItemId = (obj) => rijksIdFrom(first(obj?.shows))

/**
 * The VisualItem id derived from the object id — third digit `0` → `2`.
 *
 * Held on 6/6 objects sampled 2026-08-06 (200107947 → 202107947, 20026161 →
 * 20226161), across both id lengths. It is UNDOCUMENTED, so it is a fallback
 * for a record that omits `shows` and never a substitute for one that states
 * it. Returns null unless the id has the shape the rule was observed on.
 */
export function derivedVisualItemId(id) {
  return /^\d{2}0\d{5,6}$/.test(id ?? '') ? `${id.slice(0, 2)}2${id.slice(3)}` : null
}

/** The DigitalObject the visual content is `digitally_shown_by`, or null. */
export const digitalObjectId = (vis) => rijksIdFrom(first(vis?.digitally_shown_by))

/**
 * The terms the museum states over the VISUAL CONTENT — see the header: the
 * CC0 elsewhere in this record licenses the catalogue text, not the picture.
 * Unrecognized vocabulary yields null and the card says nothing.
 */
export function rijksRights(vis) {
  const uri = first(first(vis?.subject_to)?.classified_as)?.id
  return ccFromUri(typeof uri === 'string' ? uri : null)
}

/**
 * The IIIF Image API base the DigitalObject points at, or null.
 *
 * `access_point` is a full default.jpg URL (`https://iiif.micr.io/CNSQg/full/max/0/default.jpg`),
 * so the base is what precedes the IIIF parameters. Anything not shaped like an
 * Image API URL is refused rather than trimmed on a guess.
 */
export function imageBaseFrom(digital) {
  const url = first(digital?.access_point)?.id
  if (typeof url !== 'string') return null
  const m = /^(https?:\/\/[^\s]+?)\/full\/[^/]+\/[^/]+\/\w+\.\w+$/.exec(url.trim())
  return m ? m[1] : null
}

/**
 * The three fetched resources as one page entry, or null when they yield
 * nothing showable. Pure, so the walk above can be tested without a network.
 */
export function rijksEntryFrom(obj, vis, digital, id) {
  const title = rijksTitle(obj)
  if (!title) return null
  const base = imageBaseFrom(digital)
  const copy = licenseView(rijksRights(vis))
  return {
    source: 'rijks',
    title,
    description: ['Rijksmuseum, Amsterdam', rijksDate(obj)].filter(Boolean).join(' · '),
    imageUrl: base ? `${base}/full/400,/0/default.jpg` : null,
    // The museum's own object page, so the card is a door rather than a
    // mention — the same argument the Internet Archive cards settled.
    href: rijksPageUrl(obj, id),
    attribution: {
      author: copy ? 'Rijksmuseum · public domain' : 'Rijksmuseum',
      license: null,
    },
    rights: copy ? { copy } : undefined,
    _via: 'P13234',
  }
}

/**
 * One object id → one card, in three serial requests on this host's queue.
 *
 * Hops 2 and 3 are skipped the moment one of them yields nothing: a record
 * with no reachable image still makes a truthful text card naming what the
 * museum holds, which is better than dropping the object entirely.
 */
export async function rijksEntry(id) {
  const obj = await getJson(`https://id.rijksmuseum.nl/${id}`)
  const visId = visualItemId(obj) ?? derivedVisualItemId(id)
  let vis = null
  let digital = null
  if (visId) {
    vis = await getJson(`https://id.rijksmuseum.nl/${visId}`).catch(() => null)
    const digId = digitalObjectId(vis)
    if (digId) digital = await getJson(`https://id.rijksmuseum.nl/${digId}`).catch(() => null)
  }
  return rijksEntryFrom(obj, vis, digital, id)
}
