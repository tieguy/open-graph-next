import test from 'node:test'
import assert from 'node:assert/strict'

import { extractInfobox } from '../src/wikipedia.js'

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
