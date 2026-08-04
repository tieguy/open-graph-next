import test from 'node:test'
import assert from 'node:assert/strict'

import { proseLinks } from '../src/discover.js'

// ---- proseLinks -----------------------------------------------------------

test('a hatnote link ({{distinguish}}, {{about}}, ...) is not a prose anchor', () => {
  const html =
    '<div class="hatnote navigation-not-searchable" role="note">Not to be confused with ' +
    '<a href="/wiki/Novel" title="Novel">Novel</a>.</div>' +
    '<p><a href="/wiki/Software">Software</a> company.</p>'
  assert.deepEqual(proseLinks(html), ['Software'])
})

test('prose links survive alongside a stripped hatnote', () => {
  const html =
    '<div class="hatnote">For other uses, see <a href="/wiki/Foo_(disambiguation)">Foo (disambiguation)</a>.</div>' +
    '<p>See also <a href="/wiki/Bar">Bar</a> and <a href="/wiki/Baz">Baz</a>.</p>'
  assert.deepEqual(proseLinks(html), ['Bar', 'Baz'])
})
