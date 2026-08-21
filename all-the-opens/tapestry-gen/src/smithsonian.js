// The Smithsonian lookup: P195 (collection) + P217 (inventory number).
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
// dataset retired 2026-08-04 and live discovery had no Smithsonian lookup at all,
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
// A 60% lookup is worth having; the misses cost one anchor its card and nothing
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
 * line. An unlisted collection is simply not looked up.
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

// ---------------------------------------------------------------------------
// The second anchor: a scientific name (P225) → the Smithsonian's 3D scans
// ---------------------------------------------------------------------------
//
// Added 2026-08-20. The pair lookup above reaches an object because Wikidata
// states which Smithsonian collection holds it and under what accession number.
// Almost nothing that has been 3D scanned is reachable that way. Measured
// 2026-08-20 against the Open Access API, 1,937 objects carry a Voyager 3D
// package, and they break down by unit as:
//
//   NMNH invertebrate zoology   906     NMAH                 32
//   NMNH vertebrate zoology     728     NMAAHC               32
//   NMNH paleobiology           158     everything else     ≤11 each
//
// So roughly nine in ten scans are natural-history SPECIMENS — one gorilla
// skull out of a drawer of them. A specimen has no Wikidata item and never
// will; what it has is the species it belongs to, and the species is what the
// Wikipedia article is about. 1,934 of the 1,937 are plain CC0.
//
// The reach, measured the same day: 1,083 distinct taxon names across those
// specimens, 762 of which Wikidata knows as a taxon (P225), **307 of which have
// an English Wikipedia article**. That is the population this lookup serves.
//
// ## Why this is worth reaching for at all
//
// A Voyager package resolves to glTF. The scene document for USNM 143590 lists
// three levels of detail — 232 KB, 356 KB and 515 KB — plus a Draco-compressed
// AR variant, each served as `model/gltf-binary` with `Access-Control-Allow-
// Origin: *` (read 2026-08-20). Commons cannot hold any of it: its allowed
// upload extensions are 24 (`action=query&meta=siteinfo&siprop=fileextensions`,
// read 2026-08-20) and the only 3D one is `.stl`. So every card this lookup
// makes is a thing the encyclopedia's own media repository has no way to store,
// which is the argument the page exists to make.
//
// ## The join is a NAME, and the card says so
//
// Every other edge in this project is an identifier on both sides. This one is
// not: the Smithsonian's record states a scientific name and Wikidata states a
// scientific name, and they are compared as strings. That is a weaker claim and
// the page must not let it look the same, so these entries carry
// `evidence: 'corroborated'` — the dashed card and the "no shared identifier"
// signal row that `emit-html.js` already renders.
//
// Two things make the string comparison defensible where a person's name would
// not be. A binomial is governed: the ICZN and ICN exist precisely so that one
// name denotes one taxon, which is not true of "J. Smith". And both sides are
// structured fields written for machines — Wikidata's P225, and EDAN's
// `indexedStructured.scientific_name` — rather than prose either side wrote for
// a reader. The comparison is exact after folding case and interior whitespace;
// nothing fuzzy, no genus-only fallback (a scan of *some* Pongo is not a scan
// of the species this article is about).
//
// It remains a name match. Its known failure mode is a homonym across
// nomenclature codes — the same binomial used for an animal and a plant — which
// this cannot detect and which would put a beetle on a flower's page. No
// instance has been seen in the 307; it is stated here rather than defended
// against, because the honest answer is that the corroborated class is what
// covers it.

/** The taxon names a record states for itself, as EDAN indexes them. */
export const siScientificNames = (row) =>
  row?.content?.indexedStructured?.scientific_name?.filter?.((n) => typeof n === 'string') ?? []

/**
 * A scientific name folded for comparison — case and interior whitespace only.
 *
 * Deliberately not the alphanumerics fold `norm` uses for accession numbers:
 * that one exists because punctuation in an accession number is cataloguing
 * noise, whereas here it would make "Gorilla beringei" and "Gorillaberingei"
 * compare equal, and a name is not a number.
 */
