import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  citationCoverUrl,
  citationCoverage,
  citationHref,
  citationHeadline,
  pageCitations,
  openLibraryAccess,
  parseCitation,
  sectionCitations,
  templateParams,
} from '../src/citations.js'

// --- template params (depth-aware) ------------------------------------------

test('template params split on top-level pipes', () => {
  const p = templateParams('{{cite web |url=https://x.test/a |title=Foo |publisher=NASA}}')
  assert.equal(p.get('url'), 'https://x.test/a')
  assert.equal(p.get('title'), 'Foo')
  assert.equal(p.get('publisher'), 'NASA')
})

test('a pipe inside a wikilink does not split a param', () => {
  // [[Neil Armstrong|Armstrong]] contains a pipe that is not a param boundary.
  const p = templateParams('{{cite web|title=[[Neil Armstrong|Armstrong]] account|url=https://x.test}}')
  assert.equal(p.get('title'), '[[Neil Armstrong|Armstrong]] account')
  assert.equal(p.get('url'), 'https://x.test')
})

// --- parseCitation ----------------------------------------------------------

test('a cite web becomes a webpage-kind citation with url and title', () => {
  const c = parseCitation('{{cite web |url=https://nasa.gov/x |title=JFK Speech |publisher=NASA}}')
  assert.equal(c.kind, 'web')
  assert.equal(c.url, 'https://nasa.gov/x')
  assert.equal(c.title, 'JFK Speech')
  assert.equal(c.publisher, 'NASA')
  assert.equal(c.isbn, null)
})

test('a cite book carries its ISBN and author, markup stripped from the title', () => {
  const c = parseCitation('{{cite book |title=[[First Man (book)|First Man]] |isbn=978-0-7432-5751-0 |last=Hansen |first=James}}')
  assert.equal(c.kind, 'book')
  assert.equal(c.isbn, '9780743257510', 'ISBN normalized to digits')
  assert.equal(c.title, 'First Man', 'wiki markup stripped')
  assert.equal(c.author, 'James Hansen', 'byline uses the full stated name')
})

test('an archived citation exposes both the live and the archive url', () => {
  const c = parseCitation('{{cite web |url=https://dead.example/x |archive-url=https://web.archive.org/web/2015/https://dead.example/x |title=T}}')
  assert.equal(c.url, 'https://dead.example/x')
  assert.equal(c.archiveUrl, 'https://web.archive.org/web/2015/https://dead.example/x')
})

test('a cite journal carries its DOI', () => {
  const c = parseCitation('{{cite journal |doi=10.1126/science.1 |title=A study}}')
  assert.equal(c.kind, 'journal')
  assert.equal(c.doi, '10.1126/science.1')
})

// --- sectionCitations -------------------------------------------------------

test('citations are pulled from a section’s ref tags in order', () => {
  const wt =
    'Kennedy spoke.<ref>{{cite web |url=https://a.test |title=A}}</ref> ' +
    'The program grew.<ref name="b">{{cite book |title=B |isbn=1234567890}}</ref>'
  const cites = sectionCitations(wt)
  assert.equal(cites.length, 2)
  assert.equal(cites[0].title, 'A')
  assert.equal(cites[1].isbn, '1234567890')
})

test('a reused named ref with no body is not counted as a second citation', () => {
  // <ref name="b" /> reuses an earlier definition; it carries no payload.
  const wt =
    'First.<ref name="b">{{cite web |url=https://b.test |title=B}}</ref> ' +
    'Again.<ref name="b" />'
  const cites = sectionCitations(wt)
  assert.equal(cites.length, 1)
  assert.equal(cites[0].url, 'https://b.test')
})

test('a ref that is not a citation template is skipped', () => {
  const wt = 'Claim.<ref>Just a note, no template.</ref> Book.<ref>{{cite book|title=Real|isbn=9}}</ref>'
  const cites = sectionCitations(wt)
  assert.equal(cites.length, 1)
  assert.equal(cites[0].title, 'Real')
})

// --- resolving a citation to something linkable / shown ---------------------

test('a citation href prefers the stated URL, then the DOI, then the archive', () => {
  // The archive used to be primary; now it renders as its own dated link, so
  // the primary link says what the citation says.
  assert.equal(
    citationHref({ archiveUrl: 'https://web.archive.org/x', url: 'https://x.test', doi: '10.1/y' }),
    'https://x.test',
  )
  assert.equal(citationHref({ doi: '10.1126/science.1', archiveUrl: 'https://web.archive.org/x' }), 'https://doi.org/10.1126/science.1')
  assert.equal(citationHref({ archiveUrl: 'https://web.archive.org/x' }), 'https://web.archive.org/x')
  assert.equal(citationHref({}), null)
})

test('a book citation with an ISBN yields an OpenLibrary cover url', () => {
  assert.equal(
    citationCoverUrl({ isbn: '9780743257510' }),
    'https://covers.openlibrary.org/b/isbn/9780743257510-M.jpg',
  )
  assert.equal(citationCoverUrl({ isbn: null }), null)
})

// --- OpenLibrary access (a book you can actually read/borrow) ----------------

const olVolume = (ebook, url = 'http://openlibrary.org/books/OL1M/A_Book') => ({
  records: { '/books/OL1M': { data: { url, ...(ebook ? { ebooks: [ebook] } : {}) } } },
})

