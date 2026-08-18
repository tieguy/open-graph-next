import test from 'node:test'
import assert from 'node:assert/strict'

import { extractInfobox } from '../src/wikipedia.js'
import { bandParts } from '../src/emit-html.js'

// Markup shapes are taken from a real parse response (John Stuart Yeates,
// cached 2026-08-08): `infobox biography vcard`, an unscaled protocol-relative
// image with utm tracking params, a dedup <link> inside a cell, footnote
// markers inside data cells. Condensed, not invented.

const IMAGE_ROW =
  '<tr><td colspan="2" class="infobox-image">' +
  '<span class="mw-default-size" typeof="mw:File/Frameless">' +
  '<a href="/wiki/File:John_Stuart_Yeates_1929_(cropped).jpg" class="mw-file-description">' +
  '<img src="//upload.wikimedia.org/wikipedia/commons/b/b8/John_Stuart_Yeates_1929_%28cropped%29.jpg?utm_source=en.wikipedia.org&amp;utm_campaign=parser" ' +
  'srcset="//upload.wikimedia.org/wikipedia/commons/thumb/b/b8/x.jpg/500px-x.jpg 2x" ' +
  'decoding="async" width="250" height="300" class="mw-file-element" /></a></span>' +
  '<div class="infobox-caption">Yeates in 1929</div></td></tr>'

const BOX =
  '<table class="infobox biography vcard"><tbody>' +
  '<tr><th colspan="2" class="infobox-above"><div class="fn">John Stuart Yeates</div></th></tr>' +
  IMAGE_ROW +
  '<tr><th scope="row" class="infobox-label">Died</th><td class="infobox-data">' +
  '24 August 1986 <a href="/wiki/Palmerston_North" title="Palmerston North">Palmerston North</a>' +
  '<sup id="cite_ref-1" class="reference"><a href="#cite_note-JARS_bio-1">[1]</a></sup></td></tr>' +
  '<tr><td colspan="2" class="infobox-full-data">' +
  '<link rel="mw-deduplicated-inline-style" href="mw-data:TemplateStyles:r1358620234" /><b>Scientific career</b></td></tr>' +
  '</tbody></table>'

const PAGE = (box) => `<div class="mw-parser-output"><p>Before.</p>${box}<p>After.</p></div>`

// ------------------------------------------------------------- basic extent

test('no infobox, no result', () => {
  assert.equal(extractInfobox('<p>Nothing here.</p>'), null)
})

test('the box comes out whole, and only the box', () => {
  const out = extractInfobox(PAGE(BOX))
  assert.ok(out.html.startsWith('<table class="infobox'))
  assert.ok(out.html.endsWith('</table>'))
  assert.doesNotMatch(out.html, /Before\.|After\./)
  assert.match(out.html, /John Stuart Yeates/)
})

test('a nested table does not cut the scan short', () => {
  // The same depth-walk rule infoboxLinks already obeys: an inner </table>
  // (a crew list, a taxobox subtable) must not end the box.
  const nested = BOX.replace(
    '</tbody></table>',
    '<tr><td class="infobox-data"><table><tbody><tr><td>inner</td></tr></tbody></table></td></tr>' +
      '<tr><th scope="row" class="infobox-label">Tail</th><td class="infobox-data">still inside</td></tr>' +
      '</tbody></table>',
  )
  const out = extractInfobox(PAGE(nested))
  assert.match(out.html, /still inside/)
  assert.ok(out.html.endsWith('</table>'))
})

// ------------------------------------------------------------- sanitization

test('navbar, hidden rows, edit sections, and Kartographer are dropped', () => {
  const hazards = BOX.replace(
    '</tbody></table>',
    '<tr class="infobox-hiddenrow"><td>secretly collapsed</td></tr>' +
      '<tr><td class="infobox-navbar"><div class="navbar">v · t · e</div></td></tr>' +
      '<tr><td class="infobox-full-data"><div class="mw-kartographer-container"><a class="mw-kartographer-map">map</a></div></td></tr>' +
      '<tr><td><span class="mw-editsection">[edit]</span>kept text</td></tr>' +
      '</tbody></table>',
  )
  const out = extractInfobox(PAGE(hazards))
  assert.doesNotMatch(out.html, /secretly collapsed/)
  assert.doesNotMatch(out.html, /v · t · e|navbar/)
  assert.doesNotMatch(out.html, /kartographer/)
  assert.doesNotMatch(out.html, /mw-editsection|\[edit\]/)
  assert.match(out.html, /kept text/)
})

