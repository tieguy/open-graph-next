import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commonsFileTitle, firstSentences, imageCredit, infoboxLinks } from '../src/wikipedia.js'
import { escapeHtml } from '../src/html.js'
import { buildHtml, sourcesUsed } from '../src/emit-html.js'

// What the shipped renderer and its article extraction promise. The curated
// generator's own tests — placement, Tapestry geometry, zip — retired with it
// on 2026-08-04 to attic/all-the-opens/tapestry-gen-curated/.

test('first sentences strip markup, footnotes and tables', () => {
  const html =
    '<table><tr><td>infobox</td></tr></table>' +
    '<p>Apollo 11 was a spaceflight.<sup>[1]</sup> It landed in 1969. A third one.</p>'
  const out = firstSentences(html, 2)
  assert.equal(out, 'Apollo 11 was a spaceflight. It landed in 1969.')
})

test('sentence splitting is not fooled by an initial', () => {
  const out = firstSentences('<p>John F. Kennedy spoke. Then he left.</p>', 1)
  assert.equal(out, 'John F. Kennedy spoke.')
})

test('decodes entities that would otherwise show as raw markup', () => {
  assert.equal(firstSentences('<p>Fish &amp; chips cost &lt;5.</p>', 1), 'Fish & chips cost <5.')
})

// --- attribution ------------------------------------------------------------

test('image credit is pulled from Commons extmetadata, with markup stripped', () => {
  const ext = {
    LicenseShortName: { value: 'CC BY-SA 4.0' },
    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:NASA">NASA</a>' },
  }
  assert.deepEqual(imageCredit(ext), { license: 'CC BY-SA 4.0', author: 'NASA' })
})

test('image credit tolerates a missing license or author', () => {
  assert.deepEqual(imageCredit({ Artist: { value: 'NASA' } }), { license: null, author: 'NASA' })
  assert.deepEqual(imageCredit({ LicenseShortName: { value: 'Public domain' } }), {
    license: 'Public domain', author: null,
  })
})

test('image credit is null when there is nothing to credit', () => {
  assert.equal(imageCredit(undefined), null)
  assert.equal(imageCredit({}), null)
})

test('infobox wikilinks are extracted from the lede infobox, not the body prose', () => {
  const html =
    '<table class="infobox vevent"><tbody>' +
    '<tr><th>Landing site</th><td><a href="/wiki/Sea_of_Tranquility" title="Sea of Tranquility">Mare Tranquillitatis</a></td></tr>' +
    '<tr><th>Launch site</th><td><a href="/wiki/Kennedy_Space_Center_Launch_Complex_39A" title="x">LC-39A</a></td></tr>' +
    '</tbody></table>' +
    '<p>Prose linking the <a href="/wiki/Moon" title="Moon">Moon</a>.</p>'
  assert.deepEqual(infoboxLinks(html).sort(), [
    'Kennedy Space Center Launch Complex 39A',
    'Sea of Tranquility',
  ])
})

test('infobox extraction skips non-article namespaces and de-dupes', () => {
  const html =
    '<table class="infobox"><tr><td>' +
    '<a href="/wiki/File:Apollo.jpg" title="File:Apollo.jpg">img</a>' +
    '<a href="/wiki/Neil_Armstrong" title="Neil Armstrong">Armstrong</a>' +
    '<a href="/wiki/Neil_Armstrong" title="Neil Armstrong">Armstrong</a>' +
    '</td></tr></table>'
  assert.deepEqual(infoboxLinks(html), ['Neil Armstrong'])
})

test('infobox extraction spans a nested table rather than stopping at the first close', () => {
  // Crew infoboxes often nest a table; a non-greedy match would drop links after it.
  const html =
    '<table class="infobox"><tr><td>' +
    '<table><tr><td><a href="/wiki/Buzz_Aldrin" title="Buzz Aldrin">Aldrin</a></td></tr></table>' +
    '<a href="/wiki/Sea_of_Tranquility" title="Sea of Tranquility">landing</a>' +
    '</td></tr></table>'
  const links = infoboxLinks(html)
  assert.ok(links.includes('Buzz Aldrin'))
  assert.ok(links.includes('Sea of Tranquility'), 'link after the nested table is still found')
})

