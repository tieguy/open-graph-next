import test from 'node:test'
import assert from 'node:assert/strict'

import { fromDataUri } from '../src/http.js'

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