test('style and link tags are stripped; footnote markers go too', () => {
  const styled = BOX.replace(
    '<tbody>',
    '<tbody><tr><td><style data-mw-deduplicate="TemplateStyles:r1">.infobox{color:red}</style>x</td></tr>',
  )
  const out = extractInfobox(PAGE(styled))
  assert.doesNotMatch(out.html, /<style|<link/)
  // The dedup <link> rode inside infobox-full-data; its <b> survives.
  assert.match(out.html, /<b>Scientific career<\/b>/)
  // A footnote marker points at an anchor this page does not have.
  assert.doesNotMatch(out.html, /cite_note|class="reference"/)
})

// -------------------------------------------------------------------- links

test('article links stay root-relative for relink; namespace links go absolute', () => {
  const out = extractInfobox(PAGE(BOX))
  // Palmerston North should later land on another enriched render.
  assert.match(out.html, /href="\/wiki\/Palmerston_North"/)
  // The File: page is the image's attribution trail and stays on Wikipedia.
  assert.match(
    out.html,
    /href="https:\/\/en\.wikipedia\.org\/wiki\/File:John_Stuart_Yeates_1929_\(cropped\)\.jpg"/,
  )
})

// ------------------------------------------------------------------- images

test('image URLs normalize to https, lose tracking params and srcset, and are reported', () => {
  const out = extractInfobox(PAGE(BOX))
  const clean =
    'https://upload.wikimedia.org/wikipedia/commons/b/b8/John_Stuart_Yeates_1929_%28cropped%29.jpg'
  assert.match(out.html, new RegExp(`src="${clean.replace(/[.\\/()]/g, '\\$&')}"`))
  assert.doesNotMatch(out.html, /srcset=|utm_source|utm_campaign/)
  assert.deepEqual(out.images, [clean])
  // The caption is content, not apparatus.
  assert.match(out.html, /Yeates in 1929/)
})

// ------------------------------------------------- the lede rail's fallback

// Enough prose that a hero is allowed to float (FLOAT_MIN_PROSE) — the gate
// tests must not trip the prose rule by accident. The infobox itself is
// exempt, and there is a dedicated test for that below.
const PROSE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(14)

const INFOBOX = {
  html: '<table class="infobox"><tbody><tr><th class="infobox-above">Yeates</th></tr></tbody></table>',
  images: ['https://upload.wikimedia.org/x.jpg'],
}

const ledeBand = (over = {}) => ({
  id: 'slede',
  title: 'John Stuart Yeates',
  blocks: [{ kind: 'p', text: PROSE, html: `<p>${PROSE}</p>` }],
  entries: [],
  infobox: INFOBOX,
  ...over,
})

const subjectFind = {
  source: 'rijksmuseum',
  standing: 'subject-record',
  title: 'Their own record of the subject',
  imageUrl: 'https://example.test/subject.jpg',
}

const weakFind = {
  source: 'met',
  title: 'A picture of something merely linked',
  imageUrl: 'https://example.test/linked.jpg',
}

test('a lede with no find renders the infobox in the rail, with the lens-fold', () => {
  const { rail } = bandParts(ledeBand(), new Map(), '/wiki/')
  assert.match(rail, /<table class="infobox"/)
  assert.match(rail, /the Wikipedia article/, 'the fold names whose box this is')
  assert.match(rail, /yet/, 'the absence is a measurement, not a verdict')
  assert.match(rail, /href="\/"/, 'the partner list link points at the front page')
  assert.doesNotMatch(rail, /class="src"/, 'furniture, not a find: no source tag')
  // The fold rides INSIDE the box — its last row, where the navbar sat —
  // never above it, and its glyph is the LENS magnifier, not a ⓘ.
  const table = rail.slice(rail.indexOf('<table class="infobox"'), rail.indexOf('</table>'))
  assert.match(table, /<tr class="ib-why-row"><td colspan="2"><details class="ib-why">/)
  assert.match(table, /<svg class="rinfo"/)
  assert.doesNotMatch(rail, /ⓘ/)
})