test('infobox extraction returns nothing when there is no infobox', () => {
  assert.deepEqual(infoboxLinks('<p>No infobox <a href="/wiki/Moon">here</a>.</p>'), [])
})

// --- emit -------------------------------------------------------------------

test('card text is escaped so titles cannot inject markup', () => {
  assert.equal(escapeHtml('<script>"x"&</script>'), '&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;')
})

test('a commons file title is recovered from a thumbnail url', () => {
  const url =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/200px-Aldrin.jpg'
  // Spaces, not underscores: the API normalizes titles this way, and keying on
  // the raw URL form makes every dimension lookup silently miss.
  assert.equal(commonsFileTitle(url), 'File:Aldrin Apollo 11 original.jpg')
  assert.equal(commonsFileTitle('https://archive.org/services/img/apollo11'), null)
})

test('the footer states the provenance its caller gives it', () => {
  const html = buildHtml({
    title: 'T',
    description: 'd',
    bands: [],
    provenance: 'Generated from <code>somewhere/else/</code>.',
  })
  assert.match(html, /Generated from <code>somewhere\/else\/<\/code>\./)
  assert.doesNotMatch(html, /web-demo\/data\/apollo-11/)
})

test('a page with no stated provenance claims none', () => {
  const html = buildHtml({ title: 'T', description: 'd', bands: [] })
  assert.doesNotMatch(html, /Generated from/)
  assert.match(html, /CC BY-SA 4\.0/, 'the license line survives — it is true of every page')
})

// --- the legend describes this page, not the project ------------------------

// Same rule as the corroborated key: a legend entry for something the page does
// not contain is noise, and it implies a reach the page did not have. It also
// happens to be where the broken icons were — sources this page never used.

test('the legend names only the sources the page actually shows', () => {
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      entries: [{ id: 'x', title: 'X', source: 'internet_archive' }],
    },
  ]
  const html = buildHtml({ title: 'T', description: 'd', bands })
  assert.match(html, /Internet Archive/)
  assert.doesNotMatch(html, /GBIF/, 'nothing on this page came from GBIF')
  assert.doesNotMatch(html, /iNaturalist/)
  assert.doesNotMatch(html, /Free Law Project/)
})

test('a source with no fetchable icon still gets a legend entry, without a broken image', () => {
  // CourtListener returns 403 to anyone hotlinking its favicon. A named entry
  // with no picture beats an entry with a picture that will not load.
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      entries: [{ id: 'x', title: 'X', source: 'free_law' }],
    },
  ]
  const html = buildHtml({ title: 'T', description: 'd', bands, inline: new Map() })
  assert.match(html, /Free Law Project/)
  assert.doesNotMatch(html, /courtlistener\.com\/favicon/, 'no live hotlink that 403s')
})

test('a source reached only through footnote links still makes the legend', () => {
  // Footnotes carry no source slug — they are links. Apollo 11's references
  // borrow through the Archive and Open Library twenty times, and both would
  // otherwise vanish from the page's own legend.
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      footnotes: [
        {
          id: 'a-note-1',
          num: '1',
          html: 'A book. <a class="ext" href="https://openlibrary.org/books/OL1M">OL1M</a>.',
          access: { url: 'https://archive.org/details/x', label: 'Borrow' },
        },
      ],
    },
  ]
  // Only the borrow link we added counts. The article's OWN link to
  // openlibrary.org is the article citing a catalog, not Open Library
  // helping — and crediting it would also make every partner the article
  // already links look like a contributor in the visibility panel.
  assert.deepEqual(sourcesUsed(bands), ['internet_archive'])
  const withCatalog = [
    { ...bands[0], footnotes: [{ ...bands[0].footnotes[0],
      access: { url: 'https://openlibrary.org/books/OL1M', label: 'Cataloged · Open Library' } }] },
  ]
  assert.deepEqual(sourcesUsed(withCatalog), ['openlibrary'])
})
