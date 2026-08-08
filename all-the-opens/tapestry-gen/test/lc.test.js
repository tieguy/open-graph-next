import test from 'node:test'
import assert from 'node:assert/strict'

import { lcLabelsFromGraph } from '../src/lc.js'

// A trimmed copy of the real expanded JSON-LD for no2008188470 (fetched
// 2026-08-08) — the NLNZ-contributed NACO record for John Stuart Yeates,
// which is the record that proved LC carries NZ heading forms as variants.
const ID = 'no2008188470'
const GRAPH = [
  {
    // The trap `lcHeadingFromGraph` fixed on 2026-08-05, reproduced here so
    // this parser is tested against it: LC ships the identifier twice, and
    // the RWO node — which has no labels — can come FIRST.
    '@id': `http://id.loc.gov/rwo/agents/${ID}`,
    '@type': ['http://id.loc.gov/ontologies/bibframe/Person'],
  },
  {
    '@id': `http://id.loc.gov/authorities/names/${ID}`,
    '@type': ['http://www.loc.gov/mads/rdf/v1#PersonalName', 'http://www.loc.gov/mads/rdf/v1#Authority'],
    'http://www.w3.org/2004/02/skos/core#prefLabel': [
      { '@value': 'Yeates, J. S. (John Stuart), 1900-1986' },
    ],
    'http://www.w3.org/2004/02/skos/core#altLabel': [
      { '@language': 'zxx-Latn', '@value': 'Yeates, John Stuart, 1900-1986' },
      { '@language': 'zxx-Latn', '@value': 'Yeates, Jack, 1900-1986' },
    ],
  },
]

test('lcLabelsFromGraph reads the authorized heading and every variant form', () => {
  assert.deepEqual(lcLabelsFromGraph(GRAPH, ID), {
    heading: 'Yeates, J. S. (John Stuart), 1900-1986',
    variants: ['Yeates, John Stuart, 1900-1986', 'Yeates, Jack, 1900-1986'],
  })
})

test('lcLabelsFromGraph matches the full authority URI, never the RWO twin', () => {
  // Only the RWO node — no authority record at all → no labels, not a crash.
  assert.equal(lcLabelsFromGraph([GRAPH[0]], ID), null)
})

test('lcLabelsFromGraph answers null for a record with no heading, and for junk', () => {
  assert.equal(lcLabelsFromGraph([{ '@id': `http://id.loc.gov/authorities/names/${ID}` }], ID), null)
  assert.equal(lcLabelsFromGraph(undefined, ID), null)
  assert.equal(lcLabelsFromGraph({}, ID), null)
})

test('a record with no variants still answers, with an empty list', () => {
  const bare = [
    {
      '@id': `http://id.loc.gov/authorities/names/${ID}`,
      'http://www.w3.org/2004/02/skos/core#prefLabel': [{ '@value': 'Heading' }],
    },
  ]
  assert.deepEqual(lcLabelsFromGraph(bare, ID), { heading: 'Heading', variants: [] })
})