const foldTaxon = (s) => (typeof s === 'string' ? s.trim().toLowerCase().replace(/\s+/g, ' ') : '')

/**
 * How many rows one taxon search reads. EDAN has no field selection, so a row
 * costs about 12 KB whether or not the card will use it; 20 rows is ~240 KB for
 * a shelf of three. A taxon with more scanned specimens than this — Pongo
 * pygmaeus has 81 — reports its count as "at least", never as a total it did
 * not see.
 */
export const SI_TAXON_ROWS = 20

/**
 * The search for one taxon's scanned specimens.
 *
 * Free text rather than a fielded `scientific_name:` query: EDAN's own
 * `online_media_type` facet reports `["Images"]` for rows that plainly carry a
 * `3d_voyager` package (checked 2026-08-20), so its fielded vocabulary cannot
 * be trusted to describe what the record actually holds. The query is a net;
 * `siTaxonRows` is what decides, out of the record's own structured fields.
 */
export function siTaxonSearchUrl(taxon, key) {
  return (
    'https://api.si.edu/openaccess/api/v1.0/search?q=' +
    encodeURIComponent(`"${taxon}" AND 3d_voyager`) +
    `&rows=${SI_TAXON_ROWS}&api_key=${encodeURIComponent(key)}`
  )
}

/**
 * The rows that are BOTH this taxon and actually scanned, and whether the
 * search window held everything the API said it had.
 *
 * Both halves are checked against the record rather than the query: the free
 * text matches a collector's note as readily as a species, and `3d_voyager`
 * appears in rows whose package field is empty.
 */
export function siTaxonRows(body, taxon) {
  const want = foldTaxon(taxon)
  const rows = body?.response?.rows ?? []
  const matched = want
    ? rows.filter(
        (r) => siScientificNames(r).some((n) => foldTaxon(n) === want) && si3dModels(r).length,
      )
    : []
  const rowCount = Number(body?.response?.rowCount ?? rows.length)
  return { rows: matched, truncated: rowCount > rows.length }
}

/**
 * One scanned specimen as a page entry.
 *
 * Built on `siEntryFrom` rather than beside it — the record, its ARK, its CC0
 * mark and its Voyager package are the same fields read the same way — and then
 * says the two things that are true here and not there: the join is a name, and
 * this is a record OF the article's subject rather than of something it merely
 * mentions.
 */
/**
 * What the scan actually shows, in the museum's own words — "Pongo pygmaeus:
 * Cranium" — or null where it names nothing.
 *
 * The record's `title` is the species for every one of these specimens, so a
 * card built on the title alone says an orangutan and shows an ankle bone. The
 * Voyager package names its own subject on the media entry, in a resource this
 * module already has in hand: no second request, and no invented title.
 */
export function siScanSubject(row) {
  for (const m of media(row)) {
    if (m?.type !== '3d_voyager') continue
    for (const res of m.resources ?? [])
      if (typeof res?.name === 'string' && res.name.trim()) return foldRepeat(res.name.trim())
  }
  return null
}

/**
 * The museum's own name with a repeated leading segment collapsed: the
 * paleobiology packages are named "Bison latifrons: Bison latifrons: Teeth",
 * which renders as a card that looks broken. Dropping an exact repeat of the
 * segment before it removes nothing a reader was told — it is the same words
 * twice — and anything that is not an exact repeat is left alone.
 */
const foldRepeat = (name) => {
  const parts = name.split(':').map((p) => p.trim())
  const kept = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase())
  return kept.join(': ')
}

