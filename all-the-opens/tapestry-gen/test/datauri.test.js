import test from 'node:test'
import assert from 'node:assert/strict'

import { fromDataUri, hotlinkUnsafe, isImageType, placeholderFloor, servableImage } from '../src/http.js'

// The streaming server serves partner images from its own /img/ path rather
// than inlining them, so this is the step that turns a cached data: URI back
// into bytes on a socket. Getting it wrong shows up as a missing image, which
// is the failure mode this project is least likely to notice by looking.

test('a base64 image round-trips to its bytes and its type', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const got = fromDataUri(`data:image/png;base64,${png.toString('base64')}`)
  assert.equal(got.type, 'image/png')
  assert.deepEqual(got.body, png)
})

// The first version matched `^data:([^;,]*)(;base64)?,` and so could not read a
// media type carrying a parameter — it returned null, the handler answered 404,
// and the card silently dropped its picture.
test('a media type with parameters is still a media type', () => {
  const got = fromDataUri('data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+')
  assert.equal(got.type, 'image/svg+xml;charset=utf-8')
  assert.equal(got.body.toString(), '<svg/>')
})

test('an unencoded payload is read as text, not as base64', () => {
  assert.equal(fromDataUri('data:text/plain,hello').body.toString(), 'hello')
  assert.equal(fromDataUri('data:,bare').type, 'text/plain;charset=US-ASCII')
})

test('anything that is not a data URI is refused rather than guessed at', () => {
  assert.equal(fromDataUri('https://example.test/x.png'), null)
  assert.equal(fromDataUri(''), null)
  assert.equal(fromDataUri(null), null)
  assert.equal(fromDataUri(undefined), null)
})

// Which card images both renderers must fetch themselves — batch by inlining,
// streaming through /img/ — instead of letting a reader's browser hotlink them.
test('no partner image is hotlinked — a reader’s browser talks to us and to Wikimedia only', () => {
  // The operator’s decision, 2026-08-17: partner hosts bot-block and
  // hotlink-block unpredictably, and hotlinking cannot scale to the
  // adoption the project aims at. Every partner image is fetched by us.
  assert.equal(hotlinkUnsafe({ source: 'dpla', imageUrl: 'https://digitalcollections.museumofflight.org/x.jpg' }), true)
  assert.equal(hotlinkUnsafe({ source: 'digitalnz', imageUrl: 'https://ndhadeliver.natlib.govt.nz/x.jpg' }), true)
  assert.equal(hotlinkUnsafe({ source: 'openlibrary', imageUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg' }), true)
  assert.equal(hotlinkUnsafe({ source: 'openstreetmap', imageUrl: 'https://tile.openstreetmap.org/1/2/3.png' }), true)
  // The museums are partners too — the old cheap path is gone.
  assert.equal(hotlinkUnsafe({ source: 'met', imageUrl: 'https://images.metmuseum.org/x.jpg' }), true)
  assert.equal(hotlinkUnsafe({ source: 'ia', imageUrl: 'https://archive.org/services/img/x' }), true)
  assert.equal(hotlinkUnsafe({ source: 'rijksmuseum', imageUrl: 'https://iiif.micr.io/x/full/800,/0/default.jpg' }), true)
  // Wikipedia’s own images ride Wikimedia infrastructure built for this load.
  assert.equal(hotlinkUnsafe({ source: 'wikipedia', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/b.jpg' }), false)
  // Already-travelling bytes and absent images are nobody’s fetch.
  assert.equal(hotlinkUnsafe({ source: 'met', imageUrl: 'data:image/jpeg;base64,AAAA' }), false)
  assert.equal(hotlinkUnsafe({ source: 'dpla', imageUrl: null }), false)
})

test('the placeholder floor is one host’s fact — OpenLibrary covers 1 KB, everything else 32', () => {
  assert.equal(placeholderFloor('https://covers.openlibrary.org/b/id/1-M.jpg'), 1024)
  assert.equal(placeholderFloor('https://api.gbif.org/v2/map/occurrence/density/0/0/0@2x.png?taxonKey=1'), 32)
  assert.equal(placeholderFloor('https://images.metmuseum.org/CRDImages/ep/web-large/x.jpg'), 32)
})

test('only non-document images pass the type gate — one definition for fetch and /img/', () => {
  assert.equal(isImageType('image/jpeg'), true)
  assert.equal(isImageType('image/png'), true)
  // Header parameters are not part of the media type.
  assert.equal(isImageType('image/jpeg; charset=UTF-8'), true)
  // An SVG is a document that runs script on navigation — refused even
  // though it is an image type; our own SVG glyphs inline into markup and
  // never ride this path.
  assert.equal(isImageType('image/svg+xml'), false)
  // Bare image/svg is refused too — whether any renderer treats it as SVG
  // is a question this gate declines to find out.
  assert.equal(isImageType('image/svg'), false)
  // A bare comma-joined duplicate Content-Type is not a media type: the
  // anchored subtype makes the parameter split load-bearing rather than
  // documentary.
  assert.equal(isImageType('image/png, text/html'), false)
  // A PARAMETERIZED join passes, deliberately: the split reduces it to its
  // one safe leading type, and that split value is what gets stored and
  // served — pinned so the comment's guarantee cannot drift either way.
  assert.equal(isImageType('image/png; charset=x, text/html'), true)
  assert.equal(isImageType('text/html;charset=utf-8'), false)
  assert.equal(isImageType('application/pdf'), false)
  assert.equal(isImageType(''), false)
  assert.equal(isImageType(null), false)
})

test('the /img/ decision is a seam: only a servable image leaves the origin', () => {
  const png = { type: 'image/png', body: Buffer.from([1]) }
  assert.equal(servableImage(png), png)
  assert.equal(servableImage({ type: 'image/svg+xml', body: Buffer.from([1]) }), null)
  assert.equal(servableImage({ type: 'text/html;charset=utf-8', body: Buffer.from([1]) }), null)
  assert.equal(servableImage(null), null)
})
