import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_COOLOFF_MS, coolingFor, noteRateLimited, resetCooloffs } from '../src/cooloff.js'
import { retryAfterMs } from '../src/wmf.js'

const HOST = 'api.openalex.org'
const T = 1_000_000

test('a host that has said no is not asked again until it said to', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 60_000, T)
  assert.equal(coolingFor(HOST, T), 60_000)
  assert.equal(coolingFor(HOST, T + 59_000), 1_000)
})

// The cool-off has to expire on its own: a source that rate-limited us at noon
// is a source we must be willing to use at one.
test('the cool-off ends when the interval does', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 60_000, T)
  assert.equal(coolingFor(HOST, T + 60_000), 0)
  assert.equal(coolingFor(HOST, T + 600_000), 0)
})

// This is the bug that cost 230 seconds a page: every OpenAlex chunk paid its
// own Retry-After wait, because nothing recorded that the host had already
// answered 429. One page, one refusal.
test('one refusal covers every later request in the same render', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 60_000, T)
  for (const later of [T + 1, T + 500, T + 30_000]) {
    assert.ok(coolingFor(HOST, later) > 0, `chunk at +${later - T}ms must not ask again`)
  }
})

test('one refusing host does not silence the others', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 60_000, T)
  assert.equal(coolingFor('api.dp.la', T), 0)
  assert.equal(coolingFor('query.wikidata.org', T), 0)
})

// A 429 with no Retry-After is still a refusal, and guessing zero would turn it
// into a hot loop against a host that just asked for room.
test('a refusal with no interval named still buys the host quiet', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, null, T)
  assert.ok(coolingFor(HOST, T) > 0)
  assert.ok(coolingFor(HOST, T + 60_001) === 0, 'and not forever')
})

// Retry-After is a header, which means it is whatever the other end says — a
// typo or a hostile value must not take a source out for a day.
test('an absurd interval is capped, not honored literally', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 86_400_000, T)
  assert.equal(coolingFor(HOST, T), MAX_COOLOFF_MS)
})

// The later refusal wins even when it is shorter: it is the more recent thing
// the host actually said.
test('a fresh refusal replaces the standing one', (t) => {
  t.after(resetCooloffs)
  noteRateLimited(HOST, 600_000, T)
  noteRateLimited(HOST, 30_000, T + 1_000)
  assert.equal(coolingFor(HOST, T + 1_000), 30_000)
})

// The sleep cap and the cool-off cap are different questions — how long a
// request may block versus how long a promise not to ask should hold — so
// retryAfterMs has to be askable for either.
test('Retry-After parses against whichever cap the caller needs', () => {
  const headers = new Headers({ 'retry-after': '600' })
  assert.equal(retryAfterMs(headers), 60_000, 'default cap is the interactive sleep cap')
  assert.equal(retryAfterMs(headers, MAX_COOLOFF_MS), 600_000)
  assert.equal(retryAfterMs(new Headers(), MAX_COOLOFF_MS), null)
})
