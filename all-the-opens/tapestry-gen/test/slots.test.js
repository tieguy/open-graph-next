import test from 'node:test'
import assert from 'node:assert/strict'

import { Ledger, withDeadline } from '../src/slots.js'

// serve.js counted discoveries with a bare integer, which could say "four in
// flight" but never which four, since when, or why. After the 2026-09-04 stall
// (see QUEUE_DEADLINE_MS in src/mw.js) that is exactly what the log needed and
// could not give. The ledger knows each render by name and age.
test('the ledger names what is in flight and how long it has been', async () => {
  const l = new Ledger()
  const a = l.take('Okonomiyaki', 1000)
  await new Promise((r) => setTimeout(r, 20))
  const b = l.take('Lake Titicaca', 1000)
  assert.equal(l.size, 2)
  const rows = l.snapshot(Date.now())
  assert.deepEqual(rows.map((r) => r.page), ['Okonomiyaki', 'Lake Titicaca'], 'oldest first')
  assert.ok(rows[0].ageMs >= 15)
  assert.ok(rows[1].ageMs < rows[0].ageMs)
  l.release(a)
  assert.equal(l.size, 1)
  l.release(b)
  assert.equal(l.size, 0)
  assert.equal(l.release(b), false, 'releasing twice is a no-op, not a negative count')
})

test('a discovery that outlives its deadline is failed, and the failure says so', async () => {
  const never = new Promise(() => {})
  await assert.rejects(withDeadline(never, 25, 'Okonomiyaki'), (e) => {
    assert.match(e.message, /Okonomiyaki/)
    assert.match(e.message, /25ms/)
    assert.equal(e.stalled, true)
    return true
  })
})

test('a discovery that finishes in time passes its value through untouched', async () => {
  const out = await withDeadline(Promise.resolve({ bands: [] }), 1000, 'quick')
  assert.deepEqual(out, { bands: [] })
})

test('a discovery that fails in time passes its own error through, not a deadline', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('missingtitle')), 1000, 'x'), /missingtitle/)
})
