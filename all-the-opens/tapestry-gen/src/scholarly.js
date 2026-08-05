// The scholarly pivot: citation anchors that carry a DOI, PMID or arXiv id,
// resolved to open-access copies. This is the papers' twin of the ISBN →
// Internet Archive route — the article states the identifier, and the
// question is only whether the open ecosystem holds a readable copy.
//
// One partner answers the whole group: OpenAlex (open catalog, no key, its
// `mailto` politeness parameter carrying the same operator contact as the
// User-Agent). DOIs and PMIDs are batched through its works filter. arXiv
// papers are not looked up at all: arXiv is open by construction, so a cited
// arXiv id IS an open copy, and the card is built from the citation alone —
// zero requests.

import { templateParams } from './citations.js'
import { chunk } from './batch.js'
import { getJson } from './http.js'

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

/** One batched OpenAlex works query. `select` keeps the response small;
 * `best_oa_location` rides along because it names the open copy's license. */
export function openAlexUrl(filterField, values, contact) {
  return (
    'https://api.openalex.org/works?filter=' +
    encodeURIComponent(`${filterField}:${values.join('|')}`) +
    '&select=id,doi,ids,title,publication_year,open_access,authorships,best_oa_location' +
    `&per-page=${Math.max(values.length, 25)}` +
    `&mailto=${encodeURIComponent(contact)}`
  )
}

const normDoi = (d) => d?.toLowerCase().replace(/^https:\/\/doi\.org\//, '') ?? null

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

/** An OpenAlex work as a page entry — only when it is actually open. The
 * credit carries the open copy's license when OpenAlex knows it; "open
 * access" alone promises readability, not reuse, and the difference between
 * CC BY and merely free-to-read belongs on the card. */
export function openAlexEntry(work, via) {
  const oa = work.open_access ?? {}
  if (!oa.is_oa || !oa.oa_url) return null
  const first = work.authorships?.[0]?.author?.display_name ?? null
  const more = (work.authorships?.length ?? 0) > 1 ? ' et al.' : ''
  const license = licenseName(work.best_oa_location?.license)
  return {
    source: 'openalex',
    title: work.title ?? 'Untitled work',
    description: [first ? `${first}${more}` : null, work.publication_year]
      .filter(Boolean)
      .join(' · '),
    href: oa.oa_url,
    attribution: {
      author: ['Free to read', license].filter(Boolean).join(' · '),
      license: null,
    },
    why: `Cited here — and there is a copy you can read for free`,
    // The reason class, not the citation: per-item topics would split the
    // strip into one-card carousels; what must not mix is cited work with
    // the subject's own shelf (see subject topics in discover.js).
    topic: 'Cited in this section',
    _via: via,
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
        const entry = work && openAlexEntry(work, field)
        if (entry) hits.set(cite, entry)
      }
    }
  }
  return hits
}

/**
 * The subject's own scholarship, via its ORCID (P496) — the papers' twin of
 * the OpenLibrary author pivot. Top-cited first, and OPEN ONLY (2026-08-03):
 * a closed work gets no card, and the caller's disclosure states how many of
 * the subject's works that leaves out — the note is honest where a paywalled
 * card would just be a dead end wearing a shelf.
 */
export async function openAlexAuthorWorks(orcid, { contact, cap = 6 }) {
  const url =
    'https://api.openalex.org/works?filter=' +
    encodeURIComponent(`authorships.author.orcid:${orcid}`) +
    '&sort=cited_by_count:desc' +
    '&per-page=25' +
    '&select=id,doi,title,publication_year,open_access,authorships,best_oa_location' +
    `&mailto=${encodeURIComponent(contact)}`
  const body = await getJson(url)
  const open = (body.results ?? []).filter((w) => w.open_access?.is_oa && w.open_access?.oa_url)
  return {
    total: body.meta?.count ?? open.length,
    entries: open.slice(0, cap).map((w) => {
      const oa = w.open_access
      const license = licenseName(w.best_oa_location?.license)
      return {
        source: 'openalex',
        title: w.title ?? 'Untitled work',
        description: [w.publication_year, 'open access'].filter(Boolean).join(' · '),
        href: oa.oa_url,
        attribution: {
          author: ['Free to read', license].filter(Boolean).join(' · '),
          license: null,
        },
        _via: 'P496',
      }
    }),
  }
}
