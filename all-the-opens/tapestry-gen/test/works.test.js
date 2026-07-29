import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authorWorkEntries } from '../src/works.js'

const response = {
  size: 10,
  entries: [
    { title: 'Abriss der Lehre von der Flüssigkeits- und Gasbewegung', covers: [-1] },
    { title: 'Ergebnisse der Aerodynamischen Versuchsanstalt zu Göttingen', covers: [9583973] },
    { title: 'Applied Hydro- and Aeromechanics' },
    { title: 'Führer durch die Strömungslehre', covers: [8651818], first_publish_date: '1942' },
  ],
}

test('a work becomes an entry the renderer can place', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const guide = entries.find((e) => e.title === 'Führer durch die Strömungslehre')
  assert.equal(guide.source, 'openlibrary')
  assert.equal(guide.imageUrl, 'https://covers.openlibrary.org/b/id/8651818-M.jpg')
  assert.match(guide.description, /1942/)
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

test('OpenLibrary writes "no cover" as -1, which is not a cover id', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const abriss = entries.find((e) => e.title.startsWith('Abriss'))
  assert.equal(abriss.imageUrl, null)
})

test('the cap limits what is shown but the total still counts what is held', () => {
  const { entries, total } = authorWorkEntries(response, { cap: 2 })
  assert.equal(entries.length, 2)
  assert.equal(total, 10)
})

test('the total falls back to the number of entries when the response omits it', () => {
  const { total } = authorWorkEntries({ entries: [{ title: 'A' }, { title: 'B' }] }, { cap: 5 })
  assert.equal(total, 2)
})

test('an author with no works yields nothing rather than an empty shelf', () => {
  assert.deepEqual(authorWorkEntries({ entries: [] }, { cap: 5 }).entries, [])
  assert.deepEqual(authorWorkEntries(undefined, { cap: 5 }).entries, [])
})

test('a work with no title is dropped — an untitled card says nothing', () => {
  const { entries } = authorWorkEntries({ entries: [{ covers: [1] }, { title: 'Real' }] }, { cap: 5 })
  assert.deepEqual(
    entries.map((e) => e.title),
    ['Real'],
  )
})

test('every entry declares the claim that found it', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  assert.ok(entries.every((e) => e._via === 'P648'))
})