test('a find about the subject keeps the rail; the infobox stands down', () => {
  const { rail } = bandParts(ledeBand({ entries: [subjectFind] }), new Map(), '/wiki/')
  assert.match(rail, /Their own record of the subject/)
  assert.doesNotMatch(rail, /<table class="infobox"/)
})

test('a weak hero yields to the infobox and leads its shelf instead', () => {
  const { rail, deck } = bandParts(ledeBand({ entries: [weakFind] }), new Map(), '/wiki/')
  assert.match(rail, /<table class="infobox"/)
  assert.doesNotMatch(rail, /merely linked/)
  assert.match(deck, /merely linked/, 'demoted, not dropped')
})

test('the infobox floats even beside a stub\'s worth of prose', () => {
  // FLOAT_MIN_PROSE demotes a HERO below 700 characters; a stub's short prose
  // wrapping beneath its infobox is what a real stub looks like, so the box is
  // exempt.
  const short = ledeBand({ blocks: [{ kind: 'p', text: 'Born. Died.', html: '<p>Born. Died.</p>' }] })
  const { rail } = bandParts(short, new Map(), '/wiki/')
  assert.match(rail, /<table class="infobox"/)
})

test('a band with no infobox field renders exactly as before', () => {
  const { rail, deck } = bandParts(ledeBand({ infobox: undefined, entries: [weakFind] }), new Map(), '/wiki/')
  assert.match(rail, /merely linked/, 'the weak hero keeps the slot when there is nothing to yield to')
  assert.doesNotMatch(deck, /merely linked/)
})

test('the infobox image keeps its Wikimedia URL; the demo base does not eat the File: link', () => {
  // The article's own images are the exempt host and never enter the inline
  // map; the swap loop that once consulted it here is gone (2026-08-17), so
  // even a map that DID hold bytes for the URL must not rewrite the box.
  const box = {
    html:
      '<table class="infobox"><tbody><tr><td class="infobox-image">' +
      '<a href="https://en.wikipedia.org/wiki/File:X.jpg"><img src="https://upload.wikimedia.org/x.jpg" /></a>' +
      '<a href="/wiki/Palmerston_North">Palmerston North</a></td></tr></tbody></table>',
    images: ['https://upload.wikimedia.org/x.jpg'],
  }
  const inline = new Map([['https://upload.wikimedia.org/x.jpg', 'data:image/jpeg;base64,ZZ']])
  const { rail } = bandParts(ledeBand({ infobox: box }), inline, 'https://demo.test/wiki/')
  assert.match(rail, /src="https:\/\/upload\.wikimedia\.org\/x\.jpg"/)
  assert.match(rail, /href="https:\/\/en\.wikipedia\.org\/wiki\/File:X\.jpg"/)
  assert.match(rail, /href="https:\/\/demo\.test\/wiki\/Palmerston_North"/)
  assert.match(rail, /href="https:\/\/demo\.test\/"/, 'front-page link derived from the demo base')
})

test('a standalone batch render keeps the fold copy but drops the dead link', () => {
  // Batch with no home renders against the en.wikipedia.org base; a front-page
  // link would point at Wikipedia, which is not where the partner list lives.
  const { rail } = bandParts(ledeBand(), new Map(), 'https://en.wikipedia.org/wiki/')
  assert.match(rail, /the collections this page draws on/)
  assert.doesNotMatch(rail, /href="https:\/\/en\.wikipedia\.org\/"/)
})

test('the streamed lede fragment carries the box, so the mount script places it', async () => {
  // serve.js ships bandRail's output verbatim inside the lede band's
  // <template>; if the box is in the fragment, __thb mounts it before the
  // prose like any hero float. No serve.js change is needed for that, which
  // is what this pins.
  const { bandRail } = await import('../src/emit-html.js')
  const fragment = bandRail(ledeBand(), new Map(), '/wiki/')
  assert.match(fragment, /<aside class="rail"><div class="ib-slot">/)
  assert.match(fragment, /<table class="infobox"/)
})

// ---------------------------------------- holder pages: merged panel in infobox slot

