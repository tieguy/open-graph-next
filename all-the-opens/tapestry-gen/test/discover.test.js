import test from 'node:test'
import assert from 'node:assert/strict'

import { canonicalTitle, proseLinks } from '../src/discover.js'

// ---- canonicalTitle -------------------------------------------------------

test('canonicalTitle converts underscores to spaces', () => {
  assert.equal(canonicalTitle('Ludwig_Prandtl'), 'Ludwig Prandtl')
})

test('canonicalTitle uppercases the first character', () => {
  assert.equal(canonicalTitle('ludwig prandtl'), 'Ludwig prandtl')
})

test('canonicalTitle handles underscores and lowercase together', () => {
  assert.equal(canonicalTitle('ludwig_prandtl'), 'Ludwig prandtl')
})

test('canonicalTitle leaves already-canonical titles unchanged', () => {
  assert.equal(canonicalTitle('Dapples'), 'Dapples')
  assert.equal(canonicalTitle('Ludwig Prandtl'), 'Ludwig Prandtl')
})

test('canonicalTitle handles empty and non-string inputs', () => {
  assert.equal(canonicalTitle(''), '')
  assert.equal(canonicalTitle(null), '')
  assert.equal(canonicalTitle(undefined), '')
})

test('canonicalTitle handles titles with multiple underscores', () => {
  assert.equal(canonicalTitle('foo_bar_baz'), 'Foo bar baz')
})

test('canonicalTitle preserves case after the first character', () => {
  assert.equal(canonicalTitle('zürich'), 'Zürich')
  assert.equal(canonicalTitle('Zürich'), 'Zürich')
})

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
