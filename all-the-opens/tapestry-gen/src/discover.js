// Live discovery, shared by both entry points: spike.js (batch — one
// self-contained HTML file, byte-reproducible off its cache) and serve.js
// (streaming — Phase 7: the spine renders before enrichment arrives).
//
// The pipeline is the Tier-1 shape: the whole article in ONE parse call, split
// locally; identifier pivots batched per source; everything riding the
// per-host serial queue in mw.js so hosts run concurrently while each API
// stays serial. discover() reports progress through an async `emit` callback:
//
//   emit('spine', { page, units, dropped })   — prose extracted, before pivots
//   emit('band', band)                        — one band, in COMPLETION order
//
// and resolves to { bands, stats, dropped } with bands in ARTICLE order. A
// batch caller can ignore the events entirely; a streaming caller writes the
// spine skeleton on the first event and a rail fragment per band event. Band
// assembly runs as one task per unit, so a band waits only on its own
// dependencies: its Commons lookups, the article-global identifier batches,
// and — for the lede alone — the subject-level pivots.
import {
  articleBlocks,
  fetchArticle,
  fetchQids,
  fetchSectionWikitext,
  footnotesFor,
  referenceNotes,
  sectionOutline,
  sliceSectionHtml,
  sliceSectionWikitext,
} from './wikipedia.js'
import {
  bibliographyIdentifiers,
  openLibraryAccess,
  resolveShortCites,
  sectionCitations,
  templateParams,
} from './citations.js'
import { chunk, dedupedIaEntries, iaSearchUrl, matchIaDoc, olBooksUrl } from './batch.js'
import { corroborate, describedThesisArchiveId, preferredLabel } from './corroborate.js'
import { cachedRequest } from './mw.js'
import { CACHE, getJson } from './http.js'
import { authorWorkEntries } from './works.js'
import { openAlexAuthorWorks, openAlexLookups, scholarlyIdentifiers } from './scholarly.js'
import { entityStatements, statementEntries } from './statements.js'


// Budgets. The design streams and never truncates; a spike has to finish, so it
// caps and says what it dropped rather than pretending it covered everything.
const MAX_SECTIONS = Number(process.env.MAX_SECTIONS ?? Infinity)
const QIDS_PER_SECTION = Number(process.env.QIDS_PER_SECTION ?? 2)
const COMMONS_PER_ANCHOR = 4
const CITES_PER_SECTION = Number(process.env.CITES_PER_SECTION ?? 3)
// Above this many depictions, showing four of them is an arbitrary draw.
const BROAD_ANCHOR = Number(process.env.BROAD_ANCHOR ?? 40)
// Subject-level pivots answer "what does the ecosystem hold about this subject?"
// rather than "what did this section cite?", so they land in the lede.
const WORKS_BY_SUBJECT = Number(process.env.WORKS_BY_SUBJECT ?? 6)
const CATEGORY_FILES = Number(process.env.CATEGORY_FILES ?? 6)
const SCHOLARLY_PER_SECTION = Number(process.env.SCHOLARLY_PER_SECTION ?? 3)
const STATEMENTS_PER_SECTION = Number(process.env.STATEMENTS_PER_SECTION ?? 4)
// OpenAlex's `mailto` politeness parameter carries the same operator contact
// as the Wikimedia User-Agent: whoever runs this answers for its traffic.
const CONTACT = () => process.env.WIKIMEDIA_UA_CONTACT

const SKIP =
  /^(see also|references|notes|citations|sources|bibliography|further reading|external links|works cited|primary sources)$/i

// Apparatus sections that hold full citations rather than only footnote bodies.
// "External links" and "See also" never do; "References" sometimes does, when
// the article puts its bibliography there instead of a {{reflist}}.
const BIBLIOGRAPHY = /^(sources|bibliography|works cited|primary sources|references|notes|citations)$/i


/** A Wikidata Action API request through the shared cache and host queue. */
function wikidata(params) {
  return cachedRequest(CACHE, 'www.wikidata.org', params, { prefix: 'spike-' })
}

/** A Commons Action API request through the shared cache and host queue. */
function commons(params) {
  return cachedRequest(CACHE, 'commons.wikimedia.org', params, { prefix: 'spike-' })
}

/**
 * Citation identifiers the article states outright. `parseCitation` reads isbn
 * and doi; the design widens it to oclc/lccn/issn, which is done here inline so
 * the spike doesn't disturb the existing generator.
 */
