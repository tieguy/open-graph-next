import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authorWorkEntries, authorWorksUrl, soleAuthor } from '../src/works.js'

// The live card that exposed this, verbatim from search.json on 2026-08-06:
// a 1991 scholarly catalogue filed under the painter it is ABOUT, with three
// living co-authors, and no scan for `ebook_access` to object with.
const catalogue = {
  key: '/works/OL18415197W',
  title: 'Rembrandt, the master & his workshop',
  ebook_access: 'no_ebook',
  first_publish_year: 1991,
  cover_i: 5051657,
  author_key: ['OL18362A', 'OL291682A', 'OL1305770A', 'OL681671A'],
}

test('a work the subject merely co-wrote does not inherit their expired copyright', () => {
  const [entry] = authorWorkEntries({ docs: [catalogue] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, false)
  // And nothing is asserted in its place: Open Library said `no_ebook`, which
  // is silence, not a statement about copyright.
  assert.equal(entry.access.copy, null)
})

test('the sole-author test is about WHO, not how many names are listed', () => {
  assert.equal(soleAuthor({ author_key: ['OL18362A'] }, 'OL18362A'), true)
  assert.equal(soleAuthor(catalogue, 'OL18362A'), false)
  // A translator is a co-author for this purpose, and deliberately so: an
  // English Kafka is a new work with its own living rights holder.
  assert.equal(soleAuthor({ author_key: ['OL33146A', 'OL7356871A'] }, 'OL33146A'), false)
  // Missing or empty author data must not be read as "somebody else helped".
  assert.equal(soleAuthor({}, 'OL18362A'), true)
  assert.equal(soleAuthor({ author_key: [] }, 'OL18362A'), true)
})

test('a lent co-authored book still says it is lent — copy describes the object', () => {
  const lent = { ...catalogue, ebook_access: 'borrowable' }
  const [entry] = authorWorkEntries({ docs: [lent] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, false)
  assert.equal(entry.access.copy.code, 'LENT')
})

test('a sole-authored public work still trusts the creator ruling', () => {
  const own = { key: '/works/OL9W', title: 'Drawings', ebook_access: 'public', author_key: ['OL18362A'] }
  const [entry] = authorWorkEntries({ docs: [own] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, true)
})

// The response shape is OpenLibrary's `search.json`, not `/authors/<id>/works.json`
// (changed 2026-08-06). Both see the same corpus; only search.json carries
// `ebook_access`, which is what tells a card that its edition is lent rather
// than free. See the module comment for what else moved with it.
const response = {
  numFound: 10,
  docs: [
    { key: '/works/OL1W', title: 'Abriss der Lehre von der Flüssigkeits- und Gasbewegung', ebook_access: 'public' },
    { key: '/works/OL2W', title: 'Ergebnisse der Aerodynamischen Versuchsanstalt zu Göttingen', cover_i: 9583973, ebook_access: 'public' },
    { key: '/works/OL3W', title: 'Applied Hydro- and Aeromechanics', ebook_access: 'borrowable' },
    { key: '/works/OL4W', title: 'Führer durch die Strömungslehre', cover_i: 8651818, first_publish_year: 1942, ebook_access: 'no_ebook' },
  ],
}

test('the query asks for the access field the rights code depends on', () => {
  const url = authorWorksUrl('OL33146A', 40)
  assert.match(url, /author_key=OL33146A/)
  assert.match(url, /ebook_access/)
  assert.match(url, /limit=40/)
  // An identifier pivot, never a name search: no disambiguation, no guessing
  // between people who share a name.
  assert.doesNotMatch(url, /[?&]q=/)
})

test('a work becomes an entry the renderer can place', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const guide = entries.find((e) => e.title === 'Führer durch die Strömungslehre')
  assert.equal(guide.source, 'openlibrary')
  assert.equal(guide.imageUrl, 'https://covers.openlibrary.org/b/id/8651818-M.jpg')
  assert.match(guide.description, /1942/)
  assert.equal(guide.href, 'https://openlibrary.org/works/OL4W')
})

test('works with a cover come first — a shelf of blank cards is not a shelf', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  assert.deepEqual(
    entries.slice(0, 2).map((e) => Boolean(e.imageUrl)),
    [true, true],
  )
})

test('a coverless work still appears, without a broken image', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const bare = entries.find((e) => e.title === 'Applied Hydro- and Aeromechanics')
  assert.equal(bare.imageUrl, null)
})

test('the cap limits what is shown but the total still counts what is held', () => {
  const { entries, total } = authorWorkEntries(response, { cap: 2 })
  assert.equal(entries.length, 2)
  assert.equal(total, 10)
})

test('the total falls back to the number of docs when the response omits it', () => {
  const { total } = authorWorkEntries({ docs: [{ title: 'A' }, { title: 'B' }] }, { cap: 5 })
  assert.equal(total, 2)
})

test('an author with no works yields nothing rather than an empty shelf', () => {
  assert.deepEqual(authorWorkEntries({ docs: [] }, { cap: 5 }).entries, [])
  assert.deepEqual(authorWorkEntries(undefined, { cap: 5 }).entries, [])
})

test('a work with no title is dropped — an untitled card says nothing', () => {
  const { entries } = authorWorkEntries({ docs: [{ cover_i: 1 }, { title: 'Real' }] }, { cap: 5 })
  assert.deepEqual(
    entries.map((e) => e.title),
    ['Real'],
  )
})

test('every entry declares the claim that found it', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  assert.ok(entries.every((e) => e._via === 'P648'))
})

test('each entry carries the access verdict that decides its rights', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const lent = entries.find((e) => e.title === 'Applied Hydro- and Aeromechanics')
  assert.equal(lent.access.trustsCreator, false)
  assert.match(lent.access.copy.label, /lent, not free/i)

  const free = entries.find((e) => e.title.startsWith('Ergebnisse'))
  assert.equal(free.access.trustsCreator, true)
  assert.equal(free.access.copy, null)

  // No scan is no evidence — it must not suppress what Copyclear knows.
  const undigitized = entries.find((e) => e.title === 'Führer durch die Strömungslehre')
  assert.equal(undigitized.access.trustsCreator, true)
})
