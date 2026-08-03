#!/usr/bin/env node
/**
 * Spike for docs/design-plans/2026-07-25-live-discovery-pipeline.md.
 *
 * Generates an enriched page for an ARBITRARY article, with no curated dataset
 * and no connections.json. Items are discovered at read time by pivoting from
 * the article's own anchors:
 *
 *   citation anchors  -> ISBN / OCLC / LCCN -> Internet Archive
 *   wikilink anchors  -> QID -> haswbstatement:P180 -> Commons
 *
 * Placement needs no algorithm: an item sits in the section of the anchor that
 * found it.
 *
 * The request shape is the Tier-1 performance work: the article arrives in ONE
 * parse call (sections + HTML + wikitext, split locally), identifiers are
 * batched per source (one Solr query for a run of ISBNs, one OpenLibrary
 * volumes call for a run of ISBNs, QIDs and labels at the API's 50-per-request
 * limit), and the pivots run concurrently ACROSS hosts while a per-host queue
 * (src/mw.js) keeps every individual API serial, as etiquette asks.
 *
 *   node spike.js "Brown v. Board of Education"
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  articleBlocks,
  fetchArticle,
  fetchQids,
  fetchSectionWikitext,
  sectionOutline,
  sliceSectionHtml,
  sliceSectionWikitext,
} from './src/wikipedia.js'
import {
  bibliographyIdentifiers,
  citationCoverUrl,
  citationHref,
  openLibraryAccess,
  prioritizeCitations,
  resolveShortCites,
  sectionCitations,
  templateParams,
} from './src/citations.js'
import { chunk, iaSearchUrl, matchIaDoc, olVolumesUrl } from './src/batch.js'
import { corroborate, describedThesisArchiveId, preferredLabel } from './src/corroborate.js'
import { cachedRequest, enqueue, requestTally } from './src/mw.js'
import { isRetryable, retryAfterMs, userAgent, withMaxlag } from './src/wmf.js'
import { authorWorkEntries } from './src/works.js'
import { buildHtml, iconUrls } from './src/emit-html.js'
import { escapeHtml } from './src/emit.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache')
// Defined once for the whole repo, and refuses to build without a contact —
// see src/wmf.js. Set WIKIMEDIA_UA_CONTACT to your own address.
const UA = userAgent('tapestry-gen')

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

const SKIP =
  /^(see also|references|notes|citations|sources|bibliography|further reading|external links|works cited|primary sources)$/i

// Apparatus sections that hold full citations rather than only footnote bodies.
// "External links" and "See also" never do; "References" sometimes does, when
// the article puts its bibliography there instead of a {{reflist}}.
const BIBLIOGRAPHY = /^(sources|bibliography|works cited|primary sources|references|notes|citations)$/i

/**
 * Every non-MediaWiki network call is disk-cached, so reruns are offline and
 * reproducible, and rides the same per-host queue as everything else — serial
 * at each API, concurrent across them.
 *
 * The timeout is not optional: a bare `fetch` has none, and one stalled
 * archive.org connection hung an entire run indefinitely. A source that goes
 * quiet must cost one slot, not the whole page.
 */
