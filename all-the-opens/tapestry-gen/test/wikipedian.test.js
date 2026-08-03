import test from 'node:test'
import assert from 'node:assert/strict'

import { articleBlocks, footnotesFor, referenceNotes, sanitizeFragment } from '../src/wikipedia.js'

// ---- sanitizeFragment -------------------------------------------------------

test('intra-wiki links survive; namespace and CITEREF links unwrap to text', () => {
  const out = sanitizeFragment(
    '<a href="/wiki/John_F._Kennedy" title="JFK">Kennedy</a> and ' +
      '<a href="/wiki/File:X.jpg">a file</a> and ' +
      '<a href="#CITEREF Orloff2000">Orloff 2000</a>',
  )
  assert.equal(out, '<a class="wl" href="/wiki/John_F._Kennedy">Kennedy</a> and a file and Orloff 2000')
})

test('external links keep their href and open elsewhere; other markup reduces', () => {
  const out = sanitizeFragment(
    '<span class="x"><i>Slate</i></span>: <a rel="nofollow" class="external text" ' +
      'href="https://example.test/a?b=1&amp;c=2">story</a><script>evil()</script>' +
      '<style>.mw-parser-output cite.citation{font-style:inherit}</style>',
  )
  assert.equal(
    out,
    '<i>Slate</i>: <a class="ext" href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener">story</a>',
  )
})

test('footnote markers re-anchor under the band prefix, or vanish without one', () => {
  const marker =
    '<sup id="cite&#95;ref-a_1-0" class="reference"><a href="#cite_note-a-1">' +
    '<span class="cite-bracket">&#91;</span>1<span class="cite-bracket">&#93;</span></a></sup>'
  assert.equal(
    sanitizeFragment(marker, { notePrefix: 's3' }),
    '<sup class="ref"><a href="#s3-note-a-1">&#91;1&#93;</a></sup>',
  )
  // Without a prefix (the Tapestry path never sets one) the marker's link has
  // nowhere to land, so it unwraps rather than pointing at nothing.
  assert.equal(sanitizeFragment(marker), '<sup class="ref">&#91;1&#93;</sup>')
})

// ---- referenceNotes + footnotesFor -----------------------------------------

const ARTICLE_HTML =
  '<p>Alpha<sup id="cite&#95;ref-a_1-0" class="reference"><a href="#cite_note-a-1">' +
  '<span class="cite-bracket">&#91;</span>1<span class="cite-bracket">&#93;</span></a></sup> beta.</p>' +
  '<ol class="references">' +
  '<li id="cite&#95;note-a-1"><span class="mw-cite-backlink">^</span> <span class="reference-text">' +
  'Fineman, Mia. "<a class="external text" href="https://slate.test/x">Famous</a>". ' +
  '<i><a href="/wiki/Slate_(magazine)" title="Slate (magazine)">Slate</a></i>. ' +
  '<a href="/wiki/Special:BookSources/978-0-393-05912-8">ISBN 978-0-393-05912-8</a>.</span>\n</li>' +
  '</ol>'

test('referenceNotes decodes entity-escaped ids and keeps the rendered body', () => {
  const notes = referenceNotes(ARTICLE_HTML)
  assert.ok(notes.has('a-1'))
  assert.match(notes.get('a-1'), /^Fineman, Mia\./)
  assert.doesNotMatch(notes.get('a-1'), /mw-cite-backlink/)
})

test('blocks keep markers, and footnotesFor joins them to their notes in order', () => {
  const blocks = articleBlocks(ARTICLE_HTML, { notePrefix: 's2' })
  // Plain text is unchanged by the richer html: the Tapestry path still reads it.
  assert.equal(blocks[0].text, 'Alpha beta.')
  assert.match(blocks[0].html, /<sup class="ref"><a href="#s2-note-a-1">\[1\]<\/a><\/sup>/)

  const fns = footnotesFor(blocks, referenceNotes(ARTICLE_HTML), 's2')
  assert.equal(fns.length, 1)
  assert.equal(fns[0].id, 's2-note-a-1')
  assert.equal(fns[0].num, '1')
  // The BookSources link names the ISBN (normalized), then unwraps in the html.
  assert.equal(fns[0].isbn, '9780393059128')
  assert.match(fns[0].html, /<i><a class="wl" href="\/wiki\/Slate_\(magazine\)">Slate<\/a><\/i>/)
  assert.match(fns[0].html, /ISBN 978-0-393-05912-8/)
  assert.doesNotMatch(fns[0].html, /Special:BookSources/)
})

test('a marker whose note is missing yields no footnote, and duplicates collapse', () => {
  const blocks = [
    { html: '<a href="#s1-note-gone">[2]</a> and <a href="#s1-note-a-1">[1]</a> twice <a href="#s1-note-a-1">[1]</a>' },
  ]
  const fns = footnotesFor(blocks, new Map([['a-1', 'Body.']]), 's1')
  assert.deepEqual(fns.map((f) => [f.id, f.num]), [['s1-note-a-1', '1']])
})
