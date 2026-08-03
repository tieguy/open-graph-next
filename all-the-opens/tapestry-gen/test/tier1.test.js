import test from 'node:test'
import assert from 'node:assert/strict'

import { enqueue } from '../src/mw.js'
import { sectionOutline, sliceSectionHtml, sliceSectionWikitext } from '../src/wikipedia.js'
import { chunk, dedupedIaEntries, iaSearchUrl, matchIaDoc, olBooksUrl } from '../src/batch.js'

// ---- per-host queue ---------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('same-host tasks run strictly one at a time, in order', async () => {
  const events = []
  const task = (name, ms) => async () => {
    events.push(`start ${name}`)
    await sleep(ms)
    events.push(`end ${name}`)
  }
  await Promise.all([
    enqueue('a.example', task('one', 20)),
    enqueue('a.example', task('two', 5)),
    enqueue('a.example', task('three', 5)),
  ])
  assert.deepEqual(events, ['start one', 'end one', 'start two', 'end two', 'start three', 'end three'])
})

test('different hosts run concurrently', async () => {
  const events = []
  await Promise.all([
    enqueue('b.example', async () => {
      events.push('slow start')
      await sleep(30)
      events.push('slow end')
    }),
    enqueue('c.example', async () => {
      events.push('fast')
    }),
  ])
  // The fast host finished while the slow host was still holding its own queue.
  assert.deepEqual(events, ['slow start', 'fast', 'slow end'])
})

test('a rejection reaches its caller without poisoning the queue', async () => {
  const results = await Promise.allSettled([
    enqueue('d.example', async () => {
      throw new Error('boom')
    }),
    enqueue('d.example', async () => 'fine'),
  ])
  assert.equal(results[0].status, 'rejected')
  assert.equal(results[1].status, 'fulfilled')
  assert.equal(results[1].value, 'fine')
})

// ---- whole-article splitting ------------------------------------------------

// A miniature article whose lede contains a multi-byte character: despite its
// name, `byteoffset` is a string index, so slicing must NOT count UTF-8 bytes —
// the marker offsets here are string indices, as the API's are.
const WIKITEXT = "Prandtl's café.\n== One ==\nAlpha.\n=== One point five ===\nBeta.\n== Two ==\nGamma.\n"
const wtOffset = (marker) => WIKITEXT.indexOf(marker)
const SECTIONS = [
  { index: '1', toclevel: 1, number: '1', line: 'One', anchor: 'One', byteoffset: wtOffset('== One ==') },
  {
    index: '2',
    toclevel: 2,
    number: '1.1',
    line: 'One point five',
    anchor: 'One_point_five',
    byteoffset: wtOffset('=== One point five ==='),
  },
  { index: '3', toclevel: 1, number: '2', line: 'Two', anchor: 'Two', byteoffset: wtOffset('== Two ==') },
]

test('wikitext slices reproduce parse&section semantics, including subsections', () => {
  // The lede is trimmed of trailing blank lines like every other section.
  assert.equal(sliceSectionWikitext(WIKITEXT, SECTIONS, '0'), "Prandtl's café.")
  // A level-1 section runs to its next sibling, subsection included, and is
  // trimmed of trailing blank lines the way parse&section trims them.
  assert.equal(
    sliceSectionWikitext(WIKITEXT, SECTIONS, '1'),
    '== One ==\nAlpha.\n=== One point five ===\nBeta.',
  )
  // A leaf subsection runs to the next heading at its level or above.
  assert.equal(sliceSectionWikitext(WIKITEXT, SECTIONS, '2'), '=== One point five ===\nBeta.')
  // The last section runs to the end.
  assert.equal(sliceSectionWikitext(WIKITEXT, SECTIONS, '3'), '== Two ==\nGamma.')
})

test('a template-transcluded section (null byteoffset) slices to null, not to someone else’s text', () => {
  const withTemplate = [...SECTIONS, { index: 'T-1', toclevel: 1, line: 'Notes', anchor: 'Notes', byteoffset: null }]
  assert.equal(sliceSectionWikitext(WIKITEXT, withTemplate, 'T-1'), null)
  // And its presence does not truncate a real section's slice.
  assert.equal(sliceSectionWikitext(WIKITEXT, withTemplate, '3'), '== Two ==\nGamma.')
})

const HTML =
  '<div class="mw-parser-output"><p>Lede café.</p>' +
  '<div class="mw-heading mw-heading2"><h2 id="One">One</h2></div><p>Alpha.</p>' +
  '<div class="mw-heading mw-heading3"><h3 id="One_point_five">One point five</h3></div><p>Beta.</p>' +
  '<div class="mw-heading mw-heading2"><h2 id="Two">Two</h2></div><p>Gamma.</p></div>'