test('on a holder page with an infobox, the lede slot holds the merged panel', () => {
  const holderRecord = {
    institution: 'Rijksmuseum',
    creator: 'Rembrandt van Rijn',
    date: '1642',
    medium: 'Oil on canvas',
    dimensions: '379.5 cm × 453.5 cm',
    accession: 'SK-C-5',
    rights: { label: 'Public domain' },
  }
  const { rail } = bandParts(
    ledeBand({
      infobox: {
        html: '<table class="infobox"><tbody>' +
          '<tr><th>Artist</th><td>Rembrandt van Rijn</td></tr>' +
          '<tr><th>Date</th><td>1642</td></tr>' +
          '</tbody></table>',
        images: [],
      },
      holder: { record: holderRecord },
    }),
    new Map(),
    '/wiki/',
  )
  // The holder panel replaces the plain infobox
  assert.match(rail, /<table class="infobox holder-panel"/)
  // Dual-attributed rows should be present (chip for Rijksmuseum)
  assert.match(rail, /Rijksmuseum/)
  // Wikipedia-attributed rows also present
  assert.match(rail, /Wikipedia/)
})

test('on a holder page with NO infobox, the lede slot holds the record-derived panel', () => {
  const holderRecord = {
    institution: 'Rijksmuseum',
    creator: 'Rembrandt van Rijn',
    date: '1642',
    medium: 'Oil on canvas',
    accession: 'SK-C-5',
    rights: { label: 'Public domain' },
  }
  const { rail } = bandParts(
    ledeBand({
      infobox: undefined,
      holder: { record: holderRecord },
    }),
    new Map(),
    '/wiki/',
  )
  // The panel still renders from the record alone
  assert.match(rail, /<table class="infobox holder-panel"/)
  assert.match(rail, /Rijksmuseum/)
  assert.match(rail, /SK-C-5/)
})

test('on a holder page with an infobox showing a conflict, both values render with source chips', () => {
  const holderRecord = {
    institution: 'Rijksmuseum',
    creator: 'Rembrandt van Rijn',
    date: '1642',
    medium: 'Oil on canvas',
    // Note: dimensions differ from the infobox
    dimensions: '379.5 cm × 453.5 cm',
    accession: 'SK-C-5',
    rights: { label: 'Public domain' },
  }
  const { rail } = bandParts(
    ledeBand({
      infobox: {
        html: '<table class="infobox"><tbody>' +
          '<tr><th>Dimensions</th><td>363 cm × 437 cm</td></tr>' +
          '</tbody></table>',
        images: [],
      },
      holder: { record: holderRecord },
    }),
    new Map(),
    '/wiki/',
  )
  // Both Wikipedia and Rijksmuseum dimensions should be present
  assert.match(rail, /363 cm/)
  assert.match(rail, /379\.5 cm/)
  assert.match(rail, /Wikipedia/)
  assert.match(rail, /Rijksmuseum/)
})

test('on a non-holder page, the infobox behavior is unchanged', () => {
  const { rail } = bandParts(ledeBand(), new Map(), '/wiki/')
  assert.match(rail, /<table class="infobox"/)
  assert.doesNotMatch(rail, /holder-panel/)
  assert.match(rail, /own infobox/, 'the fold is present')
})

// ------------------------------------------------- the prose-budgeted gutter

test('every image-bearing single floats into the gutter; galleries stay in the deck', () => {
  // The whole rule (2026-08-09, Prime crew review): singles in the margin,
  // galleries under the section. The per-700-characters budget that briefly
  // rationed the gutter was fitted against the section-duplication bug's
  // phantom prose and is gone.
  const prose = 'x'.repeat(2900)
  const mk = (source, title) => ({ source, title, imageUrl: `https://example.test/${source}.jpg` })
  const { rail, deck } = bandParts({
    id: 's5',
    title: 'Section',
    blocks: [{ kind: 'p', text: prose, html: `<p>${prose}</p>` }],
    entries: [
      mk('met', 'Hero'),
      mk('openstreetmap', 'Map: Somewhere'),
      mk('inaturalist', 'A taxon'),
      mk('gbif', 'Recorded'),
      mk('dpla', 'Paper A'), mk('dpla', 'Paper B'),
    ],
  }, new Map(), '/wiki/')
  assert.match(rail, /hero-card/)
  const more = rail.match(/<aside class="rail-more">([\s\S]*)<\/aside>/)?.[1] ?? ''
  assert.match(more, /Map: Somewhere/, 'first single floats')
  assert.match(more, /A taxon/, 'second single floats')
  assert.match(more, /Recorded/, 'third single floats too — no budget')
  assert.doesNotMatch(deck, /Recorded/)
  assert.match(deck, /Paper A/, 'galleries never float')
})

