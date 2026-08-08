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
//     `page` here is the RESOLVED article title, after redirects — render that,
//     not the caller's input, or a redirect names a page that has no article.
//   emit('band', band)                        — one band, in COMPLETION order
//
// and resolves to { title, bands, stats, dropped, opinion, reach } with bands in ARTICLE
// order. A batch caller can ignore the events entirely; a streaming caller
// writes the spine skeleton on the first event and a rail fragment per band
// event. Band assembly runs as one task per unit, so a band waits only on its
// own dependencies: the article-global identifier batches, the partner
// statements, and — for the lede alone — the subject-level pivots.
//
// `reach` is what the ARTICLE ITSELF already contains — the templates it
// transcludes, the pictures it shows, the sites it links. Every partner this
// pipeline finds is measured against it, which is how the page can say who
// Wikipedia is able to show and who it isn't. See src/gap.js.
import {
  articleBlocks,
  extractInfobox,
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
  citationCoverage,
  resolveShortCites,
  sectionCitations,
  templateParams,
} from './citations.js'
import { chunk, dedupedIaEntries, iaSearchUrl, matchIaDoc, olBooksUrl } from './batch.js'
import { dplaBrowseUrl, dplaEntries } from './dpla.js'
import { europeanaBrowseUrl, europeanaEntries } from './europeana.js'
import { digitalnzBrowseUrl, digitalnzEntries } from './digitalnz.js'
import { corroborate, describedThesisArchiveId, preferredLabel } from './corroborate.js'
import { cachedRequest } from './mw.js'
import { CACHE, getJson } from './http.js'
import { articleReach } from './gap.js'
import { authorWorkEntries, authorWorksUrl, iaMetadataUrl, scanIdsToVerify } from './works.js'
import { MUSEUM_NAME, needsArtworksQuery, subjectArtworks } from './artworks.js'
import { openAlexAuthorWorks, openAlexLookups, scholarlyIdentifiers } from './scholarly.js'
import {
  aicEntry,
  metEntry,
  needsRightsQuery,
  partnerStatements,
  resolveMappability,
  statementEntries,
} from './statements.js'
import { iiifEntry } from './iiif.js'
import { rijksEntry } from './rijks.js'
import { ccFromUri, entityRights, licenseView, rightsView } from './rights.js'
import { claimAnchors, preferRelated, preferYielding, subjectAnchors } from './dedup.js'
import { broadNote, tooBroad } from './breadth.js'


// Budgets. The design streams and never truncates; a spike has to finish, so it
// caps and says what it dropped rather than pretending it covered everything.
const MAX_SECTIONS = Number(process.env.MAX_SECTIONS ?? Infinity)
const QIDS_PER_SECTION = Number(process.env.QIDS_PER_SECTION ?? 2)
const CITES_PER_SECTION = Number(process.env.CITES_PER_SECTION ?? 3)
// Subject-level pivots answer "what does the ecosystem hold about this subject?"
// rather than "what did this section cite?", so they land in the lede.
const WORKS_BY_SUBJECT = Number(process.env.WORKS_BY_SUBJECT ?? 6)
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
 * RETIRED 2026-08-03 (front-page review): the search-based corroboration
 * fallback is disabled below. The gap it covered was closed the right way —
 * Wikidata learned the identifier (P724 on Prandtl's thesis), and a fix in
 * the graph is inherited by every reuser, where a fix in this code helps only
 * this code. What remains live is the stated-identifier route; the fallback
 * is kept as commented code (with `corroborate.js` and its tests) in case a
 * subject with a truly unidentified thesis makes it worth reviving.
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
        href: `https://archive.org/details/${statedId}`,
        attribution: { author: 'Internet Archive', license: null },
        rights: { copy: licenseView(ccFromUri(first(meta.licenseurl))) },
        evidence: 'identifier',
        _via: 'P1026 → P724',
      }
    }
  }

  // The described-object search fallback, disabled per the 2026-08-03 review.
  /*
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
  */
  return null
}

const yearText = (d) => (typeof d === 'string' ? (/(\d{4})/.exec(d)?.[1] ?? null) : null)

/** archive.org returns some fields as a bare string and some as an array. */
const first = (v) => (Array.isArray(v) ? v[0] : v)

/**
 * OpenLibrary's holdings for a run of ISBNs, one Books API request per 40 —
 * what used to be a throttled request per ISBN. Cataloged is not the same as
 * scanned: most cited books have no Internet Archive copy, and for those this
 * is the difference between the rail saying nothing and the rail saying where
 * the book is. The 1.1s throttle is still honored per request; there are just
 * far fewer of them. Each hit is wrapped in the volumes/brief record shape so
 * `openLibraryAccess` reads both eras' caches identically.
 *
 * Returns `{volumes, unchecked}`: failed groups get one delayed second pass, and
 * ISBNs that still fail are reported as unchecked rather than silently absent.
 *
 * @returns {{volumes: Map<string, object>, unchecked: Set<string>}} isbn →
 * `{records}` value, and ISBNs whose batch failed
 */
