import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bandRail, buildHtml, rightsMarks, streamOpen } from '../src/emit-html.js'
import { CC_MARKS, CC_SPRITE } from '../src/cc-icons.js'
import { parseRightsRows, rightsView } from '../src/rights.js'

// How the rights marks and lines actually reach the page. The module tests in
// rights.test.js cover what is TRUE; these cover what is SHOWN.

const uri = (q) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` })
const lit = (v) => ({ type: 'literal', value: v })

const entry = (over = {}) => ({
  source: 'artic',
  title: 'A thing',
  attribution: { author: 'Art Institute of Chicago', license: null },
  ...over,
})

const bandOf = (over = {}) => ({ id: 'slede', title: 'Lede', blocks: [{ kind: 'p', html: '<p>x</p>' }], entries: [], ...over })

// --------------------------------------------------------------- the glyphs

test('every mark the sprite defines renders, and one it does not is dropped', () => {
  const html = rightsMarks(['cc', 'by'], 'CC BY')
  assert.match(html, /href="#cc-cc"/)
  assert.match(html, /href="#cc-by"/)
  // An unknown mark would render an empty box, and an empty box beside a
  // credit reads as "there is a license here" while saying nothing.
  assert.equal(rightsMarks(['not-a-mark'], 'x'), '')
  assert.equal(rightsMarks([], 'x'), '')
  assert.equal(rightsMarks(null, null), '')
})

test('the glyph row carries its words for a screen reader', () => {
  const html = rightsMarks(['cc', 'by', 'sa'], 'CC BY-SA')
  assert.match(html, /<span class="vh">CC BY-SA<\/span>/)
  assert.match(html, /title="CC BY-SA"/)
  // aria-hidden on the icons, so the row is announced once by its text and
  // not four times by unlabeled graphics.
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 3)
})

test('the sprite defines a symbol for every mark rights.js can emit', () => {
  // The two vocabularies are written in different files and would drift
  // silently: a mark with no symbol is an invisible card decoration.
  for (const m of ['cc', 'by', 'sa', 'nc', 'nd', 'zero', 'pd', 'copyright']) {
    assert.ok(CC_MARKS.includes(m), `sprite is missing ${m}`)
    assert.match(CC_SPRITE, new RegExp(`id="cc-${m}"`))
  }
})

// ----------------------------------------------------------------- the card

test('a copy license puts its glyphs in front of the credit it illustrates', () => {
  const html = bandRail(
    bandOf({
      entries: [
        entry({
          imageUrl: 'https://example.org/a.jpg',
          rights: { copy: { marks: ['cc', 'zero'], label: 'CC0', code: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } },
        }),
      ],
    }),
  )
  assert.match(html, /<p class="credit"><span class="ccrow"/)
  assert.match(html, /href="#cc-zero"/)
  // The words stay. The glyph row is a summary a reader has to know how to
  // read, and the credit line is what teaches them.
  assert.match(html, /Art Institute of Chicago/)
})

test('a card with no rights at all renders exactly what it did before', () => {
  const html = bandRail(bandOf({ entries: [entry({ imageUrl: 'https://example.org/a.jpg' })] }))
  assert.doesNotMatch(html, /ccrow/)
  assert.doesNotMatch(html, /rights-line/)
  assert.match(html, /<p class="credit">Art Institute of Chicago<\/p>/)
})

test('the rights line appears only when the answer is qualified or disputed', () => {
  const disputed = rightsView(
    parseRightsRows([
      { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States') },
      { item: uri('Q1'), cs: uri('Q50423863'), csLabel: lit('copyrighted'), juris: uri('Q183'), jurisLabel: lit('Germany') },
    ]).get('Q1'),
    { qid: 'Q1' },
  )
  const html = bandRail(
    bandOf({ entries: [entry({ imageUrl: 'https://example.org/a.jpg', rights: { work: disputed } })] }),
  )
  assert.match(html, /<p class="rights-line">public domain in the United States/)
  assert.match(html, /still in copyright in Germany/)

  const bare = rightsView(
    parseRightsRows([{ item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain') }]).get('Q1'),
    { qid: 'Q1' },
  )
  const plain = bandRail(
    bandOf({ entries: [entry({ imageUrl: 'https://example.org/a.jpg', rights: { work: bare } })] }),
  )
  assert.doesNotMatch(plain, /rights-line/, 'nothing to narrow, so no line')
  assert.match(plain, /href="#cc-pd"/, 'the mark still shows')
})

test('the fold carries the determination method, the maintainers, and Paulina', () => {
  const view = rightsView(
    parseRightsRows([
      { item: uri('Q464782'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States'), how: uri('Q1'), howLabel: lit('copyright not renewed') },
    ]).get('Q464782'),
    { qid: 'Q464782' },
  )
  const html = bandRail(
    bandOf({ entries: [entry({ imageUrl: 'https://example.org/a.jpg', rights: { work: view } })] }),
  )
  // The reason, which is the part that shows the working rather than asserting
  // a verdict.
  assert.match(html, /determined by: copyright not renewed/)
  assert.match(html, /Wikidata:CopyClear/)
  assert.match(html, /Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina/)
  assert.match(html, /paulina\.toolforge\.org\/work\/Q464782/)
})

test('a card whose only extra is rights still opens a fold to hold it', () => {
  // Before this, a card with no `trace` returned early and the rights working
  // had nowhere to go.
  const view = rightsView(
    parseRightsRows([
      { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), how: uri('Q2'), howLabel: lit('copyright not renewed') },
    ]).get('Q1'),
    { qid: 'Q1' },
  )
  const html = bandRail(
    bandOf({
      entries: [entry({ imageUrl: 'https://example.org/a.jpg', rights: { work: view }, trace: undefined })],
    }),
  )
  assert.match(html, /<details class="prov">/)
  assert.match(html, /determined by: copyright not renewed/)
})

// -------------------------------------------------------- the subject's own

const subjectView = () =>
  rightsView(
    parseRightsRows([
      { item: uri('Q214371'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States'), how: uri('Q1'), howLabel: lit('published more than 95 years ago') },
      { item: uri('Q214371'), cs: uri('Q50423863'), csLabel: lit('copyrighted'), juris: uri('Q183'), jurisLabel: lit('Germany') },
    ]).get('Q214371'),
    { qid: 'Q214371' },
  )

test('the article’s own status renders above the prose, not inside the float', () => {
  const html = bandRail(bandOf({ subjectRights: subjectView() }))
  assert.match(html, /<div class="subject-rights">/)
  assert.match(html, /public domain in the United States/)
  assert.match(html, /paulina\.toolforge\.org\/work\/Q214371/)
  // It must not be inside the floated aside: a float would make a statement
  // about the whole subject read as a caption for whatever wrapped it.
  assert.doesNotMatch(html, /<aside class="rail">[\s\S]*subject-rights/)
})

test('the streaming mount puts the subject status before the prose', () => {
  // The stream mounts by class: anything not recognized is appended AFTER the
  // prose, which would put the article's copyright status at the foot of its
  // own lede.
  const shell = streamOpen({ title: 'T', units: [{ index: '0', title: 'T', blocks: [] }] })
  assert.match(shell, /classList\.contains\("subject-rights"\)/)
  assert.match(shell, /bb\.insertBefore\(e,pr\)/)
})

test('the sprite ships once per document, in both renderers, before any use', () => {
  const band = bandOf({ entries: [entry({ imageUrl: 'https://x/a.jpg', rights: { copy: { marks: ['cc', 'by'], label: 'CC BY' } } })] })
  const page = buildHtml({ title: 'T', bands: [band] })
  assert.equal((page.match(/class="cc-sprite"/g) ?? []).length, 1)
  // A <use> resolves against the document; a symbol defined after it still
  // works in every current browser, but only because the reference is re-run
  // on parse completion. Ordering it up front removes the question.
  assert.ok(page.indexOf('cc-sprite') < page.indexOf('href="#cc-by"'))

  const shell = streamOpen({ title: 'T', units: [{ index: '0', title: 'T', blocks: [] }] })
  assert.equal((shell.match(/class="cc-sprite"/g) ?? []).length, 1)
})

// -------------------------------------------- partner audit follow-ups

test('a IIIF manifest states its own terms, in either spec version', async () => {
  const { iiifEntryFrom } = await import('../src/iiif.js')
  // Presentation 3.0 — what SMK and Yale actually answered when sampled.
  const v3 = iiifEntryFrom(
    { label: { en: ['A drawing'] }, rights: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    'https://example.org/m',
  )
  assert.equal(v3.rights.copy.code, 'CC0')
  // Presentation 2.1 called it `license`.
  const v2 = iiifEntryFrom(
    { label: 'A drawing', license: 'https://creativecommons.org/publicdomain/mark/1.0/' },
    'https://example.org/m',
  )
  assert.equal(v2.rights.copy.code, 'PDM')
  // 2.1 was loose about the value, so an unrecognized one yields nothing.
  const junk = iiifEntryFrom(
    { label: 'A drawing', license: 'See our terms and conditions page' },
    'https://example.org/m',
  )
  assert.equal(junk.rights.copy, null)
})
