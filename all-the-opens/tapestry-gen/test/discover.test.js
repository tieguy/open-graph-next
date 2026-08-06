import test from 'node:test'
import assert from 'node:assert/strict'

import { canonicalTitle, freeLawByCitation, proseLinks } from '../src/discover.js'

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
  // The initial itself must be non-ASCII, or the assertion proves nothing
  // about \w — which is exactly how the first version of this test passed
  // while accented titles silently resolved to no QID at all.
  assert.equal(canonicalTitle('émile durkheim'), 'Émile durkheim')
  // Only the initial changes; MediaWiki resolves the rest, so this must not
  // try to title-case anything else.
  assert.equal(canonicalTitle('île-de-france'), 'Île-de-france')
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

// ---- freeLawByCitation ----------------------------------------------------
//
// Every URL asserted here was resolved against CourtListener on 2026-08-06 —
// these are not guesses at a shape. The card carried the address as plain text
// and no link at all until that day, which is why the link itself is asserted
// first and hardest.

test('the opinion card is a link, not an address printed in the credit line', () => {
  const e = freeLawByCitation(['347 U.S. 483'])
  // Resolves to /opinion/105221/brown-v-board-of-education/ — verified live.
  assert.equal(e.href, 'https://www.courtlistener.com/c/U.S./347/483/')
  // The credit names where the reader lands; repeating the URL was a substitute
  // for being a link, and there is one now.
  assert.equal(e.attribution.author, 'CourtListener')
  assert.match(e.title, /347 U\.S\. 483/)
})

test('a reporter with a space is encoded rather than shipped raw', () => {
  // "74 S. Ct. 686" is Brown's parallel citation and reaches the same opinion.
  const e = freeLawByCitation(['74 S. Ct. 686'])
  assert.equal(e.href, 'https://www.courtlistener.com/c/S.%20Ct./74/686/')
})

test('the official reporter wins over a parallel commercial one', () => {
  // Both cite the same case; U.S. is the one a reader should be sent to.
  const e = freeLawByCitation(['74 S. Ct. 686', '347 U.S. 483'])
  assert.equal(e.href, 'https://www.courtlistener.com/c/U.S./347/483/')
})

test('with no parsable reporter citation there is no card', () => {
  assert.equal(freeLawByCitation(['not a citation']), null)
  assert.equal(freeLawByCitation([]), null)
})

test('the decision is marked public domain, never CC-licensed', () => {
  // Nobody granted this: a work of the US federal government has no copyright
  // to grant, so the mark is correct and a CC circle would not be.
  const e = freeLawByCitation(['347 U.S. 483'])
  assert.equal(e.rights.copy.url, 'https://creativecommons.org/publicdomain/mark/1.0/')
})