test('a short section floats nothing extra, and a floated single still carries its claim', () => {
  const prose = 'x'.repeat(2200) // above FLOAT_MIN_PROSE, so the gutter is open
  const mk = (source, title) => ({ source, title, imageUrl: `https://example.test/${source}.jpg` })
  const band = {
    id: 's6',
    title: 'Section',
    blocks: [{ kind: 'p', text: prose, html: `<p>${prose}</p>` }],
    entries: [mk('met', 'Hero'), mk('openstreetmap', 'Map: Somewhere')],
    samples: [{ source: 'openstreetmap', topic: null, shown: 1, total: 83, text: 'A sample: 1 of 83 mapped places' }],
  }
  const { rail, deck } = bandParts(band, new Map(), '/wiki/')
  assert.match(rail, /rail-more[\s\S]*1 of 83/, 'the claim rides the floated caption')
  assert.doesNotMatch(deck, /class="disclosure"/, 'nothing fell to the orphan paragraph')
  // The same band with stub prose keeps the deck arrangement entirely.
  const stub = bandParts({ ...band, blocks: [{ kind: 'p', text: 'Short.', html: '<p>Short.</p>' }] }, new Map(), '/wiki/')
  assert.doesNotMatch(stub.rail, /rail-more/)
  assert.match(stub.deck, /Map: Somewhere/)
})

// The real holder-lede shape: the band carries BOTH the holder context and
// the holder-work entry, exactly as src/discover.js emits them together —
// the fixture shape that exposed the hero-vs-panel either/or bug.
const HOLDER_RECORD = {
  partner: 'rijks', institution: 'Rijksmuseum', title: 'The Night Watch',
  creator: 'Rembrandt van Rijn', date: '1642', medium: 'Oil on canvas',
  dimensions: '379.5 cm \u00d7 453.5 cm', accession: 'SK-C-5',
  imageUrl: 'https://example.test/nw.jpg',
  href: 'https://www.rijksmuseum.nl/en/collection/SK-C-5',
  rights: { publicDomain: true, label: 'Public domain' },
}
const HOLDER_PROSE = 'The Night Watch is a 1642 painting by Rembrandt van Rijn. '.repeat(30)
const holderLede = (over = {}) => ({
  id: 'slede', title: 'The Night Watch',
  blocks: [{ kind: 'p', text: HOLDER_PROSE, html: `<p>${HOLDER_PROSE}</p>` }],
  entries: [{ source: 'rijks', title: HOLDER_RECORD.title, imageUrl: HOLDER_RECORD.imageUrl,
    href: HOLDER_RECORD.href, standing: 'holder-work',
    attribution: { author: 'Rijksmuseum', license: null }, rights: { copy: null } }],
  infobox: { html: '<table class="infobox"><tbody><tr><th>Dimensions</th><td>363 cm \u00d7 437 cm</td></tr></tbody></table>', images: [] },
  holder: { partner: 'rijks', record: HOLDER_RECORD, medium: 'painting', property: 'P13234', subjectQid: 'Q219831' },
  ...over,
})

test('a real holder lede shows the hero AND the merged panel, stacked', () => {
  const { rail } = bandParts(holderLede(), new Map(), '/wiki/')
  assert.match(rail, /hero-card/, 'the hero float is the work')
  assert.match(rail, /<table class="infobox holder-panel"/, 'and the merged panel is in the lede slot')
  assert.match(rail, /class="rail rail-panel"/, 'the panel aside clears the hero float')
  // The panel shows the conflict: Wikipedia\u2019s dimensions and the museum\u2019s.
  assert.match(rail, /363 cm/)
  assert.match(rail, /379\.5 cm/)
})