test('a borrowable scan links to the Internet Archive copy', () => {
  const a = openLibraryAccess(
    olVolume({ availability: 'borrow', preview_url: 'https://archive.org/details/apolloracetomoon0000murr' }),
  )
  assert.equal(a.availability, 'borrow')
  assert.equal(a.url, 'https://archive.org/details/apolloracetomoon0000murr')
  assert.match(a.label, /Borrow/)
})

test('a fully readable scan links to reading it free', () => {
  const a = openLibraryAccess(
    olVolume({ availability: 'full', read_url: 'https://archive.org/stream/x', preview_url: 'https://archive.org/details/x' }),
  )
  assert.equal(a.availability, 'full')
  assert.equal(a.url, 'https://archive.org/stream/x')
  assert.match(a.label, /Read/)
})

test('a book OpenLibrary catalogs but has no scan links to the OpenLibrary page, over https', () => {
  const a = openLibraryAccess(olVolume(null))
  assert.equal(a.availability, 'catalog')
  assert.equal(a.url, 'https://openlibrary.org/books/OL1M/A_Book')
  assert.match(a.label, /Open Library/)
})

test('a book OpenLibrary does not have yields no access', () => {
  assert.equal(openLibraryAccess({ records: {} }), null)
  assert.equal(openLibraryAccess(undefined), null)
})

test('citation bylines: numbered authors, first/last pairs, et al past three', () => {
  const one = parseCitation('{{cite web |title=T |last=Doe |first=Jane |date=May 12, 2023 |url=https://x.test}}')
  assert.equal(one.author, 'Jane Doe')
  assert.equal(one.date, 'May 12, 2023')
  const three = parseCitation(
    '{{cite book |title=T |last1=A |first1=X |last2=B |last3=C |year=1998}}',
  )
  assert.equal(three.author, 'X A, B & C')
  const crowd = parseCitation(
    '{{cite journal |title=T |last1=A |last2=B |last3=C |last4=D}}',
  )
  assert.equal(crowd.author, 'A, B, C et al.')
  assert.equal(parseCitation('{{cite web |title=T |url=https://x.test}}').author, null)
})

test('the archived copy travels with its date, and the live URL is primary again', () => {
  const c = parseCitation(
    '{{cite web |title=T |url=https://live.test/a |archive-url=https://web.archive.org/web/2023/https://live.test/a |archive-date=12 May 2023}}',
  )
  assert.equal(c.archiveDate, '12 May 2023')
  assert.equal(citationHref(c), 'https://live.test/a')
  // With no live URL, the archive is still the best door.
  const dead = parseCitation(
    '{{cite web |title=T |archive-url=https://web.archive.org/web/2023/x}}',
  )
  assert.equal(citationHref(dead), 'https://web.archive.org/web/2023/x')
})

// --- coverage functions (unchecked bucket) ----------------------------------

test('citationCoverage buckets unchecked ISBNs instead of calling them closed', () => {
  const candidates = [
    { isbn: '111', url: 'https://x' }, // volumes hit, full scan
    { isbn: '222', url: 'https://x' }, // unchecked: OL batch failed
    { isbn: '333' },                   // unchecked, no links either
    { url: 'https://y' },              // no isbn: plain linked citation
    {},                                // no isbn, no links: unreached
  ]
  const volumes = new Map([
    ['111', { records: { 'ISBN:111': { data: { ebooks: [{ availability: 'full', preview_url: 'https://archive.org/details/x' }] } } } }],
  ])
  const cov = citationCoverage(candidates, volumes, new Set(['222', '333']))
  assert.equal(cov.total, 5)
  assert.equal(cov.open, 1)
  assert.equal(cov.unchecked, 2)
  assert.equal(cov.linked, 1) // only the no-isbn linked cite; 222 must NOT land here
  assert.equal(cov.cataloged, 0)
})

test('pageCitations sums the per-band tallies the bands now carry', () => {
  const bands = [
    { citations: { total: 10, open: 2, cataloged: 1, linked: 6, unchecked: 1 }, papers: { total: 3, open: 1 } },
    { citations: { total: 5, open: 0, cataloged: 2, linked: 3, unchecked: 0 }, papers: { total: 2, open: 2 } },
    {}, // a band that cited nothing must not break the sum
  ]
  assert.deepEqual(pageCitations(bands), {
    total: 15, open: 2, cataloged: 3, linked: 9, unchecked: 1, papers: { total: 5, open: 3 },
  })
})

test('citationHeadline says the unchecked bucket and never claims nothing exists', () => {
  const text = citationHeadline({ total: 15, open: 2, cataloged: 3, unchecked: 1, papers: { total: 5, open: 3 } })
  assert.match(text, /The original Wikipedia article cites 15 works\./)
  assert.match(text, /Two of them you can read or borrow right now\./)
  assert.match(text, /cataloged three more that nobody has scanned/)
  // "We could not look" must never be left reading as "there is nothing there".
  assert.match(text, /One we could not check this time\./)
  assert.match(text, /three are free to read/)
})

test('citationHeadline reports a search that found nothing as a search, not a fact', () => {
  const text = citationHeadline({ total: 620, open: 0, cataloged: 0, papers: { total: 0, open: 0 } })
  assert.match(text, /We could not find a free copy of any of them\./)
  assert.doesNotMatch(text, /no free copy exists/i)
  // Thousands separators, because 620 works is a number a reader reads.
  assert.match(citationHeadline({ total: 1620, open: 0 }), /cites 1,620 works/)
})

test('citationHeadline says nothing at all when the article cites nothing', () => {
  assert.equal(citationHeadline({ total: 0 }), null)
  assert.equal(citationHeadline(), null)
})
