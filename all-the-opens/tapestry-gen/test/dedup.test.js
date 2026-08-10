import test from 'node:test'
import assert from 'node:assert/strict'

import { claimAnchors, claimCitations } from '../src/dedup.js'

test('claimCitations: a cited work belongs to the first section that cites it', () => {
  // The citations twin of claimAnchors (2026-08-09): Carrying the Fire is
  // cited in eight Apollo 11 sections and floated in every one of them.
  const key = (c) => c.isbn ?? c.title
  const claimed = new Set()
  const first = claimCitations([{ isbn: 'A' }, { isbn: 'B' }], claimed, 3, key)
  assert.deepEqual(first.map(key), ['A', 'B'])
  // A later section citing the same book backfills from its OWN later cites
  // — the cap applies after the page-wide drop, like claimAnchors' backfill.
  const second = claimCitations(
    [{ isbn: 'A' }, { isbn: 'C' }, { isbn: 'D' }, { isbn: 'E' }],
    claimed,
    3,
    key,
  )
  assert.deepEqual(second.map(key), ['C', 'D', 'E'])
})

test('claimCitations: only what a section actually shows is claimed', () => {
  // A cite squeezed out by the per-section cap must stay unclaimed, or the
  // book would be owned by a section that never rendered it and appear
  // nowhere on the page.
  const key = (c) => c.isbn ?? c.title
  const claimed = new Set()
  claimCitations([{ isbn: 'A' }, { isbn: 'B' }, { isbn: 'C' }, { isbn: 'D' }], claimed, 3, key)
  assert.deepEqual([...claimed], ['A', 'B', 'C'])
  const later = claimCitations([{ isbn: 'D' }], claimed, 3, key)
  assert.deepEqual(later.map(key), ['D'])
})

test('claimCitations: a keyless cite always passes and never claims', () => {
  // dropSeenFiles' old stance, kept: refusing to dedup is safer than
  // dedup-by-accident on a null key.
  const claimed = new Set()
  const out = claimCitations([{}, {}], claimed, 3, (c) => c.isbn ?? null)
  assert.equal(out.length, 2)
  assert.equal(claimed.size, 0)
})

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
