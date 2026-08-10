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

// Enough prose that the section's best find is allowed to float. `bandParts`
// demotes a hero into the deck below FLOAT_MIN_PROSE (700 characters), because
// a float with no text beside it leaves the left column blank — so a fixture
// short enough to trip that rule would be testing the rule rather than the
// shelving these tests are about. Do not trim this to taste; the length is the
// point. The dedicated test for the rule itself builds its own short band.
const ENOUGH_PROSE = ' Lorem ipsum dolor sit amet, consectetur adipiscing elit.'.repeat(14)

const UNITS = [
  { index: '0', title: 'Test Article', blocks: [{ kind: 'p', text: 'Lede prose.' }] },
  {
    index: '3',
    title: 'One',
    blocks: [
      {
        kind: 'p',
        text: `Alpha.${ENOUGH_PROSE}`,
        html: `Alpha <a class="wl" href="/wiki/Beta">Beta</a>.<sup class="ref"><a href="#s3-note-x">[1]</a></sup>${ENOUGH_PROSE}`,
      },
    ],
  },
]

const BAND = {
  id: 's3',
  title: 'One',
  blocks: UNITS[1].blocks,
  // Two entries, because one of a band's finds is hoisted into the rail as the
  // section's hero and the rest are shelved — a one-entry band has no deck at
  // all, which is correct but tests nothing about shelving.
  entries: [
    {
      source: 'met',
      title: 'A photo',
      imageUrl: 'https://example.test/x.jpg',
      attribution: { author: 'Someone', license: 'CC0' },
      why: 'About Santiago Calatrava, which this section links to',
    },
    {
      source: 'met',
      title: 'Another photo',
      imageUrl: 'https://example.test/y.jpg',
      attribution: { author: 'Someone Else', license: 'CC0' },
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
  samples: [],
}

// A sample claim matching BAND's single Met shelf (source 'met', no topic).
const MET_SAMPLE = {
  source: 'met',
  topic: null,
  shown: 1,
  total: 9,
  text: 'A sample: 1 of the 9 objects the Met holds',
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

test('the best find floats in the rail, media rides the deck, references close the section', () => {
  const { rail, deck, refs } = bandParts(BAND)
  // The rail carries the section's hero and nothing bibliographic. It held the
  // references until 2026-08-05, which spent the page's most prominent slot on
  // a closed fold.
  assert.match(rail, /^<aside class="rail"><figure class="card hero-card">/)
  assert.doesNotMatch(rail, /References in this section/)
  assert.doesNotMatch(rail, /<div class="carousel"/)
  // The surviving single is an image card, so it floats into the gutter
  // (2026-08-09: singles in the margin, galleries in the deck) — and this
  // band has no gallery, so it has no deck at all.
  assert.match(rail, /<aside class="rail-more">/)
  assert.equal(deck, '')
  // The references are their own part now, and last.
  assert.match(refs, /^<div class="refs">/)
  assert.match(refs, /References in this section/)
  // The hoisted find is NOT also in the gutter: two entries in, one hero and
  // one gutter thumb.
  const more = rail.match(/<aside class="rail-more">([\s\S]*)<\/aside>/)[1]
  assert.match(rail, /A photo/)
  assert.match(more, /Another photo/)
  assert.doesNotMatch(more, /A photo</)
})

test('a section with too little prose to wrap a float gets no float', () => {
  // Apollo 11's "Multimedia" section is the case: ten characters of prose and a
  // floated thumbnail, leaving 365px of blank left column until the deck
  // cleared it. The find is not dropped — it is shelved as an ordinary card,
  // and it leads its shelf, because it is still the section's best find.
  const short = { ...BAND, blocks: [{ kind: 'p', text: 'Media.', html: 'Media.' }] }
  const { rail, deck } = bandParts(short)
  assert.doesNotMatch(rail, /class="rail"/, 'no float beside three words of prose')
  assert.match(deck, /A photo/, 'the hero is shelved rather than lost')
  assert.match(deck, /Another photo/)
  // Order is preserved: the would-be hero still leads its shelf.
  assert.ok(deck.indexOf('A photo') < deck.indexOf('Another photo'))
  // And the same band with real prose keeps its float, so the rule is the
  // prose length and nothing else about these entries.
  assert.match(bandParts(BAND).rail, /class="rail"/)
})

test('a shared why hoists to the head even on a shelf with no topic label', () => {
  // The badge says "6 of 10"; this is the line that says ten of WHAT. It used
  // to hoist only on topic-split shelves, so the common case — one source, one
  // anchor — repeated the line on every card and left the badge unexplained.
  // Three entries: one is hoisted into the hero, leaving two on the shelf —
  // the hoist needs more than one card to be worth doing.
  const { deck } = bandParts({
    ...BAND,
    entries: [
      ...BAND.entries,
      {
        source: 'met',
        title: 'A third photo',
        imageUrl: 'https://example.test/z.jpg',
        why: 'About Santiago Calatrava, which this section links to',
      },
    ],
    samples: [MET_SAMPLE],
  })
  assert.match(deck, /<span class="count"[^>]*>2 of 9<\/span><\/div><p class="carousel-why">About Santiago Calatrava, which this section links to<\/p>/)
  assert.doesNotMatch(deck, /<span class="topic">/)
  // Said once under the head, not again on the card below it.
  assert.doesNotMatch(deck, /<p class="why">About Santiago Calatrava/)
})

test('a sample claim rides on the head of the shelf it is a sample of', () => {
  // It used to be a paragraph atop the deck, which on Brown v. Board counted
  // the DPLA shelf from above the Internet Archive and OpenStreetMap shelves.
  const { rail, deck } = bandParts({ ...BAND, samples: [MET_SAMPLE] })
  // One image card left after the hero hoist, so it floats (2026-08-09) —
  // and the claim rides its caption head INTO the gutter with it: the
  // disclosure moves with the card, never dropped.
  assert.match(
    rail,
    /<div class="single-head"><span class="src">The Met<\/span><span class="count" title="A sample: 1 of the 9 objects the Met holds">1 of 9<\/span><\/div>/,
  )
  // The floating paragraph is gone entirely when every claim found its shelf.
  assert.doesNotMatch(deck, /class="disclosure"/)
})

test('a count with no sample stays a bare number, and 1 alone is not badged', () => {
  const one = bandParts({ ...BAND, entries: [BAND.entries[0]] }).deck
  assert.doesNotMatch(one, /class="count"/) // hoisted to hero; nothing left to badge
  const two = bandParts({
    ...BAND,
    entries: [...BAND.entries, { source: 'met', title: 'A third', imageUrl: 'https://example.test/z.jpg' }],
  }).deck
  assert.match(two, /<span class="count">2<\/span>/)
})

test('a sample whose shelf never rendered still gets said, in the old paragraph', () => {
  // Nothing may be silently dropped: that is the entire point of disclosing.
  // Here the claim is about Europeana, which has no shelf in this band.
  const { deck } = bandParts({
    ...BAND,
    samples: [{ source: 'europeana', topic: 'X', shown: 4, total: 90, text: '4 of 90 items linked to X' }],
  })
  assert.match(
    deck,
    /<p class="disclosure"><b>A sample, not the whole shelf:<\/b> 4 of 90 items linked to X<\/p>/,
  )
})

test('a band with no media at all still says what it sampled', () => {
  const { rail, deck } = bandParts({
    ...BAND,
    entries: [],
    samples: [{ source: 'met', topic: null, shown: 0, total: 9, text: 'A sample: 0 of 9' }],
  })
  assert.equal(rail, '')
  assert.match(deck, /<p class="disclosure">/)
})

test('a band with nothing worth leading with gets no float at all', () => {
  // A text-only citation card blown up to a 330px float is the thin box the
  // references fold used to be. Better to have no rail and full-width prose.
  const { rail, deck } = bandParts({
    ...BAND,
    entries: [{ source: 'internet_archive', title: 'A cited scan', why: 'Cited here' }],
  })
  assert.equal(rail, '')
  assert.match(deck, /A cited scan/)
})

test('an anchor too broad to sample becomes a sentence and a browse link', () => {
  const { deck } = bandParts({
    ...BAND,
    broad: [
      {
        source: 'europeana',
        label: 'oil painting',
        heading: null,
        total: 6123,
        url: 'https://www.europeana.eu/en/search?query=x',
      },
    ],
  })
  assert.match(deck, /<p class="broad">/)
  // "openly licensed" is not decoration: the count and the browse link both
  // carry Europeana's reusability=open filter, so the sentence must too.
  assert.match(deck, /<b>Not shown here:<\/b> the 6,123 openly licensed items Europeana’s partners link to “oil painting”/)
  assert.match(deck, /a heading too broad for this page to choose four that would belong/)
  assert.match(deck, /Browse them at Europeana ↗/)
  // No cards were invented to stand in for the ones that were not shown.
  assert.doesNotMatch(deck, /öljymaalaus/)
})

test('DPLA’s broad note counts what its partners cataloged, under the authorized heading', () => {
  const { deck } = bandParts({
    ...BAND,
    broad: [
      {
        source: 'dpla',
        label: 'spaceflight',
        heading: 'Space flight',
        total: 3016,
        url: 'https://dp.la/search?subject=%22Space%20flight%22',
      },
    ],
  })
  assert.match(deck, /<b>Not shown here:<\/b> the 3,016 items DPLA’s partners catalog under “Space flight”/)
  assert.doesNotMatch(deck, /openly licensed/)
  // It must not be confusable with the sample claim. On Brown v. Board the two
  // land in one band — "a sample of 54" and "1,409 is too many to sample" —
  // and phrasing them alike made them read as contradicting each other. Now
  // the sample rides its shelf's head and the absence closes the deck.
  const both = bandParts({
    ...BAND,
    samples: [MET_SAMPLE],
    broad: [{ source: 'dpla', label: 'the court', heading: 'United States. Supreme Court', total: 1409, url: 'https://dp.la/x' }],
  }).deck
  assert.ok(both.indexOf('1 of 9') < both.indexOf('Not shown here'))
  assert.ok(both.indexOf('<div class="carousel-track"') < both.indexOf('Not shown here'))
  assert.doesNotMatch(both, /class="disclosure"/)
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
  // The why line IS the control: one target, not a line plus a 12px glyph.
  // The glyph is the LENS magnifier (an SVG, class "info"), not a ⓘ.
  assert.match(
    rail,
    /<summary class="why" title="How this got here">About Santiago Calatrava, which this section links to<svg class="info"[^>]*>/,
  )
  assert.match(rail, /states its Met object ID \(P3634\)/)
  assert.match(rail, /<a class="fixlink" href="https:\/\/www\.wikidata\.org\/wiki\/Q1#P3634" target="_blank" rel="noopener">Check or fix it on Wikidata ↗<\/a>/)
  // A card with no trace shows no fold — an empty ⓘ is a broken promise.
  assert.doesNotMatch(bandRail(BAND), /class="prov"/)
})

test('a card whose why was hoisted to the shelf head still names its ⓘ', () => {
  // In a topic-labeled shelf the shared why moves to the head, so the fold has
  // no line to hang on and a bare glyph would be unlabeled. It says what it is.
  // The hoist only fires on a SPLIT source (more than one topic), so the
  // fixture needs a second topic as well as two cards left in the first.
  const mk = (title, topic) => ({
    source: 'met',
    title,
    imageUrl: `https://example.test/${title}.jpg`,
    topic,
    why: `About ${topic}, which this section links to`,
    trace: 'Wikidata’s item for X (Q1) states its Met object ID (P3634).',
  })
  const { deck } = bandParts({
    ...BAND,
    footnotes: [],
    entries: [mk('A', 'bridge'), mk('B', 'bridge'), mk('C', 'bridge'), mk('D', 'strait')],
  })
  assert.match(deck, /<p class="carousel-why">About bridge, which this section links to<\/p>/)
  // "How we know" named the act and never the subject — it did not say WHAT is
  // known. This fold answers how the item reached the page.
  assert.match(deck, /<summary class="why bare" title="How this got here"><svg class="info"[^>]*>.*?<\/svg>How is it connected\?<\/summary>/)
})

test('one source, two topics: the carousel splits, one labeled strip per topic', () => {
  const mk = (title, topic) => ({
    source: 'met',
    title,
    imageUrl: `https://example.test/${title}.jpg`,
    topic,
    why: `About ${topic}, which this section links to`,
  })
  // Four, not three: the first is hoisted into the rail as the section's hero,
  // and the shared-why hoist below needs two cards left in one topic to fire.
  const { rail, deck } = bandParts({
    ...BAND,
    footnotes: [],
    entries: [
      mk('Bridge deck', 'suspension bridge'),
      mk('Towers', 'suspension bridge'),
      mk('Cables', 'suspension bridge'),
      mk('The strait', 'Golden Gate'),
    ],
  })
  // The two-card topic keeps its gallery in the deck; the one-card topic
  // floats into the gutter (2026-08-09) wearing its topic label, since it
  // left a source that still shelves another topic. The surviving gallery,
  // now its source's ONLY topic, drops the label — a label distinguishes
  // strips within a source, and there is nothing left to distinguish from;
  // its hoisted why line still names the topic.
  assert.equal((deck.match(/<div class="carousel"/g) ?? []).length, 1)
  assert.equal((deck.match(/<div class="carousel single"/g) ?? []).length, 0)
  assert.match(rail, /<aside class="rail-more">[\s\S]*<span class="topic">Golden Gate<\/span>/)
  assert.doesNotMatch(deck, /<span class="topic">/)
  // The shared why line is said once under the head, not on every card.
  assert.match(
    deck,
    /<p class="carousel-why">About suspension bridge, which this section links to<\/p>/,
  )
  assert.doesNotMatch(
    deck,
    /<p class="why">About suspension bridge, which this section links to<\/p>/,
  )
  // The hero is not in a shelf, so nothing hoisted ITS why — it keeps its own
  // line. Scoping this assertion to the deck is the point: the same why text
  // legitimately appears once in the rail and never on a shelved card.
  assert.match(rail, /<p class="why">About suspension bridge, which this section links to<\/p>/)
})

test('one source, one topic: the lone surviving card floats, with no topic label', () => {
  const rail = bandRail(BAND)
  // The single is an image card, so it is a gutter thumb now (2026-08-09),
  // not a deck carousel — and a source's only topic still labels nothing.
  assert.match(rail, /<aside class="rail-more"><figure class="card">/)
  assert.equal((rail.match(/<div class="carousel single"/g) ?? []).length, 0)
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

test('the streamed shell says it is still looking until the legend arrives', () => {
  // Between the spine and the last rail the page knows none of its sources, so
  // the masthead used to show "Today, help came from:" above an empty strip.
  const open = streamOpen({ title: 'T', units: UNITS, home: '/' })
  assert.match(open, /<span class="finding" role="status">Asking libraries/)
  // No invented denominator: the page cannot know how many it will find, so
  // the stand-in carries no number at all. (Scoped to the span — the
  // stylesheet is full of legitimate percentages.)
  const finding = /<span class="finding"[^>]*>([^<]*)</.exec(open)[1]
  assert.doesNotMatch(finding, /\d|%/)
  // __fill replaces the legend's children, so the stand-in needs no teardown.
  const extras = streamHeroExtras([BAND])
  assert.match(extras, /__fill\("tpl-legend",".legend"\)/)
  assert.doesNotMatch(extras, /class="finding"/)
  // A cut stream must stop claiming to still be looking.
  assert.match(open, /Stopped before the search finished/)
})

test('the lede band has no h2 — the masthead already says the title, Vector never repeats it', () => {
  // Before this, a phone showed the title three deep: the masthead h1, the
  // lede band's h2, and the infobox's own title row. A real article page
  // starts its lede under the firstHeading with no repeated heading, so ours
  // does too. Section bands keep theirs.
  const open = streamOpen({ title: 'Test Article', units: UNITS, home: '/' })
  const lede = open.slice(open.indexOf('id="slede"'), open.indexOf('id="s3"'))
  assert.doesNotMatch(lede, /<h2>/)
  const s3 = open.slice(open.indexOf('id="s3"'))
  assert.match(s3, /<header class="band-head"><h2>One<\/h2><\/header>/)
})

test('a one-card source is a thumb, not a gallery of one', () => {
  // MediaWiki's own idiom: one image is a thumb with a caption, a group is a
  // gallery. A single find wearing a full shelf head read as a crate. The
  // source tag and any sample claim move INTO the card's caption; multi-card
  // shelves keep the box.
  const { rail, deck } = bandParts({
    ...BAND,
    footnotes: [],
    entries: [
      { source: 'met', title: 'A photo', imageUrl: 'https://example.test/x.jpg' },
      { source: 'met', title: 'Another photo', imageUrl: 'https://example.test/y.jpg' },
      { source: 'openstreetmap', title: 'Map: Somewhere', imageUrl: 'https://example.test/m.png' },
      // Text-only, so it CANNOT float (the margin is for things to look at)
      // and exercises the deck's own single-thumb shape.
      { source: 'dpla', title: 'A finding aid' },
    ],
    samples: [{ source: 'openstreetmap', topic: null, shown: 1, total: 83, text: 'A sample: 1 of 83 mapped places' }],
  })
  // The image singles float (2026-08-09); each is a thumb whose source and
  // claim ride inside the caption, never a gallery head.
  assert.match(rail, /<aside class="rail-more">[\s\S]*<div class="single-head">.*?OpenStreetMap.*?1 of 83/s)
  // The text single stays in the deck, as a thumb and not a gallery of one.
  assert.equal((deck.match(/class="carousel single"/g) ?? []).length, 1)
  assert.match(deck, /<div class="single-head">.*?DPLA/s)
  // A single never wears the gallery head, wherever it renders.
  assert.doesNotMatch(deck + rail, /<div class="carousel-head">/)
})