function citationIdentifiers(wikitext) {
  const out = []
  const re = /<ref\b[^>]*>([\s\S]*?)<\/ref>/gi
  let m
  while ((m = re.exec(wikitext ?? ''))) {
    const tpl = /\{\{\s*(?:cite[ _][a-z]+|citation)\b[\s\S]*?\}\}/i.exec(m[1])
    if (!tpl) continue
    const p = templateParams(tpl[0])
    const isbn = p.get('isbn')?.replace(/[^0-9Xx]/g, '')
    const entry = {
      title: (p.get('title') ?? '').replace(/<[^>]+>|\[\[|\]\]/g, '').trim(),
      isbn: isbn && (isbn.length === 10 || isbn.length === 13) ? isbn : null,
      oclc: p.get('oclc')?.trim() || null,
      lccn: p.get('lccn')?.trim() || null,
    }
    if (entry.isbn || entry.oclc || entry.lccn) out.push(entry)
  }
  return out
}

/**
 * The document a person's Wikidata entry *describes* but never identifies:
 * P1026 (doctoral thesis) points at an entity carrying the thesis's author, year
 * and awarding university, and archival scans of theses carry exactly those three
 * fields and no identifier at all. So the two can be joined on the description.
 *
 * Returns an entry marked `corroborated` rather than `identifier`, with the
 * agreeing signals attached — the page shows the reasoning, because a matched
 * description is a weaker claim than a shared ISBN and must not read like one.
 */
async function collectionByDescribedThesis(subjectClaims, personName) {
  const thesisQid = subjectClaims.P1026?.[0]?.mainsnak?.datavalue?.value?.id
  if (!thesisQid || !personName) return null

  // Labels come along in the same request as the claims. They are what lets the
  // pivot name the work from the Wikidata side rather than from whatever the
  // holding archive happened to file it under.
  const body = await wikidata({
    action: 'wbgetentities',
    ids: thesisQid,
    props: 'claims|labels',
  })
  const claims = body.entities?.[thesisQid]?.claims ?? {}
  const label = preferredLabel(body.entities?.[thesisQid]?.labels)

  // If Wikidata now says which scan this is, take it and stop. Corroboration is
  // what you do when nobody has written the identifier down; continuing to guess
  // after they have would be the tool preferring its own inference to a stated
  // fact — and it costs nine requests to reach the same item.
  const statedId = describedThesisArchiveId(claims)
  if (statedId) {
    const meta = (await getJson(`https://archive.org/metadata/${statedId}`)).metadata ?? {}
    if (meta.title) {
      return {
        source: 'internet_archive',
        title: label ?? meta.title,
        description: [meta.type_of_work ?? 'Thesis', meta.institution, yearText(meta.date)]
          .filter(Boolean)
          .join(' · '),
        imageUrl: `https://archive.org/services/img/${statedId}`,
        attribution: { author: `archive.org/details/${statedId}`, license: 'stated by Wikidata' },
        evidence: 'identifier',
        _via: 'P1026 → P724',
      }
    }
  }

  const year = claims.P577?.[0]?.mainsnak?.datavalue?.value?.time
  const uniQid = claims.P4101?.[0]?.mainsnak?.datavalue?.value?.id
  if (!year || !uniQid) return null
  const institution = (await entityLabels([uniQid])).get(uniQid)
  if (!institution) return null

  // The surname is the only part of the description that can be searched; the
  // rest is what decides among the results. This collection alone answers three
  // different Prandtls.
  const surname = personName.trim().split(/\s+/).pop()
  const search =
    'https://archive.org/advancedsearch.php?q=' +
    encodeURIComponent(`collection:(theses-and-dissertations) AND creator:("${surname}")`) +
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=date&rows=20&output=json'
  const docs = (await getJson(search)).response?.docs ?? []

  for (const doc of docs.slice(0, 8)) {
    // `institution` is not in the search index, so it costs one metadata read
    // per candidate — bounded by the surname search, which is small.
    let meta = {}
    try {
      meta = (await getJson(`https://archive.org/metadata/${doc.identifier}`)).metadata ?? {}
    } catch (e) {
      console.error(`  metadata read failed (${doc.identifier}): ${e.message}`)
      continue
    }
    const candidate = { ...doc, institution: meta.institution ?? null }
    const { matched, corroboratedBy } = corroborate(candidate, { personName, year, institution })
    if (!matched) continue
    return {
      source: 'internet_archive',
      title: label ?? meta.title ?? doc.title,
      description: [meta.type_of_work ?? 'Thesis', meta.institution, yearText(doc.date)]
        .filter(Boolean)
        .join(' · '),
      imageUrl: `https://archive.org/services/img/${doc.identifier}`,
      attribution: {
        author: `archive.org/details/${doc.identifier}`,
        license: 'corroborated, not identified',
      },
      evidence: 'corroborated',
      corroboratedBy,
      _via: 'P1026',
    }
  }
  return null
}

