import test from 'node:test'
import assert from 'node:assert/strict'

import { enqueue, hostLimit, peakConcurrency, queueSnapshot, requestTally } from '../src/mw.js'

// The per-host queue is where this project's politeness lives, so its shape is
// worth asserting rather than trusting: serial by default, wider only where a
// service says in writing that it may be, and never wider than it was told.

/** A task that records when it starts and stops, so overlap is observable. */
function tracker() {
  const log = []
  let live = 0
  let peak = 0
  const make = (name, ms = 5) => async () => {
    live++
    peak = Math.max(peak, live)
    log.push(`+${name}`)
    await new Promise((r) => setTimeout(r, ms))
    log.push(`-${name}`)
    live--
    return name
  }
  return { make, log, peak: () => peak }
}

test('an unlisted host is serial: one in flight, in the order it was asked', async () => {
  const t = tracker()
  const host = 'serial.test'
  assert.equal(hostLimit(host), 1)
  const names = ['a', 'b', 'c', 'd']
  const out = await Promise.all(names.map((n) => enqueue(host, t.make(n))))
  assert.deepEqual(out, names)
  assert.equal(t.peak(), 1, 'never two in flight at one host')
  // Strictly alternating start/stop is what "serial" looks like in the log.
  assert.deepEqual(t.log, ['+a', '-a', '+b', '-b', '+c', '-c', '+d', '-d'])
})

test('a widened host runs several at once, and never more than its limit', async () => {
  const t = tracker()
  // api.dp.la publishes no rate limit (see hostLimit's citation); it is the one
  // host this project widens, so it is the one the test pins.
  const host = 'api.dp.la'
  const limit = hostLimit(host)
  assert.ok(limit > 1, 'DPLA is the widened case')
  await Promise.all(Array.from({ length: limit * 3 }, (_, i) => enqueue(host, t.make(`t${i}`))))
  assert.equal(t.peak(), limit, 'saturates the limit')
  assert.ok(t.peak() <= limit, 'and never exceeds it')
})

test('Wikimedia hosts and id.loc.gov stay at one, whatever else is widened', () => {
  // Serial-per-host is a Wikimedia etiquette requirement, not a default we may
  // tune away — see the compliance section in CLAUDE.md.
  for (const h of [
    'en.wikipedia.org',
    'www.wikidata.org',
    'query.wikidata.org',
    'commons.wikimedia.org',
    'upload.wikimedia.org',
    'maps.wikimedia.org',
    'de.wikipedia.org',
  ]) {
    assert.equal(hostLimit(h), 1, `${h} must stay serial`)
  }
  // id.loc.gov publishes `Crawl-delay: 3` for every agent in its robots.txt.
  // Serial is already far above that; widening it would be indefensible.
  assert.equal(hostLimit('id.loc.gov'), 1)
  // OpenLibrary rate-limits back-to-back requests (see the CLAUDE.md gotcha).
  assert.equal(hostLimit('openlibrary.org'), 1)
  // A host nobody has researched gets the safe answer, not the fast one.
  assert.equal(hostLimit('unknown.example'), 1)
})

test('a failing task frees its slot instead of poisoning the queue', async () => {
  const host = 'poison.test'
  const boom = enqueue(host, async () => {
    throw new Error('upstream said no')
  })
  await assert.rejects(boom, /upstream said no/)
  // The queue still runs, and the rejection did not leave the slot occupied.
  assert.equal(await enqueue(host, async () => 'still here'), 'still here')
})

test('every request is counted, and the widest it ever ran is recorded', async () => {
  const host = 'tally.test'
  const before = requestTally.get(host) ?? 0
  await Promise.all([enqueue(host, async () => 1), enqueue(host, async () => 2)])
  assert.equal(requestTally.get(host), before + 2)
  // Peak concurrency is what makes the politeness claim checkable after the
  // fact rather than merely asserted in a comment.
  assert.equal(peakConcurrency.get(host), 1)
})

// Measured on production, 2026-09-04 → 2026-09-08: one task in a Wikimedia
// host's queue never settled — no socket, no timer, just a promise that stayed
// pending — and because every discovery needs that host, every discovery
// queued behind it, all four admission slots filled with renders that could
// never finish, and every cold page answered 503 for four and a half days
// until a restart. A queue slot must have an end that does not depend on the
// task keeping its promise.
test('a task that never settles is cut off at its deadline and the host moves on', async () => {
  const host = 'stuck.test'
  const never = () => new Promise(() => {})
  await assert.rejects(enqueue(host, never, { deadlineMs: 30 }), (e) => {
    assert.match(e.message, /stuck\.test/)
    assert.match(e.message, /30ms/)
    assert.equal(e.stalled, true)
    return true
  })
  // The slot is free again: the next task on the same serial host actually runs.
  const t = tracker()
  const out = await enqueue(host, t.make('after'), { deadlineMs: 1000 })
  assert.equal(out, 'after')
})

test('a task that settles in time is unaffected by its deadline', async () => {
  const t = tracker()
  const out = await enqueue('prompt.test', t.make('quick', 5), { deadlineMs: 1000 })
  assert.equal(out, 'quick')
})

test('the snapshot names each host, what it is running, and for how long', async () => {
  const host = 'snap.test'
  let release
  const p = enqueue(host, () => new Promise((r) => { release = r }))
  const q = enqueue(host, async () => 'second')
  await new Promise((r) => setTimeout(r, 20))
  const snap = queueSnapshot(Date.now())
  const row = snap.find((s) => s.host === host)
  assert.ok(row, 'the busy host is listed')
  assert.equal(row.active, 1)
  assert.equal(row.waiting, 1)
  assert.ok(row.oldestActiveMs >= 15, `oldest task has aged: ${row.oldestActiveMs}`)
  release('first')
  assert.deepEqual(await Promise.all([p, q]), ['first', 'second'])
  // An idle host leaves the snapshot rather than padding it.
  assert.equal(queueSnapshot(Date.now()).find((s) => s.host === host), undefined)
})