async function openLibraryVolumes(isbns) {
  const volumes = new Map()
  const unchecked = new Set()
  const fill = (group, body) => {
    for (const isbn of group) {
      const data = body[`ISBN:${isbn}`]
      if (data) volumes.set(isbn, { records: { [`ISBN:${isbn}`]: { data } } })
    }
  }
  const failed = []
  for (const group of chunk([...new Set(isbns)], 40)) {
    try {
      fill(group, await getJson(olBooksUrl(group), { throttleMs: 1100 }))
    } catch (e) {
      console.error(`  openlibrary books failed (${group.length} isbns): ${e.message}`)
      // A permanent status (a 4xx that is our bad request, not OpenLibrary's
      // bad day) will fail identically in two seconds. Retrying it spends a
      // request to learn nothing; those ISBNs go straight to unchecked.
      if (e.permanent) for (const isbn of group) unchecked.add(isbn)
      else failed.push(group)
    }
  }
  // One more chance after a beat — OpenLibrary's stumbles are usually
  // moments, not outages. Whatever still fails is truthfully unchecked.
  if (failed.length) await new Promise((r) => setTimeout(r, 2000))
  for (const group of failed) {
    try {
      fill(group, await getJson(olBooksUrl(group), { throttleMs: 1100 }))
    } catch (e) {
      console.error(`  openlibrary books failed again (${group.length} isbns): ${e.message}`)
      for (const isbn of group) unchecked.add(isbn)
    }
  }
  return { volumes, unchecked }
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
    // The card links to the scan itself. It used to print the details path as
    // the credit instead, which named the place without opening the door.
    href: `https://archive.org/details/${doc.identifier}`,
    attribution: { author: 'Internet Archive', license: null },
    // Uploader-supplied, so present on well under half of items and messy where
    // it is present — a sample carried a GPL URL on a novel. ccFromUri refuses
    // what it does not recognize, which is what makes reading it at all safe.
    rights: { copy: licenseView(ccFromUri(first(doc.licenseurl))) },
    why: `Cited here — the Internet Archive holds a copy, matched on its ${via.toUpperCase()}`,
    // The reason class, not the citation: what must not mix in the lede's IA
    // box is cited scans with the subject's own thesis, not scan with scan.
    topic: 'Cited in this section',
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
 *
 * **And it must be a link.** Until 2026-08-06 this card carried the permalink as
 * TEXT in the credit line and no `href` at all, so the one page whose subject is
 * a public-domain document showed the reader its address and gave them nothing to
 * click. A link audit found it: zero courtlistener.com hrefs on Brown v. Board,
 * beside a card naming courtlistener.com/c/U.S./347/483/.
 *
 * The shape was verified the same day rather than assumed — the mistake that put
 * a 404 on the Rijksmuseum cards. `347 U.S. 483` redirects to
 * /opinion/105221/brown-v-board-of-education/, the parallel `74 S. Ct. 686`
 * reaches the same opinion, `F.2d` resolves, and a citation to a volume that does
 * not exist 404s — so the server distinguishes a real citation from a bogus one.
 * Reporters carry spaces and periods ("S. Ct."), hence the per-segment encoding.
 */
export function freeLawByCitation(citations) {
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
    // There is no photograph of an opinion, and the reporter citation is a
    // better emblem of it than one would be: it is how the thing is actually
    // referred to, cited and shelved. See plate() in emit-html.js.
    plate: cite,
    href:
      `https://www.courtlistener.com/c/${encodeURIComponent(best.reporter)}/` +
      `${best.volume}/${best.page}/`,
    attribution: {
      // The destination, not the URL: the address is the link's job now, and
      // repeating it here was only ever a substitute for being one.
      author: 'CourtListener',
      license: 'Public domain — nobody owns the law',
    },
    // Not a license anybody granted: a work of the US federal government has
    // no copyright to grant. The public-domain mark is the accurate glyph and
    // the CC circle would be the wrong one.
    rights: { copy: licenseView(ccFromUri('https://creativecommons.org/publicdomain/mark/1.0/')) },
    _via: 'P1031',
  }
}

/**
 * Which partner to ask for a picked artwork, and how.
 *
 * The same per-object fetchers the anchor pivot uses, so a painting reached
 * through the subject's own statements renders identically to one reached
 * through a wikilink — same card, same credit, same rights reading. Only the
 * reason it is on the page differs, and that is what `why` and the ⓘ fold say.
 */
const artworkFetcher = (via, id, label) => {
  if (via === 'met') return metEntry(id)
  if (via === 'rijks') return rijksEntry(id)
  if (via === 'aic') return aicEntry(id)
  return iiifEntry(id, label)
}