const yearText = (d) => (typeof d === 'string' ? (/(\d{4})/.exec(d)?.[1] ?? null) : null)

/**
 * OpenLibrary's holdings for a run of ISBNs, one Books API request per 40 —
 * what used to be a throttled request per ISBN. Catalogued is not the same as
 * scanned: most cited books have no Internet Archive copy, and for those this
 * is the difference between the rail saying nothing and the rail saying where
 * the book is. The 1.1s throttle is still honoured per request; there are just
 * far fewer of them. Each hit is wrapped in the volumes/brief record shape so
 * `openLibraryAccess` reads both eras' caches identically.
 *
 * @returns {Map<string, object>} isbn → `{records}` value
 */
async function openLibraryVolumes(isbns) {
  const volumes = new Map()
  for (const group of chunk([...new Set(isbns)], 40)) {
    try {
      const body = await getJson(olBooksUrl(group), { throttleMs: 1100 })
      for (const isbn of group) {
        const data = body[`ISBN:${isbn}`]
        if (data) volumes.set(isbn, { records: { [`ISBN:${isbn}`]: { data } } })
      }
    } catch (e) {
      console.error(`  openlibrary books failed (${group.length} isbns): ${e.message}`)
    }
  }
  return volumes
}


/**
 * What the section cites versus what a reader can actually open. The gutter
 * now shows the article's own footnotes rather than a curated shortlist, so
 * this is the summary line under them: without it the difference between a
 * section whose sources are all reachable and one whose sources are all dead
 * ends is invisible. Holdings arrive pre-fetched (one batched request for
 * the whole article); access lands on the candidates as a side effect, which
 * is also what lets footnotes borrow it by ISBN.
 */
function citationCoverage(candidates, volumes) {
  for (const cite of candidates) {
    if (!cite.isbn) continue
    cite.access = openLibraryAccess(volumes.get(cite.isbn))
  }
  const open = candidates.filter(
    (c) => c.access?.availability === 'full' || c.access?.availability === 'borrow',
  ).length
  const catalogued = candidates.filter((c) => c.access?.availability === 'catalog').length
  const linked = candidates.filter((c) => !c.access && (c.archiveUrl || c.doi || c.url)).length
  return { total: candidates.length, open, catalogued, linked }
}

/**
 * The coverage line, phrased so an absence reads as a fact about the ecosystem
 * rather than as a thin section. Says nothing when there is nothing to say.
 */
function coverageText({ total, open, catalogued, linked }) {
  if (!total) return null
  const parts = [`${total} work${total === 1 ? '' : 's'} cited here`]
  if (open) parts.push(`${open} readable or borrowable`)
  if (catalogued) parts.push(`${catalogued} catalogued but not scanned`)
  if (linked) parts.push(`${linked} linked only`)
  const unreached = total - open - catalogued - linked
  if (unreached > 0) parts.push(`${unreached} the open ecosystem does not hold`)
  return parts.join(' · ')
}

/**
 * One entry per work. A section that cites a book directly and again through
 * the bibliography would otherwise spend two of its three slots on one book.
 */
