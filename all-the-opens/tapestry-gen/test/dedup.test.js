import test from 'node:test'
import assert from 'node:assert/strict'

import { claimAnchors, dropSeenFiles } from '../src/dedup.js'

test('claimAnchors: first band in article order owns an anchor; later bands backfill', () => {
  const picks = claimAnchors(
    [
      ['Q1', 'Q2', 'Q3'],
      ['Q1', 'Q4', 'Q5'], // Q1 already claimed -> backfills with Q4, Q5
      ['Q2', 'Q4'],       // both claimed -> nothing left
    ],
    { perUnit: 2 },
  )
  assert.deepEqual(picks, [['Q1', 'Q2'], ['Q4', 'Q5'], []])
})

test('claimAnchors: within a unit, duplicates collapse before the cap', () => {
  const picks = claimAnchors([['Q1', 'Q1', 'Q2']], { perUnit: 2 })
  assert.deepEqual(picks, [['Q1', 'Q2']])
})

test('claimAnchors: a seeded owner keeps its anchor even against earlier units', () => {
  // The subject QID belongs to the lede (index 0) even if section 1 links it.
  const picks = claimAnchors([['Q9'], ['Q9', 'Q7']], { perUnit: 2, seeded: new Map([['Q9', 0]]) })
  assert.deepEqual(picks, [['Q9'], ['Q7']])
})

test('claimAnchors: null/undefined QIDs never claim a slot', () => {
  const picks = claimAnchors([[null, 'Q1', undefined]], { perUnit: 2 })
  assert.deepEqual(picks, [['Q1']])
})

test('dropSeenFiles: a file renders once, at its first article-order appearance', () => {
  const lists = [
    [{ _file: 'File:A.jpg' }, { _file: 'File:B.jpg' }],
    [{ _file: 'File:B.jpg' }, { _file: 'File:C.jpg' }],
  ]
  const out = dropSeenFiles(lists, (e) => e._file)
  assert.deepEqual(out.map((l) => l.map((e) => e._file)), [
    ['File:A.jpg', 'File:B.jpg'],
    ['File:C.jpg'],
  ])
})

test('dropSeenFiles: entries with no key always pass', () => {
  const out = dropSeenFiles([[{ title: 'x' }], [{ title: 'x' }]], (e) => e._file)
  assert.equal(out.flat().length, 2)
})

test('dropSeenFiles: a pre-seeded set claims files before any list does', () => {
  const seen = new Set(['File:A.jpg'])
  const out = dropSeenFiles([[{ _file: 'File:A.jpg' }, { _file: 'File:B.jpg' }]], (e) => e._file, seen)
  assert.deepEqual(out[0].map((e) => e._file), ['File:B.jpg'])
})
