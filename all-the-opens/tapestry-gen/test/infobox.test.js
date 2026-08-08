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

test('batch inlining swaps the infobox image; the demo base does not eat the File: link', () => {
  const box = {
    html:
      '<table class="infobox"><tbody><tr><td class="infobox-image">' +
      '<a href="https://en.wikipedia.org/wiki/File:X.jpg"><img src="https://upload.wikimedia.org/x.jpg" /></a>' +
      '<a href="/wiki/Palmerston_North">Palmerston North</a></td></tr></tbody></table>',
    images: ['https://upload.wikimedia.org/x.jpg'],
  }
  const inline = new Map([['https://upload.wikimedia.org/x.jpg', 'data:image/jpeg;base64,ZZ']])
  const { rail } = bandParts(ledeBand({ infobox: box }), inline, 'https://demo.test/wiki/')
  assert.match(rail, /src="data:image\/jpeg;base64,ZZ"/)
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
