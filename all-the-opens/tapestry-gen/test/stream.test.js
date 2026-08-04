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
  {
    index: '3',
    title: 'One',
    blocks: [
      {
        kind: 'p',
        text: 'Alpha.',
        html: 'Alpha <a class="wl" href="/wiki/Beta">Beta</a>.<sup class="ref"><a href="#s3-note-x">[1]</a></sup>',
      },
    ],
  },
]

const BAND = {
  id: 's3',
  title: 'One',
  blocks: UNITS[1].blocks,
  entries: [
    {
      source: 'wikimedia_commons',
      title: 'A photo',
      imageUrl: 'https://example.test/x.jpg',
      attribution: { author: 'Someone', license: 'CC0' },
      why: 'Depicts Santiago Calatrava, a link in this section',
    },
  ],
  footnotes: [
    {
      id: 's3-note-x',
      num: '1',
      html: 'Author, A. <a class="ext" href="https://example.test/b" target="_blank" rel="noopener">A Book</a>.',
      access: { url: 'https://archive.org/details/abook', label: 'Borrow at the Internet Archive' },
    },
  ],
  coverage: '1 work cited here',
  disclosure: null,
  broad: false,
}

test('streamOpen carries the whole spine with band ids, no numbering, and no rails', () => {
  const open = streamOpen({ title: 'Test Article', units: UNITS, home: '/' })
  assert.match(open, /<section class="band section" id="slede">/)
  assert.match(open, /<section class="band section" id="s3">/)
  assert.match(open, /Lede prose\./)
  // Prose keeps its wikilinks and footnote markers; on the server /wiki/ is
  // already the right base, so hrefs pass through untouched.
  assert.match(open, /<a class="wl" href="\/wiki\/Beta">Beta<\/a>/)
  assert.match(open, /<a href="#s3-note-x">\[1\]<\/a>/)
  // No section numbering anywhere — Wikipedia does not number its sections.
  assert.doesNotMatch(open, /eyebrow/)
  assert.doesNotMatch(open, /§/)
  assert.doesNotMatch(open, /<aside class="rail">/)
  // The relocation helpers precede any fragment that will call them.
  assert.match(open, /function __thb/)
  // The shell can tell a finished stream from a cut one: the load listener
  // announces an interruption unless streamClose set the flag.
  assert.match(open, /__tapdone/)
  assert.match(open, /stream-cut/)
  // The document is deliberately unfinished: the stream continues.
  assert.doesNotMatch(open, /<\/html>/)
})

test('streamClose marks the stream as complete on purpose', () => {
  assert.match(streamClose({}), /window\.__tapdone=1/)
})

test('a card says which anchor brought it here', () => {
  const rail = bandRail(BAND)
  assert.match(rail, /<p class="why">Depicts Santiago Calatrava, a link in this section<\/p>/)
})

test('one source, two topics: the carousel splits, one labelled strip per topic', () => {
  const mk = (title, topic) => ({
    source: 'wikimedia_commons',
    title,
    imageUrl: `https://example.test/${title}.jpg`,
    topic,
    why: `Depicts ${topic}, a link in this section`,
  })
  const rail = bandRail({
    ...BAND,
    footnotes: [],
    entries: [
      mk('Bridge deck', 'suspension bridge'),
      mk('Towers', 'suspension bridge'),
      mk('The strait', 'Golden Gate'),
    ],
  })
  const carousels = rail.match(/<div class="carousel">/g) ?? []
  assert.equal(carousels.length, 2)
  assert.match(rail, /<span class="topic">suspension bridge<\/span>/)
  assert.match(rail, /<span class="topic">Golden Gate<\/span>/)
  // The shared why line is said once under the head, not on every card.
  assert.match(
    rail,
    /<p class="carousel-why">Depicts suspension bridge, a link in this section<\/p>/,
  )
  assert.doesNotMatch(rail, /<p class="why">Depicts suspension bridge, a link in this section<\/p>/)
})

test('one source, one topic: a single carousel with no topic label, as before', () => {
  const rail = bandRail(BAND)
  assert.equal((rail.match(/<div class="carousel">/g) ?? []).length, 1)
  assert.doesNotMatch(rail, /<span class="topic">/)
})

test('the rail shows the actual footnotes, numbered as the prose numbers them', () => {
  const rail = bandRail(BAND)
  assert.match(rail, /References in this section/)
  assert.match(rail, /<li class="fn" id="s3-note-x">/)
  assert.match(rail, /<span class="fn-num">1\.<\/span>/)
  assert.match(rail, /A Book/)
  // The open ecosystem's access link rides on the note itself.
  assert.match(rail, /Borrow at the Internet Archive/)
  assert.match(rail, /1 work cited here/)
})

test('a long footnote list folds past the first eight', () => {
  const fns = Array.from({ length: 14 }, (_, i) => ({
    id: `s3-note-${i}`,
    num: String(i + 1),
    html: `Note ${i + 1}.`,
    access: null,
  }))
  const rail = bandRail({ ...BAND, entries: [], footnotes: fns })
  assert.match(rail, /<details class="fn-more"><summary>6 more references<\/summary>/)
  assert.match(rail, /s3-note-13/)
})

test('streamBand wraps the same rail band() would embed, targeted at its band', () => {
  const fragment = streamBand(BAND)
  assert.match(fragment, /^<template id="tpl-s3">/)
  assert.ok(fragment.includes(bandRail(BAND)))
  assert.match(fragment, /__thb\("tpl-s3","s3"\)/)
})

test('a band with nothing to show streams nothing', () => {
  assert.equal(streamBand({ id: 's9', title: 'Empty', blocks: [], entries: [], footnotes: [] }), '')
})

test('hero extras fill the legend from the sources actually used', () => {
  const extras = streamHeroExtras([BAND])
  assert.match(extras, /Wikimedia Commons/)
  // The access link makes the page an Internet Archive page too.
  assert.match(extras, /Internet Archive/)
  assert.match(extras, /__fill\("tpl-legend",".legend"\)/)
  // No corroborated cards → no notes fragment at all.
  assert.doesNotMatch(extras, /tpl-notes/)
})

test('open + fragments + close compose a complete document', () => {
  const page =
    streamOpen({ title: 'T', units: UNITS }) +
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