/** The subject's own works, via the OpenLibrary author identifier P648. */
async function subjectAuthorWorks(subjectClaims) {
  const olid = subjectClaims.P648?.[0]?.mainsnak?.datavalue?.value
  if (typeof olid !== 'string' || !/^OL\d+A$/.test(olid)) return { entries: [], total: 0 }
  const body = await getJson(authorWorksUrl(olid, 40), { throttleMs: 1100 })
  // Ask the archive about each scan the shelf is about to show — one cached
  // request per scan, serial on the archive.org queue — because Open Library's
  // edition→scan link is sometimes somebody else's book, and the cover-from-
  // the-scan rule then amplifies that into the whole card. See
  // `scanMatchesWork` in src/works.js for the live card that proved it.
  const iaMeta = {}
  for (const id of scanIdsToVerify(body, { cap: WORKS_BY_SUBJECT })) {
    try {
      iaMeta[id] = (await getJson(iaMetadataUrl(id)))?.result ?? null
    } catch (e) {
      // Unfetched is not disproven: the scan stays, exactly as before this
      // check existed. Cosmetic, so it logs rather than fails the shelf.
      console.error(`  scan check failed for ${id}: ${e.message}`)
    }
  }
  // `olid` goes in so a work can be tested for co-authors: the subject's
  // creator-level status covers what the subject wrote, not what somebody
  // wrote with them. See `soleAuthor`.
  return authorWorkEntries(body, { cap: WORKS_BY_SUBJECT, olid, iaMeta })
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
// how the article cites, not what it is about, and left in they become anchors
// in their own right — a section would pivot on "ISBN" as though the article
// were about barcodes.
const APPARATUS =
  /^(ISBN|ISSN|OCLC|Doi|Digital object identifier|Wayback Machine|JSTOR|Bibcode|LCCN|International Standard|Library of Congress Control Number|PMID|S2CID|Google Books)/i

/**
 * A section's anchors, in document order, taken from prose only.
 *
 * The rendered HTML includes everything inside <ref> tags, so ranking cannot
 * be skipped — unranked, the first two links of a section are usually its
 * first two footnotes. Document order is a decent prominence proxy: an article
 * links its subject matter early and its apparatus late — which is exactly why
 * hatnotes ({{distinguish|Novel}} atop Novell) are dangerous left in: they sit
 * before the lede's own first sentence and would rank as the section's most
 * prominent link despite naming what the article is explicitly NOT about.
 */
export function proseLinks(html) {
  const body = html
    .replace(/<div[^>]*class="[^"]*hatnote[^"]*"[\s\S]*?<\/div>/gi, ' ')
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
 * An article title as MediaWiki would write it: underscores to spaces, first
 * character upper-cased. Applied to the caller's raw input — an argv string or
 * a URL path — before the one parse call that resolves it for real.
 *
 * This is NOT what makes lookups match: `redirects=1` and `fetchArticle`'s
 * returned title do that, and every downstream lookup uses the resolved title.
 * What it buys is cache-key stability, so `"Ludwig_Prandtl"` and
 * `"Ludwig Prandtl"` are one `.cache` entry rather than two. Keep it for that
 * reason; do not reintroduce a lookup that depends on it.
 */
export function canonicalTitle(title) {
  if (typeof title !== 'string') return ''
  return title
    .replace(/_/g, ' ')    // Underscores to spaces
    // `/^./u` and not `/^\w/`: \w is [A-Za-z0-9_], so an accented initial —
    // "émile durkheim", "île-de-france" — would pass through uncapitalized and
    // miss the QID map entirely, silently costing the page its whole lede.
    .replace(/^./u, (c) => c.toUpperCase())
}

/**
 * A partner reached by SEARCH rather than by direct object id: an anchor
 * states one property (a subject heading, an entity id), the partner is
 * asked to look things up FILED UNDER that value, and what comes back is a
 * sample of a shelf rather than the shelf's own record. DPLA and Europeana
 * are the two live cases and share this whole shape — see `tapestry-gen/
 * CLAUDE.md`'s "Adding a data source" section for how this differs from the
 * direct-id shape in `statements.js`'s `MUSEUM_PIVOTS`.
 *
 * `spec.fetch` may resolve to null (DPLA does, when the LC heading lookup
 * itself fails); a spec whose fetch never returns null is unaffected by the
 * check.
 */
async function bandPropertyPivot(
  { unit, extras, statementQids, statements, labels, entries, stats, samples, broad },
  spec,
) {
  // `keyOptional` marks a partner whose API answers keyless requests
  // (DigitalNZ, verified 2026-08-08); its env key is used when present and
  // its absence skips nothing. DPLA and Europeana genuinely require theirs.
  if (!process.env[spec.envKey] && !spec.keyOptional) return
  const anchored = statementQids
    .map((q) => ({ id: statements.get(q)?.[spec.field], label: labels.get(q) ?? null, qid: q }))
    .map((a) => (unit.index === '0' && a.qid === extras?.subjectQid ? { ...a, label: unit.title } : a))
    .filter((a) => a.id)
    .slice(0, 2)
  for (const { id, label, qid } of anchored) {
    const isSubject = unit.index === '0' && qid === extras?.subjectQid
    try {
      const hit = await spec.fetch(id, label, process.env[spec.envKey])
      if (!hit) continue
      if (tooBroad(hit.total, { isSubject })) {
        broad.push(
          broadNote({ source: spec.source, label, total: hit.total, url: spec.browseUrl(hit, id), ...spec.broadExtra?.(hit) }),
        )
        continue
      }
      for (const e of hit.entries) {
        if (isSubject) e.standing = 'subject-record'
        e.trace = spec.trace(label, qid, hit)
        e.fix = { url: `https://www.wikidata.org/wiki/${qid}#${spec.property}`, label: 'Check or fix it on Wikidata' }
      }
      entries.push(...hit.entries)
      stats[spec.statsKey] += hit.entries.length
      if (hit.total > hit.entries.length) samples.push(spec.sample(hit, label, id))
    } catch (e) {
      console.error(`  ${spec.source} lookup failed (${id}): ${e.message}`)
    }
  }
}

// DPLA, keyed on a real identifier: only anchors whose Wikidata entry states
// an LC authority (P244) pivot, via the authorized heading — "Eagle" the
// lunar module either has its own authority or stays out, which is what
// keeps eleven thousand bird photographs off the page. Without
// DPLA_API_KEY the pivot is simply absent: the demo must run keyless for
// anyone who clones it.
const DPLA_PIVOT = {
  source: 'dpla',
  envKey: 'DPLA_API_KEY',
  field: 'lc',
  property: 'P244',
  statsKey: 'dpla',
  fetch: (lc, label, key) => dplaEntries(lc, label, key),
  browseUrl: (hit) => dplaBrowseUrl(hit.heading),
  broadExtra: (hit) => ({ heading: hit.heading }),
  trace: (label, qid, hit) =>
    `Wikidata’s item for ${label ?? qid} (${qid}) states its Library of Congress ` +
    `authority ID (P244), whose authorized heading is “${hit.heading}” — DPLA’s ` +
    `partners catalog this item under that heading.`,
  sample: (hit, label) => ({
    source: 'dpla',
    // The same value dplaEntryFrom writes as each entry's topic — that
    // pairing is what lets the renderer find the shelf.
    topic: label ?? hit.heading,
    shown: hit.entries.length,
    total: hit.total,
    text:
      `A sample: ${hit.entries.length} of the ${hit.total.toLocaleString()} items DPLA’s ` +
      `partner institutions catalog under the Library of Congress heading “${hit.heading}”`,
  }),
}

// Europeana, keyed the same way: only anchors whose Wikidata entry states a
// Europeana entity (P7704) pivot, and only openly licensed items come back.
// Keyless clones skip it silently.
const EUROPEANA_PIVOT = {
  source: 'europeana',
  envKey: 'EUROPEANA_API_KEY',
  field: 'eu',
  property: 'P7704',
  statsKey: 'europeana',
  fetch: (eu, label, key) => europeanaEntries(eu, label, key),
  browseUrl: (hit, eu) => europeanaBrowseUrl(eu),
  trace: (label, qid) =>
    `Wikidata’s item for ${label ?? qid} (${qid}) states its Europeana entity ID ` +
    `(P7704) — Europeana’s partner records link this item to that entity.`,
  sample: (hit, label, eu) => ({
    source: 'europeana',
    topic: label ?? null,
    shown: hit.entries.length,
    total: hit.total,
    text:
      `A sample: ${hit.entries.length} of ${hit.total.toLocaleString()} openly licensed ` +
      `items Europeana’s partners link to ${label ?? eu}`,
  }),
}

// DigitalNZ, the first non-US/EU partner (LUI-145): 150+ NZ GLAM
// institutions behind one API, anchored the same way as DPLA — NLNZ catalogs
// through LC/NACO rather than running its own VIAF contribution, so LC's
// record of a P244 authority carries the heading form NZ catalogers use
// (as a VARIANT, not the authorized form — see src/lc.js and src/digitalnz.js
// for the live findings behind that). Strict by decision (2026-08-08): only
// records whose own subject field states one of LC's forms become cards.
// Keyless is fine here — the API answers without a key (`keyOptional`) — and
// a key, when set, rides along.
const DIGITALNZ_PIVOT = {
  source: 'digitalnz',
  envKey: 'DIGITALNZ_API_KEY',
  keyOptional: true,
  field: 'lc',
  property: 'P244',
  statsKey: 'digitalnz',
  fetch: (lc, label, key) => digitalnzEntries(lc, label, key),
  browseUrl: (hit) => digitalnzBrowseUrl(hit.heading),
  broadExtra: (hit) => ({ heading: hit.heading }),
  // `hit.heading` is the LC form the records' own subject fields matched —
  // usually LC's variant, so this says "a form of that name", never
  // "authorized heading", which for NZ material would be false.
  trace: (label, qid, hit) =>
    `Wikidata’s item for ${label ?? qid} (${qid}) states its Library of Congress ` +
    `authority ID (P244). “${hit.heading}” is a form of that name in the Library of ` +
    `Congress record, and this item’s own catalog entry files it under that heading.`,
  sample: (hit, label) => ({
    source: 'digitalnz',
    topic: label ?? hit.heading,
    shown: hit.entries.length,
    total: hit.total,
    text:
      `A sample: ${hit.entries.length} of the ${hit.total.toLocaleString()} items DigitalNZ’s ` +
      `partner institutions catalog under the heading “${hit.heading}”`,
  }),
}

/**
 * Discover the enriched page for one article. See the module comment for the
 * emit protocol. `emit` may be async; each band's fragment is awaited before
 * the next event for the same band-task fires, so a streaming caller can
 * write to a socket from it without interleaving.
 */
export async function discover(page, { emit = async () => {} } = {}) {
  // ---- Spine: the whole article in one parse call, split locally. ----------
  // Normalize the page title at entry, then resolve to the API's own title —
  // fetchArticle follows redirects, so a redirect source (e.g. "Coral Gables")
  // must not linger in `page`/`normalizedPage` or every downstream lookup and
  // display string would still name the redirect, not the article it targets.
  const article = await fetchArticle(CACHE, canonicalTitle(page))
  const normalizedPage = article.title
  page = normalizedPage
  const outline = sectionOutline(article.sections)
  const bodySections = outline.filter((s) => !SKIP.test(s.title))
  const sections = bodySections.slice(0, MAX_SECTIONS)
  const dropped = bodySections.length - sections.length

  const sectionWikitext = async (index) =>
    sliceSectionWikitext(article.wikitext, article.sections, index) ??
    // A template-transcluded section has no byteoffset to slice by; fetching
    // it individually is the rare fallback, not the rule.
    (await fetchSectionWikitext(CACHE, normalizedPage, index))

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
    ia: 0,
    scholar: 0,
    statements: 0,
    dpla: 0,
    europeana: 0,
    digitalnz: 0,
    anchorsQid: 0,
    anchorsCite: 0,
    anchorsScholar: 0,
    viaShortCite: 0,
    sections: 0,
  }
  // The footnote bodies, once for the whole page: each band's gutter shows
  // the notes its own prose points at, joined here by note name.
  const noteMap = referenceNotes(article.html)
  // The article's own infobox, held for the lede band: its fallback when no
  // find with subject standing earns the rail (the gate lives in bandParts —
  // design: ../docs/design-plans/2026-08-08-infobox-retention.md). Extracted
  // from the parse response the spine already paid for; null costs the page
  // its fallback and nothing else.
  const infobox = extractInfobox(article.html)

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
  // Article-global batches resolve once. Labels are batched for every picked
  // QID the moment the QID map lands, concurrent with the partner lookups they
  // describe. The subject's own claims — a case citation, a thesis, an author
  // identifier — enrich only the lede, so nothing about them may sit ahead of
  // the spine.
  // The page's own title rides the same batch: its QID seeds the anchor
  // registry below without waiting on the subject's claims fetch.
  const qidsPromise = fetchQids(CACHE, [
    ...new Set([normalizedPage, ...units.flatMap((u) => u.linkCandidates)]),
  ])

  // The subject's QID, resolved via wikidata. `subjectPromise` waits on all N
  // batches of `qidsPromise` (one per 50 titles), not just a single 50-title
  // request: the page title now rides in the batched titles list alongside every
  // unit's link candidates, pooling one WMF request. The tradeoff: subject
  // claims arrive after ALL title batches complete instead of after the first
  // batch — measured on Prandtl: +89ms for subject, +81ms for statements
  // (each scales ~10ms per batch). This is acceptable because the subject's
  // claims were already on every band's critical path through
  // `statementsPromise`, which has always awaited them.
  const subjectPromise = (async () => {
    const qid = (await qidsPromise).get(normalizedPage)
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

  // Stderr diagnostics: which global batch is the long pole. A streaming
  // reader sees rails arrive when the slowest batch a band needs settles, so
  // when a page feels slow this line says which host to blame.
  const timed = (name, p) => {
    const t0 = Date.now()
    return p.finally(() => console.error(`  ${name} settled in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
  }

  // ---- The lede goes first, at every queue. -------------------------------
  //
  // Measured cold on Brown v. Board (2026-08-05): spine at 0.6s, then NOTHING
  // until 2.6s, when eight bands landed at once, and 3.5s, when the remaining
  // nine did — including the lede, dead last of seventeen. Two step functions,
  // not a stream, because "a band waits only on the batches it will read" is
  // true and unhelpful when nearly every band reads the same two batches.
  //
  // So the lede gets its own turn at the front of each host's FIFO queue: its
  // candidates are asked about first, its anchors decided from that answer
  // alone, and its citations looked up before the rest of the page's. The cost
  // is one extra request per batch — a Solr query, an OpenLibrary volumes
  // call, a WDQS chunk — spent so the band carrying the hero card arrives
  // first instead of last.
  const lede = units.find((u) => u.index === '0') ?? null
  const others = units.filter((u) => u !== lede)
  // `first` runs before `rest` because enqueue() is FIFO per host: whichever
  // call is made first takes that host's turn first. Nothing here enforces the
  // order beyond that, and nothing needs to.
  const ledeFirst = (name, first, rest, merge) => {
    const firstPromise = timed(`${name} (lede)`, first())
    return [firstPromise, timed(name, firstPromise.then(async (a) => merge(a, await rest())))]
  }

  // What every candidate on the page holds, before any of them is chosen. The
  // pipeline used to do this the other way around: each section picked two
  // anchors on document order, asked about those two, and if neither held
  // anything the section rendered nothing — while its own third and fourth
  // links held a Met object or a taxon. On Apollo 11 that left 11 of 36
  // sections empty, 9 of them with usable material one link further down.
  //
  // Costs one cheap WDQS query per hundred candidates instead of one per page:
  // measured on Apollo 11, 49 anchors in 0.37s becomes 331 in 0.93s. The
  // expensive class walk does NOT widen with it — see statementsPromise.
  const candidatesOf = (us, qids) => us.flatMap((u) => u.linkCandidates.map((t) => qids.get(t)))
  const [ledePartnersPromise, partnersPromise] = ledeFirst(
    'wdqs partners',
    () =>
      qidsPromise.then((qids) =>
        partnerStatements([...(lede ? candidatesOf([lede], qids) : []), qids.get(normalizedPage)]),
      ),
    async () => partnerStatements(candidatesOf(others, await qidsPromise)),
    // Same statement OBJECTS in both maps where a qid appears twice, which is
    // what lets resolveMappability enrich one and be seen by the other.
    (a, b) => new Map([...b, ...a]),
  )

  /**
   * The lede's own anchors, decided from the lede's own answer.
   *
   * Sound because the lede is unit 0: `claimAnchors` walks units in article
   * order, so nothing upstream can have taken an anchor from it, and its picks
   * are a function of its own candidates alone. Seeding them into the
   * page-wide claim below therefore reproduces exactly what that claim would
   * have chosen — the batch renderer's byte-reproducibility depends on it, and
   * a test asserts it.
   */
  const ledePickedPromise = Promise.all([qidsPromise, subjectPromise, ledePartnersPromise]).then(
    ([qids, subject, partners]) => {
      if (!lede) return []
      const ordered = preferRelated(
        preferYielding(candidatesOf([lede], qids), partners),
        subjectAnchors(subject.claims),
      )
      const own = []
      for (const q of ordered) {
        if (own.length >= QIDS_PER_SECTION) break
        if (!q || own.includes(q)) continue
        own.push(q)
      }
      return own
    },
  )

  const pickedPromise = Promise.all([
    qidsPromise,
    subjectPromise,
    partnersPromise,
    ledePickedPromise,
  ]).then(([qids, subject, partners, ledeOwn]) => {
    // Every unit's candidates in article order; ownership is decided here,
    // before any partner is fetched, so streaming's completion-order
    // emission can never reassign an anchor between runs. The subject QID is
    // seeded to the lede: its own statements belong there by design, and so
    // are the anchors the lede already committed to above.
    const seeded = new Map()
    const ledeAt = units.findIndex((u) => u.index === '0')
    const subjectQid = qids.get(normalizedPage)
    if (ledeAt !== -1) {
      if (subjectQid) seeded.set(subjectQid, ledeAt)
      for (const q of ledeOwn) seeded.set(q, ledeAt)
    }
    const related = subjectAnchors(subject.claims)
    const owned = claimAnchors(
      units.map((u) => {
        const qs = u.linkCandidates.map((t) => qids.get(t))
        // Every unit prefers candidates that actually hold something.
        const yielding = preferYielding(qs, partners)
        // The lede then re-sorts by how specifically the subject's own
        // Wikidata statements name each one — applied SECOND, so relevance
        // dominates and yield breaks ties within it. Grant Wood and the Art
        // Institute (named, and holding something) come before Nan Wood
        // Graham (named, holding nothing) and before oil painting (holding
        // something, never named). Other units have no such signal: nothing
        // states what §"Cultural significance" is about.
        return u.index === '0' ? preferRelated(yielding, related) : yielding
      }),
      { perUnit: QIDS_PER_SECTION, seeded },
    )
    const picked = new Map()
    units.forEach((unit, i) => {
      stats.anchorsQid += owned[i].length
      picked.set(unit, owned[i])
    })
    return picked
  })

  // Declared before the page-wide one so it takes wikidata's turn first — the
  // lede's two anchors are one small request, and without this the lede would
  // still be waiting on the page-wide pick just to learn their names.
  const ledeLabelsPromise = ledePickedPromise.then((own) => entityLabels(own))
  const labelsPromise = pickedPromise.then((picked) => entityLabels([...picked.values()].flat()))

  const [ledeIaPromise, iaPromise] = ledeFirst(
    'ia batch',
    async () => iaLookups(lede?.identified ?? []),
    async () => iaLookups(others.flatMap((u) => u.identified)),
    (a, b) => new Map([...b, ...a]),
  )
  const isbnsOf = (us) => us.flatMap((u) => u.railCandidates.map((c) => c.isbn)).filter(Boolean)
  const [ledeVolumesPromise, volumesPromise] = ledeFirst(
    'openlibrary volumes',
    async () => openLibraryVolumes(lede ? isbnsOf([lede]) : []),
    async () => openLibraryVolumes(isbnsOf(others)),
    (a, b) => ({
      volumes: new Map([...b.volumes, ...a.volumes]),
      unchecked: new Set([...b.unchecked, ...a.unchecked]),
    }),
  )
  const scholarPromise = timed(
    'openalex batch',
    openAlexLookups(units.flatMap((u) => u.scholarly), { contact: CONTACT() }),
  )
  // Mappability, for the anchors that were actually picked and nothing else.
  // The partner statements are already in hand; this is the transitive class
  // walk that decides whether a coordinate may become a map, and it is the
  // expensive half. Widening it alongside the partner query would take Apollo
  // 11 from 16 location-bearing items to 95 and 0.63s to 1.11s, to answer the
  // question for anchors no section will render. See src/statements.js.
  const ledeStatementsPromise = timed(
    'wdqs mappability (lede)',
    Promise.all([ledePartnersPromise, ledePickedPromise, subjectPromise]).then(
      ([partners, own, subject]) => resolveMappability(partners, [...own, subject.qid]),
    ),
  )
  const statementsPromise = timed(
    'wdqs mappability',
    Promise.all([ledeStatementsPromise, partnersPromise, pickedPromise, subjectPromise]).then(
      ([, partners, picked, subject]) =>
        resolveMappability(partners, [...[...picked.values()].flat(), subject.qid]),
    ),
  )
  /**
   * Copyright status, for the anchors a card could honestly carry it on.
   *
   * Narrow by construction: the article's own subject (always — it is one item
   * and it is where a reader most wants the answer) plus any picked anchor
   * whose partner statements say it is an object rather than a place or an
   * event (`needsRightsQuery`). On a normal page that is one to three QIDs, so
   * this is a small query, not a second copy of the partner one.
   *
   * Split lede-first for the same reason mappability is: the subject's card
   * lives in the lede, and the lede goes ahead of the page.
   *
   * Failure semantic, deliberately identical to mappability: a failed query
   * costs the page its rights marks and never a card. `entityRights` swallows
   * the error and returns what it has, because a missing mark says nothing
   * while a wrong one tells a reader they may reuse something they may not.
   */
  const rightsFor = async (partners, qids, subjectQid) =>
    entityRights([
      subjectQid,
      ...qids.filter((q) => needsRightsQuery(partners.get(q))),
    ])
  const ledeRightsPromise = timed(
    'wdqs rights (lede)',
    Promise.all([ledePartnersPromise, ledePickedPromise, subjectPromise]).then(
      ([partners, own, subject]) => rightsFor(partners, own, subject.qid),
    ),
  )
  const rightsPromise = timed(
    'wdqs rights',
    Promise.all([ledeRightsPromise, partnersPromise, pickedPromise, subjectPromise]).then(
      ([ledeRights, partners, picked, subject]) =>
        rightsFor(partners, [...picked.values()].flat(), subject.qid).then(
          (rights) => new Map([...rights, ...ledeRights]),
        ),
    ),
  )

  const ledeExtrasPromise = Promise.all([subjectPromise, ledePickedPromise]).then(async ([
    { qid: subjectQid, claims: subjectClaims },
    ledeOwn,
  ]) => {
    const reporterCites = (subjectClaims.P1031 ?? [])
      .map((c) => c.mainsnak?.datavalue?.value)
      .filter((v) => typeof v === 'string')
    const opinion = reporterCites.length ? freeLawByCitation(reporterCites) : null
    const orcid = subjectClaims.P496?.[0]?.mainsnak?.datavalue?.value
    const [thesis, works, scholarship, artworks] = await Promise.all([
      // No longer waits for the page-wide identifier batch. That gate was
      // written when this pivot could spend eight serial archive.org requests
      // searching for a thesis by description — a cost worth deferring behind
      // work every band needed. The search fallback was retired on 2026-08-03
      // (see collectionByDescribedThesis), leaving at most ONE metadata read
      // for an identifier Wikidata states outright, while the gate went on
      // holding the lede behind every ISBN on the page. Measured on Brown v.
      // Board, that helped make the lede the last band of seventeen.
      collectionByDescribedThesis(subjectClaims, normalizedPage).catch((e) => {
        console.error(`  thesis pivot failed: ${e.message}`)
        return null
      }),
      subjectAuthorWorks(subjectClaims).catch((e) => {
        console.error(`  author works failed: ${e.message}`)
        return { entries: [], total: 0 }
      }),
      typeof orcid === 'string'
        ? openAlexAuthorWorks(orcid, { contact: CONTACT(), cap: WORKS_BY_SUBJECT }).catch((e) => {
            console.error(`  openalex author works failed: ${e.message}`)
            return { entries: [], total: 0 }
          })
        : Promise.resolve({ entries: [], total: 0 }),
      // The subject's own artworks, held by partner museums. Asked of the
      // graph rather than of the article's links, because on an artist article
      // the paintings are linked from galleries and works-tables and
      // `proseLinks` strips tables — see the header of src/artworks.js for the
      // measured funnel that made this its own pivot. Excludes anchors the
      // lede already owns, so a painting the lede is already carding does not
      // arrive a second time on the subject's shelf.
      needsArtworksQuery(subjectClaims)
        ? subjectArtworks(subjectQid, {
            cap: WORKS_BY_SUBJECT,
            exclude: new Set(ledeOwn),
            fetchEntry: artworkFetcher,
          }).catch((e) => {
            console.error(`  subject artworks failed: ${e.message}`)
            return { entries: [], totals: {}, total: 0 }
          })
        : Promise.resolve({ entries: [], totals: {}, total: 0 }),
    ])
    // The shelves of the subject's own output say whose output and which
    // identifier vouches for that — the band's disclosure states the counts,
    // the card states the claim.
    // The subject's own output is its own reason class: in the lede an ORCID
    // paper or the thesis must not share a strip with works merely cited there.
    // `standing` is the same fact stated for the hero picker (src/hero.js):
    // where the article is ABOUT a document, that document leads the section,
    // ahead of any illustrated record of it.
    if (thesis) {
      thesis.topic = `By ${page}`
      thesis.standing = 'subject-document'
    }
    if (opinion) opinion.standing = 'subject-document'
    const fixOn = (prop) => ({
      url: `https://www.wikidata.org/wiki/${subjectQid}#${prop}`,
      label: 'Check or fix it on Wikidata',
    })
    for (const e of works.entries) {
      e.why = `Written by ${page}`
      e.topic = `By ${page}`
      e.standing = 'subject-work'
      e.trace =
        `Wikidata — the shared database behind Wikipedia’s infoboxes — records an Open Library ` +
        `author ID (P648) for ${page}. These are the books Open Library files under that author.`
      e.fix = fixOn('P648')
    }
    for (const e of scholarship.entries) {
      e.why = `A paper by ${page}, free to read`
      e.topic = `By ${page}`
      e.standing = 'subject-work'
      e.trace =
        `Wikidata records an ORCID iD (P496) for ${page} — the number researchers use to keep ` +
        `their own name attached to their work. OpenAlex lists this paper under it.`
      e.fix = fixOn('P496')
    }
    for (const e of artworks.entries) {
      const holder = MUSEUM_NAME[e.source] ?? 'a partner museum'
      e.why = `Made by ${page}, held by ${holder}`
      e.topic = `By ${page}`
      e.standing = 'subject-work'
      e.trace =
        `Wikidata — the shared database behind Wikipedia’s infoboxes — records that ${page} ` +
        `created this work (P170), and that ${holder} holds it. ` +
        `We asked the museum for its own record of it, and this is what came back.`
      // The work's own Wikidata entry, not the subject's: that is where both
      // halves of this claim — who made it and who holds it — are stated, and
      // so where a reader who spots either being wrong would fix it.
      e.fix = e._qid
        ? { url: `https://www.wikidata.org/wiki/${e._qid}#P170`, label: 'Check or fix it on Wikidata' }
        : fixOn('P170')
    }
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
    if (artworks.entries.length)
      console.error(
        `artworks by subject: ${artworks.entries.length} of ` +
          `${artworks.truncated ? `${artworks.total}+` : artworks.total} ` +
          `(${Object.entries(artworks.totals)
            .filter(([k, n]) => k !== 'works' && n)
            .map(([k, n]) => `${k} ${n}`)
            .join(', ')})`,
      )
    return { opinion, thesis, works, scholarship, artworks, subjectQid }
  })

  // ---- One task per unit: a band completes when ITS dependencies do. -------
  const bandTasks = units.map(async (unit) => {
    // A band waits only on the global batches it will actually read: a
    // section with no book citations must not stall behind OpenLibrary, nor a
    // section with no identifiers behind archive.org.
    //
    // The lede reads the lede-only half of each batch — the half that took its
    // host's first turn — so it is not held behind the rest of the page. Every
    // other band reads the merged result, which resolves no later than it did
    // before. `labelsPromise` is the one thing the lede still shares, because
    // labels are one batched request for the whole page and cheap.
    const first = unit === lede
    const picked = first ? await ledePickedPromise : (await pickedPromise).get(unit)
    const [iaHits, ol, labels, scholarHits, statements, rights] = await Promise.all([
      unit.identified.length ? (first ? ledeIaPromise : iaPromise) : new Map(),
      unit.railCandidates.some((c) => c.isbn)
        ? first
          ? ledeVolumesPromise
          : volumesPromise
        : { volumes: new Map(), unchecked: new Set() },
      picked.length ? (first ? ledeLabelsPromise : labelsPromise) : new Map(),
      unit.scholarly.length ? scholarPromise : new Map(),
      picked.length || first ? (first ? ledeStatementsPromise : statementsPromise) : new Map(),
      picked.length || first ? (first ? ledeRightsPromise : rightsPromise) : new Map(),
    ])
    const extras = unit.index === '0' ? await ledeExtrasPromise : null

    const coverage = citationCoverage(unit.railCandidates, ol.volumes, ol.unchecked)
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
    if (extras)
      entries.push(
        ...extras.works.entries,
        ...extras.scholarship.entries,
        ...extras.artworks.entries,
      )
    // The subject's own output — books Open Library files under them, papers
    // their ORCID vouches for, their thesis. Here the article's subject is the
    // AUTHOR, so what applies is their creator-level status: CopyClear's bots
    // rule on a body of work, and that ruling covers these shelves. The view
    // built with `kind: 'author'` states whose status it is and links to
    // Paulina's author page rather than a work page, so the claim on the card
    // stays attached to the person it is actually about.
    if (extras?.subjectQid) {
      const authorRights = rightsView(rights.get(extras.subjectQid), {
        qid: extras.subjectQid,
        kind: 'author',
        label: unit.title,
      })
      // The artworks belong in this loop for the reason CLAUDE.md gives for
      // the shelf class: these are works the subject MADE, so the creator's
      // status is a status of the right thing. This is the case the Kafka
      // anthology was not — a 1991 compilation filed under a long-dead author
      // is a new work, whereas a painting with P170 pointing at the subject is
      // that subject's own. The museum's own `copy` statement is untouched;
      // the two answer different questions and both ride the card.
      for (const e of [
        extras.thesis,
        ...extras.works.entries,
        ...extras.scholarship.entries,
        ...extras.artworks.entries,
      ]) {
        // The opinion is deliberately absent: a court's own words are public
        // domain because nobody may own the law, which is a stronger and
        // different reason than anything an author's status could supply.
        if (!e) continue
        // Open Library's lending status, where there is one, is about THIS
        // EDITION and therefore beats a ruling about the author's whole body of
        // work. A lent book gets the lending statement and no creator claim at
        // all: the two would contradict each other on the same card, and the
        // one describing the actual object wins. See accessRights.
        const access = e.access
        if (access?.copy) {
          e.rights = { ...e.rights, copy: access.copy }
          continue
        }
        if (authorRights && access?.trustsCreator !== false) {
          e.rights = { ...e.rights, work: authorRights }
        }
      }
    }

    // Citation anchors -> Internet Archive. The gutter's footnotes are text;
    // a cover card is the complementary visual, so cards no longer yield to
    // them — only two citations resolving to one scan still collapse.
    for (const hit of dedupedIaEntries(unit.identified, iaHits, [])) {
      entries.push(hit)
      stats.ia++
    }

    // Citation anchors -> open-access scholarship (OpenAlex / arXiv). Papers
    // with no open copy get no card — and the coverage line says how many
    // were filtered, because a shelf that shows only the open ones must not
    // imply the section cited only open ones.
    let openPapers = 0
    for (const cite of unit.scholarly) {
      const hit = scholarHits.get(cite)
      if (hit) {
        entries.push(hit)
        openPapers++
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
      // A partner's own record of what this article is about — the Art
      // Institute's American Gothic, iNaturalist's monarch. The hero picker
      // ranks these above any record of something merely linked here.
      if (isSubject) for (const e of found) e.standing = 'subject-record'
      // Wikidata's copyright status for THIS entity, on the cards that are a
      // record of it. Sound because every entry `statementEntries` returns is
      // the partner's own record of `qid` — the Met's object, the taxon, the
      // manifest — so the status of `qid` is the status of the thing on the
      // card. It is emphatically not sound one shelf over, where DPLA and
      // Europeana return items merely filed *under* an anchor; those carry
      // only the license their host states for the copy.
      const workRights = rightsView(rights.get(qid), { qid, kind: 'work', label })
      if (workRights) for (const e of found) e.rights = { ...e.rights, work: workRights }
      if (found.some((e) => e.source === 'openstreetmap')) mapsLeft--
      statementsLeft -= found.length
      entries.push(...found)
      stats.statements += found.length
    }

    // What each shelf is a sample OF, keyed to the shelf it describes.
    //
    // This used to be one string per band, joined with '. ' and printed as a
    // paragraph at the top of the deck — so on Brown v. Board a reader met
    // "4 of the 54 items DPLA's partners catalog under…" two shelves before
    // reaching the DPLA cards it counted, with the Internet Archive and
    // OpenStreetMap shelves in between. A sample claim has to sit on the thing
    // it is a sample of. The renderer matches on (source, topic), which is
    // exactly how it groups entries into shelves.
    const samples = []
    // Anchors whose holdings are too broad to sample: shown as one sentence
    // and a browse link instead of four arbitrary cards. See src/breadth.js.
    const broad = []
    const pivotCtx = { unit, extras, statementQids, statements, labels, entries, stats, samples, broad }
    await bandPropertyPivot(pivotCtx, DPLA_PIVOT)
    // Runs after DPLA. Both pivot on P244, but they no longer share a
    // request: DPLA HEADs for the authorized heading, this GETs the record
    // for its variant forms (src/lc.js says why) — two id.loc.gov URLs, each
    // once ever per identifier given the durable cache. Folding DPLA's HEAD
    // into the GET would save one request per anchor and is noted in the
    // DigitalNZ section of CLAUDE.md as a follow-up, not done here because it
    // touches the DPLA pivot's hot path.
    await bandPropertyPivot(pivotCtx, DIGITALNZ_PIVOT)
    await bandPropertyPivot(pivotCtx, EUROPEANA_PIVOT)

    // Say how much was left on the table. Every shelf here is a sample of
    // something larger, and a page that shows six of six hundred without
    // saying so is claiming a selection it never made. These notes only ever
    // fire on the lede, where unit.title is the article's own title — and the
    // topic is the one ledeExtras stamps on those entries, so each lands on
    // its own shelf rather than in a paragraph above all of them.
    // The article's own copyright status, when nothing else on this band said
    // it. Only the lede: the claim is about the article's subject, and the
    // lede is where the subject is named. The `some` guard is what keeps a
    // page from saying it twice — where a partner holds a record OF the
    // subject, that card already carries the same view, and a box above the
    // prose repeating it would be the duplicate disclosure this page keeps
    // deleting.
    let subjectRights = null
    if (extras?.subjectQid && !entries.some((e) => e.rights?.work)) {
      const rec = rights.get(extras.subjectQid)
      // Which route Paulina should take is decided by what the graph holds:
      // P6216 is a property of works, P7763 of the people who make them.
      const kind = rec?.work?.length ? 'work' : 'author'
      const view = rightsView(rec, { qid: extras.subjectQid, kind, label: unit.title })
      // A view with neither marks nor a sentence is nothing to show. That
      // happens when the only statement is "not yet determined", which is a
      // real answer about the state of the graph and not an answer about the
      // work — see the status vocabulary in src/rights.js.
      if (view && (view.marks.length || view.line)) subjectRights = view
    }

    if (extras?.works.entries.length)
      samples.push({
        source: 'openlibrary',
        topic: `By ${page}`,
        shown: extras.works.entries.length,
        total: extras.works.total,
        text:
          `A sample: ${extras.works.entries.length} of ${extras.works.total} ` +
          `book${extras.works.total === 1 ? '' : 's'} Open Library files under ${unit.title}`,
      })
    if (extras?.scholarship.entries.length)
      samples.push({
        source: 'openalex',
        topic: `By ${page}`,
        shown: extras.scholarship.entries.length,
        total: extras.scholarship.total,
        text:
          `${extras.scholarship.entries.length} free to read, of the ${extras.scholarship.total} ` +
          `papers OpenAlex files under ${unit.title}’s ORCID record`,
      })
    // One note per MUSEUM, not one for the whole artworks pivot: the renderer
    // groups shelves by (source, topic), so these cards arrive as a Met shelf
    // beside a Rijksmuseum shelf, and a single note counting all of them would
    // be the free-floating claim this page keeps deleting. Each museum's note
    // counts that museum's own holdings.
    for (const [key, count] of Object.entries(extras?.artworks.totals ?? {})) {
      if (key === 'works' || !count) continue
      const source = key === 'aic' ? 'artic' : key
      const shown = extras.artworks.entries.filter((e) => e.source === source).length
      if (!shown) continue
      const holder = MUSEUM_NAME[source] ?? 'this collection'
      samples.push({
        source,
        topic: `By ${page}`,
        shown,
        total: count,
        text:
          `A sample: ${shown} of ${count} work${count === 1 ? '' : 's'} by ${unit.title} ` +
          `that Wikidata records ${holder} as holding`,
      })
    }

    const band = {
      id: unit.index === '0' ? 'slede' : `s${unit.index}`,
      title: unit.title,
      blocks: unit.blocks,
      entries,
      footnotes,
      // The raw tallies, not a sentence. They are summed page-wide and said
      // ONCE, in the visibility panel — per section this was 36 lines on San
      // Francisco, 26 of them reporting nothing but a failure to find.
      citations: coverage,
      papers: { total: unit.scholarly.length, open: openPapers },
      samples,
      broad,
      // Null on every band but the lede, and on a lede whose cards already
      // carry the claim. `bandParts` renders nothing for a null.
      subjectRights,
      // Also lede-only: the article's own infobox, `bandParts`' fallback for
      // a rail no subject-standing find claimed. Null elsewhere on purpose —
      // only the lede band may trip the gate.
      infobox: unit.index === '0' ? infobox : null,
    }
    console.error(`§ ${unit.title} — ${entries.length} items`)
    await emit('band', band)
    return band
  })

  const bands = await Promise.all(bandTasks)
  // `title` is the article we actually read, which is not always the one we
  // were asked for: "Coral Gables" is a redirect to "Coral Gables, Florida".
  // A caller that renders its own input would title the page after a redirect
  // that has no article behind it.
  return {
    title: normalizedPage,
    bands,
    stats,
    dropped,
    opinion: (await ledeExtrasPromise).opinion,
    // What the article can reach on its own, for the visibility panel. Read
    // off the spine's parse response — no request of its own.
    reach: articleReach(article),
  }
}
