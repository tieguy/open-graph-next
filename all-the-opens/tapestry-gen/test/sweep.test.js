import test from 'node:test'
import assert from 'node:assert/strict'

import { chooseEvictions } from '../src/sweep.js'

const MB = 1024 * 1024
const f = (name, mb, atimeMs) => ({ name, size: mb * MB, atimeMs })

test('a cache under its cap is left entirely alone', () => {
  const files = [f('a', 10, 1), f('b', 10, 2)]
  assert.deepEqual(chooseEvictions(files, { capBytes: 100 * MB }), [])
})

// Least-recently-USED, not least-recently-written. These files are written once
// and read many times, so evicting by write time would drop the oldest entries
// first — which here are the most-shared and most valuable ones, the LC
// headings and class verdicts that every later article draws on.
test('the least recently read go first, whatever order they were written in', () => {
  const files = [
    f('fresh', 30, 9_000),
    f('stale', 30, 1_000),
    f('middling', 30, 5_000),
  ]
  // Cap 60 MB, so the sweep frees down to the 80% floor (48 MB): two must go.
  const gone = chooseEvictions(files, { capBytes: 60 * MB })
  assert.deepEqual(gone, ['stale', 'middling'])
})

test('it frees to the floor, not merely to the cap, so it is not called again at once', () => {
  const files = Array.from({ length: 10 }, (_, i) => f(`f${i}`, 10, i))
  const gone = chooseEvictions(files, { capBytes: 90 * MB })
  // 100 MB present, floor is 80% of 90 = 72 MB, so at least 28 MB must go.
  const freed = gone.length * 10 * MB
  assert.ok(freed >= 100 * MB - 72 * MB, `freed ${freed} is enough`)
  // And it stops there rather than emptying the cache.
  assert.ok(gone.length <= 4, `evicted ${gone.length} files, not the whole cache`)
  assert.deepEqual(gone, ['f0', 'f1', 'f2'])
})

test('a single file larger than the whole cap is still evictable', () => {
  const gone = chooseEvictions([f('huge', 200, 1)], { capBytes: 100 * MB })
  assert.deepEqual(gone, ['huge'])
})

test('an empty cache is not an error', () => {
  assert.deepEqual(chooseEvictions([], { capBytes: 100 * MB }), [])
})
