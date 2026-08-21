// Live discovery, shared by both entry points: spike.js (batch — one
// self-contained HTML file, byte-reproducible off its cache) and serve.js
// (streaming — Phase 7: the spine renders before enrichment arrives).
//
// The pipeline is the Tier-1 shape: the whole article in ONE parse call, split
// locally; identifier lookups batched per source; everything riding the
// per-host serial queue in mw.js so hosts run concurrently while each API
// stays serial. discover() reports progress through an async `emit` callback:
//
//   emit('spine', { page, units, dropped })   — prose extracted, before lookups
//     `page` here is the RESOLVED article title, after redirects — render that,
//     not the caller's input, or a redirect names a page that has no article.
//   emit('band', band)                        — one band, in COMPLETION order
//
// and resolves to { title, bands, stats, dropped, opinion, reach } with bands in ARTICLE
// order. A batch caller can ignore the events entirely; a streaming caller
// writes the spine skeleton on the first event and a rail fragment per band
// event. Band assembly runs as one task per unit, so a band waits only on its
// own dependencies: the article-global identifier batches, the partner
// statements, and — for the lede alone — the subject-level lookups.
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
  OUTLINE_DEPTH,
} from './wikipedia.js'
import {
  applyAccess,
  bibliographyIdentifiers,
  citationCoverage,
  citationKey,
  resolveShortCites,
  sectionCitations,
  templateParams,
} from './citations.js'
import { chunk, dedupedIaEntries, iaSearchUrl, matchIaDoc, olBooksUrl } from './batch.js'
import { stripTags } from './html.js'
import { dplaBrowseUrl, dplaEntries } from './dpla.js'
import { europeanaBrowseUrl, europeanaEntries } from './europeana.js'
import { digitalnzBrowseUrl, digitalnzEntries } from './digitalnz.js'
import { describedThesisArchiveId, preferredLabel } from './corroborate.js'
import { cachedRequest } from './mw.js'
import { CACHE, getJson } from './http.js'
import { articleReach } from './gap.js'
import { authorBrowseUrl, authorWorkEntries, authorWorksUrl, iaMetadataUrl, scanIdsToVerify } from './works.js'
import { MUSEUM_NAME, needsArtworksQuery, subjectArtworks } from './artworks.js'
import { smithsonianScansForTaxon } from './smithsonian.js'
import { PARTNERS } from './partners.js'
import {
  openAlexAuthorWorks,
  openAlexLookups,
  scholarKey,
  scholarlyIdentifiers,
} from './scholarly.js'
import {
  aicEntry,
  clevelandEntry,
  gettyEntry,
  metEntry,
  needsRightsQuery,
  partnerStatements,
  PROP_NAME,
  resolveMappability,
  statementEntries,
} from './statements.js'
import { iiifEntry } from './iiif.js'
import { rijksEntry } from './rijks.js'
import { ccFromUri, entityRights, licenseView, rightsView, workFreeStatus } from './rights.js'
import {
  claimAnchors,
  claimCitations,
  preferOpen,
  preferRelated,
  preferYielding,
  subjectAnchors,
} from './dedup.js'
import { broadNote, tooBroad } from './breadth.js'
import { topicSpace } from './relevance.js'
import { workClass, selectHolder, holderStatements, bestRankValues } from './holder.js'
import { fetchHolderRecord, gateFailure } from './holder-record.js'