async function getJson(url, { timeoutMs = 15000, tries = 2, throttleMs = 0 } = {}) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(CACHE, `spike-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    /* not cached */
  }
  const body = await enqueue(new URL(url).host, async () => {
    let lastError
    for (let attempt = 1; attempt <= tries; attempt++) {
      // Only ever paid on a cache miss, and only by sources that ask for it.
      if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs))
      const control = new AbortController()
      const timer = setTimeout(() => control.abort(), timeoutMs)
      try {
        const res = await fetch(withMaxlag(url), {
          headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
          signal: control.signal,
        })
        if (!res.ok) {
          // A 404 is our bad identifier, not the server's bad day: retrying it
          // spends someone else's capacity to get the same answer twice.
          if (!isRetryable(res.status)) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { permanent: true })
          const wait = retryAfterMs(res.headers)
          if (wait !== null && attempt < tries) await new Promise((r) => setTimeout(r, wait))
          throw new Error(`${res.status} ${res.statusText}`)
        }
        return await res.json()
      } catch (e) {
        lastError = e.name === 'AbortError' ? new Error(`timeout after ${timeoutMs}ms`) : e
        if (e.permanent) break
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  })
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, JSON.stringify(body))
  return body
}

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
 * OpenLibrary's holdings for a run of ISBNs, in one volumes request per 25 —
 * what used to be a throttled request per ISBN. Catalogued is not the same as
 * scanned: most cited books have no Internet Archive copy, and for those this
 * is the difference between the rail saying nothing and the rail saying where
 * the book is. The 1.1s throttle is still honoured per request; there are just
 * far fewer of them.
 *
 * @returns {Map<string, object>} isbn → volumes/brief value (`{records, items}`)
 */
async function openLibraryVolumes(isbns) {
  const volumes = new Map()
  for (const group of chunk([...new Set(isbns)], 25)) {
    try {
      const body = await getJson(olVolumesUrl(group), { throttleMs: 1100 })
      for (const isbn of group) {
        const value = body[`isbn:${isbn}`]
        if (value && Object.keys(value).length) volumes.set(isbn, value)
      }
    } catch (e) {
      console.error(`  openlibrary volumes failed (${group.length} isbns): ${e.message}`)
    }
  }
  return volumes
}

/**
 * A cover fetched and base64'd, so the page does not depend on the archive.org
 * redirect OpenLibrary covers resolve through. Null when there is no cover —
 * OpenLibrary answers a coverless ISBN with a placeholder a few bytes long, and
 * a broken image in the rail is worse than no image.
 */
async function coverDataUri(url, { minBytes = 1024 } = {}) {
  const key = createHash('sha1').update(`datauri:${url}`).digest('hex').slice(0, 16)
  const path = join(CACHE, `datauri-${key}.txt`)
  try {
    const cached = await readFile(path, 'utf8')
    return cached || null
  } catch {
    /* not fetched yet */
  }
  const uri = await enqueue(new URL(url).host, async () => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return ''
      const bytes = Buffer.from(await res.arrayBuffer())
      // Below the floor it is a placeholder, not the thing. Covers use 1 KB; a
      // favicon is legitimately smaller, so callers can lower it.
      return bytes.length < minBytes ? '' : `data:${res.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes.toString('base64')}`
    } catch {
      return ''
    }
  })
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, uri)
  return uri || null
}

/**
 * A section's cited works as the rail shows them: ranked by how openly a reader
 * can reach each one, then given a cover and a link that says what opening it
 * will get you. Both citation styles arrive here — an inline {{cite}} and a
 * work resolved through the bibliography are the same kind of thing once found.
 * Holdings arrive pre-fetched (one batched request for the whole article).
 */
async function railCitations(candidates, volumes) {
  for (const cite of candidates) {
    if (!cite.isbn) continue
    cite.access = openLibraryAccess(volumes.get(cite.isbn))
  }
  const chosen = prioritizeCitations(candidates, CITES_PER_SECTION)
  const built = []
  for (const cite of chosen) {
    const coverUrl = citationCoverUrl(cite)
    built.push({
      kind: cite.kind ?? 'book',
      title: cite.title || 'Untitled source',
      publisher: cite.publisher ?? null,
      href: cite.access ? cite.access.url : citationHref(cite),
      linkLabel: cite.access ? cite.access.label : null,
      cover: coverUrl && (await coverDataUri(coverUrl)) ? coverUrl : null,
    })
  }

  // What the section cites versus what a reader can actually open. Only a few
  // sources fit in the rail, so without this the difference between a section
  // whose sources are all reachable and one whose sources are all dead ends is
  // invisible — both just show three entries.
  const open = candidates.filter(
    (c) => c.access?.availability === 'full' || c.access?.availability === 'borrow',
  ).length
  const catalogued = candidates.filter((c) => c.access?.availability === 'catalog').length
  const linked = candidates.filter((c) => !c.access && (c.archiveUrl || c.doi || c.url)).length
  return {
    shown: built,
    coverage: { total: candidates.length, open, catalogued, linked },
  }
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

async function main() {
  const started = Date.now()
  const page = process.argv[2]
  if (!page) {
    console.error('usage: node spike.js "Article title"')
    process.exit(1)
  }
  const slug = page.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out = join(HERE, 'demo', `spike-${slug}.html`)

  // ---- Spine: the whole article in one parse call, split locally. ----------
  const article = await fetchArticle(CACHE, page)
  const outline = sectionOutline(article.sections)
  const body = outline.filter((s) => !SKIP.test(s.title))
  const sections = body.slice(0, MAX_SECTIONS)
  const dropped = body.length - sections.length

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

  // The article's own subject, for identifiers that describe the whole page
  // rather than one section (a case citation, coordinates, a Smithsonian ID).
  const subjectQid = (await fetchQids(CACHE, [page])).get(page)
  let subjectClaims = {}
  if (subjectQid) {
    try {
      const claimsBody = await wikidata({ action: 'wbgetentities', ids: subjectQid, props: 'claims' })
      subjectClaims = claimsBody.entities?.[subjectQid]?.claims ?? {}
    } catch (e) {
      // Cosmetic: the whole-page identifiers are optional enrichment.
      console.error(`  subject claims failed: ${e.message}`)
    }
  }
  const reporterCites = (subjectClaims.P1031 ?? [])
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => typeof v === 'string')
  const opinion = reporterCites.length ? freeLawByCitation(reporterCites) : null

  // ---- Everything the pivots need, extracted locally before any of them run.
  const stats = { commons: 0, ia: 0, anchorsQid: 0, anchorsCite: 0, viaShortCite: 0, sections: 0 }
  const units = []
  for (const s of [{ index: '0', title: page }, ...sections]) {
    const html = sliceSectionHtml(article.html, article.sections, s.index) ?? ''
    const blocks = articleBlocks(html)
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
    stats.anchorsCite += identified.length
    stats.viaShortCite += identified.filter((c) => shortCites.includes(c)).length
    units.push({
      index: s.index,
      title: s.title,
      blocks,
      railCandidates,
      identified,
      linkCandidates: proseLinks(html).slice(0, 24),
    })
  }

  // ---- The pivots, concurrent across hosts, serial within each. -----------
  // Each task is an independent chain ordered by its own data dependencies;
  // the per-host queue in src/mw.js is what keeps en.wikipedia, wikidata,
  // commons, archive.org and openlibrary each polite while all five run.
  const categoryName = subjectClaims.P373?.[0]?.mainsnak?.datavalue?.value

  const qidsAndCommons = (async () => {
    const allTitles = [...new Set(units.flatMap((u) => u.linkCandidates))]
    const qids = await fetchQids(CACHE, allTitles)
    const perUnit = new Map()
    for (const unit of units) {
      const picked = unit.linkCandidates
        .map((t) => qids.get(t))
        .filter((q, i, a) => q && a.indexOf(q) === i)
        .slice(0, QIDS_PER_SECTION)
      stats.anchorsQid += picked.length
      const entries = []
      const breadth = []
      for (const qid of picked) {
        try {
          const { files, totalhits } = await commonsDepicting(qid)
          entries.push(...files)
          stats.commons += files.length
          if (files.length) breadth.push({ qid, shown: files.length, totalhits })
        } catch (e) {
          console.error(`  commons lookup failed (${qid}): ${e.message}`)
        }
      }
      perUnit.set(unit, { entries, breadth })
    }
    return perUnit
  })()

  const iaTask = iaLookups(units.flatMap((u) => u.identified))
  const volumesTask = openLibraryVolumes(
    units.flatMap((u) => u.railCandidates.map((c) => c.isbn)).filter(Boolean),
  )
  const thesisTask = collectionByDescribedThesis(subjectClaims, page).catch((e) => {
    console.error(`  thesis pivot failed: ${e.message}`)
    return null
  })
  const worksTask = subjectAuthorWorks(subjectClaims).catch((e) => {
    console.error(`  author works failed: ${e.message}`)
    return { entries: [], total: 0 }
  })
  const categoryTask =
    typeof categoryName === 'string'
      ? commonsCategoryFiles(categoryName, CATEGORY_FILES).catch((e) => {
          console.error(`  commons category failed: ${e.message}`)
          return []
        })
      : Promise.resolve([])

  const [commonsByUnit, iaHits, volumes, thesis, works, categoryFiles] = await Promise.all([
    qidsAndCommons,
    iaTask,
    volumesTask,
    thesisTask,
    worksTask,
    categoryTask,
  ])

  if (thesis)
    console.error(
      `thesis: ${thesis.title} (` +
        (thesis.corroboratedBy
          ? `${thesis.corroboratedBy.length} signals agree`
          : 'identified by the P724 Wikidata states') +
        ')',
    )
  if (works.entries.length) console.error(`works by subject: ${works.entries.length} of ${works.total}`)
  if (categoryFiles.length) console.error(`commons category: ${categoryFiles.length} files`)

  // Where the subject is a person who wrote a thesis, the thesis itself is the
  // one thing the ecosystem holds that no identifier will reach. Anchor labels
  // for every section's disclosure come in one batched request.
  const labels = await entityLabels(
    [...commonsByUnit.values()].flatMap(({ breadth }) => breadth.map((b) => b.qid)),
  )

  // ---- Assembly, in article order. ----------------------------------------
  const bands = []
  for (const unit of units) {
    const { entries: commonsEntries, breadth } = commonsByUnit.get(unit) ?? { entries: [], breadth: [] }
    const entries = []

    // The primary source first, where the subject IS a document — or wrote one.
    if (opinion && unit.index === '0') entries.push(opinion)
    if (thesis && unit.index === '0') entries.push(thesis)
    if (unit.index === '0') entries.push(...works.entries, ...categoryFiles)

    // Citation anchors -> Internet Archive. No entity resolution in front.
    for (const cite of unit.identified) {
      const hit = iaHits.get(cite)
      if (hit) {
        entries.push(hit)
        stats.ia++
      }
    }

    // Wikilink anchors -> QID -> Commons.
    entries.push(...commonsEntries)

    const { shown: cites, coverage } = await railCitations(unit.railCandidates, volumes)

    // Disclose how each anchor's media was drawn. Above the threshold the four
    // shown are arbitrary, and saying so is the honest rendering.
    const subjectNotes = []
    if (unit.index === '0' && works.entries.length)
      subjectNotes.push(
        `${works.entries.length} of ${works.total} work${works.total === 1 ? '' : 's'} by the subject, ` +
          'via its OpenLibrary author identifier',
      )
    if (unit.index === '0' && categoryFiles.length)
      subjectNotes.push(`${categoryFiles.length} files from the subject's own Commons category`)
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

    bands.push({
      id: unit.index === '0' ? 'slede' : `s${unit.index}`,
      title: unit.title,
      blocks: unit.blocks,
      entries,
      citations: cites,
      coverage: coverageText(coverage),
      disclosure: fullDisclosure,
      // Set when any anchor here drew from more than BROAD_ANCHOR candidates.
      // The renderer states what that means once per page rather than appending
      // "arbitrarily selected" to every ratio.
      broad: breadth.some((b) => b.totalhits > BROAD_ANCHOR),
    })
    console.error(`§ ${unit.title} — ${entries.length} items`)
  }

  // Covers travel with the page. They are the only images here that resolve
  // through the archive.org redirect, so a live dependency would blank the rail
  // whenever the Internet Archive is down.
  const inline = new Map()
  for (const b of bands) {
    for (const c of b.citations ?? []) {
      if (!c.cover || inline.has(c.cover)) continue
      const uri = await coverDataUri(c.cover)
      if (uri) inline.set(c.cover, uri)
    }
    // Works by the subject carry OpenLibrary covers on the entry itself.
    for (const e of b.entries ?? []) {
      if (!e.imageUrl?.includes('covers.openlibrary.org') || inline.has(e.imageUrl)) continue
      const uri = await coverDataUri(e.imageUrl)
      if (uri) inline.set(e.imageUrl, uri)
    }
  }

  // Source icons travel too, and for a sharper reason than the covers: several
  // of these sites refuse cross-origin hotlinks outright (CourtListener answers
  // 403), so a live <img> is a guaranteed broken image for the sources readers
  // are least likely to recognise unaided. Only the icons this page will show
  // are fetched, and anything that fails simply renders as a name.
  for (const url of iconUrls()) {
    if (inline.has(url)) continue
    const uri = await coverDataUri(url, { minBytes: 64 })
    if (uri) inline.set(url, uri)
  }

  const html = buildHtml({
    title: page,
    description:
      'Generated live from the article itself — no curated dataset. Every item was found ' +
      "by an identifier the article states: a citation's ISBN, OCLC or LCCN, or a " +
      "wikilink's Wikidata QID. Each item sits in the section of the anchor that found it.",
    bands,
    inline,
    // The page opens by saying it used no curated dataset; the footer has to
    // agree with it. No timestamp — a rerun off the same cache must produce the
    // same bytes.
    // Where the index that discusses these trade-offs is published. Overridable
    // because anyone can run this; unset it and the page simply states the rule
    // without pointing anywhere, which is right for a file opened off disk.
    home: process.env.SITE_HOME ?? 'https://all-the-opens.netlify.app/',
    provenance:
      `Discovered live from the English Wikipedia article ` +
      `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}">` +
      `${escapeHtml(page)}</a> — no curated dataset.`,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)

  const tally = [...requestTally.entries()].map(([h, n]) => `${h}:${n}`).join(' ')
  console.error(
    `\n${page}: ${stats.sections} sections, ${stats.anchorsCite} citation anchors ` +
      `(${stats.viaShortCite} via the bibliography), ` +
      `${stats.anchorsQid} entity anchors -> ${stats.ia} IA + ${stats.commons} Commons items` +
      (opinion ? ' + 1 Free Law opinion' : '') +
      (dropped > 0 ? ` (${dropped} sections dropped by MAX_SECTIONS)` : ''),
  )
  console.error(
    `${((Date.now() - started) / 1000).toFixed(1)}s` +
      (tally ? `, network requests — ${tally}` : ', fully from cache'),
  )
  console.error(out)
}

await main()
