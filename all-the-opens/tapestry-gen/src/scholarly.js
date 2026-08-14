// The scholarly lookup: citation anchors that carry a DOI, PMID or arXiv id,
// resolved to open-access copies. This is the papers' twin of the ISBN →
// Internet Archive route — the article states the identifier, and the
// question is only whether the open ecosystem holds a readable copy.
//
// One partner answers the whole group: OpenAlex (open catalog, its `mailto`
// politeness parameter carrying the same operator contact as the User-Agent).
// It runs keyless on OpenAlex's grace tier — production use requires a free
// API key since February 2026, and shipping one is LUI-163. DOIs and PMIDs
// are batched through its works filter. arXiv papers are not looked up at
// all: arXiv is open by construction, so a cited arXiv id IS an open copy,
// and the card is built from the citation alone — zero requests. Crossref
// enters only to corroborate retraction claims (see retractionNotices).

import { templateParams } from './citations.js'
import { chunk } from './batch.js'
import { getJson } from './http.js'
import { ccFromSlug, licenseView } from './rights.js'

/**
 * Scholarly identifiers a section's citations state: one record per cited
 * work carrying a DOI, PMID, or arXiv id, in document order, deduplicated.
 * {{cite arXiv}} writes the id as |arxiv= or |eprint=; older templates put a
 * full arXiv DOI in |doi=, which is folded into the arxiv field so the local
 * (request-free) route answers it.
 */