test('no box at all and nothing to append renders no panel and no empty shell', () => {
  // No infobox and a record with no append fields: the hero stands alone;
  // nothing else renders in the slot.
  const bare = { institution: 'Rijksmuseum', rights: {} }
  const band = holderLede({
    infobox: null,
    holder: { partner: 'rijks', record: bare, medium: 'painting', property: 'P13234', subjectQid: 'Q219831' },
  })
  const { rail } = bandParts(band, new Map(), '/wiki/')
  assert.match(rail, /hero-card/)
  assert.doesNotMatch(rail, /holder-panel/)
  assert.doesNotMatch(rail, /ib-slot/)
})

test('an empty panel with a box present falls back to the old suppression', () => {
  // An infobox whose only row is furniture (image + caption) parses to zero
  // fact rows, so the panel is empty even though `infobox` is present \u2014 the
  // one shape that reaches the fallthrough. The holder hero (rank -1) then
  // suppresses the plain box exactly as it did before the panel existed:
  // ONE rail aside, no ib-slot, no second float. (No gate-passed record
  // produces this today; every one carries a rights label.)
  const bare = { institution: 'Rijksmuseum', rights: {} }
  const band = holderLede({
    infobox: { html: '<table class="infobox"><tbody><tr><td colspan="2" class="infobox-image"><img src="//u/x.jpg"><div class="infobox-caption">cap</div></td></tr></tbody></table>', images: [] },
    holder: { partner: 'rijks', record: bare, medium: 'painting', property: 'P13234', subjectQid: 'Q219831' },
  })
  const { rail } = bandParts(band, new Map(), '/wiki/')
  assert.equal((rail.match(/<aside/g) ?? []).length, 1)
  assert.match(rail, /hero-card/)
  assert.doesNotMatch(rail, /holder-panel/)
  assert.doesNotMatch(rail, /ib-slot/)
})

test('a labelled image row keeps its Wikimedia src — the panel never rewrites the box', () => {
  // Same rule as the plain box: the article's own images hotlink from
  // Wikimedia and no inline map rewrites them, even one holding their URL.
  const url = 'https://upload.wikimedia.org/x/portrait.jpg'
  const band = holderLede({
    infobox: {
      html: `<table class="infobox"><tbody><tr><th>Portrait</th><td><img src="${url}"><br>the painting</td></tr></tbody></table>`,
      images: [url],
    },
  })
  const inline = new Map([[url, 'data:image/jpeg;base64,AAA']])
  const { rail } = bandParts(band, inline, '/wiki/')
  assert.match(rail, /src="https:\/\/upload\.wikimedia\.org\/x\/portrait\.jpg"/)
  assert.doesNotMatch(rail, /data:image\/jpeg;base64,AAA/)
})

test('the panel\u2019s Wikipedia rows re-base their article links in standalone renders', () => {
  const band = holderLede({
    infobox: { html: '<table class="infobox"><tbody><tr><th>Artist</th><td><a href="/wiki/Rembrandt">Rembrandt van Rijn</a></td></tr></tbody></table>', images: [] },
  })
  const { rail } = bandParts(band, new Map(), 'https://en.wikipedia.org/wiki/')
  assert.match(rail, /href="https:\/\/en\.wikipedia\.org\/wiki\/Rembrandt"/)
})

test('holder furniture never reaches a non-lede band, whatever the band carries', () => {
  // Both renderers read b.holder; if a page-wide value ever leaks onto a
  // section band (it did once \u2014 an await collapse in discover), the panel
  // must still not render there. The guard lives in bandParts.
  const band = { ...holderLede(), id: 's3', title: 'Reception' }
  // The record carries a requiredStatement so all three furniture pieces
  // are genuinely reachable and each absence assertion can fail.
  band.holder = {
    ...band.holder,
    record: { ...band.holder.record, requiredStatement: 'Photo: SMK Open' },
  }
  const { rail } = bandParts(band, new Map(), '/wiki/')
  assert.doesNotMatch(rail, /holder-panel/)
  assert.doesNotMatch(rail, /class="zoom"/)
  assert.doesNotMatch(rail, /<p class="req-statement">/)
})
