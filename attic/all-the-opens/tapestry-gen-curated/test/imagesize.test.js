import { test } from 'node:test'
import assert from 'node:assert/strict'

import { imageAspect } from '../src/imagesize.js'

function png(width, height) {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0) // signature
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

function jpeg(width, height) {
  // SOI, then a SOF0 segment carrying the dimensions.
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0) // SOF0 marker
  sof.writeUInt16BE(8, 2) // segment length
  sof.writeUInt8(8, 4) // precision
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof])
}

test('PNG dimensions are read from the IHDR chunk', () => {
  assert.equal(imageAspect(png(200, 300)), 1.5)
})

test('JPEG dimensions are read from the SOF marker', () => {
  assert.equal(imageAspect(jpeg(200, 300)), 1.5)
})

test('a landscape image gives an aspect below 1', () => {
  assert.ok(imageAspect(png(400, 200)) < 1)
})

test('a JPEG with a preceding segment before the SOF still resolves', () => {
  // An APP0/JFIF-style segment sits before the SOF in real files.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, jpeg(120, 180).subarray(2)])
  assert.equal(imageAspect(buf), 1.5)
})

test('unrecognised bytes yield null rather than a wrong guess', () => {
  assert.equal(imageAspect(Buffer.from([1, 2, 3, 4])), null)
  assert.equal(imageAspect(Buffer.alloc(0)), null)
})