function dedupeIdentifiers(entries) {
  const seen = new Set()
  return entries.filter((e) => {
    const key = e.isbn ?? e.oclc ?? e.lccn ?? e.title
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** An archive.org search row as a page entry, credited to its identifier. */
function iaEntry(doc, cite, via) {
  return {
    source: 'internet_archive',
    title: doc.title ?? cite.title,
    description: [Array.isArray(doc.creator) ? doc.creator[0] : doc.creator, doc.year]
      .filter(Boolean)
      .join(' · '),
    imageUrl: `https://archive.org/services/img/${doc.identifier}`,
    attribution: { author: `archive.org/details/${doc.identifier}`, license: `via ${via}` },
    why: `Cited in this section — matched by ${via.toUpperCase()}`,
    _via: via,
  }
}

const IA_ISBN_BATCH = 15

/**
 * Internet Archive lookups for every citation identifier on the page, batched:
 * one Solr query per run of ISBNs (the common case), one query each for the
 * rare LCCN/OCLC-only citations. Returns a Map from the citation object to its
 * matched entry; citations the Archive does not hold are simply absent.
 */
async function iaLookups(cites) {
  const hits = new Map()
  const byIsbn = cites.filter((c) => c.isbn)
  for (const group of chunk(byIsbn, IA_ISBN_BATCH)) {
    let docs = []
    try {
      docs = (await getJson(iaSearchUrl(group.map((c) => c.isbn)))).response?.docs ?? []
    } catch (e) {
      console.error(`  ia batch failed (${group.length} isbns): ${e.message}`)
      continue
    }
    for (const cite of group) {
      const doc = matchIaDoc(cite, docs)
      if (doc) hits.set(cite, iaEntry(doc, cite, 'isbn'))
    }
  }
  for (const cite of cites.filter((c) => !c.isbn && (c.oclc || c.lccn))) {
    const key = cite.lccn
      ? `lccn:${cite.lccn}`
      : `external-identifier:"urn:oclc:record:${cite.oclc}"`
    const url =
      'https://archive.org/advancedsearch.php?q=' +
      encodeURIComponent(`${key} AND mediatype:texts`) +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=isbn' +
      '&rows=8&output=json'
    try {
      const docs = (await getJson(url)).response?.docs ?? []
      const doc = matchIaDoc({ ...cite, isbn: null }, docs) ?? docs[0] ?? null
      if (doc) hits.set(cite, iaEntry(doc, cite, cite.lccn ? 'lccn' : 'oclc'))
    } catch (e) {
      console.error(`  ia lookup failed (${cite.oclc ?? cite.lccn}): ${e.message}`)
    }
  }
  return hits
}

/**
 * The opinion itself, from Free Law Project, keyed on a reporter citation.
 *
 * Where an article's subject IS a document, the ecosystem's best offering is that
 * document — for a court case, the opinion outranks any book about it.
 * CourtListener's /c/ path is an identifier-addressed permalink, so this needs no
 * request at all: the citation resolves by construction.
 */
function freeLawByCitation(citations) {
  // Prefer the official reporter (U.S.) over parallel commercial ones.
  const parsed = citations
    .map((c) => /^(\d+)\s+(.+?)\s+(\d+)$/.exec(c.trim()))
    .filter(Boolean)
    .map((m) => ({ volume: m[1], reporter: m[2], page: m[3] }))
  const best = parsed.find((c) => /^U\.?\s?S\.?$/.test(c.reporter)) ?? parsed[0]
  if (!best) return null
  const cite = `${best.volume} ${best.reporter} ${best.page}`
  return {
    source: 'free_law',
    title: `Opinion of the Court — ${cite}`,
    description: 'Full text of the decision, from the Free Law Project',
    attribution: {
      author: `courtlistener.com/c/${best.reporter}/${best.volume}/${best.page}/`,
      license: 'via P1031 legal citation',
    },
    _via: 'P1031',
  }
}

/** Commons files depicting an entity, via Structured Data on Commons. */
async function commonsDepicting(qid) {
  const body = await commons({
    action: 'query',
    generator: 'search',
    gsrsearch: `haswbstatement:P180=${qid}`,
    gsrnamespace: '6',
    gsrlimit: String(COMMONS_PER_ANCHOR),
    gsrinfo: 'totalhits',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
  })
  const pages = body.query?.pages ?? []
  // How many depictions exist in total. When this is large the four we show are
  // an arbitrary draw, and the page says so rather than implying a selection.
  // `generator=search` omits searchinfo unless gsrinfo asks for it. Never
  // substitute the returned count here: a fabricated total is worse than none.
  const totalhits = body.query?.searchinfo?.totalhits ?? null
  const files = pages
    .map((p) => {
      const info = p.imageinfo?.[0]
      if (!info) return null
      const meta = info.extmetadata ?? {}
      const plain = (v) => v?.value?.replace(/<[^>]+>/g, '').trim() || null
      return {
        source: 'wikimedia_commons',
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
        imageUrl: info.thumburl ?? info.url,
        attribution: { author: plain(meta.Artist), license: plain(meta.LicenseShortName) },
        _via: 'P180',
      }
    })
    .filter(Boolean)
  return { files, totalhits }
}

/**
 * Media from the subject's own Commons category. `P180 depicts` finds only what
 * somebody thought to tag; a category is curated, so on a well-kept subject it
 * reaches further and is better selected than an arbitrary draw from a large
 * depiction set.
 */
async function commonsCategoryFiles(category, limit) {
  const body = await commons({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: `Category:${category}`,
    gcmtype: 'file',
    gcmlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
  })
  return (body.query?.pages ?? [])
    .map((p) => {
      const info = p.imageinfo?.[0]
      if (!info) return null
      const meta = info.extmetadata ?? {}
      const plain = (v) => v?.value?.replace(/<[^>]+>/g, '').trim() || null
      return {
        source: 'wikimedia_commons',
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
        imageUrl: info.thumburl ?? info.url,
        attribution: { author: plain(meta.Artist), license: plain(meta.LicenseShortName) },
        why: 'From the subject’s own Commons category',
        _via: 'P373',
      }
    })
    .filter(Boolean)
}

/** The subject's own works, via the OpenLibrary author identifier P648. */
async function subjectAuthorWorks(subjectClaims) {
  const olid = subjectClaims.P648?.[0]?.mainsnak?.datavalue?.value
  if (typeof olid !== 'string' || !/^OL\d+A$/.test(olid)) return { entries: [], total: 0 }
  const body = await getJson(`https://openlibrary.org/authors/${olid}/works.json?limit=40`, {
    throttleMs: 1100,
  })
  return authorWorkEntries(body, { cap: WORKS_BY_SUBJECT })
}

/** Labels of the entities we anchored on, batched at the API's 50-id limit. */
async function entityLabels(qids) {
  const labels = new Map()
  for (const group of chunk([...new Set(qids)], 50)) {
    try {
      const body = await wikidata({
        action: 'wbgetentities',
        ids: group.join('|'),
        props: 'labels',
        languages: 'en',
      })
      for (const [q, e] of Object.entries(body.entities ?? {})) {
        labels.set(q, e.labels?.en?.value ?? q)
      }
    } catch (e) {
      // Cosmetic: the disclosure falls back to bare QIDs rather than failing.
      console.error(`  label lookup failed: ${e.message}`)
    }
  }
  return labels
}

// Citation apparatus that `prop=links` reports as ordinary wikilinks. These are
// how the article cites, not what it is about, and left in they become anchors:
// "ISBN" resolves to a QID whose Commons depictions are barcode diagrams.
const APPARATUS =
  /^(ISBN|ISSN|OCLC|Doi|Digital object identifier|Wayback Machine|JSTOR|Bibcode|LCCN|International Standard|Library of Congress Control Number|PMID|S2CID|Google Books)/i

/**
 * A section's anchors, in document order, taken from prose only.
 *
 * The rendered HTML includes everything inside <ref> tags, so ranking cannot
 * be skipped — unranked, the first two links of a section are usually its
 * first two footnotes. Document order is a decent prominence proxy: an article
 * links its subject matter early and its apparatus late.
 */
function proseLinks(html) {
  const body = html
    .replace(/<ol class="references"[\s\S]*?<\/ol>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
  const titles = []
  const re = /<a[^>]+href="\/wiki\/([^"#:?]+)"[^>]*>/gi
  let m
  while ((m = re.exec(body))) {
    const title = decodeURIComponent(m[1]).replace(/_/g, ' ')
    if (APPARATUS.test(title) || titles.includes(title)) continue
    titles.push(title)
  }
  return titles
}

/**
 * Discover the enriched page for one article. See the module comment for the
 * emit protocol. `emit` may be async; each band's fragment is awaited before
 * the next event for the same band-task fires, so a streaming caller can
 * write to a socket from it without interleaving.
 */
export async function discover(page, { emit = async () => {} } = {}) {
  // ---- Spine: the whole article in one parse call, split locally. ----------
  const article = await fetchArticle(CACHE, page)
  const outline = sectionOutline(article.sections)
  const bodySections = outline.filter((s) => !SKIP.test(s.title))
  const sections = bodySections.slice(0, MAX_SECTIONS)
  const dropped = bodySections.length - sections.length

  const sectionWikitext = async (index) =>
    sliceSectionWikitext(article.wikitext, article.sections, index) ??
    // A template-transcluded section has no byteoffset to slice by; fetching
    // it individually is the rare fallback, not the rule.
    (await fetchSectionWikitext(CACHE, page, index))

  // The apparatus sections are not rendered, but on an {{sfn}}-style article
  // they hold every identifier the body points at.
  const bibliography = new Map()
  for (const s of outline.filter((s) => BIBLIOGRAPHY.test(s.title))) {
    try {
      for (const [k, v] of bibliographyIdentifiers(await sectionWikitext(s.index))) {
        if (!bibliography.has(k)) bibliography.set(k, v)
      }
    } catch (e) {
      console.error(`  bibliography section "${s.title}" failed: ${e.message}`)
    }
  }
  if (bibliography.size) console.error(`bibliography: ${bibliography.size} identified works`)

  // ---- Everything the pivots need, extracted locally before any of them run.
  const stats = {
    commons: 0,
    ia: 0,
    scholar: 0,
    statements: 0,
    anchorsQid: 0,
    anchorsCite: 0,
    anchorsScholar: 0,
    viaShortCite: 0,
    sections: 0,
  }
  // The footnote bodies, once for the whole page: each band's gutter shows
  // the notes its own prose points at, joined here by note name.
  const noteMap = referenceNotes(article.html)

  const units = []
  for (const s of [{ index: '0', title: page }, ...sections]) {
    const html = sliceSectionHtml(article.html, article.sections, s.index) ?? ''
    const bandId = s.index === '0' ? 'slede' : `s${s.index}`
    const blocks = articleBlocks(html, { notePrefix: bandId })
    if (!blocks.length) continue
    stats.sections++
    const wikitext = await sectionWikitext(s.index)
    // Both citation styles, in that order: identifiers the section states
    // outright, then the ones it points at through the bibliography. Direct
    // refs come first only because they cost no join to trust.
    const shortCites = resolveShortCites(wikitext, bibliography)
    // The rail takes both styles too. An {{sfn}} article still has ordinary
    // <ref> cites — news and web sources — so the panel was never empty, but
    // the books it points at through the bibliography were missing from it,
    // and those are the reachable ones.
    const railCandidates = [
      ...sectionCitations(wikitext),
      ...shortCites.map((w) => ({ kind: 'book', ...w })),
    ]
    const identified = dedupeIdentifiers([...citationIdentifiers(wikitext), ...shortCites]).slice(
      0,
      CITES_PER_SECTION,
    )
    const scholarly = scholarlyIdentifiers(wikitext).slice(0, SCHOLARLY_PER_SECTION)
    stats.anchorsCite += identified.length
    stats.viaShortCite += identified.filter((c) => shortCites.includes(c)).length
    stats.anchorsScholar += scholarly.length
    units.push({
      index: s.index,
      title: s.title,
      blocks,
      footnotes: footnotesFor(blocks, noteMap, bandId),
      railCandidates,
      identified,
      scholarly,
      linkCandidates: proseLinks(html).slice(0, 24),
    })
  }

  await emit('spine', { page, units, dropped })

  // ---- The pivots, concurrent across hosts, serial within each. -----------
  // Article-global batches resolve once; per-unit Commons work rides the
  // commons queue. Labels are batched for every picked QID the moment the QID
  // map lands, concurrent with the Commons lookups they describe. The
  // subject's own claims — a case citation, a thesis, an author identifier —
  // enrich only the lede, so nothing about them may sit ahead of the spine.
  const subjectPromise = (async () => {
    const qid = (await fetchQids(CACHE, [page])).get(page)
    if (!qid) return { qid: null, claims: {} }
    try {
      const claimsBody = await wikidata({ action: 'wbgetentities', ids: qid, props: 'claims' })
      return { qid, claims: claimsBody.entities?.[qid]?.claims ?? {} }
    } catch (e) {
      // Cosmetic: the whole-page identifiers are optional enrichment.
      console.error(`  subject claims failed: ${e.message}`)
      return { qid, claims: {} }
    }
  })()

  const qidsPromise = fetchQids(CACHE, [...new Set(units.flatMap((u) => u.linkCandidates))])
  const pickedPromise = qidsPromise.then((qids) => {
    const picked = new Map()
    for (const unit of units) {
      const p = unit.linkCandidates
        .map((t) => qids.get(t))
        .filter((q, i, a) => q && a.indexOf(q) === i)
        .slice(0, QIDS_PER_SECTION)
      stats.anchorsQid += p.length
      picked.set(unit, p)
    }
    return picked
  })
  const labelsPromise = pickedPromise.then((picked) => entityLabels([...picked.values()].flat()))

  // Stderr diagnostics: which global batch is the long pole. A streaming
  // reader sees rails arrive when the slowest batch a band needs settles, so
  // when a page feels slow this line says which host to blame.
  const timed = (name, p) => {
    const t0 = Date.now()
    return p.finally(() => console.error(`  ${name} settled in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
  }

  const iaPromise = timed('ia batch', iaLookups(units.flatMap((u) => u.identified)))
  const volumesPromise = timed(
    'openlibrary volumes',
    openLibraryVolumes(units.flatMap((u) => u.railCandidates.map((c) => c.isbn)).filter(Boolean)),
  )
  const scholarPromise = timed(
    'openalex batch',
    openAlexLookups(units.flatMap((u) => u.scholarly), { contact: CONTACT() }),
  )
  // Partner statements for every anchor on the page — and the subject itself,
  // whose statements (a museum ID on an artwork article, a taxon ID on a
  // species article, coordinates on a place) belong to the lede.
  const statementsPromise = timed(
    'wdqs statements',
    Promise.all([pickedPromise, subjectPromise]).then(([picked, subject]) =>
      entityStatements([...[...picked.values()].flat(), subject.qid]),
    ),
  )
  const ledeExtrasPromise = subjectPromise.then(async ({ qid: subjectQid, claims: subjectClaims }) => {
    const reporterCites = (subjectClaims.P1031 ?? [])
      .map((c) => c.mainsnak?.datavalue?.value)
      .filter((v) => typeof v === 'string')
    const opinion = reporterCites.length ? freeLawByCitation(reporterCites) : null
    const categoryName = subjectClaims.P373?.[0]?.mainsnak?.datavalue?.value
    const orcid = subjectClaims.P496?.[0]?.mainsnak?.datavalue?.value
    const [thesis, works, categoryFiles, scholarship] = await Promise.all([
      // The thesis pivot can spend eight serial archive.org requests, and it
      // enriches only the lede — so it waits for the identifier batches that
      // every band needs before taking its turn on that host's queue.
      Promise.allSettled([iaPromise])
        .then(() => collectionByDescribedThesis(subjectClaims, page))
        .catch((e) => {
          console.error(`  thesis pivot failed: ${e.message}`)
          return null
        }),
      subjectAuthorWorks(subjectClaims).catch((e) => {
        console.error(`  author works failed: ${e.message}`)
        return { entries: [], total: 0 }
      }),
      typeof categoryName === 'string'
        ? commonsCategoryFiles(categoryName, CATEGORY_FILES).catch((e) => {
            console.error(`  commons category failed: ${e.message}`)
            return []
          })
        : Promise.resolve([]),
      typeof orcid === 'string'
        ? openAlexAuthorWorks(orcid, { contact: CONTACT(), cap: WORKS_BY_SUBJECT }).catch((e) => {
            console.error(`  openalex author works failed: ${e.message}`)
            return { entries: [], total: 0 }
          })
        : Promise.resolve({ entries: [], total: 0 }),
    ])
    // The shelves of the subject's own output say whose output and which
    // identifier vouches for that — the band's disclosure states the counts,
    // the card states the claim.
    for (const e of works.entries) e.why = `By ${page} — from their OpenLibrary author record`
    for (const e of scholarship.entries) e.why = `By ${page} — from their ORCID publication record`
    // The subject's own category files are their own topic, so the lede's
    // Commons box never mixes them with files drawn in by other anchors.
    for (const e of categoryFiles) e.topic = page
    if (thesis)
      console.error(
        `thesis: ${thesis.title} (` +
          (thesis.corroboratedBy
            ? `${thesis.corroboratedBy.length} signals agree`
            : 'identified by the P724 Wikidata states') +
          ')',
      )
    if (works.entries.length)
      console.error(`works by subject: ${works.entries.length} of ${works.total}`)
    if (scholarship.entries.length)
      console.error(`scholarship by subject: ${scholarship.entries.length} of ${scholarship.total}`)
    if (categoryFiles.length) console.error(`commons category: ${categoryFiles.length} files`)
    return { opinion, thesis, works, categoryFiles, scholarship, subjectQid }
  })

  // ---- One task per unit: a band completes when ITS dependencies do. -------
  const bandTasks = units.map(async (unit) => {
    const commonsEntries = []
    const breadth = []
    for (const qid of (await pickedPromise).get(unit)) {
      try {
        const { files, totalhits } = await commonsDepicting(qid)
        // Remember which anchor asked: the card will say why it is here,
        // once the anchor's label arrives.
        for (const f of files) f._qid = qid
        commonsEntries.push(...files)
        stats.commons += files.length
        if (files.length) breadth.push({ qid, shown: files.length, totalhits })
      } catch (e) {
        console.error(`  commons lookup failed (${qid}): ${e.message}`)
      }
    }
    // A band waits only on the global batches it will actually read: a
    // section with no book citations must not stall behind OpenLibrary, nor a
    // section with no identifiers behind archive.org. That is what lets the
    // early rails stream while the slow batches are still answering.
    const picked = (await pickedPromise).get(unit)
    const [iaHits, volumes, labels, scholarHits, statements] = await Promise.all([
      unit.identified.length ? iaPromise : new Map(),
      unit.railCandidates.some((c) => c.isbn) ? volumesPromise : new Map(),
      breadth.length || picked.length ? labelsPromise : new Map(),
      unit.scholarly.length ? scholarPromise : new Map(),
      picked.length || unit.index === '0' ? statementsPromise : new Map(),
    ])
    const extras = unit.index === '0' ? await ledeExtrasPromise : null

    const coverage = citationCoverage(unit.railCandidates, volumes)
    // The gutter shows Wikipedia's own footnotes; where one cites a book the
    // open ecosystem holds, the access link rides along on the note itself.
    const accessByIsbn = new Map(
      unit.railCandidates.filter((c) => c.isbn && c.access).map((c) => [c.isbn, c.access]),
    )
    const footnotes = unit.footnotes.map((f) => ({
      ...f,
      access: (f.isbn && accessByIsbn.get(f.isbn)) || null,
    }))

    const entries = []
    // The primary source first, where the subject IS a document — or wrote one.
    if (extras?.opinion) entries.push(extras.opinion)
    if (extras?.thesis) entries.push(extras.thesis)
    if (extras) entries.push(...extras.works.entries, ...extras.scholarship.entries)

    // Citation anchors -> Internet Archive. The gutter's footnotes are text;
    // a cover card is the complementary visual, so cards no longer yield to
    // them — only two citations resolving to one scan still collapse.
    for (const hit of dedupedIaEntries(unit.identified, iaHits, [])) {
      entries.push(hit)
      stats.ia++
    }

    // Citation anchors -> open-access scholarship (OpenAlex / arXiv).
    for (const cite of unit.scholarly) {
      const hit = scholarHits.get(cite)
      if (hit) {
        entries.push(hit)
        stats.scholar++
      }
    }

    // Anchored entities' partner statements: museum objects, taxa,
    // occurrence maps, place maps. The subject's own statements belong to the
    // lede; one map per section, or every place-heavy section becomes
    // wallpaper. Statement entries are capped like every other budget here.
    const statementQids = unit.index === '0' && extras?.subjectQid ? [extras.subjectQid, ...picked] : picked
    let mapsLeft = 1
    let statementsLeft = STATEMENTS_PER_SECTION
    for (const qid of statementQids) {
      if (statementsLeft <= 0) break
      const stmts = statements.get(qid)
      if (!stmts) continue
      const isSubject = unit.index === '0' && qid === extras?.subjectQid
      const label = isSubject ? unit.title : (labels.get(qid) ?? null)
      const found = (
        await statementEntries(qid, stmts, { label, withMap: mapsLeft > 0, subject: isSubject })
      ).slice(0, statementsLeft)
      if (found.some((e) => e.source === 'openstreetmap')) mapsLeft--
      statementsLeft -= found.length
      entries.push(...found)
      stats.statements += found.length
    }

    // Wikilink anchors -> QID -> Commons — deliberately LAST. The demo's
    // point is the breadth of the ecosystem's partners; Wikimedia's own
    // media should not outrank the museum's record of its own painting.
    // Each card says which anchor asked for it: a Valencia opera house in
    // the Golden Gate Bridge article is baffling until the card admits it
    // arrived through the section's link to Santiago Calatrava.
    for (const e of commonsEntries) {
      const label = labels.get(e._qid)
      e.why = label ? `Depicts ${label}, a link in this section` : null
      // The renderer splits one source's carousel by topic, so files depicting
      // the suspension-bridge anchor never share a box with the strait's.
      e.topic = label ?? null
    }
    entries.push(...commonsEntries)
    if (extras) entries.push(...extras.categoryFiles)

    // Disclose how each anchor's media was drawn. Above the threshold the four
    // shown are arbitrary, and saying so is the honest rendering.
    const subjectNotes = []
    if (extras?.works.entries.length)
      subjectNotes.push(
        `${extras.works.entries.length} of ${extras.works.total} work${extras.works.total === 1 ? '' : 's'} by the subject, ` +
          'via its OpenLibrary author identifier',
      )
    if (extras?.scholarship.entries.length)
      subjectNotes.push(
        `${extras.scholarship.entries.length} of ${extras.scholarship.total} scholarly works by the subject, ` +
          'via its ORCID',
      )
    if (extras?.categoryFiles.length)
      subjectNotes.push(`${extras.categoryFiles.length} files from the subject's own Commons category`)
    const disclosure = breadth.length
      ? 'Media anchored on ' +
        breadth
          .map(
            (b) =>
              b.totalhits == null
                ? `${labels.get(b.qid) ?? b.qid} (${b.shown} shown, total unknown)`
                : `${labels.get(b.qid) ?? b.qid} (${b.shown} of ${b.totalhits.toLocaleString()})`,
          )
          .join('; ')
      : null
    const fullDisclosure = [disclosure, ...subjectNotes].filter(Boolean).join('. ') || null

    const band = {
      id: unit.index === '0' ? 'slede' : `s${unit.index}`,
      title: unit.title,
      blocks: unit.blocks,
      entries,
      footnotes,
      coverage: coverageText(coverage),
      disclosure: fullDisclosure,
      // Set when any anchor here drew from more than BROAD_ANCHOR candidates.
      // The renderer states what that means once per page rather than appending
      // "arbitrarily selected" to every ratio.
      broad: breadth.some((b) => b.totalhits > BROAD_ANCHOR),
    }
    console.error(`§ ${unit.title} — ${entries.length} items`)
    await emit('band', band)
    return band
  })

  const bands = await Promise.all(bandTasks)
  return { bands, stats, dropped, opinion: (await ledeExtrasPromise).opinion }
}
