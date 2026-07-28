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
 * found it. This is phases 1, 3 and part of 4 only — no infobox anchors, no
 * corroborated collection pivot, no speculative tiles, no streaming.
 *
 *   node spike.js "Brown v. Board of Education"
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  articleBlocks,
  fetchLede,
  fetchQids,
  fetchSection,
  fetchSections,
  fetchSectionWikitext,
} from './src/wikipedia.js'
import {
  bibliographyIdentifiers,
  prioritizeCitations,
  resolveShortCites,
  sectionCitations,
  templateParams,
} from './src/citations.js'
import { buildHtml } from './src/emit-html.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache')
const UA = 'all-the-opens-tapestry-gen/0.1 (https://github.com/tieguy/open-graph-next)'

// Budgets. The design streams and never truncates; a spike has to finish, so it
// caps and says what it dropped rather than pretending it covered everything.
const MAX_SECTIONS = Number(process.env.MAX_SECTIONS ?? 8)
const QIDS_PER_SECTION = Number(process.env.QIDS_PER_SECTION ?? 2)
const COMMONS_PER_ANCHOR = 4
const CITES_PER_SECTION = Number(process.env.CITES_PER_SECTION ?? 3)
// Above this many depictions, showing four of them is an arbitrary draw.
const BROAD_ANCHOR = Number(process.env.BROAD_ANCHOR ?? 40)

const SKIP =
  /^(see also|references|notes|citations|sources|bibliography|further reading|external links|works cited|primary sources)$/i

// Apparatus sections that hold full citations rather than only footnote bodies.
// "External links" and "See also" never do; "References" sometimes does, when
// the article puts its bibliography there instead of a {{reflist}}.
const BIBLIOGRAPHY = /^(sources|bibliography|works cited|primary sources|references|notes|citations)$/i

/**
 * Every network call is disk-cached, so reruns are offline and reproducible.
 *
 * The timeout is not optional: a bare `fetch` has none, and one stalled
 * archive.org connection hung an entire run indefinitely. A source that goes
 * quiet must cost one slot, not the whole page.
 */
