// The Smithsonian pivot: P195 (collection) + P217 (inventory number).
//
// Added 2026-08-06. Unlike every other museum partner here, the Smithsonian has
// **no external-id property on the objects that matter**. The Met has P3634, the
// Rijksmuseum P13234, the Art Institute P4610 — one property, one id, one card.
// Columbia (Q85753536), the Apollo 11 command module, carries none of them. What
// it does carry is `P195 = National Air and Space Museum` and
// `P217 = A19700102000`, and that pair is enough, because the Smithsonian's Open
// Access API indexes the accession number.
//
// This module exists because of a specific regression. The command module's 3D
// scan was on the Apollo 11 page when that page was hand-curated; the curated
// dataset retired 2026-08-04 and live discovery had no Smithsonian pivot at all,
// so it silently vanished. The anchor was never the problem — the article links
// "Command module Columbia" from its prose several times and the QID resolves —
// the problem was that the QID carried no question this project knew how to ask.
//
// ## Coverage, measured rather than assumed (2026-08-06)
//
// 41,202 Wikidata items sit in a Smithsonian collection with an inventory
// number. Not all resolve to an Open Access record — the Enola Gay's
// `A19500100000` returns nothing, because the aircraft itself is not in Open
// Access even though exhibition records about it are.
//
//   SAAM   12/20 sampled resolved (60%), all with images, none with 3D
//   NASM    4/6  resolved,             4 with images, **2 with CC0 3D models**
//
// A 60% pivot is worth having; the misses cost one anchor its card and nothing
// else. The 3D models are the reason NASM punches above its six items.
//
// ## Why the id is verified rather than constructed
//
// The API's record ids look constructible — `edanmdm:nasm_A19700102000` is
// visibly `<unitcode>_<inventory>` — and constructing them is a trap. Unit codes
// do not follow from the collection (the Natural History Museum alone has
// several, by department) and accession punctuation is normalized in ways that
// vary: Cooper Hewitt's "1993.9" and "31588 D" do not resolve at all. So this
// SEARCHES for the inventory number and then accepts a row only if the row's
// own stated id ends with it, compared on alphanumerics. That is a check against
// what the Smithsonian says, not a guess at what it might say — the rule the
// Rijksmuseum 404 taught (see `rijksPageUrl`).
//
// ## The href is an ARK the Smithsonian states
//
// `record_link` is `n2t.net/ark:/65665/…`, which resolves to the object's page
// (`airandspace.si.edu/collection-objects/command-module-apollo-11/…`) and 404s
// for an ARK that does not exist — the real/bogus control, passed 2026-08-06.
// The prettier `3d.si.edu/object/3d/<slug>:<uuid>` URL is deliberately NOT built
// here: its slug cannot be derived from anything the API returns, and the ARK's
// page carries the 3D viewer anyway.

import { getJson } from './http.js'
import { ccFromUri, licenseView } from './rights.js'

/**
 * Smithsonian collections, by the QID Wikidata files objects under, with the
 * name a card should credit. Counts are distinct items carrying both P195 and
 * P217 as of 2026-08-06.
 *
 * An explicit map rather than a SPARQL property path walking P361/P749 up to
 * wd:Q131626: the path costs every page's anchor query a graph walk to learn
 * something that changes about once a decade, and the map doubles as the credit
 * line. An unlisted collection simply does not pivot.
 */
export const SI_COLLECTIONS = {
  Q1192305: 'Smithsonian American Art Museum', // 16,237
  Q1967614: 'National Portrait Gallery', //        2,435
  Q148554: 'National Museum of Natural History', //  362
  Q1075126: 'Freer Gallery of Art', //               280
  Q1129820: 'Cooper Hewitt, Smithsonian Design Museum', // 175
  Q259767: 'Arthur M. Sackler Gallery', //            88
  Q131626: 'Smithsonian Institution', //              60
  Q1620553: 'Hirshhorn Museum and Sculpture Garden', // 55
  Q148584: 'National Museum of American History', //   53
  Q105749808: 'National Museum of Asian Art', //        8
  Q752669: 'National Air and Space Museum', //          6
  Q3073495: 'National Museum of African American History and Culture', // 6
  Q2154134: 'Smithsonian Institution Archives', //      4
  Q876537: 'Renwick Gallery', //                        3
  Q483592: 'Anacostia Community Museum', //             3
  Q1075141: 'National Museum of the American Indian', // 3
  Q1609326: 'Smithsonian Libraries and Archives', //     2
  Q110453413: 'Archives Center, National Museum of American History', // 2
  Q46812: 'National Museum of African Art', //           1
  Q144900: 'National Postal Museum', //                  1
  Q2860568: 'Archives of American Art', //               1
}

