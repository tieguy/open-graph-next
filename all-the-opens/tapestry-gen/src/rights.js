// What a reader may actually DO with the thing on the card.
//
// Two different questions live here, and conflating them is the mistake this
// module exists to prevent:
//
//   1. **What license does the host serve this copy under?** Europeana states a
//      rights URI, OpenAlex a slug, the Met a flag. This is a promise made by
//      whoever is handing you the bytes, and it is true of that copy.
//   2. **What is the copyright status of the underlying work?** That is a fact
//      about the work and its author, it does not change when a museum
//      photographs it, and — crucially — it has a DIFFERENT ANSWER IN DIFFERENT
//      COUNTRIES. Wikidata records it in `P6216`, qualified by jurisdiction.
//
// They can disagree, and the disagreement is the interesting part: an
// institution asserting terms over a photograph of a painting whose copyright
// expired in 1958 is exactly the situation the public-domain community built
// tooling to expose. So the two are kept in separate fields all the way to the
// renderer, and neither is ever printed as the other.
//
// The second question's data does not come from an API. It comes from Wikidata,
// where **CopyClear** (<https://www.wikidata.org/wiki/Wikidata:CopyClear>, a
// Dutch initiative) runs bots — dodbot, lifesignbot, DACSbot, ADAGPbot — that
// establish the copyright status of creators and of works in museum
// collections, and where the **Dominio Público en América Latina** project
// maps Latin American terms. `P7763` alone holds 473,320 creators. Neither
// project charges us a request: the work is already in the graph, and reading
// it is the whole integration.
//
// **Paulina** (<https://paulina.toolforge.org>, 2025 Coolest Tool Award) is the
// tool that explains a status per country, and it takes deep links by QID:
// `/work/<QID>`, `/author/<QID>`, `/term/<QID>`. Its funded 2026/27 work is a
// public-domain calculator meant to be reusable by other tools; when that
// exists, this module is where it would be called from. Until then a link is
// the honest integration — we do not reimplement a term calculation we would
// get wrong.

import { chunk } from './batch.js'
import { getJson } from './http.js'

/**
 * The glyph vocabulary, matching the symbol ids in `src/cc-icons.js`.
 * `copyright` and `pd` are not Creative Commons marks and must never be
 * composed with `cc` — a © next to the CC circle would read as a CC license.
 * `unknown` (2026-08-08) is the ? mark for an HONESTLY RECORDED open
 * question — DigitalNZ's `Unknown`, rightsstatements' CNE/UND, Wikidata's
 * "not yet determined" — and it always stands alone: composing it with any
 * license mark would read as doubt about that license.
 */
export const MARKS = ['cc', 'by', 'sa', 'nc', 'nd', 'zero', 'pd', 'copyright', 'unknown']

/**
 * Licenses, canonicalized. `rank` orders by how much a reuser may do, freest
 * first, and is what decides which glyph row a card leads with.
 *
 * Versions are deliberately dropped. A card has room for a glyph row, not for
 * "CC BY-SA 4.0 International", and the version changes what a lawyer needs
 * without changing what the reader is being told they may do. The full URI is
 * still on the card as a link, which is where a version belongs.
 */