export function scholarlyIdentifiers(wikitext) {
  const out = []
  const seen = new Set()
  const re = /<ref\b[^>]*>([\s\S]*?)<\/ref>/gi
  let m
  while ((m = re.exec(wikitext ?? ''))) {
    const tpl = /\{\{\s*(?:cite[ _][a-z]+|citation)\b[\s\S]*?\}\}/i.exec(m[1])
    if (!tpl) continue
    const p = templateParams(tpl[0])
    const rawDoi = p.get('doi')?.trim() || null
    const arxivFromDoi = rawDoi && /^10\.48550\/arxiv\./i.test(rawDoi)
      ? rawDoi.replace(/^10\.48550\/arxiv\./i, '')
      : null
    const entry = {
      title: (p.get('title') ?? '').replace(/<[^>]+>|\[\[|\]\]/g, '').trim() || null,
      doi: arxivFromDoi ? null : rawDoi,
      pmid: p.get('pmid')?.trim() || null,
      arxiv: p.get('arxiv')?.trim() || p.get('eprint')?.trim() || arxivFromDoi,
    }
    if (!entry.doi && !entry.pmid && !entry.arxiv) continue
    const key = entry.doi ?? entry.pmid ?? entry.arxiv
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * The identifier a cited work is deduplicated and looked up by, page-wide.
 * DOI first because it is the one the article states most often and the one
 * OpenAlex matches on; a citation with none of the three never reaches here
 * (`scholarlyIdentifiers` drops it), so this is never null.
 */
export const scholarKey = (cite) => cite.doi ?? cite.pmid ?? cite.arxiv

/** One batched OpenAlex works query. `select` keeps the response small;
 * `best_oa_location` rides along because it names the open copy's license. */
export function openAlexUrl(filterField, values, contact) {
  return (
    'https://api.openalex.org/works?filter=' +
    encodeURIComponent(`${filterField}:${values.join('|')}`) +
    '&select=id,doi,ids,title,publication_year,open_access,authorships,best_oa_location,is_retracted' +
    // A flat page far above the batch size (40), not values.length: OpenAlex
    // occasionally holds two work records for one DOI, and a page sized
    // exactly to the request would silently truncate the last match.
    '&per-page=100' +
    `&mailto=${encodeURIComponent(contact)}`
  )
}

const normDoi = (d) => d?.toLowerCase().replace(/^https:\/\/doi\.org\//, '') ?? null

/**
 * One Crossref record, for corroborating a retraction claim. Crossref's
 * polite pool is entered by the same mailto etiquette OpenAlex uses (its
 * December 2025 policy: 10 req/s for single-record requests in the polite
 * pool; this code stays serial on the host regardless — hostLimit's default).
 */
export function crossrefWorkUrl(doi, contact) {
  return `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(contact)}`
}

/**
 * The retraction-notice DOIs a paper's own Crossref record states — but
 * only the entries the Retraction Watch database curated. Crossref carries
 * two kinds of `updated-by` entry and they are not equally trustworthy,
 * measured 2026-08-14: every famous retraction sampled (Wakefield,
 * Surgisphere, STAP, the NEJM Mediterranean diet) carries a
 * `source: 'retraction-watch'` retraction entry, while the one false
 * positive found — the 2020 Lancet Commission dementia report, which is not
 * retracted — carries only a `source: 'publisher'` entry, deposited onto
 * the wrong record. Human curation is the signal; bulk publisher metadata
 * is where the garbage lives. Only `type: 'retraction'` counts — an
 * expression of concern or a correction is not a retraction, and the card
 * must not use the stronger word (the Gautret hydroxychloroquine paper is
 * the live case: OpenAlex flags it, its RW entry says only a concern).
 */
export function retractionNotices(body) {
  const updates = body?.message?.['updated-by']
  if (!Array.isArray(updates)) return []
  return updates
    .filter((u) => u?.type === 'retraction' && u?.source === 'retraction-watch' && u.DOI)
    .map((u) => u.DOI)
}

/**
 * Does the retraction NOTICE itself say it retracts this paper? The
 * one-hop check — "the paper's record names a retraction notice" — is not
 * enough, and the live case is why (found 2026-08-14): the 2020 Lancet
 * Commission dementia report's Crossref record carries an `updated-by`
 * retraction entry, but the notice it names is the retraction of a
 * DIFFERENT paper ("Addressing hearing loss at all ages"), deposited onto
 * the wrong record by the publisher — and OpenAlex's `is_retracted` flag
 * inherits the error. A genuine notice states its target in `update-to`
 * (the NEJM Mediterranean-diet retraction names its paper exactly), so the
 * claim stands only when the notice points back.
 */
export function noticeRetracts(noticeBody, doi) {
  const updates = noticeBody?.message?.['update-to']
  return (
    Array.isArray(updates) &&
    updates.some((u) => u?.type === 'retraction' && normDoi(u.DOI) === normDoi(doi))
  )
}

/** OpenAlex's retraction flag, corroborated in two hops: the paper's own
 * Crossref record names its retraction notices, and a notice must name the
 * paper back. Returns the confirming notice's DOI, or null — the caller
 * writes both onto the work (`is_retracted`, `_retractionNotice`) so the
 * card can link the notice itself. Failure semantics are the scan rule's
 * ("a scan's word is checked before the shelf takes it"): a claim that
 * cannot be corroborated is withheld, so a Crossref hiccup understates a
 * card and never misstates one. Cost: two cached requests per work OpenAlex
 * flags — near zero per page, since retracted cited papers are rare. */
async function confirmedRetraction(work, contact) {
  if (work.is_retracted !== true) return null
  const doi = normDoi(work.doi)
  if (!doi) return null
  try {
    const notices = retractionNotices(await getJson(crossrefWorkUrl(doi, contact)))
    for (const notice of notices)
      if (noticeRetracts(await getJson(crossrefWorkUrl(notice, contact)), doi)) return notice
    return null
  } catch (e) {
    console.error(`  crossref retraction check failed (${doi}): ${e.message}`)
    return null
  }
}

/** Corroborate-and-stamp, shared by both lookups. */
async function stampRetraction(work, contact) {
  if (!work?.is_retracted) return
  work._retractionNotice = await confirmedRetraction(work, contact)
  work.is_retracted = Boolean(work._retractionNotice)
}

/**
  * OpenAlex license slugs as readers know them: cc-by → CC BY. Two slugs are
  * not licenses at all and must not be printed as though they were —
  * `other-oa` means OpenAlex knows the copy is free but not on what terms,
  * which is a different and weaker promise than any CC license.
  */
const licenseName = (slug) => {
  if (!slug) return null
  if (slug === 'other-oa') return 'terms not stated'
  if (slug === 'public-domain') return 'public domain'
  return slug.toUpperCase().replace(/^CC-/, 'CC ').replace(/-/g, ' ')
}

/** The retraction working, for the fold a retracted card's why line opens.
 * It names the chain because "retracted" is the strongest claim any card on
 * the page makes about a cited work, and a claim that strong owes the reader
 * its source. (2026-08-14: Retraction Watch's database has fed Crossref's
 * production API since January 2025, and OpenAlex reads it from there.) */
const RETRACTION_TRACE =
  'OpenAlex, the open catalog this card came from, marks this paper as ' +
  'retracted, and we checked that claim against Crossref — the DOI ' +
  'registry, where the Retraction Watch database files retraction notices. ' +
  'Both agree: the paper carries a formal retraction.'

/** An OpenAlex work as a page entry — when it is actually open, or when it
 * is RETRACTED (the caller has corroborated the flag and put the notice DOI
 * on `_retractionNotice`). A retracted paper keeps its card whether or not a
 * free copy exists — the citation is in the article either way, and "the
 * journal took this back" is exactly the kind of thing the Wikipedia article
 * rarely shows. Every retracted card shelves under its own head, `Retracted
 * papers`, so the page names the group plainly instead of scattering the
 * strongest claim it makes through a strip of ordinary citations; the fold
 * links the retraction notice itself. The credit on an open copy carries its
 * license when OpenAlex knows it; "open access" alone promises readability,
 * not reuse, and the difference belongs on the card. */
export function openAlexEntry(work, via) {
  const oa = work.open_access ?? {}
  const retracted = work.is_retracted === true
  const first = work.authorships?.[0]?.author?.display_name ?? null
  const more = (work.authorships?.length ?? 0) > 1 ? ' et al.' : ''
  const common = {
    source: 'openalex',
    title: work.title ?? 'Untitled work',
    description: [first ? `${first}${more}` : null, work.publication_year]
      .filter(Boolean)
      .join(' · '),
    retracted,
    ...(retracted && { trace: RETRACTION_TRACE }),
    ...(retracted &&
      work._retractionNotice && {
        // The notice DOI came off the paper's own Crossref record and named
        // this paper back, so the link is verified, never constructed.
        fix: {
          url: `https://doi.org/${work._retractionNotice}`,
          label: 'Read the retraction notice',
        },
      }),
    // The reason class, not the citation: per-item topics would split the
    // strip into one-card carousels; what must not mix is cited work with
    // the subject's own shelf (see subject topics in discover.js).
    topic: retracted ? 'Retracted papers' : 'Cited in this section',
    _via: via,
  }
  if (!oa.is_oa || !oa.oa_url) {
    // A closed paper is not a finding — except a retracted one, which is the
    // finding regardless of access: Wakefield's Lancet paper is closed, and a
    // page about the fraud that shows nothing would be hiding what it knows.
    // The card links the paper's own DOI (OpenAlex states it in doi.org
    // form) and promises no free copy anywhere on it.
    if (!retracted || !work.doi) return null
    return {
      ...common,
      href: work.doi,
      noFreeCopy: true,
      attribution: { author: 'Retracted', license: null },
      rights: { copy: licenseView(null) },
      oa: { status: null },
      why: `Cited here — and later retracted. We found no free copy to read`,
    }
  }
  const license = licenseName(work.best_oa_location?.license)
  return {
    ...common,
    href: oa.oa_url,
    attribution: {
      author: ['Free to read', license].filter(Boolean).join(' · '),
      license: null,
    },
    // `other-oa` deliberately yields no glyph: OpenAlex knows the copy is free
    // to read and does not know on what terms, and free to read is not a
    // license. See ccFromSlug.
    rights: { copy: licenseView(ccFromSlug(work.best_oa_location?.license)) },
    // Carried, never printed (2026-08-14). `oa_status` is OpenAlex's route
    // word — gold, green, bronze, hybrid, diamond — and the one worth having
    // is the one worth trusting least: `diamond` is derived from a MISSING
    // article-processing charge, and OpenAlex has no fee figure for 17,904 of
    // the 23,235 DOAJ journals it knows. It is here so `preferOpen` and any
    // future reader can see it; the rule against printing an inference as a
    // claim is why nothing does. See openRank in src/dedup.js.
    oa: { status: oa.oa_status ?? null },
    why: retracted
      ? `Cited here — and later retracted. There is still a copy you can read for free`
      : `Cited here — and there is a copy you can read for free`,
  }
}

/** An arXiv citation as a page entry: open by construction, no lookup. */
export function arxivEntry(cite) {
  return {
    source: 'arxiv',
    title: cite.title ?? `arXiv:${cite.arxiv}`,
    description: `arXiv:${cite.arxiv}`,
    href: `https://arxiv.org/abs/${cite.arxiv}`,
    attribution: { author: 'Free to read · arXiv', license: null },
    why: 'Cited here — every arXiv paper is free to read by design',
    topic: 'Cited in this section',
    _via: 'arxiv',
  }
}

/**
 * Open-access copies for every scholarly citation on the page, batched per
 * identifier kind. Returns a Map from the citation object to its entry;
 * citations with no open copy are simply absent — the rail already lists
 * them as citations, and a closed paper is not a finding.
 */
export async function openAlexLookups(cites, { contact }) {
  const hits = new Map()
  for (const cite of cites.filter((c) => c.arxiv)) hits.set(cite, arxivEntry(cite))

  const plans = [
    { field: 'doi', key: (c) => c.doi, of: cites.filter((c) => !c.arxiv && c.doi) },
    { field: 'pmid', key: (c) => c.pmid, of: cites.filter((c) => !c.arxiv && !c.doi && c.pmid) },
  ]
  for (const { field, key, of } of plans) {
    for (const group of chunk(of, 40)) {
      let results = []
      try {
        results = (await getJson(openAlexUrl(field, group.map(key), contact))).results ?? []
      } catch (e) {
        console.error(`  openalex ${field} batch failed (${group.length}): ${e.message}`)
        continue
      }
      for (const cite of group) {
        const work = results.find((w) =>
          field === 'doi' ? normDoi(w.doi) === normDoi(cite.doi) : w.ids?.pmid?.endsWith(`/${cite.pmid}`),
        )
        await stampRetraction(work, contact)
        const entry = work && openAlexEntry(work, field)
        if (entry) hits.set(cite, entry)
      }
    }
  }
  return hits
}

/**
 * The subject's own scholarship, via its ORCID (P496) — the papers' twin of
 * the OpenLibrary author lookup. Top-cited first, and OPEN ONLY (2026-08-03):
 * a closed work gets no card, and the caller's disclosure states how many of
 * the subject's works that leaves out — the note is honest where a paywalled
 * card would just be a dead end wearing a shelf.
 */
/** The author-works query, top-cited first. `openOnly` adds OpenAlex's own
 * `is_oa` filter — the follow-up below, never the first ask, because the
 * DENOMINATOR must stay the unfiltered count of everything the ORCID holds. */
export function openAlexAuthorWorksUrl(orcid, contact, { openOnly = false } = {}) {
  return (
    'https://api.openalex.org/works?filter=' +
    encodeURIComponent(`authorships.author.orcid:${orcid}${openOnly ? ',open_access.is_oa:true' : ''}`) +
    '&sort=cited_by_count:desc' +
    '&per-page=25' +
    '&select=id,doi,title,publication_year,open_access,authorships,best_oa_location,is_retracted' +
    `&mailto=${encodeURIComponent(contact)}`
  )
}

export async function openAlexAuthorWorks(orcid, { contact, cap = 6 }) {
  const body = await getJson(openAlexAuthorWorksUrl(orcid, contact))
  let open = (body.results ?? []).filter((w) => w.open_access?.is_oa && w.open_access?.oa_url)
  // The window used to filter openness AFTER fetching top-25-by-citations, so
  // an author whose most-cited papers are paywalled showed an empty shelf
  // while open work sat past row 25 (2026-08-14, the counting/priority
  // audit). When the window comes up short AND the catalog holds more than
  // the window saw, one follow-up asks for the top-cited OPEN works
  // directly — the shelf's question, put as a filter. The total printed on
  // the shelf stays the FIRST query's count: "N papers OpenAlex files under
  // this ORCID" must keep counting the paywalled ones, or the disclosure
  // stops disclosing.
  if (open.length < cap && (body.meta?.count ?? 0) > (body.results?.length ?? 0)) {
    try {
      const followUp = await getJson(openAlexAuthorWorksUrl(orcid, contact, { openOnly: true }))
      const better = (followUp.results ?? []).filter((w) => w.open_access?.is_oa && w.open_access?.oa_url)
      if (better.length > open.length) open = better
    } catch (e) {
      // The first answer stands; a failed follow-up costs breadth, never the shelf.
      console.error(`  openalex author follow-up failed (${orcid}): ${e.message}`)
    }
  }
  const shown = open.slice(0, cap)
  for (const w of shown) await stampRetraction(w, contact)
  return {
    total: body.meta?.count ?? open.length,
    entries: shown.map((w) => {
      const oa = w.open_access
      const license = licenseName(w.best_oa_location?.license)
      return {
        source: 'openalex',
        title: w.title ?? 'Untitled work',
        description: [w.publication_year, 'open access'].filter(Boolean).join(' · '),
        // The caller stamps why/trace over these entries (see discover.js),
        // so the shelf carries the fact and the stamping site words it.
        retracted: w.is_retracted === true,
        href: oa.oa_url,
        attribution: {
          author: ['Free to read', license].filter(Boolean).join(' · '),
          license: null,
        },
        rights: { copy: licenseView(ccFromSlug(w.best_oa_location?.license)) },
        _via: 'P496',
      }
    }),
  }
}