async function getJson(url, { timeoutMs = 15000, tries = 2 } = {}) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(CACHE, `spike-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    /* not cached */
  }
  let lastError
  for (let attempt = 1; attempt <= tries; attempt++) {
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: control.signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const body = await res.json()
      await mkdir(CACHE, { recursive: true })
      await writeFile(path, JSON.stringify(body))
      return body
    } catch (e) {
      lastError = e.name === 'AbortError' ? new Error(`timeout after ${timeoutMs}ms`) : e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
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

const stop = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'its', 'on', 'for'])
const tokens = (s) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  )

/**
 * One Internet Archive lookup, keyed on an identifier the citation supplied.
 *
 * `isbn:` is a genuine Solr field, but the field is multi-valued and book-dealer
 * donation manifests are indexed with every ISBN on the pallet — one of them
 * carries 8,142 — so they are true matches that outrank the book itself. They are
 * `mediatype: data`, so constraining mediatype in the QUERY (not afterwards)
 * removes them without spending result rows on records that can never qualify.
 *
 * Title overlap is then a second, different guard: against a mis-keyed ISBN in
 * the citation resolving to a real but unrelated book.
 */
async function iaByIdentifier(cite) {
  const key = cite.isbn
    ? `isbn:${cite.isbn}`
    : cite.lccn
      ? `lccn:${cite.lccn}`
      : `external-identifier:"urn:oclc:record:${cite.oclc}"`
  const url =
    'https://archive.org/advancedsearch.php?q=' +
    encodeURIComponent(`${key} AND mediatype:texts`) +
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=mediatype' +
    '&rows=8&output=json'
  const body = await getJson(url)
  const wanted = tokens(cite.title)
  const doc = (body.response?.docs ?? [])
    .map((d) => {
      const overlap = [...tokens(d.title)].filter((w) => wanted.has(w)).length
      return { d, score: wanted.size ? overlap / wanted.size : 0 }
    })
    // A pallet manifest shares no words with the cited title; the book does.
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)[0]?.d
  if (!doc) return null
  const via = cite.isbn ? 'isbn' : cite.lccn ? 'lccn' : 'oclc'
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
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    '&generator=search&gsrsearch=' +
    encodeURIComponent(`haswbstatement:P180=${qid}`) +
    `&gsrnamespace=6&gsrlimit=${COMMONS_PER_ANCHOR}&gsrinfo=totalhits` +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640'
  const body = await getJson(url)
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

/** Labels of the entities we anchored on, for the disclosure line. */
async function entityLabels(qids) {
  if (!qids.length) return new Map()
  try {
    const url =
      'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&formatversion=2' +
      `&ids=${qids.join('|')}&props=labels&languages=en`
    const body = await getJson(url)
    return new Map(
      Object.entries(body.entities ?? {}).map(([q, e]) => [q, e.labels?.en?.value ?? q]),
    )
  } catch (e) {
    // Cosmetic: the disclosure falls back to bare QIDs rather than failing.
    console.error(`  label lookup failed: ${e.message}`)
    return new Map()
  }
}

// Citation apparatus that `prop=links` reports as ordinary wikilinks. These are
// how the article cites, not what it is about, and left in they become anchors:
// "ISBN" resolves to a QID whose Commons depictions are barcode diagrams.
const APPARATUS =
  /^(ISBN|ISSN|OCLC|Doi|Digital object identifier|Wayback Machine|JSTOR|Bibcode|LCCN|International Standard|Library of Congress Control Number|PMID|S2CID|Google Books)/i

/**
 * A section's anchors, in document order, taken from prose only.
 *
 * `fetchSection`'s link list includes everything inside <ref> tags, so ranking
 * cannot be skipped — unranked, the first two links of a section are usually its
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
  const page = process.argv[2]
  if (!page) {
    console.error('usage: node spike.js "Article title"')
    process.exit(1)
  }
  const slug = page.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out = join(HERE, 'demo', `spike-${slug}.html`)

  const all = await fetchSections(CACHE, page)
  const sections = all.filter((s) => !SKIP.test(s.title)).slice(0, MAX_SECTIONS)
  const dropped = all.filter((s) => !SKIP.test(s.title)).length - sections.length

  // The apparatus sections are not rendered, but on an {{sfn}}-style article
  // they hold every identifier the body points at. Read them once, up front.
  const bibliography = new Map()
  for (const s of all.filter((s) => BIBLIOGRAPHY.test(s.title))) {
    try {
      for (const [k, v] of bibliographyIdentifiers(await fetchSectionWikitext(CACHE, page, s.index))) {
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
      const body = await getJson(
        'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&formatversion=2' +
          `&ids=${subjectQid}&props=claims`,
      )
      subjectClaims = body.entities?.[subjectQid]?.claims ?? {}
    } catch (e) {
      // Cosmetic: the whole-page identifiers are optional enrichment.
      console.error(`  subject claims failed: ${e.message}`)
    }
  }
  const reporterCites = (subjectClaims.P1031 ?? [])
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => typeof v === 'string')
  const opinion = reporterCites.length ? freeLawByCitation(reporterCites) : null

  const bands = []
  const stats = { commons: 0, ia: 0, anchorsQid: 0, anchorsCite: 0, viaShortCite: 0, sections: 0 }

  // Lede first, then body sections, each carrying its own anchors.
  process.stderr.write(`fetching ${sections.length + 1} sections`)
  const lede = await fetchLede(CACHE, page)
  const units = [{ index: '0', title: page, ...lede }]
  for (const s of sections) {
    process.stderr.write('.')
    units.push({ index: s.index, title: s.title, ...(await fetchSection(CACHE, page, s.index)) })
  }
  process.stderr.write('\n')

  for (const unit of units) {
    const blocks = articleBlocks(unit.html)
    if (!blocks.length) continue
    stats.sections++

    const wikitext = await fetchSectionWikitext(CACHE, page, unit.index)
    const cites = prioritizeCitations(sectionCitations(wikitext), CITES_PER_SECTION)
    // Both citation styles, in that order: identifiers the section states
    // outright, then the ones it points at through the bibliography. Direct
    // refs come first only because they cost no join to trust.
    const shortCites = resolveShortCites(wikitext, bibliography)
    const identified = dedupeIdentifiers([...citationIdentifiers(wikitext), ...shortCites]).slice(
      0,
      CITES_PER_SECTION,
    )
    stats.anchorsCite += identified.length
    stats.viaShortCite += identified.filter((c) => shortCites.includes(c)).length

    const entries = []

    // The primary source first, where the subject IS a document.
    if (opinion && unit.index === '0') entries.push(opinion)

    // Citation anchors -> Internet Archive. No entity resolution in front.
    for (const cite of identified) {
      try {
        const hit = await iaByIdentifier(cite)
        if (hit) {
          entries.push(hit)
          stats.ia++
        }
      } catch (e) {
        console.error(`  ia lookup failed (${cite.isbn ?? cite.oclc ?? cite.lccn}): ${e.message}`)
      }
    }

    // Wikilink anchors -> QID -> Commons.
    const candidates = proseLinks(unit.html).slice(0, 24)
    const qids = await fetchQids(CACHE, candidates)
    // Keep document order — fetchQids returns a Map keyed by title, so read it
    // back through the ranked candidate list rather than by insertion order.
    const picked = candidates
      .map((t) => qids.get(t))
      .filter((q, i, a) => q && a.indexOf(q) === i)
      .slice(0, QIDS_PER_SECTION)
    stats.anchorsQid += picked.length
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

    // Disclose how each anchor's media was drawn. Above the threshold the four
    // shown are arbitrary, and saying so is the honest rendering.
    const labels = await entityLabels(breadth.map((b) => b.qid))
    const disclosure = breadth.length
      ? 'Media anchored on ' +
        breadth
          .map(
            (b) =>
              b.totalhits == null
                ? `${labels.get(b.qid) ?? b.qid} (${b.shown} shown, total unknown)`
                : `${labels.get(b.qid) ?? b.qid} (${b.shown} of ${b.totalhits.toLocaleString()}` +
                  `${b.totalhits > BROAD_ANCHOR ? ', arbitrarily selected' : ''})`,
          )
          .join('; ')
      : null

    bands.push({
      id: unit.index === '0' ? 'slede' : `s${unit.index}`,
      title: unit.title,
      blocks,
      entries,
      citations: cites,
      disclosure,
    })
    console.error(`§ ${unit.title} — ${entries.length} items`)
  }

  const html = buildHtml({
    title: page,
    description:
      'Generated live from the article itself — no curated dataset. Every item was found ' +
      "by an identifier the article states: a citation's ISBN, OCLC or LCCN, or a " +
      "wikilink's Wikidata QID. Each item sits in the section of the anchor that found it.",
    bands,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)

  console.error(
    `\n${page}: ${stats.sections} sections, ${stats.anchorsCite} citation anchors ` +
      `(${stats.viaShortCite} via the bibliography), ` +
      `${stats.anchorsQid} entity anchors -> ${stats.ia} IA + ${stats.commons} Commons items` +
      (opinion ? ' + 1 Free Law opinion' : '') +
      (dropped > 0 ? ` (${dropped} sections dropped by MAX_SECTIONS)` : ''),
  )
  console.error(out)
}

await main()