test('html slices follow the same include-subsections rule', () => {
  assert.match(sliceSectionHtml(HTML, SECTIONS, '0'), /Lede café/)
  assert.doesNotMatch(sliceSectionHtml(HTML, SECTIONS, '0'), /Alpha/)
  const one = sliceSectionHtml(HTML, SECTIONS, '1')
  assert.match(one, /Alpha/)
  assert.match(one, /Beta/) // the subsection travels with its parent
  assert.doesNotMatch(one, /Gamma/)
  const two = sliceSectionHtml(HTML, SECTIONS, '3')
  assert.match(two, /Gamma/)
  assert.doesNotMatch(two, /Beta/)
})

test('a section whose anchor is missing from the html yields null', () => {
  assert.equal(sliceSectionHtml('<p>no headings</p>', SECTIONS, '1'), null)
})

test('sectionOutline matches what fetchSections always produced', () => {
  const outline = sectionOutline([
    ...SECTIONS,
    { index: '4', toclevel: 3, number: '2.1.1', line: 'Deep', anchor: 'Deep', byteoffset: 99 },
  ])
  assert.deepEqual(
    outline.map((s) => [s.index, s.level, s.title, s.hasChildren]),
    [
      ['1', 1, 'One', true],
      ['2', 2, 'One point five', false],
      ['3', 1, 'Two', false],
    ],
  )
})

// ---- batched pivots ---------------------------------------------------------

test('chunk preserves order and covers everything', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 3), [])
})

test('iaSearchUrl constrains mediatype in the query and asks for the isbn field', () => {
  const url = iaSearchUrl(['111', '222'])
  assert.match(url, /isbn%3A111%20OR%20isbn%3A222/)
  assert.match(url, /mediatype%3Atexts/)
  assert.match(url, /fl%5B%5D=isbn/)
  assert.match(url, /rows=16/)
})

test('matchIaDoc requires a shared isbn AND title overlap', () => {
  const docs = [
    { identifier: 'pallet', title: 'Donation manifest 47', isbn: ['111', '999'] },
    { identifier: 'right', title: 'Carrying the Fire: An Astronaut Journey', isbn: ['111'] },
    { identifier: 'other', title: 'Carrying the Fire', isbn: ['333'] },
  ]
  const cite = { title: 'Carrying the Fire', isbn: '111' }
  // The unrelated-title doc shares the isbn but fails the overlap guard;
  // the same-title doc with a different isbn is never a candidate.
  assert.equal(matchIaDoc(cite, docs).identifier, 'right')
  assert.equal(matchIaDoc({ title: 'Unrelated Work Entirely', isbn: '999' }, docs), null)
  assert.equal(matchIaDoc({ title: 'Carrying the Fire', isbn: '444' }, docs), null)
})

test('olBooksUrl asks the fast batch endpoint for exactly the access fields', () => {
  const url = olBooksUrl(['111', '222'])
  assert.equal(url, 'https://openlibrary.org/api/books?bibkeys=ISBN:111,ISBN:222&format=json&jscmd=data')
})

test('an IA card yields when the rail already shows the same work', () => {
  const biel = { isbn: '111', title: 'American Gothic: A Life' }
  const dave = { isbn: '222', title: 'Geography of the Imagination' }
  const other = { isbn: '333', title: 'Unrelated Book' }
  const hit = (id) => ({ imageUrl: `https://archive.org/services/img/${id}` })
  const iaHits = new Map([
    [biel, hit('americangothicli00biel')],
    [dave, hit('geographyofimagi00dave')],
    [other, hit('unrelated00book')],
  ])
  const rail = [
    // Same work, linked by its scan URL (no isbn on the rail entry).
    { isbn: null, href: 'https://archive.org/details/americangothicli00biel' },
    // Same work by ISBN, even though the rail links a different edition's scan.
    { isbn: '222', href: 'https://archive.org/details/geographyofimagi00daverich' },
  ]
  const kept = dedupedIaEntries([biel, dave, other], iaHits, rail)
  assert.deepEqual(kept, [hit('unrelated00book')])
})

test('two citations resolving to one scan collapse to one card', () => {
  const a = { isbn: '111', title: 'Hardcover' }
  const b = { isbn: '999', title: 'Paperback' }
  const hit = { imageUrl: 'https://archive.org/services/img/samescan00' }
  const kept = dedupedIaEntries([a, b], new Map([[a, hit], [b, { ...hit }]]), [])
  assert.equal(kept.length, 1)
})