const LICENSES = {
  CC0: { label: 'CC0', marks: ['cc', 'zero'], rank: 0, url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  PDM: { label: 'public domain', marks: ['pd'], rank: 0, url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
  'CC BY': { label: 'CC BY', marks: ['cc', 'by'], rank: 1, url: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC BY-SA': { label: 'CC BY-SA', marks: ['cc', 'by', 'sa'], rank: 2, url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'CC BY-ND': { label: 'CC BY-ND', marks: ['cc', 'by', 'nd'], rank: 3, url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
  'CC BY-NC': { label: 'CC BY-NC', marks: ['cc', 'by', 'nc'], rank: 4, url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  'CC BY-NC-SA': { label: 'CC BY-NC-SA', marks: ['cc', 'by', 'nc', 'sa'], rank: 5, url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  'CC BY-NC-ND': { label: 'CC BY-NC-ND', marks: ['cc', 'by', 'nc', 'nd'], rank: 6, url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  // rightsstatements.org, which Europeana and DPLA both use as heavily as they
  // use CC. Not licenses and not CC anything — they are curators stating a
  // status. Sampled across DPLA on 2026-08-06, rightsstatements values
  // outnumbered CC ones roughly three to one, so leaving the whole vocabulary
  // unrecognized meant most DPLA cards said nothing.
  // A work of the US federal government: 17 USC §105 denies it copyright
  // outright, so this is a statute rather than a grant. archive.org states it
  // on 22 of every 400 items sampled, second only to CC's retired dedication.
  USGOV: { label: 'a US government work — no copyright', marks: ['pd'], rank: 0, url: 'https://www.usa.gov/government-works' },
  NOCUS: { label: 'no copyright in the United States', marks: ['pd'], rank: 0, url: 'http://rightsstatements.org/vocab/NoC-US/1.0/' },
  NKC: { label: 'no known copyright', marks: ['pd'], rank: 1, url: 'http://rightsstatements.org/vocab/NKC/1.0/' },
  INC: { label: 'in copyright', marks: ['copyright'], rank: 9, url: 'http://rightsstatements.org/vocab/InC/1.0/' },
  // The two honest non-answers, surfaced since 2026-08-08 (they rendered as
  // nothing before — see the ? mark's comment on MARKS). Ranked below
  // everything: an open question never leads a card that also has an answer.
  // The labels keep the statements' own distinction — CNE is "nobody has
  // looked", UND is "looked, and could not tell".
  CNE: { label: 'copyright not evaluated', marks: ['unknown'], rank: 10, url: 'http://rightsstatements.org/vocab/CNE/1.0/' },
  UND: { label: 'copyright undetermined', marks: ['unknown'], rank: 10, url: 'http://rightsstatements.org/vocab/UND/1.0/' },
}

/** The CC element order is fixed by CC's own marking guidance, not by us. */
const ELEMENT_ORDER = ['by', 'nc', 'nd', 'sa']

/** `by-nc-sa` → the canonical code, or null for anything unrecognized. */
function fromElements(elements) {
  const parts = new Set(elements.filter((e) => ELEMENT_ORDER.includes(e)))
  if (!parts.has('by')) return null
  // Rebuilt from the fixed order rather than from the caller's string, so
  // `nc-by-sa` and `by-nc-sa` cannot become two different codes.
  const code = 'CC ' + ELEMENT_ORDER.filter((e) => parts.has(e)).join('-').toUpperCase()
  return LICENSES[code] ? code : null
}

const verdict = (code) => (code && LICENSES[code] ? { code, ...LICENSES[code] } : null)

/**
 * A rights URI as a verdict. Europeana's `rights` field and any partner that
 * states a URL. Returns null rather than guessing: a card that shows the wrong
 * glyph has told a reader they may do something they may not.
 */
export function ccFromUri(uri) {
  if (!uri || typeof uri !== 'string') return null
  if (/creativecommons\.org\/publicdomain\/zero/.test(uri)) return verdict('CC0')
  if (/creativecommons\.org\/publicdomain\/mark/.test(uri)) return verdict('PDM')
  // CC's RETIRED pre-CC0 dedication, `/licenses/publicdomain/`. It has to be
  // tested before the general `/licenses/<elements>/` branch below, which would
  // otherwise read "publicdomain" as an element list, find no `by`, and drop it.
  // That is not a hypothetical: it is the single commonest license value in the
  // archive.org index, so the general branch silently discarded most of what
  // the Internet Archive actually states.
  if (/creativecommons\.org\/licenses\/publicdomain/.test(uri)) return verdict('PDM')
  // Not a Creative Commons URL at all, and archive.org's second commonest.
  if (/usa\.gov\/government-works/.test(uri)) return verdict('USGOV')
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)/.exec(uri)
  if (cc) return verdict(fromElements(cc[1].split('-')))
  // InC, InC-EDU, InC-OW-EU and friends all mean "in copyright".
  if (/rightsstatements\.org\/vocab\/InC/.test(uri)) return verdict('INC')
  // NoC-US is jurisdiction-shaped and its label says so. The other NoC-*
  // flavors are NOT interchangeable with it: OKLR, CR and NC all mean "the
  // copyright expired, and something else still restricts you" — a contract, a
  // donor agreement, a non-commercial condition. A public-domain mark on those
  // would promise a freedom the statement explicitly withholds, so they stay
  // unrecognized. Order matters: NoC-US must be tested before the general NoC.
  if (/rightsstatements\.org\/vocab\/NoC-US/.test(uri)) return verdict('NOCUS')
  if (/rightsstatements\.org\/vocab\/NKC/.test(uri)) return verdict('NKC')
  // CNE (Copyright Not Evaluated) and UND (Undetermined) are the
  // rightsstatements twins of Wikidata's "not yet determined": somebody looked
  // and recorded that nobody knows. They rendered as nothing until 2026-08-08;
  // now they carry the ? mark, on the decision that an honestly recorded open
  // question is a peer to the open statements — a fact about the record, not a
  // gap in it — and the card's fold says which non-answer it is. A LICENSE
  // mark for either would still be a guess and still never happens.
  if (/rightsstatements\.org\/vocab\/CNE/.test(uri)) return verdict('CNE')
  if (/rightsstatements\.org\/vocab\/UND/.test(uri)) return verdict('UND')
  return null
}

/**
 * An OpenAlex license slug as a verdict. `other-oa` is the one that matters:
 * it means OpenAlex knows the copy is free to read but not on what terms, and
 * a CC glyph there would invent a permission nobody granted.
 */
export function ccFromSlug(slug) {
  if (!slug || typeof slug !== 'string') return null
  const s = slug.toLowerCase()
  if (s === 'other-oa') return null
  if (s === 'cc0') return verdict('CC0')
  if (s === 'public-domain' || s === 'pd') return verdict('PDM')
  if (!s.startsWith('cc-')) return null
  return verdict(fromElements(s.slice(3).split('-')))
}

/**
 * A Wikidata license item read from its English label. Labels are used rather
 * than a QID table because `P275` has no allowed-values constraint and the CC
 * license items are per-version — six families times five versions times the
 * ported jurisdictions is a table that would rot. The label is generated from
 * the same six families every time, so the families are what we match.
 */
export function ccFromLabel(label) {
  if (!label || typeof label !== 'string') return null
  const l = label.toLowerCase()
  if (!/creative ?commons|^cc[ -]/.test(l)) return null
  if (/zero|cc0|public domain dedication/.test(l)) return verdict('CC0')
  if (/public domain mark/.test(l)) return verdict('PDM')
  if (!/attribution/.test(l)) return null
  const elements = ['by']
  if (/non-?commercial/.test(l)) elements.push('nc')
  if (/no ?deriv/.test(l)) elements.push('nd')
  if (/share-?alike/.test(l)) elements.push('sa')
  return verdict(fromElements(elements))
}

/**
 * The copyright-status vocabulary — closed, and taken from the allowed-values
 * constraints on `P6216` (work) and `P7763` (creator) rather than invented
 * here. `known: false` is its own state and not a synonym for absent: "not yet
 * determined" is somebody having looked and recorded that the answer is open.
 * Since 2026-08-08 that state is SHOWN — the ? mark, via `rightsView`'s
 * open-question branch — rather than rendered as nothing, but it still never
 * competes with an answer: `known: false` keeps it out of the freest-leads
 * ordering and the disagreement line, and it surfaces only when it is the
 * only thing anybody recorded.
 */
const STATUS = {
  // P6216 — the work.
  Q19652: { code: 'PD', label: 'public domain', free: true, rank: 0, marks: ['pd'] },
  Q99263261: { code: 'NOKNOWN', label: 'no known copyright restrictions', free: true, rank: 1, marks: ['pd'] },
  Q88088423: { code: 'DEDICATED', label: 'dedicated to the public domain by its copyright holder', free: true, rank: 1, marks: ['cc', 'zero'] },
  Q73566113: { code: 'CCLICENSED', label: 'available under a Creative Commons license', free: true, rank: 2, marks: ['cc'] },
  Q139041128: { code: 'CCLICENSED', label: 'licensed under Creative Commons', free: true, rank: 2, marks: ['cc'] },
  Q1546053: { code: 'ORPHAN', label: 'an orphan work — in copyright, with no findable holder', free: false, rank: 8, marks: ['copyright'] },
  Q50423863: { code: 'INC', label: 'in copyright', free: false, rank: 9, marks: ['copyright'] },
  Q59496158: { code: 'UNKNOWN', label: 'copyright not yet determined', free: false, rank: 99, marks: ['unknown'], known: false },

  // P7763 — the creator, which is what CopyClear's bots write.
  Q71887839: { code: 'EXPIRED', label: 'copyrights on works have expired', free: true, rank: 0, marks: ['pd'] },
  Q77430932: { code: 'NOCOPYRIGHT', label: 'no copyright was ever vested in this author', free: true, rank: 0, marks: ['pd'] },
  Q104844567: { code: 'CCAUTHOR', label: 'works released under a Creative Commons Attribution license', free: true, rank: 2, marks: ['cc', 'by'] },
  Q75700125: { code: 'PARTEXPIRED', label: 'copyright has expired on part of the body of work', free: false, rank: 5, marks: [] },
  Q73555012: { code: 'PROTECTED', label: 'works protected by copyrights', free: false, rank: 9, marks: ['copyright'] },
}

/** A `P6216`/`P7763` value QID as a status, or null if it is off-vocabulary. */
export function statusFromQid(qid) {
  if (!qid || !STATUS[qid]) return null
  return { known: true, ...STATUS[qid] }
}

// ------------------------------------------------------------------ the query

/**
 * One WDQS query for everything this module reads.
 *
 * **UNION, not stacked OPTIONALs.** Every property here is genuinely
 * multi-valued — a work carries a copyright status per jurisdiction, and the
 * qualifiers multiply again — so five OPTIONAL blocks in one WHERE would
 * return their cross product. A work with four jurisdictions and two licenses
 * comes back as eight rows that say nothing the four and the two did not, and
 * the shape grows with every property added. Each branch answering alone keeps
 * the row count additive.
 *
 * Both creator directions are asked, because a card can be either thing: the
 * anchor may BE the author (`?self`, for a shelf of that author's books) or
 * merely have one (`?ccs`, for a painting whose painter CopyClear has ruled
 * on). They are different claims and are kept apart downstream.
 *
 * No transitive walk appears here — `statements.js` explains at length why one
 * asked of items blew the WDQS timeout and cost the page every partner card.
 */
export function rightsUrl(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query =
    'SELECT ?item ?cs ?csLabel ?juris ?jurisLabel ?how ?howLabel ?lic ?licLabel ' +
    '?creator ?creatorLabel ?ccs ?ccsLabel ?self ?selfLabel WHERE { ' +
    `VALUES ?item { ${values} } { ` +
    // The work's own status, with the two qualifiers that make it readable:
    // which country it is true in (P1001) and why anybody thinks so (P459).
    '?item p:P6216 ?st . ?st ps:P6216 ?cs . ' +
    // Deprecated rank is an editor's record that this copyright claim is WRONG,
    // so it is refused here rather than ranked with the rest. Every other
    // branch below reads `wdt:`, which serves best-rank values and can never
    // return one; this branch reaches the statement node for its qualifiers,
    // so it must say no itself. Skipping the filter lets the freest-answer-
    // leads rule print a disproven claim first, or as the only claim.
    '?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) ' +
    'OPTIONAL { ?st pq:P1001 ?juris } OPTIONAL { ?st pq:P459 ?how } ' +
    '} UNION { ?item wdt:P275 ?lic ' +
    '} UNION { ?item wdt:P170 ?creator . ?creator wdt:P7763 ?ccs ' +
    '} UNION { ?item wdt:P7763 ?self } ' +
    'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }'
  return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
}

const qidOf = (b) => b?.value?.split('/').pop() ?? null

/**
 * Bindings → one record per item. Pure, so the shape can be tested without a
 * network, which is the only way the jurisdiction handling gets exercised
 * against the awkward real answers (a work that is public domain in the US and
 * in copyright in Germany is the normal case, not the edge one).
 *
 * @returns {Map<string, {work: Array, licenses: Array, creator: object|null, self: object|null}>}
 */
export function parseRightsRows(rows) {
  const out = new Map()
  // Keyed by (status, jurisdiction) so a status carrying two determination
  // methods stays one statement. WDQS returns a row per qualifier combination,
  // and counting rows would print the same jurisdiction on the card twice.
  const seen = new Map()

  for (const row of rows) {
    const qid = qidOf(row.item)
    if (!qid) continue
    const rec = out.get(qid) ?? { work: [], licenses: [], creator: null, self: null }
    let touched = false

    const cs = statusFromQid(qidOf(row.cs))
    if (cs) {
      const jurisdiction = row.jurisLabel?.value ?? null
      const key = `${qid}|${cs.code}|${jurisdiction ?? ''}`
      const prior = seen.get(key)
      if (prior) {
        // A second row for a statement we already have carries only a further
        // determination method. Keep the first — the card shows one reason,
        // and the fold is not a place to argue with ourselves.
        if (!prior.how && row.howLabel?.value) prior.how = row.howLabel.value
      } else {
        const stmt = { status: cs, jurisdiction, how: row.howLabel?.value ?? null }
        seen.set(key, stmt)
        rec.work.push(stmt)
      }
      touched = true
    }

    const lic = ccFromLabel(row.licLabel?.value)
    if (lic && !rec.licenses.some((l) => l.code === lic.code)) {
      rec.licenses.push(lic)
      touched = true
    }

    const ccs = statusFromQid(qidOf(row.ccs))
    if (ccs && !rec.creator) {
      rec.creator = { status: ccs, qid: qidOf(row.creator), label: row.creatorLabel?.value ?? null }
      touched = true
    }

    const self = statusFromQid(qidOf(row.self))
    if (self && !rec.self) {
      rec.self = { status: self }
      touched = true
    }

    // An item that matched no branch is not a record. Writing an empty one
    // would make "we asked and Wikidata said nothing" indistinguishable from
    // "this work is in copyright", which is the worst error available here.
    if (touched) out.set(qid, rec)
  }
  return out
}

/** One WDQS query per hundred items; a failure costs rights marks and nothing else. */
export async function entityRights(qids) {
  const map = new Map()
  for (const group of chunk([...new Set(qids)].filter(Boolean), 100)) {
    let rows = []
    try {
      rows = (await getJson(rightsUrl(group))).results?.bindings ?? []
    } catch (e) {
      // Deliberately the same failure semantic as mappability: the page loses
      // its rights marks, never a card. A missing mark says nothing; a wrong
      // one says a reader may reuse something they may not.
      console.error(`  wdqs rights failed (${group.length} entities): ${e.message}`)
      continue
    }
    for (const [qid, rec] of parseRightsRows(rows)) map.set(qid, rec)
  }
  return map
}

// -------------------------------------------------------------- reader-facing

/**
 * Wikidata's jurisdiction shorthand as English. "countries with 70 years pma"
 * is precise and is not a sentence anybody outside this field can read; `pma`
 * is *post mortem auctoris* and appears nowhere in the phrase it abbreviates.
 *
 * Matched by pattern rather than by QID because the family is open — the Latin
 * American term project is adding jurisdiction items — and the shorthand is
 * generated to a fixed form.
 */
export function jurisdictionPhrase(label) {
  if (!label) return null
  const m = /^countries with (\d+) years pma( or shorter)?$/i.exec(label.trim())
  if (m) {
    return (
      `countries where copyright lasts ${m[1]} years after the author’s death` +
      (m[2] ? ' or less' : '')
    )
  }
  // Country names read as places in a sentence only with the article they
  // normally take. Everything else is left exactly as Wikidata has it.
  if (/^(United States|United Kingdom|Netherlands|Philippines|Czech Republic)$/.test(label.trim())) {
    return `the ${label.trim()}`
  }
  return label.trim()
}

/**
 * A partner-stated license as the card's `rights.copy`.
 *
 * Kept apart from `rights.work` all the way to the renderer, because the two
 * answer different questions and a page that merges them tells a reader
 * something nobody said. The Rijksmuseum releasing a scan as CC0 is a promise
 * about that scan. Wikidata recording the painting as public domain is a claim
 * about the painting. Where an institution asserts terms over a photograph of a
 * work whose copyright expired centuries ago, the honest page shows both and
 * lets the reader see the gap — flattening them into one line is how that gap
 * disappears.
 */
export function licenseView(cc) {
  if (!cc) return null
  return { marks: cc.marks, label: cc.label, code: cc.code, url: cc.url }
}

/**
 * Open Library's `ebook_access`, read as a statement about THIS EDITION.
 *
 * This exists because of a card the page actually rendered. Open Library files
 * *Prentice Hall Literature — World Masterpieces* (1991) under Franz Kafka, and
 * CopyClear's ruling on Kafka is "copyrights on works have expired" — so a
 * modern classroom anthology came out carrying a public-domain mark. The ruling
 * was not wrong; it was about the wrong thing. Kafka's texts are free. A 1991
 * compilation of them is a new work with its own copyright.
 *
 * The lending status fixes it because it is about **the edition the card is
 * showing**, which is finer-grained than any claim about a body of work. The
 * Internet Archive lends one copy at a time precisely for books still in
 * copyright; a public-domain scan is simply readable. So `borrowable` is
 * evidence about this edition that outranks an inference from the author's
 * death date, and it replaces it.
 *
 * What this deliberately does NOT do is treat silence as an answer.
 * `no_ebook` means nobody has digitized this edition, which is evidence of
 * nothing, and an unrecognized value means Open Library has added a state we
 * have not read yet. Both leave the creator ruling standing — the same stance
 * `openLibraryVolumes` takes when a batch fails, where "we could not look" must
 * never render as "there is no copy".
 *
 * @returns {{copy: object|null, trustsCreator: boolean}}
 */
export function accessRights(ebookAccess) {
  if (ebookAccess === 'borrowable' || ebookAccess === 'printdisabled') {
    return {
      trustsCreator: false,
      copy: {
        code: 'LENT',
        // Said as an access fact, which is what Open Library actually told us,
        // rather than as a copyright ruling, which it did not. The implication
        // is plain enough without us asserting a status nobody recorded.
        label: 'lent, not free',
        // `note` is what the card SAYS; `label` is the short form the glyph
        // row announces. They are separate because the credit line is clamped
        // and the note is not: this sentence is the whole substance of the
        // finding, and half of it would be worse than none.
        note:
          ebookAccess === 'printdisabled'
            ? 'Lent, not free — and only to readers with a print disability.'
            : 'Lent, not free — the Internet Archive lends this edition one copy at a time.',
        marks: ['copyright'],
        url: null,
      },
    }
  }
  // 'public' — freely readable, which agrees with a public-domain ruling
  // instead of contradicting it, so there is nothing extra to say.
  return { copy: null, trustsCreator: true }
}

const PAULINA_ROUTES = new Set(['work', 'author', 'term'])

/**
 * A deep link into Paulina, which explains a status country by country — the
 * question this page cannot answer, because it does not know where its reader
 * is. Routes are checked against the set Paulina actually serves: a 404 aimed
 * at a volunteer-run Toolforge tool is our bug, not theirs.
 */
export function paulinaUrl(qid, kind = 'work') {
  if (!qid || !/^Q\d+$/.test(qid) || !PAULINA_ROUTES.has(kind)) return null
  return `https://paulina.toolforge.org/${kind}/${qid}`
}

/** "A, B and C" — the page's own list style, so rights copy reads like the rest. */
const sentenceList = (parts) =>
  parts.length > 2
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts.join(' and ')

/**
 * A record as the card renders it.
 *
 * The ordering contract: **the freest answer leads.** Where a work is public
 * domain somewhere and in copyright elsewhere, the card says so in that order,
 * and the glyph row follows the free answer. That is a deliberate editorial
 * choice and it has a cost worth naming — a reader in a longer-term country
 * could take the first clause and stop reading. It is mitigated by never
 * printing the free clause alone: `line` always carries the contrast when one
 * exists, and the Paulina link is how a reader gets an answer for where they
 * actually are.
 *
 * @returns {{marks, label, line, detail: string[], paulina}|null}
 */
export function rightsView(rec, { qid, kind = 'work', label = null } = {}) {
  if (!rec) return null
  const work = (rec.work ?? []).filter((w) => w.status.known !== false)
  const open = (rec.work ?? []).filter((w) => w.status.known === false)
  const licenses = rec.licenses ?? []
  const creator = rec.creator ?? rec.self ?? null
  if (!work.length && !licenses.length && !creator) {
    // Nothing anybody KNOWS — but "not yet determined" is something somebody
    // RECORDED, and since 2026-08-08 that surfaces as the ? mark instead of
    // rendering as nothing (see STATUS). Only here, where it is the sole
    // recorded fact: the moment any real answer exists, the open question
    // stays out of its way — an unknown beside an answer reads as doubt.
    if (!open.length) return null
    const paulinaHref = paulinaUrl(qid, kind)
    return {
      marks: ['unknown'],
      label: 'copyright not yet determined',
      line: null,
      detail: [
        'Wikidata records this work’s copyright status as not yet determined — ' +
          'someone looked, and wrote down that the question is open. ' +
          'That is not a permission and not a restriction.',
      ],
      paulina: paulinaHref
        ? { url: paulinaHref, label: 'Is it free where you are? — Paulina' }
        : null,
    }
  }

  // Freest first, and stable within a rank so two runs of the same data render
  // the same bytes — the batch renderer's reproducibility depends on it.
  const ranked = [...work].sort((a, b) => a.status.rank - b.status.rank)
  const lead = ranked[0] ?? null
  const leadLicense = [...licenses].sort((a, b) => a.rank - b.rank)[0] ?? null

  // Which glyphs. A stated license outranks a derived status when both exist
  // and the license is at least as free: the license is a promise somebody
  // made, the status is an inference about the law.
  //
  // **A creator-level status does get a mark**, and that is a deliberate call
  // rather than an oversight. CopyClear's "copyrights on works have expired"
  // is a ruling on a body of work, reached by people who do this on purpose and
  // recorded in the graph for anyone to check — so a card showing one of that
  // author's works may carry the mark. What it may not do is let the mark stand
  // alone: whenever the answer came from the creator rather than from the work,
  // `line` names whose status it is, so the mark is never read as a separate
  // finding about this particular book.
  const aboutThisThing = leadLicense || lead
  const marks = !aboutThisThing
    ? (creator?.status.marks ?? [])
    : leadLicense && (!lead || leadLicense.rank <= lead.status.rank)
      ? leadLicense.marks
      : lead.status.marks

  // For a creator-derived mark the label names whose ruling it is, because it
  // is now the only place a reader meets that attribution without clicking:
  // it is the glyph's tooltip and its screen-reader text.
  const creatorLabel = creator
    ? `${creator.label ?? label ?? 'This author'}: ${creator.status.label}`
    : null
  const shortLabel = leadLicense?.label ?? lead?.status.label ?? creatorLabel

  // The line. Two cases earn it, and both are cases where the glyph alone
  // would say more than the graph does.
  //
  //  1. **The answers disagree** — public domain in one country, in copyright
  //     in another. This is the finding the feature exists for.
  //  2. **The only answer is free, but it names a jurisdiction.** This one was
  //     added after looking at a real card. American Gothic is public domain in
  //     countries whose terms run 70 years or less from the author's death, and
  //     nowhere does Wikidata record the contrary US status — so the disagree
  //     test found no conflict and the card rendered a bare public-domain mark
  //     beside the Art Institute's name. Whoever read that would take it for a
  //     worldwide answer. A status that came qualified must be shown qualified.
  //
  // A status with no jurisdiction at all is genuinely unqualified and gets no
  // line: there is nothing to narrow.
  let line = null
  const free = ranked.filter((w) => w.status.free)
  const bound = ranked.filter((w) => !w.status.free)
  // Named places before rule-shaped clauses, which is purely about reading:
  // "in countries where copyright lasts 80 years after the author's death or
  // less and the United States" is a real sentence this produced, and the tail
  // reads as part of the clause before it. Put the short name first — "in the
  // United States and countries where copyright lasts…" — and the seam is
  // obvious. Sorted by length, so the order is deterministic and a re-render
  // off the same cache is byte-identical.
  const where = (ws) =>
    sentenceList(
      [...new Set(ws.map((w) => jurisdictionPhrase(w.jurisdiction)).filter(Boolean))].sort(
        (a, b) => a.length - b.length || a.localeCompare(b),
      ),
    )
  if (free.length && bound.length) {
    const freeWhere = where(free)
    const boundWhere = where(bound)
    line =
      `${free[0].status.label}${freeWhere ? ` in ${freeWhere}` : ''} · ` +
      `still in copyright${boundWhere ? ` in ${boundWhere}` : ' elsewhere'}`
  } else if (lead?.jurisdiction) {
    const leadWhere = where(lead.status.free ? free : bound)
    line = `${lead.status.label} in ${leadWhere}`
  }
  // A creator-only answer gets NO visible line. It used to get one, and on a
  // card whose mark already says "public domain" a line reading "José Rizal:
  // copyrights on works have expired" is the same fact in a second container —
  // which is exactly how it read. The sentence still exists, in `detail`, one
  // click away, where it keeps attributing the claim to the person it is
  // actually about. A line survives only when it says something the mark
  // cannot: which countries, or that a copy is lent rather than given.

  // The fold: why anybody thinks so, and what is known about the author. This
  // is the part a reader who wants to check the reasoning opens, and it is the
  // part CopyClear's bots actually produced.
  const detail = []
  for (const w of ranked) {
    if (!w.how) continue
    const wherePhrase = jurisdictionPhrase(w.jurisdiction)
    detail.push(
      `${w.status.label}${wherePhrase ? ` in ${wherePhrase}` : ''} — determined by: ${w.how}.`,
    )
  }
  if (creator) {
    const who = creator.label ?? label ?? 'The author'
    detail.push(`${who}: ${creator.status.label}.`)
  }
  if (leadLicense && !work.length) {
    detail.push(`Wikidata records this work as released under ${leadLicense.label}.`)
  }

  const paulinaHref = paulinaUrl(qid, kind)
  return {
    marks,
    label: shortLabel,
    line,
    detail,
    paulina: paulinaHref
      ? {
          url: paulinaHref,
          label: kind === 'author' ? 'Copyright status by country — Paulina' : 'Is it free where you are? — Paulina',
        }
      : null,
  }
}
