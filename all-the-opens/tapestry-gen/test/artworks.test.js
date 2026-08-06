import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  artworkRows,
  artworkTotals,
  needsArtworksQuery,
  pickDiverse,
  subjectArtworksUrl,
} from '../src/artworks.js'

const instanceOf = (...qids) => ({
  P31: qids.map((id) => ({ mainsnak: { datavalue: { value: { id } } } })),
})

test('only a person is asked what they made — WDQS is on the lede’s critical path', () => {
  assert.equal(needsArtworksQuery(instanceOf('Q5')), true)
  // A butterfly (taxon), a city, a court case: one saved request each, on the
  // overwhelming majority of pages this site renders.
  assert.equal(needsArtworksQuery(instanceOf('Q16521')), false)
  assert.equal(needsArtworksQuery(instanceOf('Q515')), false)
  assert.equal(needsArtworksQuery({}), false)
  assert.equal(needsArtworksQuery(null), false)
  // A subject with several classes still qualifies if one of them is human.
  assert.equal(needsArtworksQuery(instanceOf('Q3658341', 'Q5')), true)
})

/** One WDQS binding row, in the shape the endpoint actually returns. */
const row = (qid, ids = {}, { label = `Work ${qid}`, sitelink = false } = {}) => ({
  work: { value: `http://www.wikidata.org/entity/${qid}` },
  workLabel: { value: label },
  ...Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, { value: v }])),
  ...(sitelink ? { sitelink: { value: `https://en.wikipedia.org/wiki/${qid}` } } : {}),
})

const body = (rows) => ({ results: { bindings: rows } })

test('the query asks the graph, never the article’s links', () => {
  const url = subjectArtworksUrl('Q5598', 1000)
  const q = decodeURIComponent(url)
  assert.match(q, /wdt:P170 wd:Q5598/)
  // All four object-level partners, as UNION branches rather than stacked
  // OPTIONALs — see the module comment for why the cross product matters.
  for (const p of ['P3634', 'P13234', 'P4610', 'P6108']) assert.match(q, new RegExp(p))
  assert.match(q, /UNION/)
  assert.doesNotMatch(q, /OPTIONAL \{ \?work wdt:P3634/)
  // Stable order, or a warm re-render would shuffle the shelf.
  assert.match(q, /ORDER BY \?work/)
  assert.match(q, /LIMIT 1000/)
})

test('rows collapse to one record per work, keeping every partner that holds it', () => {
  const recs = artworkRows(
    body([
      row('Q1', { met: '45734' }),
      row('Q1', { iiif: 'https://example.org/manifest' }),
      row('Q2', { rijks: '200107947' }),
    ]),
  )
  assert.equal(recs.length, 2)
  const q1 = recs.find((r) => r.qid === 'Q1')
  assert.deepEqual(Object.keys(q1.ids).sort(), ['iiif', 'met'])
})

test('a work with no English label is dropped — a card titled Q123 is not a card', () => {
  // WDQS's label service falls back to the bare QID, which must not be a title.
  const recs = artworkRows(body([row('Q7', { met: '1' }, { label: 'Q7' })]))
  assert.deepEqual(recs, [])
})

test('malformed rows are skipped rather than crashing the shelf', () => {
  const recs = artworkRows(body([{ work: { value: 'not-a-uri' } }, row('Q3', { aic: '9' })]))
  assert.deepEqual(recs.map((r) => r.qid), ['Q3'])
  assert.deepEqual(artworkRows(null), [])
  assert.deepEqual(artworkRows({}), [])
})

test('the pick spreads across museums instead of taking the most numerous', () => {
  // The real distribution: Rembrandt is 481 IIIF against 39 Met and 29 Rijks,
  // so any natural order gives six IIIF cards on the page whose whole argument
  // is how many different friends hold this material.
  const recs = artworkRows(
    body([
      ...Array.from({ length: 20 }, (_, i) => row(`Q1${i}`, { iiif: `m${i}` })),
      row('Q90', { met: '1' }),
      row('Q91', { met: '2' }),
      row('Q92', { rijks: '3' }),
    ]),
  )
  const picked = pickDiverse(recs, { cap: 4 })
  const sources = picked.map((p) => p.via)
  assert.equal(new Set(sources).size, 3, `expected three partners, got ${sources.join(',')}`)
  assert.deepEqual(sources.slice(0, 3), ['met', 'rijks', 'iiif'])
})

test('a work already carded as an anchor is not shown a second time', () => {
  const recs = artworkRows(body([row('Q1', { met: '1' }), row('Q2', { met: '2' })]))
  const picked = pickDiverse(recs, { cap: 4, exclude: new Set(['Q1']) })
  assert.deepEqual(picked.map((p) => p.qid), ['Q2'])
})

test('nothing is shown twice when two partners hold the same work', () => {
  const recs = artworkRows(body([row('Q1', { met: '1', rijks: '2' })]))
  const picked = pickDiverse(recs, { cap: 4 })
  assert.equal(picked.length, 1)
})

test('works with their own Wikipedia article come first, and QID order breaks the tie', () => {
  // Arbitrary but STABLE: byte-reproducibility of a warm re-render depends on
  // this shelf not shuffling between runs.
  const recs = artworkRows(
    body([
      row('Q300', { met: '3' }),
      row('Q100', { met: '1' }),
      row('Q200', { met: '2' }, { sitelink: true }),
    ]),
  )
  assert.deepEqual(pickDiverse(recs, { cap: 3 }).map((p) => p.qid), ['Q200', 'Q100', 'Q300'])
})

test('the pick is bounded by what exists, not padded to the cap', () => {
  const recs = artworkRows(body([row('Q1', { met: '1' })]))
  assert.equal(pickDiverse(recs, { cap: 6 }).length, 1)
  assert.deepEqual(pickDiverse([], { cap: 6 }), [])
})

test('the totals count everything held, which is what the disclosure claims', () => {
  const recs = artworkRows(
    body([row('Q1', { met: '1' }), row('Q2', { met: '2' }), row('Q3', { rijks: '3' })]),
  )
  assert.deepEqual(artworkTotals(recs), { met: 2, rijks: 1, aic: 0, iiif: 0, works: 3 })
})
