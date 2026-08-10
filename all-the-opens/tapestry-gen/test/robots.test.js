import test from 'node:test'
import assert from 'node:assert/strict'

import { robotsTxt } from '../src/robots.js'

const lines = (txt) => txt.trim().split('\n').map((l) => l.trim())

// Every /wiki/ view spends other people's API capacity — a crawler walking the
// English Wikipedia's article space through this server would spend all of it.
test('no crawler is invited into the render space', () => {
  assert.ok(lines(robotsTxt({})).includes('Disallow: /'))
  assert.ok(lines(robotsTxt({ disallowAll: true })).includes('Disallow: /'))
})

// The front page is the one page that costs nothing to serve — no discovery, no
// upstream request — and it is the page a share or a search should land on.
test('the front page stays findable in production', () => {
  assert.ok(lines(robotsTxt({})).includes('Allow: /$'))
})

// Staging exists for one reviewer. An indexed staging render is a wrong answer
// that outlives the review, so nothing there is offered at all.
test('staging offers nothing, front page included', () => {
  const staging = lines(robotsTxt({ disallowAll: true }))
  assert.ok(!staging.some((l) => l.startsWith('Allow:')))
})

test('both forms name every agent', () => {
  for (const txt of [robotsTxt({}), robotsTxt({ disallowAll: true })]) {
    assert.ok(lines(txt).includes('User-agent: *'))
    assert.ok(txt.endsWith('\n'), 'robots.txt is a line-oriented file')
  }
})