/**
 * The bare QID, whether given one or the entity URI WDQS binds for an item
 * value (`http://www.wikidata.org/entity/Q752669`). Every other var in that
 * query is a literal, so this is the one place the difference shows up.
 */
export const siQid = (v) => (typeof v === 'string' ? (/(Q\d+)$/.exec(v.trim())?.[1] ?? null) : null)

/** The collection's name if it is a Smithsonian one, else null. */
export const siCollectionName = (v) => SI_COLLECTIONS[siQid(v)] ?? null

/** Whether this anchor is worth one Smithsonian request. */
export const isSmithsonianCollection = (v) => Boolean(siCollectionName(v))

/** Accession numbers differ in punctuation between Wikidata and EDAN. */
const norm = (s) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : '')

export function siSearchUrl(inventory, key) {
  return (
    'https://api.si.edu/openaccess/api/v1.0/search?q=' +
    encodeURIComponent(`"${inventory}"`) +
    `&api_key=${encodeURIComponent(key)}`
  )
}

/**
 * The row whose OWN stated id ends with this inventory number, or null.
 *
 * A bare accession number is a weak query — "1993.9" matches a great deal that
 * is not the object — so a row is only accepted when the Smithsonian's own
 * `edanmdm:` id confirms it. Compared on alphanumerics because EDAN writes
 * `nasm_A19700102000` for what Wikidata writes `A19700102000`, and elsewhere
 * normalizes dots and spaces away.
 */
export function siRowFor(body, inventory) {
  const want = norm(inventory)
  if (!want) return null
  const rows = body?.response?.rows ?? []
  return rows.find((r) => norm(r?.url).endsWith(want)) ?? null
}

const media = (row) => row?.content?.descriptiveNonRepeating?.online_media?.media ?? []

/** The object's 3D scans, as the Smithsonian states them. */
export const si3dModels = (row) => media(row).filter((m) => m?.type === '3d_voyager' && m?.content)

/**
 * The card's picture — the first still image, at a card-sized width.
 *
 * `ids.si.edu/ids/deliveryService` takes a `max` edge length; the full-size
 * default is several thousand pixels and this is a 178px card.
 */
export function siImageUrl(row) {
  const found = media(row).find((m) => m?.type === 'Images' && typeof m.content === 'string')
  if (!found) return null
  return `${found.content}${found.content.includes('?') ? '&' : '?'}max=800`
}

/**
 * The terms, read only where the Smithsonian states them.
 *
 * Open Access records carry `usage.access: "CC0"` on the media. Anything else —
 * a blank, an unrecognized string — yields null and the card claims nothing,
 * per the "a mark is never a guess" rule in CLAUDE.md.
 */
export function siRights(row) {
  const any = media(row).find((m) => m?.usage?.access)
  return any?.usage?.access === 'CC0'
    ? ccFromUri('https://creativecommons.org/publicdomain/zero/1.0/')
    : null
}

/** The date the object's own record states, verbatim, or null. */
export function siDate(row) {
  const ft = row?.content?.freetext?.date ?? []
  const first = ft.find((d) => typeof d?.content === 'string' && d.content.trim())
  return first?.content.trim() ?? null
}

/** One Open Access record as a page entry, or null when it shows nothing. */
export function siEntryFrom(row, collectionName) {
  const title = typeof row?.title === 'string' && row.title.trim() ? row.title.trim() : null
  // The ARK the Smithsonian states. No ARK, no door — and a card whose href we
  // would have to invent is exactly what this module refuses to build.
  const href = row?.content?.descriptiveNonRepeating?.record_link ?? null
  if (!title || !href) return null
  const models = si3dModels(row)
  const copy = licenseView(siRights(row))
  const unit = row?.content?.descriptiveNonRepeating?.data_source ?? collectionName ?? 'the Smithsonian'
  return {
    source: 'smithsonian',
    title,
    description: [unit, siDate(row)].filter(Boolean).join(' · '),
    imageUrl: siImageUrl(row),
    href,
    // A scanned object is the thing this partner has that no other one here
    // does, and it is worth saying on the card rather than burying in a link.
    plate: models.length ? '3D scan' : undefined,
    media3d: models.length ? models[0].content : undefined,
    attribution: {
      author: copy ? `${unit} · CC0` : unit,
      license: null,
    },
    rights: copy ? { copy } : undefined,
    _via: 'P217',
  }
}

/**
 * One inventory number → one card, in a single request.
 *
 * Returns null rather than throwing on a miss: roughly 40% of Wikidata's
 * Smithsonian-collection items have no Open Access record, which is an ordinary
 * outcome and not an error.
 */
export async function smithsonianEntry(inventory, collectionName, key) {
  if (!inventory || !key) return null
  const body = await getJson(siSearchUrl(inventory, key))
  const row = siRowFor(body, inventory)
  return row ? siEntryFrom(row, collectionName) : null
}