// Which scans a reader can recognize, and which are for a morphometrician.
//
// The Bornean orangutan's 81 scans include 33 mandibles and 30 crania; the
// three that reached the page were a right cuneiform 1, a right navicular and
// a right cuneiform 3, because the catalog returns its rows in no order and
// this shelf took the first three. That is the unranked-shelf failure
// `rankShelfEntries` exists to prevent, in a shelf that could not use it.
//
// So the pick prefers, in order: a scan of the whole specimen, then one of the
// head — a skull identifies an animal to anyone, and the museum names 656 of
// the 1,873 named scans as a cranium or mandible — then everything else, each
// group keeping the museum's own order inside it. Nothing is dropped: an
// isolated ankle bone is still a real scan of this species and still shelves,
// behind the skull rather than in front of it. The vocabulary is a judgment
// about what a reader recognizes, which is why it is short, listed here, and
// not dressed up as a relevance score.
const HEAD_PARTS = /\b(cranium|skull|mandible|jaw|teeth|tooth|dentition)\b/i

/** 0 for a whole specimen, 1 for its head, 2 for anything else. */
export function siScanRank(row) {
  const name = siScanSubject(row)
  if (!name?.includes(':')) return 0
  return HEAD_PARTS.test(name.split(':', 2)[1]) ? 1 : 2
}

/**
 * The museum's own catalogue number for a specimen — "USNM 143590" — or null.
 *
 * A shelf of specimens is a shelf of records the museum titles identically:
 * three cards all reading "Pan troglodytes troglodytes" on the chimpanzee page.
 * The title stays the museum's own (a title is never invented here), so the
 * number leads the description instead, which is where a reader can tell the
 * three apart. Present on 1,805 of the 1,807 natural-history scans (measured
 * 2026-08-20). "Accession Number" is the museum's acquisition event and "Other
 * Numbers" is a labelled grab-bag of field and legacy ids; neither names the
 * specimen, so neither is read.
 */
export function siSpecimenNumber(row) {
  const ids = row?.content?.freetext?.identifier ?? []
  const found = ids.find(
    (i) =>
      typeof i?.label === 'string' &&
      typeof i?.content === 'string' &&
      i.content.trim() &&
      /\bnumber$/i.test(i.label.trim()) &&
      !/^(accession|other)\b/i.test(i.label.trim()),
  )
  return found ? `${found.label.trim().replace(/(?<!\s)\s*number$/i, '')} ${found.content.trim()}` : null
}

export function siScanEntryFrom(row, taxon) {
  const entry = siEntryFrom(row)
  if (!entry?.media3d) return null
  const specimen = siSpecimenNumber(row)
  const subject = siScanSubject(row)
  const holding = siScientificNames(row).find((n) => foldTaxon(n) === foldTaxon(taxon)) ?? taxon
  return {
    ...entry,
    // What the scan shows, where the package says — otherwise the record's own
    // title, which is the species and nothing narrower.
    title: subject ?? entry.title,
    description: [specimen, entry.description].filter(Boolean).join(' · '),
    // A partner's own record of the thing the article is about — see heroRank.
    standing: 'subject-record',
    evidence: 'corroborated',
    corroboratedBy: [{ field: 'scientific name', holding, claimed: taxon }],
    _via: 'P225',
  }
}

/**
 * The Smithsonian's 3D scans of one taxon, in a single request.
 *
 * Returns `{ entries, total, truncated }`: `total` counts the confirmed rows
 * this request saw, so a caller printing "3 of 12" is naming something that was
 * checked. `truncated` says the API reported more rows than the window read,
 * which makes that count a floor rather than a total.
 *
 * Keyless it returns nothing at all, the same graceful degradation the pair
 * lookup makes — `SMITHSONIAN_API_KEY` is free by mail and production runs with
 * one.
 */
export async function smithsonianScansForTaxon(taxon, key, { cap = 3 } = {}) {
  const empty = { entries: [], total: 0, truncated: false }
  if (!taxon || !key) return empty
  const body = await getJson(siTaxonSearchUrl(taxon, key))
  const { rows, truncated } = siTaxonRows(body, taxon)
  // Stable: equal ranks keep the order the museum returned them in.
  const ordered = rows
    .map((r, i) => ({ r, i, rank: siScanRank(r) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r)
  const entries = ordered
    .slice(0, cap)
    .map((r) => siScanEntryFrom(r, taxon))
    .filter(Boolean)
  return { entries, total: rows.length, truncated }
}
