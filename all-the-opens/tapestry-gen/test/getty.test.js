import test from 'node:test'
import assert from 'node:assert/strict'
import { gettyImageUrl, gettyLd, gettyPageUrl } from '../src/getty.js'

test('gettyPageUrl builds the object page the record is read from and linked to', () => {
  assert.equal(gettyPageUrl('103JNH'), 'https://www.getty.edu/art/collection/object/103JNH')
})

test('gettyLd reads the one embedded JSON-LD block out of the page', () => {
  const html =
    '<html><head><script type="application/ld+json">' +
    '{"name": "Irises", "temporal": "1889"}' +
    '</script></head><body></body></html>'
  assert.deepEqual(gettyLd(html), { name: 'Irises', temporal: '1889' })
})

test('a page with no JSON-LD block is the bogus-id shape and yields null', () => {
  // A bogus id answers 200 with a generic page and no block — this null is
  // what keeps real and bogus ids distinguishable (probe note 12).
  assert.equal(gettyLd('<html><body>generic page</body></html>'), null)
  assert.equal(gettyLd(null), null)
  assert.equal(gettyLd(''), null)
})

test('a block that does not parse costs the card, never a crash', () => {
  assert.equal(gettyLd('<script type="application/ld+json">{broken</script>'), null)
})

test('gettyImageUrl rewrites the IIIF size segment to display size', () => {
  assert.equal(
    gettyImageUrl('https://media.getty.edu/iiif/image/8c255d80/full/!300,300/0/default.jpg'),
    'https://media.getty.edu/iiif/image/8c255d80/full/!800,800/0/default.jpg',
  )
})

test('a thumbnail without the expected size segment passes through unchanged', () => {
  const odd = 'https://media.getty.edu/iiif/image/8c255d80/square/max/0/default.jpg'
  assert.equal(gettyImageUrl(odd), odd)
  assert.equal(gettyImageUrl(null), null)
  assert.equal(gettyImageUrl(''), null)
})