// Budgets. The design streams and never truncates; a spike has to finish, so it
// caps and says what it dropped rather than pretending it covered everything.
const MAX_SECTIONS = Number(process.env.MAX_SECTIONS ?? Infinity)
const QIDS_PER_SECTION = Number(process.env.QIDS_PER_SECTION ?? 2)
const CITES_PER_SECTION = Number(process.env.CITES_PER_SECTION ?? 3)
// Subject-level lookups answer "what does the ecosystem hold about this subject?"
// rather than "what did this section cite?", so they land in the lede.
const WORKS_BY_SUBJECT = Number(process.env.WORKS_BY_SUBJECT ?? 6)
// Scanned specimens of the article's own species. Three, not six: a shelf of
// gorilla skulls from one drawer says nothing the first one did not.
const SCANS_BY_SUBJECT = Number(process.env.SCANS_BY_SUBJECT ?? 3)
const SCHOLARLY_PER_SECTION = Number(process.env.SCHOLARLY_PER_SECTION ?? 3)
const STATEMENTS_PER_SECTION = Number(process.env.STATEMENTS_PER_SECTION ?? 4)
// On a single-institution page every non-holder lookup sits out. Each gated
// partner is one that can never BE a page's holder (HOLDERS is the museum
// properties plus the shared manifest door), so the test is simply whether a
// holder resolved; the holder's own record and statement lookups run through
// their own paths. A gated lookup is indistinguishable from an absent key
// downstream — except the citation tally, which must say "not checked"
// rather than let a negative stand (see the volumes gates).
const sitsOut = Boolean
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
    const isbn = p.get('isbn')?.replaceAll(/[^0-9Xx]/g, '')
    const entry = {
      title: stripTags(p.get('title') ?? '')
        .replaceAll(/\[\[|\]\]/g, '')
        .trim(),
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
  // lookup name the work from the Wikidata side rather than from whatever the
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
 * The same per-object fetchers the anchor lookup uses, so a painting reached
 * through the subject's own statements renders identically to one reached
 * through a wikilink — same card, same credit, same rights reading. Only the
 * reason it is on the page differs, and that is what `why` and the ⓘ fold say.
 */
const artworkFetcher = (via, id, label) => {
  if (via === 'met') return metEntry(id)
  if (via === 'rijks') return rijksEntry(id)
  if (via === 'aic') return aicEntry(id)
  if (via === 'cleveland') return clevelandEntry(id)
  if (via === 'getty') return gettyEntry(id)
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
  return { ...authorWorkEntries(body, { cap: WORKS_BY_SUBJECT, olid, iaMeta }), browse: authorBrowseUrl(olid) }
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
// in their own right — a section would lookup on "ISBN" as though the article
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
    .replaceAll(/<div[^>]*class="[^"]*hatnote[^"]*"[\s\S]*?<\/div>/gi, ' ')
    .replaceAll(/<ol class="references"[\s\S]*?<\/ol>/gi, ' ')
    .replaceAll(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replaceAll(/<table[\s\S]*?<\/table>/gi, ' ')
  const titles = []
  const re = /<a[^>]+href="\/wiki\/([^"#:?]+)"[^>]*>/gi
  let m
  while ((m = re.exec(body))) {
    const title = decodeURIComponent(m[1]).replaceAll(/_/g, ' ')
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
    .replaceAll(/_/g, ' ')    // Underscores to spaces
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
 * direct-id shape in `statements.js`'s `MUSEUM_LOOKUPS`.
 *
 * `spec.fetch` may resolve to null (DPLA does, when the LC heading lookup
 * itself fails); a spec whose fetch never returns null is unaffected by the
 * check.
 *
 * The fourth argument to `spec.fetch` is the corroboration context —
 * `{topic, ownQid, isSubject}`, see src/relevance.js — with which a fetcher
 * may drop records that are about the anchor but touch the article nowhere
 * else. DPLA and DigitalNZ read it; a fetcher that ignores it (Europeana,
 * whose records arrive entity-linked rather than heading-searched) behaves
 * exactly as before. A hit whose entries all failed corroboration is skipped
 * whole: no cards, no sample line — the shelf's absence IS the verdict, and
 * a "0 of 48" sentence would dress it as a disclosure.
 */
async function bandPropertyLookup(
  { unit, extras, statementQids, statements, labels, entries, stats, samples, broad, topic, holder },
  spec,
) {
  // On a holder page the search-shape partners sit out entirely.
  if (sitsOut(holder)) return
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
      const hit = await spec.fetch(id, label, process.env[spec.envKey], {
        topic,
        ownQid: qid,
        isSubject,
      })
      if (!hit) continue
      if (tooBroad(hit.total, { isSubject })) {
        broad.push(
          broadNote({ source: spec.source, label, total: hit.total, url: spec.browseUrl(hit, id), ...spec.broadExtra?.(hit) }),
        )
        continue
      }
      if (!hit.entries.length) continue
      for (const e of hit.entries) {
        // Reviewed and kept 2026-08-08: a search hit filed under the
        // subject's own heading keeps full subject-record standing, even
        // though it is not the partner's record OF the subject (the
        // distinction the rights rules draw). A photo of the Apollo 11
        // launch is the best non-document answer the lede can get, whatever
        // catalog relationship produced it — so the Atlanta History Center
        // shot outranks the article's own infobox, deliberately.
        if (isSubject) e.standing = 'subject-record'
        e.trace = spec.trace(label, qid, hit)
        e.fix = { url: `https://www.wikidata.org/wiki/${qid}#${spec.property}`, label: 'Check or fix it on Wikidata' }
      }
      entries.push(...hit.entries)
      stats[spec.statsKey] += hit.entries.length
      // The browse URL comes from `spec.browseUrl`, the same builder the broad
      // note uses, rather than from `spec.sample` — the two make the same offer
      // ("the rest of this shelf is over there") and a second copy of the URL
      // logic could drift so that a folded shelf and a sampled one sent readers
      // to different pages.
      if (hit.total > hit.entries.length)
        samples.push({ ...spec.sample(hit, label, id), url: spec.browseUrl(hit, id) })
    } catch (e) {
      console.error(`  ${spec.source} lookup failed (${id}): ${e.message}`)
    }
  }
}

// DPLA, keyed on a real identifier: only anchors whose Wikidata entry states
// an LC authority (P244) are looked up, via the authorized heading — "Eagle" the
// lunar module either has its own authority or stays out, which is what
// keeps eleven thousand bird photographs off the page. Without
// DPLA_API_KEY the lookup is simply absent: the demo must run keyless for
// anyone who clones it.
const DPLA_LOOKUP = {
  source: 'dpla',
  envKey: 'DPLA_API_KEY',
  field: 'lc',
  property: 'P244',
  statsKey: 'dpla',
  fetch: (lc, label, key, ctx) => dplaEntries(lc, label, key, ctx),
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
// Europeana entity (P7704) are looked up, and only openly licensed items come back.
// Keyless clones skip it silently.
const EUROPEANA_LOOKUP = {
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
const DIGITALNZ_LOOKUP = {
  source: 'digitalnz',
  envKey: 'DIGITALNZ_API_KEY',
  keyOptional: true,
  field: 'lc',
  property: 'P244',
  statsKey: 'digitalnz',
  fetch: (lc, label, key, ctx) => digitalnzEntries(lc, label, key, ctx),
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

  const sectionWikitext = async (index, opts) =>
    sliceSectionWikitext(article.wikitext, article.sections, index, opts) ??
    // A template-transcluded section has no byteoffset to slice by; fetching
    // it individually is the rare fallback, not the rule. (The fetch has
    // parse&section semantics — a transcluded parent would arrive with its
    // children — accepted as the rare case rather than paid for everywhere.)
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

  // ---- Everything the lookups need, extracted locally before any of them run.
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
  // The page-wide COUNTER for cited works, threaded through the loop below in
  // article order: each distinct work is tallied once, in the band that cites
  // it first. Before 2026-08-14 the visibility panel summed every band's full
  // candidate list, so a bibliography book cited from eight sections counted
  // eight times — Apollo 11's panel claimed "cites 216 works" for an article
  // citing 173 distinct ones, and the "you can read" numerator inflated the
  // same way. claimCitations with no cap IS the first-occurrence filter, null
  // keys kept and unclaimed.
  const countedOnPage = new Set()
  for (const s of [{ index: '0', title: page }, ...sections]) {
    // stopAt: a band holds only its OWN text. Every outline section becomes a
    // band, so a parent that kept its children's text (parse&section
    // semantics, the slicers' default) put every h3 on the page twice — its
    // words, its links, its citations, and therefore its cards. Found on
    // Apollo 11 (2026-08-09): the Preparations band carried all six
    // subsections' prose and a gutter of floats earned by their citations,
    // stacked beside whitespace; every phrase in the subtree appeared twice.
    const html = sliceSectionHtml(article.html, article.sections, s.index, { stopAt: OUTLINE_DEPTH }) ?? ''
    const bandId = s.index === '0' ? 'slede' : `s${s.index}`
    const blocks = articleBlocks(html, { notePrefix: bandId })
    if (!blocks.length) continue
    stats.sections++
    const wikitext = await sectionWikitext(s.index, { stopAt: OUTLINE_DEPTH })
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
    // NEITHER citation family is claimed here any more (papers 2026-08-14
    // morning, books same day): a card exists only if the open ecosystem
    // holds a copy, and that is knowable before the pick rather than after
    // it. The whole section's identifiers go to the lookups, and the picks —
    // `scholarPickedPromise` for papers, `iaPickedPromise` for books — claim
    // in article order once the lookups have answered, so a scanless book or
    // a paywalled paper no longer spends a slot rendering nothing. See
    // "Query, then pick" in CLAUDE.md. The 2026-08-09 rule survives inside
    // those picks: a cited WORK still belongs to the first section that
    // cites it, page-wide, and footnotes are untouched — every section's
    // references carry their own borrow links; only the CARD belongs to one
    // section.
    const identified = dedupeIdentifiers([...citationIdentifiers(wikitext), ...shortCites])
    const scholarly = scholarlyIdentifiers(wikitext)
    units.push({
      index: s.index,
      title: s.title,
      blocks,
      footnotes: footnotesFor(blocks, noteMap, bandId),
      railCandidates,
      // The band's share of the page tally: its rail, minus works an earlier
      // band already counted. Decided here because this loop runs in article
      // order; see countedOnPage above.
      counted: claimCitations(railCandidates, countedOnPage, Infinity, citationKey),
      identified,
      shortCites,
      scholarly,
      linkCandidates: proseLinks(html).slice(0, 24),
    })
  }

  await emit('spine', { page, units, dropped })

  // ---- The lookups, concurrent across hosts, serial within each. -----------
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

  // Single-institution work pages: when the article IS a museum-held work,
  // its one holding institution — selected from the subject's own best-rank
  // identifiers, never by search. On for every deployment (the operator's
  // decision, 2026-08-20, on the QA document).
  const holderVerdictPromise = (async () => {
    const subject = await subjectPromise
    const medium = workClass(subject.claims)
    if (!medium) return null
    const holder = selectHolder(subject.claims)
    if (!holder) return null
    console.error(`  holder page: ${medium} held by ${holder.partner} (${holder.property} ${holder.id})`)
    const record = await fetchHolderRecord(holder)
    const failure = gateFailure(record)
    if (failure) {
      console.error(`  holder record fails gate (${failure})`)
      // A rights refusal is not silent: the record got far enough to name its
      // institution, and the museum's flag disagreeing with the graph's
      // answer about the work is a finding this page exists to surface — the
      // renderer shows it only where the graph actually states a free
      // answer, so a Picasso refused by everyone stays a plain refusal.
      if (failure === 'non-pd-rights' && record?.institution) {
        return {
          refusal: {
            partner: holder.partner,
            // The reader's-words name where one exists; a door whose manifest
            // names the institution (partners.js: institutionFromRecord) uses
            // the record's own name, never the generic display row.
            phrase: PARTNERS[holder.partner]?.institutionFromRecord
              ? record.institution
              : (MUSEUM_NAME[holder.partner] ?? record.institution),
            institution: record.institution,
            href: record.href ?? null,
          },
        }
      }
      return null
    }
    return { holder: { medium, ...holder, record, subjectQid: subject.qid } }
  })()
  const holderPromise = holderVerdictPromise.then((v) => v?.holder ?? null)

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
  // Labels cover every LC-bearing candidate, not only the picked anchors,
  // because the corroboration topic space (src/relevance.js) needs a name for
  // each anchor a record's subjects might touch — "Moon", "Astronauts",
  // "Space flight" are rarely picked by their sections but are exactly what
  // the good records under "Aldrin, Buzz" are also filed under. Costs at most
  // one more batched wbgetentities request per page; both promises already
  // depend on the partners map, so nothing waits longer.
  const lcBearing = (partners) => [...partners.entries()].filter(([, st]) => st?.lc).map(([q]) => q)
  const ledeLabelsPromise = Promise.all([ledePickedPromise, ledePartnersPromise]).then(
    ([own, partners]) => entityLabels([...own, ...lcBearing(partners)].filter(Boolean)),
  )
  const labelsPromise = Promise.all([pickedPromise, partnersPromise]).then(([picked, partners]) =>
    entityLabels([...[...picked.values()].flat(), ...lcBearing(partners)].filter(Boolean)),
  )

  // Each batch asks about one object per identifier: sections cite the same
  // bibliography entry as the same shared object, and a direct re-cite is a
  // fresh object with the same key — either way one answer serves them all,
  // and the pick below reads hits by key, not by object.
  const distinctCites = (cites) => {
    const seen = new Set()
    return cites.filter((c) => {
      const k = citationKey(c)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const [ledeIaPromise, iaPromise] = ledeFirst(
    'ia batch',
    async () => {
      const holder = await holderPromise
      return (!sitsOut(holder))
        ? iaLookups(distinctCites(lede?.identified ?? []))
        : new Map()
    },
    async () => {
      const holder = await holderPromise
      return (!sitsOut(holder))
        ? iaLookups(distinctCites(others.flatMap((u) => u.identified)))
        : new Map()
    },
    (a, b) => new Map([...b, ...a]),
  )
  /**
   * Query, then pick — the books twin of `scholarPickedPromise` below
   * (2026-08-14). The section used to claim its three book identifiers on
   * document order in the units loop, then ask the Internet Archive which
   * were scanned, so an unscanned book spent a slot and rendered nothing
   * (measured: Apollo 11 held scans for 7 of its 29 identified works and the
   * blind cap cost one of the 7 its card). Now only books IA actually holds
   * compete for the section's slots, article order unbroken — no license
   * tiers here, a scan is a scan — and the 2026-08-09 ownership rule is
   * applied at the same moment: only what a section keeps is claimed.
   *
   * The lede picks off its own batch alone — it is unit 0, so nothing
   * upstream can have claimed before it, the same argument as
   * `ledePickedPromise` — which preserves lede-first: its cards need never
   * wait on the page-wide batch. The page-wide pick then seeds the lede's
   * claims and walks the other units in article order, so band completion
   * order still cannot move a book between sections.
   */
  const pickIaCards = (us, hits, claimed) => {
    const byKey = new Map()
    for (const [cite, entry] of hits) byKey.set(citationKey(cite), entry)
    const picks = new Map()
    for (const unit of us) {
      const kept = claimCitations(
        unit.identified.filter((c) => byKey.has(citationKey(c))),
        claimed,
        CITES_PER_SECTION,
        citationKey,
      )
      stats.anchorsCite += kept.length
      stats.viaShortCite += kept.filter((c) => unit.shortCites.includes(c)).length
      picks.set(unit, { cites: kept, hits: new Map(kept.map((c) => [c, byKey.get(citationKey(c))])) })
    }
    return { picks, claimed }
  }
  const ledeIaPickedPromise = ledeIaPromise.then((hits) => pickIaCards(lede ? [lede] : [], hits, new Set()))
  const ledeIaPicksPromise = ledeIaPickedPromise.then((r) => r.picks)
  const iaPickedPromise = Promise.all([ledeIaPickedPromise, iaPromise]).then(([l, hits]) => {
    const r = pickIaCards(others, hits, new Set(l.claimed))
    return new Map([...l.picks, ...r.picks])
  })
  const isbnsOf = (us) => us.flatMap((u) => u.railCandidates.map((c) => c.isbn)).filter(Boolean)
  const [ledeVolumesPromise, volumesPromise] = ledeFirst(
    'openlibrary volumes',
    async () => {
      const holder = await holderPromise
      const ledeIsbns = lede ? isbnsOf([lede]) : []
      // Not asked, not "not found": the tally must say "could not check".
      return sitsOut(holder)
        ? { volumes: new Map(), unchecked: new Set(ledeIsbns) }
        : openLibraryVolumes(ledeIsbns)
    },
    async () => {
      const holder = await holderPromise
      return (!sitsOut(holder))
        ? openLibraryVolumes(isbnsOf(others))
        : { volumes: new Map(), unchecked: new Set(isbnsOf(others)) }
    },
    (a, b) => ({
      volumes: new Map([...b.volumes, ...a.volumes]),
      unchecked: new Set([...b.unchecked, ...a.unchecked]),
    }),
  )
  // Every distinct paper the article cites, asked about ONCE. The lookup used
  // to be handed the three-per-section survivors of a blind pick; it is handed
  // the whole page now, which is what lets `preferOpen` choose among papers
  // that can actually become cards. Deduplicated by identifier here rather
  // than by the claim, because the same DOI in eight sections is one work and
  // was one lookup before this change too.
  const scholarCandidates = []
  const askedScholar = new Set()
  for (const u of units) {
    for (const c of u.scholarly) {
      const k = scholarKey(c)
      if (askedScholar.has(k)) continue
      askedScholar.add(k)
      scholarCandidates.push(c)
    }
  }
  const scholarPromise = timed(
    'openalex batch',
    holderPromise.then(holder =>
      !sitsOut(holder)
        ? openAlexLookups(scholarCandidates, { contact: CONTACT() })
        : Promise.resolve(new Map())
    ),
  )
  /**
   * Query, then pick — the citations twin (2026-08-14), the same shape as
   * `pickedPromise` above and for the same reason. Two things are decided
   * here, and they are deliberately NOT the same set:
   *
   * - **Which papers get cards.** Only ones with an open copy compete, stated
   *   terms first (`preferOpen`), then the section's own citation order, then
   *   `claimCitations` so a work cited in eight sections is carded in one.
   *   Only what a section KEEPS is claimed — a paper squeezed out by the cap
   *   stays available to a later section, the rule claimCitations already had.
   * - **What the visibility panel counts.** Every distinct paper is counted
   *   once, in the band that cites it first, whether or not it earned a card.
   *   The panel's sentence is "Of the N research papers among them, M are
   *   free to read", and until now N was the number that SURVIVED the pick —
   *   at most three per section — so the page understated the Wikipedia
   *   article's own scholarship. `open` likewise means readable, not carded.
   *
   * Pure over `units`, which is in article order, and resolved once, so the
   * bands' completion order still cannot move a card between sections.
   */
  const scholarPickedPromise = scholarPromise.then((hits) => {
    const byKey = new Map()
    for (const [cite, entry] of hits) byKey.set(scholarKey(cite), entry)
    const entryOf = (c) => byKey.get(scholarKey(c))
    // Papers claim in their own namespace: `citedOnPage` holds ISBNs, OCLCs
    // and bare titles, this holds DOIs, PMIDs and arXiv ids, and the two
    // never met. Separate sets also mean the book claims (decided in the
    // units loop) and the paper claims (decided here, later) cannot race.
    const carded = new Set()
    const counted = new Set()
    const picks = new Map()
    for (const unit of units) {
      const mine = unit.scholarly.filter((c) => {
        const k = scholarKey(c)
        if (counted.has(k)) return false
        counted.add(k)
        return true
      })
      const kept = claimCitations(
        preferOpen(unit.scholarly.filter((c) => !entryOf(c)?.retracted), entryOf),
        carded,
        SCHOLARLY_PER_SECTION,
        scholarKey,
      )
      // Retracted papers neither compete for the section's slots nor answer
      // to its cap: they shelve under their own head ('Retracted papers' in
      // src/scholarly.js), and losing Wakefield to a cap because the section
      // also cites three sound open papers would silently drop the strongest
      // claim the page can make. Uncapped is safe because corroborated
      // retractions are rare — a page has none or one, not a shelf-full.
      // Same `carded` set, so a paper cited in eight sections says it once.
      const retractedHere = claimCitations(
        unit.scholarly.filter((c) => entryOf(c)?.retracted),
        carded,
        Infinity,
        scholarKey,
      )
      stats.anchorsScholar += kept.length + retractedHere.length
      picks.set(unit, {
        entries: [...kept.map(entryOf), ...retractedHere.map(entryOf)],
        // `open` means READABLE: a closed retracted paper has a card and no
        // free copy, and the panel's "M are free to read" must not count it.
        papers: {
          total: mine.length,
          open: mine.filter((c) => entryOf(c) && !entryOf(c).noFreeCopy).length,
        },
      })
    }
    return picks
  })
  // Mappability, for the anchors that were actually picked and nothing else.
  // The partner statements are already in hand; this is the transitive class
  // walk that decides whether a coordinate may become a map, and it is the
  // expensive half. Widening it alongside the partner query would take Apollo
  // 11 from 16 location-bearing items to 95 and 0.63s to 1.11s, to answer the
  // question for anchors no section will render. See src/statements.js.
  const ledeStatementsPromise = timed(
    'wdqs mappability (lede)',
    Promise.all([ledePartnersPromise, ledePickedPromise, subjectPromise, holderPromise]).then(
      // On a holder page maps sit out, so the class walk that exists only to
      // qualify them is not asked; the partner statements pass through as-is.
      ([partners, own, subject, holder]) =>
        sitsOut(holder) ? partners : resolveMappability(partners, [...own, subject.qid]),
    ),
  )
  const statementsPromise = timed(
    'wdqs mappability',
    Promise.all([ledeStatementsPromise, partnersPromise, pickedPromise, subjectPromise, holderPromise]).then(
      ([, partners, picked, subject, holder]) =>
        sitsOut(holder) ? partners : resolveMappability(partners, [...[...picked.values()].flat(), subject.qid]),
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

  const ledeExtrasPromise = Promise.all([subjectPromise, ledePickedPromise, holderPromise]).then(async ([
    { qid: subjectQid, claims: subjectClaims },
    ledeOwn,
    holder,
  ]) => {
    const reporterCites = (subjectClaims.P1031 ?? [])
      .map((c) => c.mainsnak?.datavalue?.value)
      .filter((v) => typeof v === 'string')
    const opinion = reporterCites.length && (!sitsOut(holder))
      ? freeLawByCitation(reporterCites)
      : null
    const orcid = subjectClaims.P496?.[0]?.mainsnak?.datavalue?.value
    const taxonName = subjectClaims.P225?.[0]?.mainsnak?.datavalue?.value
    const [thesis, works, scholarship, artworks, scans] = await Promise.all([
      // No longer waits for the page-wide identifier batch. That gate was
      // written when this lookup could spend eight serial archive.org requests
      // searching for a thesis by description — a cost worth deferring behind
      // work every band needed. The search fallback was retired on 2026-08-03
      // (see collectionByDescribedThesis), leaving at most ONE metadata read
      // for an identifier Wikidata states outright, while the gate went on
      // holding the lede behind every ISBN on the page. Measured on Brown v.
      // Board, that helped make the lede the last band of seventeen.
      (!sitsOut(holder))
        ? collectionByDescribedThesis(subjectClaims, normalizedPage).catch((e) => {
            console.error(`  thesis lookup failed: ${e.message}`)
            return null
          })
        : Promise.resolve(null),
      (!sitsOut(holder))
        ? subjectAuthorWorks(subjectClaims).catch((e) => {
            console.error(`  author works failed: ${e.message}`)
            return { entries: [], total: 0 }
          })
        : Promise.resolve({ entries: [], total: 0 }),
      (!sitsOut(holder)) && typeof orcid === 'string'
        ? openAlexAuthorWorks(orcid, { contact: CONTACT(), cap: WORKS_BY_SUBJECT }).catch((e) => {
            console.error(`  openalex author works failed: ${e.message}`)
            return { entries: [], total: 0 }
          })
        : Promise.resolve({ entries: [], total: 0 }),
      // The subject's own artworks, held by partner museums. Asked of the
      // graph rather than of the article's links, because on an artist article
      // the paintings are linked from galleries and works-tables and
      // `proseLinks` strips tables — see the header of src/artworks.js for the
      // measured funnel that made this its own lookup. Excludes anchors the
      // lede already owns, so a painting the lede is already carding does not
      // arrive a second time on the subject's shelf.
      // Gated like every partner dispatch: this path fetches museum records
      // (fetchEntry), and the person-gate is no impossibility proof —
      // needsArtworksQuery reads raw P31 claims while workClass reads best
      // rank, and P31 is multi-valued, so the two CAN coincide. The gate is
      // one conjunct; holderShelfPromise below is the holder-scoped shelf.
      !sitsOut(holder) && needsArtworksQuery(subjectClaims)
        ? subjectArtworks(subjectQid, {
            cap: WORKS_BY_SUBJECT,
            exclude: new Set(ledeOwn),
            fetchEntry: artworkFetcher,
          }).catch((e) => {
            console.error(`  subject artworks failed: ${e.message}`)
            return { entries: [], totals: {}, total: 0 }
          })
        : Promise.resolve({ entries: [], totals: {}, total: 0 }),
      // The Smithsonian's 3D scans of the article's own species, joined on the
      // scientific name rather than on any identifier — see the second half of
      // src/smithsonian.js for why a specimen can be reached no other way, and
      // for what the corroborated class is doing on these cards. Gated on the
      // subject having a P225, so nothing but a taxon article ever spends the
      // request.
      typeof taxonName === 'string' && taxonName.trim()
        ? smithsonianScansForTaxon(taxonName, process.env.SMITHSONIAN_API_KEY, {
            cap: SCANS_BY_SUBJECT,
          }).catch((e) => {
            console.error(`  smithsonian scans failed: ${e.message}`)
            return { entries: [], total: 0, truncated: false }
          })
        : Promise.resolve({ entries: [], total: 0, truncated: false }),
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
      e.why = e.retracted
        ? `A paper by ${page} — later retracted, still free to read`
        : `A paper by ${page}, free to read`
      e.topic = `By ${page}`
      e.standing = 'subject-work'
      e.trace =
        `Wikidata records an ORCID iD (P496) for ${page} — the number researchers use to keep ` +
        `their own name attached to their work. OpenAlex lists this paper under it.` +
        (e.retracted
          ? ` OpenAlex also marks the paper as retracted, and Crossref — the DOI registry, ` +
            `where the Retraction Watch database files retraction notices — confirms it.`
          : ``)
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
    for (const e of scans.entries) {
      e.why = `A Smithsonian specimen of ${page}, scanned in 3D`
      e.topic = 'Scanned in 3D'
      // A record OF the subject, not a work BY it: the specimen is one of these
      // animals, and the museum made the scan. That is `subject-record`, and it
      // is deliberately kept out of the creator-status loop below — nothing
      // about who authored what applies to a gorilla.
      e.standing = 'subject-record'
      e.trace =
        `Wikidata — the shared database behind Wikipedia’s infoboxes — records the scientific ` +
        `name (P225) for ${page}. The Smithsonian’s Open Access catalog states that same name ` +
        `on this specimen’s own record, and publishes a 3D scan of it. The two are joined by ` +
        `the name: no identifier is shared, which is why the card says so.`
      e.fix = fixOn('P225')
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
    if (scans.entries.length)
      console.error(
        `smithsonian scans by taxon: ${scans.entries.length} of ` +
          `${scans.truncated ? scans.total + '+' : scans.total} for ${taxonName}`,
      )
    if (artworks.entries.length)
      console.error(
        `artworks by subject: ${artworks.entries.length} of ` +
          `${artworks.truncated ? artworks.total + '+' : artworks.total} ` +
          `(${Object.entries(artworks.totals)
            .filter(([k, n]) => k !== 'works' && n)
            .map(([k, n]) => `${k} ${n}`)
            .join(', ')})`,
      )
    return { opinion, thesis, works, scholarship, artworks, scans, subjectQid }
  })

  // The holder-scoped shelf: on a museum-holder page whose subject states a
  // creator (P170), the creator’s other works at the SAME museum, found
  // through the graph — the works-by-creator query restricted to the
  // holder’s own property, no search API (the no-fuzzy rule). Deliberately
  // separate from the lede extras: these entries’ author is the CREATOR,
  // not the article’s subject, so they must never ride the subject-level
  // loops (author rights, subject standings). A manifest holder gets no
  // shelf — its “collection” is not enumerable from the graph (the recorded
  // scope rule) — and the shelf lands on the one band that owns the
  // creator’s anchor, the lede when none does.
  // Gated BEFORE the page-wide pick is awaited: every band (the lede
  // included) awaits this promise, and the lede is deliberately routed
  // around the page-wide batches everywhere else — a non-holder page must
  // never couple its hero band to the slowest global batch. Only a
  // museum-holder page pays the coupling, where the exclusion set and the
  // placement decision genuinely need the page-wide pick.
  const holderShelfPromise = Promise.all([subjectPromise, holderPromise]).then(async ([subject, holder]) => {
    // A door whose institution comes from each object's own record
    // (partners.js: institutionFromRecord) is many institutions, and a
    // works-by-creator shelf would fetch the OTHER institutions' records —
    // the single-source rule. Same manifest fact as the refusal's naming.
    if (!holder || PARTNERS[holder.partner]?.institutionFromRecord) return null
    const [creatorQid] = bestRankValues(subject.claims, 'P170')
    if (!creatorQid) return null
    const [ledeOwn, pickedMap] = await Promise.all([ledePickedPromise, pickedPromise])
    const creatorLabel = (await entityLabels([creatorQid])).get(creatorQid)
    // entityLabels falls back to the bare QID when no English label exists,
    // and a shelf headed "works by Q123456" is worse than no shelf — the
    // same refusal artworkRows makes for the works themselves.
    if (!creatorLabel || creatorLabel === creatorQid) return null
    const shelf = await subjectArtworks(creatorQid, {
      cap: WORKS_BY_SUBJECT,
      // Every band's picked anchors, not only the lede's: an anchor already
      // carding through its own band's statements must not card again here.
      exclude: new Set([...ledeOwn, subject.qid, ...[...pickedMap.values()].flat()]),
      fetchEntry: artworkFetcher,
      property: holder.property,
    }).catch((e) => {
      console.error(`  holder shelf failed: ${e.message}`)
      return null
    })
    if (!shelf?.entries.length) return null
    // One placement decision, made once: the band owning the creator’s
    // anchor, else the lede (or the first band, on a page without one).
    let owner = units.some((u) => u.index === '0') ? '0' : (units[0]?.index ?? '0')
    let ownerFound = false
    for (const [unit, qids] of pickedMap) {
      if ((qids ?? []).includes(creatorQid)) {
        owner = unit.index
        ownerFound = true
        break
      }
    }
    const museumName = MUSEUM_NAME[shelf.entries[0].source] ?? 'this museum'
    const propName = PROP_NAME[holder.property] ?? holder.property
    // Worded to what was computed: the anchor assignment picks at most two
    // anchors per section, so "anchors on" is the knowable claim — "never
    // links" would assert an absence nobody verified.
    const placement = ownerFound
      ? `The shelf sits beside the section this page anchors on ${creatorLabel}.`
      : `No section on this page anchors on ${creatorLabel}, so the shelf sits at the top of the page.`
    for (const e of shelf.entries) {
      e.topic = `By ${creatorLabel}`
      e.why = `Made by ${creatorLabel}, held by ${museumName}`
      e.trace =
        `Wikidata — the shared database behind Wikipedia’s infoboxes — records that ${creatorLabel} ` +
        `created this work (P170), and that ${museumName} holds it, stating its ${propName}. ` +
        `We asked the museum for its own record of it, and this is what came back. ${placement}`
      // artworkRows validates every qid, so the fallback is belt-and-braces:
      // the subject's own item still carries the claim a reader would check.
      e.fix = e._qid
        ? { url: `https://www.wikidata.org/wiki/${e._qid}#P170`, label: 'Check or fix it on Wikidata' }
        : { url: `https://www.wikidata.org/wiki/${subject.qid}#P170`, label: 'Check or fix it on Wikidata' }
    }
    console.error(
      `  holder shelf: ${shelf.entries.length} of ${shelf.total} works by ${creatorLabel} (${holder.partner}), band ${owner}`,
    )
    return {
      entries: shelf.entries,
      shown: shelf.entries.length,
      total: shelf.total,
      truncated: Boolean(shelf.truncated),
      creatorLabel,
      owner,
      source: shelf.entries[0].source,
      museumName,
    }
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
    const forBand = (ledeLookup, restLookup) => (first ? ledeLookup : restLookup)
    const [iaPicks, ol, labels, scholarHits, statements, rights] = await Promise.all([
      unit.identified.length ? forBand(ledeIaPicksPromise, iaPickedPromise) : new Map(),
      unit.railCandidates.some((c) => c.isbn)
        ? forBand(ledeVolumesPromise, volumesPromise)
        : { volumes: new Map(), unchecked: new Set() },
      picked.length ? forBand(ledeLabelsPromise, labelsPromise) : new Map(),
      unit.scholarly.length ? scholarPickedPromise : new Map(),
      picked.length || first ? forBand(ledeStatementsPromise, statementsPromise) : new Map(),
      picked.length || first ? forBand(ledeRightsPromise, rightsPromise) : new Map(),
    ])
    const extras = unit.index === '0' ? await ledeExtrasPromise : null

    // Access verdicts land on EVERY rail candidate — the footnotes read them
    // off this band's own objects below — while the tally counts only this
    // band's first-on-the-page works, so the panel's sum names each distinct
    // work once (see countedOnPage in the units loop).
    applyAccess(unit.railCandidates, ol.volumes)
    // The page-wide holder, not the lede-only local above: every band's
    // access lookups sat out on a holder page, so every band's tally must
    // say so.
    const pageHolder = await holderPromise
    const holderRefusal = (await holderVerdictPromise)?.refusal ?? null
    const coverage = citationCoverage(unit.counted, ol.volumes, ol.unchecked, {
      // On a holder page no access lookup ran; the tally must say "not
      // checked", never let a negative stand.
      searched: !sitsOut(pageHolder),
    })
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
    // The holder's record of the work comes first on a holder page — the page's reason for existing.
    // Holder is available to all bands for dispatch-site gating (not just the lede card).
    const holder = pageHolder
    if (holder && unit.index === '0') {
      const holderCopy = holder.record.rights?.uri ? licenseView(ccFromUri(holder.record.rights.uri)) : null
      const descParts = [holder.record.creator, holder.record.date]
        .filter(Boolean)
      const holderEntry = {
        source: holder.partner,
        title: holder.record.title,
        description: descParts.length ? descParts.join(' · ') : null,
        imageUrl: holder.record.imageUrl,
        href: holder.record.href,
        standing: 'holder-work',
        attribution: {
          author: holderCopy ? `${holder.record.institution} · ${holderCopy.label}` : holder.record.institution,
          license: null,
        },
        rights: { copy: holderCopy },
        why: `${holder.record.institution}’s own record of this ${holder.medium} — Wikidata names it directly.`,
        trace: `Wikidata — the shared database behind Wikipedia’s infoboxes — records this ${holder.medium}’s ${PROP_NAME[holder.property] ?? holder.property}, and this is the record it points to.`,
        fix: {
          url: `https://www.wikidata.org/wiki/${holder.subjectQid}#${holder.property}`,
          label: 'Check or fix it on Wikidata',
        },
      }
      entries.push(holderEntry)
    }
    // The primary source first, where the subject IS a document — or wrote one.
    if (extras?.opinion) entries.push(extras.opinion)
    if (extras?.thesis) entries.push(extras.thesis)
    if (extras)
      entries.push(
        ...extras.works.entries,
        ...extras.scholarship.entries,
        ...extras.artworks.entries,
        ...extras.scans.entries,
      )
    // The holder-scoped shelf, on the one band the placement decision named.
    const holderShelf = await holderShelfPromise
    if (holderShelf && unit.index === holderShelf.owner) {
      entries.push(...holderShelf.entries)
    }
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
    // them — only two citations resolving to one scan still collapse. Which
    // books, and who shows them, was settled in the pick above.
    const iaPick = iaPicks.get?.(unit) ?? null
    for (const hit of dedupedIaEntries(iaPick?.cites ?? [], iaPick?.hits ?? new Map(), [])) {
      entries.push(hit)
      stats.ia++
    }

    // Citation anchors -> open-access scholarship (OpenAlex / arXiv). Papers
    // with no open copy get no card — and the coverage line says how many
    // were filtered, because a shelf that shows only the open ones must not
    // imply the section cited only open ones. Which three, and the tally the
    // panel prints, were both settled in `scholarPickedPromise`.
    const scholarPick = scholarHits.get?.(unit) ?? null
    for (const hit of scholarPick?.entries ?? []) {
      entries.push(hit)
      stats.scholar++
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
      // On a holder page the statement dispatch itself is filtered — a museum
      // holder keeps only its own property's lookup (an anchor carrying the
      // holder's id still cards), a manifest holder keeps none — so no
      // request goes to a third institution's host, not merely no card.
      let found = await statementEntries(qid, holderStatements(stmts, holder), { label, withMap: mapsLeft > 0, subject: isSubject })
      // The holder's record IS the subject's own card for this property, and
      // the hero already carries it — the subject's duplicate is dropped;
      // anchors carrying the property are untouched.
      if (isSubject && holder?.property) {
        found = found.filter((e) => e._via !== holder.property)
      }
      found = found.slice(0, statementsLeft)
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
    // The holder shelf’s claim rides the band that shows it. The count is
    // Wikidata’s and links nowhere (the museum-count badge rule).
    if (holderShelf && unit.index === holderShelf.owner) {
      samples.push({
        source: holderShelf.source,
        topic: `By ${holderShelf.creatorLabel}`,
        shown: holderShelf.shown,
        total: holderShelf.total,
        text:
          `A sample: ${holderShelf.shown} of ${holderShelf.total}${holderShelf.truncated ? '+' : ''} ` +
          `work${holderShelf.total === 1 ? '' : 's'} by ${holderShelf.creatorLabel} ` +
          `that Wikidata records ${holderShelf.museumName} as holding`,
      })
    }
    // Anchors whose holdings are too broad to sample: shown as one sentence
    // and a browse link instead of four arbitrary cards. See src/breadth.js.
    const broad = []
    // The corroboration topic space: every LC-bearing anchor this band's maps
    // know, with its label. Deterministic per band — the lede's maps are the
    // lede-only halves, so its space is smaller, which only ever withholds.
    // The subject QID comes from the qid map rather than `extras` because
    // every band needs it (extras is lede-only): the subject is the one
    // anchor that corroborates even as a place.
    const subjectQid = (await qidsPromise).get(normalizedPage)
    const lookupCtx = { unit, extras, statementQids, statements, labels, entries, stats, samples, broad, topic: topicSpace(statements, labels, { subjectQid }), holder }
    await bandPropertyLookup(lookupCtx, DPLA_LOOKUP)
    // Runs after DPLA. Both lookup on P244, but they no longer share a
    // request: DPLA HEADs for the authorized heading, this GETs the record
    // for its variant forms (src/lc.js says why) — two id.loc.gov URLs, each
    // once ever per identifier given the durable cache. Folding DPLA's HEAD
    // into the GET would save one request per anchor and is noted in the
    // DigitalNZ section of CLAUDE.md as a follow-up, not done here because it
    // touches the DPLA lookup's hot path.
    await bandPropertyLookup(lookupCtx, DIGITALNZ_LOOKUP)
    await bandPropertyLookup(lookupCtx, EUROPEANA_LOOKUP)

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
    let refusalShown = null
    if (extras?.subjectQid) {
      const rec = rights.get(extras.subjectQid)
      // Which route Paulina should take is decided by what the graph holds:
      // P6216 is a property of works, P7763 of the people who make them.
      const kind = rec?.work?.length ? 'work' : 'author'
      const view = rightsView(rec, { qid: extras.subjectQid, kind, label: unit.title })
      // A view with neither marks nor a sentence is nothing to show. That
      // happens when the only statement is "not yet determined", which is a
      // real answer about the state of the graph and not an answer about the
      // work — see the status vocabulary in src/rights.js. The some() guard
      // is the says-it-twice rule: a lede card that IS the subject already
      // carries this claim.
      if (view && (view.marks.length || view.line) && !entries.some((e) => e.rights?.work))
        subjectRights = view
      // The museum's side of a rights disagreement travels only where the
      // graph states a free answer ABOUT THE WORK — gate and words from the
      // same work-level statements (workFreeStatus), so the page can never
      // quote a creator ruling or a copy's license as the work's status. A
      // refusal everyone agrees with (a Picasso) stays a plain refusal, and
      // a creator-only or license-only free answer is withheld the way the
      // unknown branch withholds: a one-sided or mis-attributed line is
      // worse than silence.
      const workFree = holderRefusal ? workFreeStatus(rec) : null
      if (workFree)
        refusalShown = { ...holderRefusal, statusLine: workFree.line, mixed: workFree.mixed }
    }

    if (extras?.works.entries.length)
      samples.push({
        source: 'openlibrary',
        topic: `By ${page}`,
        shown: extras.works.entries.length,
        total: extras.works.total,
        url: extras.works.browse ?? null,
        text:
          `A sample: ${extras.works.entries.length} of ${extras.works.total} ` +
          `book${extras.works.total === 1 ? '' : 's'} Open Library files under ${unit.title}`,
      })
    // No `url` here, and the omission is a decision (2026-08-10). The badge's
    // number is a claim, so its link has to land on a page that makes the SAME
    // claim — that is the whole test `authorBrowseUrl` was written against.
    // OpenAlex's own site is a React app whose filter URLs this project has
    // not verified answer to a plain reader, and this denominator is the
    // subtler one anyway: it counts papers filed under an ORCID, of which the
    // shelf shows only the open ones. A link that quietly shows all of them
    // would sell the paywalled ones as part of the find.
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
    // One note per MUSEUM, not one for the whole artworks lookup: the renderer
    // groups shelves by (source, topic), so these cards arrive as a Met shelf
    // beside a Rijksmuseum shelf, and a single note counting all of them would
    // be the free-floating claim this page keeps deleting. Each museum's note
    // counts that museum's own holdings.
    //
    // No `url` on these either, for a harder reason than OpenAlex's: this total
    // is WIKIDATA's count of works by the subject that the graph records this
    // museum as holding, and no museum publishes a browse for that question.
    // Its own collection search would answer a different one and return a
    // different number — the Rijksmuseum-404 rule (a href is verified, never
    // constructed) applied to a count rather than an id. A WDQS permalink is
    // technically available and is not a browse a reader wants.
    for (const [key, count] of Object.entries(extras?.artworks.totals ?? {})) {
      if (key === 'works' || !count) continue
      const source = key === 'aic' ? 'artic' : key
      const shown = extras.artworks.entries.filter((e) => e.source === source).length
      if (!shown) continue
      const museumName = MUSEUM_NAME[source] ?? 'this collection'
      samples.push({
        source,
        topic: `By ${page}`,
        shown,
        total: count,
        text:
          `A sample: ${shown} of ${count} work${count === 1 ? '' : 's'} by ${unit.title} ` +
          `that Wikidata records ${museumName} as holding`,
      })
    }

    // The scan shelf's own count, on the shelf head where the cards are. `total`
    // is what the request actually confirmed as this species AND scanned, so
    // the number is one that was checked rather than one the API asserted; when
    // the search window was full it reads "at least", because the rest was
    // never seen. No `url`, for the artworks reason above — the Smithsonian
    // publishes no browse that answers this question with this number.
    if (extras?.scans.entries.length) {
      const total = extras.scans.total
      samples.push({
        source: 'smithsonian',
        topic: 'Scanned in 3D',
        shown: extras.scans.entries.length,
        total,
        text:
          `A sample: ${extras.scans.entries.length} of ${extras.scans.truncated ? 'at least ' : ''}` +
          `${total} specimen${total === 1 ? '' : 's'} of ${unit.title} the Smithsonian has ` +
          `scanned in 3D and released as CC0`,
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
      papers: scholarPick?.papers ?? { total: 0, open: 0 },
      samples,
      broad,
      // Null on every band but the lede, and on a lede whose cards already
      // carry the claim. `bandParts` renders nothing for a null.
      subjectRights,
      // Also lede-only: the article's own infobox, `bandParts`' fallback for
      // a rail no subject-standing find claimed. Null elsewhere on purpose —
      // only the lede band may trip the gate.
      infobox: unit.index === '0' ? infobox : null,
      // Lede-only holder context (null elsewhere): the streamed band renderer
      // reads it off the band, because a band reaches serve.js through the
      // emit callback before discover() has resolved a holder to thread. The
      // page-wide pageHolder above gates the DISPATCHES on every band; the
      // band itself carries holder FURNITURE only on the lede.
      holder: unit.index === '0' ? pageHolder : null,
      // Lede-only like the holder itself: a museum-lane candidate the gate
      // refused on rights, where the graph's work-level answer disagrees
      // with the flag. Null on any other leg, and null when the graph
      // agrees with the museum. (unit.index === '0' and the renderer's
      // b.id === 'slede' name the same band — the lede's id is 'slede' by
      // construction — so the two guards are one predicate, failing closed
      // if they ever diverged.)
      holderRefusal: unit.index === '0' ? refusalShown : null,
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
    holder: await holderPromise,
  }
}
