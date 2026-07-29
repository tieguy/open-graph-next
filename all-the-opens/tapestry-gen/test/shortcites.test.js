import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bibliographyIdentifiers, resolveShortCites, shortCitePointers } from '../src/citations.js'

// --- shortCitePointers ------------------------------------------------------

test('an sfn pointer yields its surname and year', () => {
  const p = shortCitePointers('The module fired.{{sfn|Chaikin|1994|p=138}}')
  assert.deepEqual(p, [{ surnames: ['chaikin'], year: '1994', key: 'chaikin|1994' }])
})

test('an sfn with two authors keys on the first surname but keeps both', () => {
  const p = shortCitePointers('{{sfn|Brooks|Grimwood|1979|pp=12-14}}')
  assert.equal(p.length, 1)
  assert.deepEqual(p[0].surnames, ['brooks', 'grimwood'])
  assert.equal(p[0].year, '1979')
  assert.equal(p[0].key, 'brooks|1979')
})

test('a disambiguated year keeps its letter suffix', () => {
  // Two works by one author in one year are distinguished by 1969a / 1969b;
  // dropping the letter would merge two different books.
  const p = shortCitePointers('{{sfn|NASA|1969a|p=3}}')
  assert.equal(p[0].year, '1969a')
  assert.equal(p[0].key, 'nasa|1969a')
})

test('a harvnb inside a ref is a pointer too', () => {
  const p = shortCitePointers('<ref>{{harvnb|Cortright|1975|p=9}}</ref>')
  assert.deepEqual(p[0].surnames, ['cortright'])
  assert.equal(p[0].year, '1975')
})

test('an sfn with no year is not a pointer', () => {
  assert.deepEqual(shortCitePointers('{{sfn|Chaikin}}'), [])
})

test('pointers come back in document order, repeats included', () => {
  const p = shortCitePointers('a{{sfn|B|1979|p=1}} b{{sfn|A|1994}} c{{sfn|B|1979|p=9}}')
  assert.deepEqual(
    p.map((x) => x.key),
    ['b|1979', 'a|1994', 'b|1979'],
  )
})

test('prose with no short citations yields nothing', () => {
  assert.deepEqual(shortCitePointers('Plain prose.<ref>{{cite web|url=https://x.test}}</ref>'), [])
  assert.deepEqual(shortCitePointers(undefined), [])
})

// --- bibliographyIdentifiers ------------------------------------------------

const SOURCES = `
== Sources ==
* {{cite book |last=Chaikin |first=Andrew |title=A Man on the Moon |year=1994 |isbn=0-670-81446-6}}
* {{cite book |last1=Brooks |first1=Courtney |last2=Grimwood |title=Chariots for Apollo |date=July 1979 |oclc=4664449}}
* {{cite book |last=Cortright |title=Apollo Expeditions to the Moon |year=1975 |lccn=75-600071}}
`

test('a bibliography entry is keyed on surname and year', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  const entry = bib.get('chaikin|1994')
  assert.equal(entry.title, 'A Man on the Moon')
  assert.equal(entry.isbn, '0670814466')
  assert.equal(entry.oclc, null)
})

test('a year is taken from date when there is no year param', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  assert.equal(bib.get('brooks|1979').oclc, '4664449')
})

test('an lccn entry resolves like the others', () => {
  assert.equal(bibliographyIdentifiers(SOURCES).get('cortright|1975').lccn, '75-600071')
})

test('a bibliography entry carries the publisher the rail displays', () => {
  const bib = bibliographyIdentifiers(
    '* {{cite book |last=Chaikin |title=A Man on the Moon |year=1994 |isbn=0-670-81446-6 |publisher=[[Viking Press|Viking]]}}',
  )
  assert.equal(bib.get('chaikin|1994').publisher, 'Viking')
})

test('a bibliography entry with no publisher says so rather than inventing one', () => {
  const bib = bibliographyIdentifiers('* {{cite book |last=X |title=T |year=2000 |isbn=0670814466}}')
  assert.equal(bib.get('x|2000').publisher, null)
})

test('a bibliography entry with no identifier at all is not registered', () => {
  const bib = bibliographyIdentifiers('* {{cite book |last=Nobody |title=Untraceable |year=1900}}')
  assert.equal(bib.size, 0)
})

test('a malformed isbn is dropped rather than passed to a lookup', () => {
  // 9 digits is neither ISBN-10 nor ISBN-13; searching it finds nothing.
  const bib = bibliographyIdentifiers('* {{cite book |last=X |title=T |year=2000 |isbn=123456789}}')
  assert.equal(bib.size, 0)
})

test('a bibliography carries no pointers of its own', () => {
  assert.deepEqual(shortCitePointers(SOURCES), [])
})

// --- the join ---------------------------------------------------------------

test('a section resolves its short citations through the bibliography', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  const got = resolveShortCites('The crew trained.{{sfn|Chaikin|1994|p=138}}', bib)
  assert.equal(got.length, 1)
  assert.equal(got[0].title, 'A Man on the Moon')
  assert.equal(got[0].isbn, '0670814466')
})

test('a multi-author pointer resolves against a multi-author entry', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  const got = resolveShortCites('{{sfn|Brooks|Grimwood|1979|p=12}}', bib)
  assert.equal(got[0].oclc, '4664449')
})

test('an sfn whose target is missing from the bibliography resolves to nothing', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  assert.deepEqual(resolveShortCites('{{sfn|Aldrin|1973|p=4}}', bib), [])
})

test('a work cited many times in a section is offered once', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  const got = resolveShortCites('{{sfn|Chaikin|1994|p=1}} x {{sfn|Chaikin|1994|p=9}}', bib)
  assert.equal(got.length, 1)
})

test('resolved works keep the order the section cites them in', () => {
  const bib = bibliographyIdentifiers(SOURCES)
  const got = resolveShortCites('{{sfn|Cortright|1975}} {{sfn|Chaikin|1994}}', bib)
  assert.deepEqual(
    got.map((c) => c.lccn ?? c.isbn),
    ['75-600071', '0670814466'],
  )
})

test('an empty bibliography resolves nothing without throwing', () => {
  assert.deepEqual(resolveShortCites('{{sfn|Chaikin|1994}}', new Map()), [])
})
