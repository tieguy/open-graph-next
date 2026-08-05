import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bandParts,
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
      source: 'met',
      title: 'A photo',
      imageUrl: 'https://example.test/x.jpg',
      attribution: { author: 'Someone', license: 'CC0' },
      why: 'About Santiago Calatrava, which this section links to',
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
  disclosure: null,
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

test('references float in the rail; media shelves ride the full-width deck', () => {
  const { rail, deck } = bandParts(BAND)
  // The rail carries the references and nothing visual.
  assert.match(rail, /^<aside class="rail">/)
  assert.match(rail, /References in this section/)
  assert.doesNotMatch(rail, /<div class="carousel"/)
  // The deck carries the media and nothing bibliographic.
  assert.match(deck, /^<div class="deck">/)
  assert.match(deck, /<div class="carousel"/)
  assert.doesNotMatch(deck, /References in this section/)
  // A disclosure describes the media, so it opens the deck when one exists.
  const disclosed = bandParts({ ...BAND, disclosure: 'Media anchored on X' })
  assert.match(
    disclosed.deck,
    /^<div class="deck"><p class="disclosure"><b>A sample, not the whole shelf:<\/b> Media anchored on X<\/p>/,
  )
  assert.doesNotMatch(disclosed.rail, /disclosure/)
  // …and falls back to the rail when the band has notes but no media.
  const noMedia = bandParts({ ...BAND, entries: [], disclosure: 'Media anchored on X' })
  assert.match(
    noMedia.rail,
    /<p class="disclosure"><b>A sample, not the whole shelf:<\/b> Media anchored on X<\/p>/,
  )
  assert.equal(noMedia.deck, '')
})

test('a card says which anchor brought it here', () => {
  const rail = bandRail(BAND)
  assert.match(rail, /<p class="why">About Santiago Calatrava, which this section links to<\/p>/)
})

test('a card with a trace grows an ⓘ fold: the exact chain, and the door to the fix', () => {
  const rail = bandRail({
    ...BAND,
    entries: [
      {
        ...BAND.entries[0],
        trace: 'Wikidata’s item for X (Q1) states its Met object ID (P3634) — this card is what that identifier returned.',
        fix: { url: 'https://www.wikidata.org/wiki/Q1#P3634', label: 'Check or fix it on Wikidata' },
      },
    ],
  })
  assert.match(rail, /<details class="prov"><summary title="How this card got here">ⓘ<\/summary>/)
  assert.match(rail, /states its Met object ID \(P3634\)/)
  assert.match(rail, /<a href="https:\/\/www\.wikidata\.org\/wiki\/Q1#P3634" target="_blank" rel="noopener">Check or fix it on Wikidata ↗<\/a>/)
  // A card with no trace shows no fold — an empty ⓘ is a broken promise.
  assert.doesNotMatch(bandRail(BAND), /class="prov"/)
})

test('one source, two topics: the carousel splits, one labeled strip per topic', () => {
  const mk = (title, topic) => ({
    source: 'met',
    title,
    imageUrl: `https://example.test/${title}.jpg`,
    topic,
    why: `About ${topic}, which this section links to`,
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
  const carousels = rail.match(/<div class="carousel"/g) ?? []
  assert.equal(carousels.length, 2)
  assert.match(rail, /<span class="topic">suspension bridge<\/span>/)
  assert.match(rail, /<span class="topic">Golden Gate<\/span>/)
  // The shared why line is said once under the head, not on every card.
  assert.match(
    rail,
    /<p class="carousel-why">About suspension bridge, which this section links to<\/p>/,
  )
  assert.doesNotMatch(
    rail,
    /<p class="why">About suspension bridge, which this section links to<\/p>/,
  )
})

test('one source, one topic: a single carousel with no topic label, as before', () => {
  const rail = bandRail(BAND)
  assert.equal((rail.match(/<div class="carousel"/g) ?? []).length, 1)
  assert.doesNotMatch(rail, /<span class="topic">/)
})

test('the rail shows the actual footnotes, numbered as the prose numbers them', () => {
  const rail = bandRail(BAND)
  assert.match(rail, /References in this section · 1/)
  assert.match(rail, /<li class="fn" id="s3-note-x">/)
  assert.match(rail, /<span class="fn-num">1\.<\/span>/)
  assert.match(rail, /A Book/)
  // The open ecosystem's access link rides on the note itself.
  assert.match(rail, /Borrow at the Internet Archive/)
})

test('the references fold closed, with nothing else in the rail beside it', () => {
  const fns = Array.from({ length: 14 }, (_, i) => ({
    id: `s3-note-${i}`,
    num: String(i + 1),
    html: `Note ${i + 1}.`,
    access: null,
  }))
  const rail = bandRail({ ...BAND, entries: [], footnotes: fns })
  // Every note lives inside the fold, whose one-line summary counts them…
  assert.match(rail, /<details class="fn-fold"><summary>References in this section · 14<\/summary>/)
  assert.match(rail, /s3-note-13/)
  // The coverage line that used to sit beneath the fold is gone: it is now one
  // page-level sentence in the visibility panel (2026-08-04 review).
  assert.doesNotMatch(rail, /class="coverage"/)
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
  assert.match(extras, /The Met/)
  // The access link makes the page an Internet Archive page too.
  assert.match(extras, /Internet Archive/)
  assert.match(extras, /__fill\("tpl-legend",".legend"\)/)
  // Without `reach` there is no visibility panel and no corroborated cards,
  // so neither extra fragment is emitted at all.
  assert.doesNotMatch(extras, /tpl-notes/)
  assert.doesNotMatch(extras, /tpl-gap/)
  // The credit bar is always filled — it is what the masthead leads with.
  assert.match(extras, /tpl-legend/)
})

test('hero extras carry the visibility panel once the page knows what it found', () => {
  const reach = {
    hosts: new Set(['archive.org']),
    templates: new Set(),
    images: 3,
    kartographer: false,
    identifierBar: false,
  }
  const extras = streamHeroExtras([BAND], { reach })
  // Mounted into the masthead's second column — beside what the page says
  // about itself, never above it.
  assert.match(extras, /__fill\("tpl-gap",".gap-slot"\)/)
  // Shut by default: a reader meets one quiet line, not a table.
  assert.match(extras, /<details class="gap"><summary>Who helped, and who Wikipedia doesn’t show<\/summary>/)
  // The Archive is linked from the article; the Met is nowhere in it.
  // Two columns, so the two frames are structural rather than left to prose:
  // what the partner gave THIS page, and what Wikipedia can show of it.
  assert.match(extras, /<th scope="col">Helping here<\/th><th scope="col">On Wikipedia<\/th>/)
  assert.match(extras, /<tr class="gap-link"><th scope="row" class="gap-who">Internet Archive/)
  assert.match(extras, /<tr class="gap-invisible"><th scope="row" class="gap-who">The Met/)
  // "the article" alone reads as THIS page, which does show all of them.
  assert.match(extras, /The original Wikipedia article links to one of them and does not surface the rest/)
  // Never "can't": the premise is that Wikipedia could, and does not.
  assert.doesNotMatch(extras, /can(no|’)t show/)
  // Never "there is no route" — a bare external link always exists.
  assert.doesNotMatch(extras, /no route/i)
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
