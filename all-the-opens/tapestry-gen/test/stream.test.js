import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bandRail,
  streamBand,
  streamClose,
  streamHeroExtras,
  streamOpen,
} from '../src/emit-html.js'

const UNITS = [
  { index: '0', title: 'Test Article', blocks: [{ kind: 'p', text: 'Lede prose.' }] },
  { index: '3', title: 'One', blocks: [{ kind: 'p', text: 'Alpha.' }] },
]

const BAND = {
  id: 's3',
  title: 'One',
  blocks: [{ kind: 'p', text: 'Alpha.' }],
  entries: [
    {
      source: 'wikimedia_commons',
      title: 'A photo',
      imageUrl: 'https://example.test/x.jpg',
      attribution: { author: 'Someone', license: 'CC0' },
    },
  ],
  citations: [{ kind: 'book', title: 'A Book', href: 'https://example.test/b' }],
  coverage: '1 work cited here',
  disclosure: null,
  broad: false,
}

test('streamOpen carries the whole spine with band ids and no rails', () => {
  const open = streamOpen({ title: 'Test Article', description: 'd', units: UNITS })
  assert.match(open, /<section class="band section" id="slede">/)
  assert.match(open, /<section class="band section" id="s3">/)
  assert.match(open, /Lede prose\./)
  assert.match(open, /Alpha\./)
  assert.doesNotMatch(open, /<aside class="rail">/)
  // The relocation helpers precede any fragment that will call them.
  assert.match(open, /function __thb/)
  // The document is deliberately unfinished: the stream continues.
  assert.doesNotMatch(open, /<\/html>/)
})

test('streamBand wraps the same rail band() would embed, targeted at its band', () => {
  const fragment = streamBand(BAND)
  assert.match(fragment, /^<template id="tpl-s3">/)
  assert.ok(fragment.includes(bandRail(BAND)))
  assert.match(fragment, /__thb\("tpl-s3","s3"\)/)
})

test('a band with nothing to show streams nothing', () => {
  assert.equal(streamBand({ id: 's9', title: 'Empty', blocks: [], entries: [], citations: [] }), '')
})

test('hero extras fill the legend from the sources actually used', () => {
  const extras = streamHeroExtras([BAND])
  assert.match(extras, /Wikimedia Commons/)
  assert.match(extras, /__fill\("tpl-legend",".legend"\)/)
  // No broad anchors and no corroborated cards → no notes fragment at all.
  assert.doesNotMatch(extras, /tpl-notes/)
})

test('open + fragments + close compose a complete document', () => {
  const page =
    streamOpen({ title: 'T', description: 'd', units: UNITS }) +
    streamBand(BAND) +
    streamHeroExtras([BAND]) +
    streamClose({ provenance: 'From a test.' })
  assert.match(page, /^<!doctype html>/)
  assert.match(page, /From a test\./)
  assert.match(page, /<\/html>\n$/)
  // Every template the page opens is mounted by a matching script call.
  const templates = [...page.matchAll(/<template id="([^"]+)"/g)].map((m) => m[1])
  for (const t of templates) assert.ok(page.includes(`"${t}"`), `no mount for ${t}`)
})
