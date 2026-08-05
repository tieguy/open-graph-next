import test from 'node:test'
import assert from 'node:assert/strict'

import { claimAnchors } from '../src/dedup.js'

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
