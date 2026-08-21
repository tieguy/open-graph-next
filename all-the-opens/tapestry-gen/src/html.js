// The one escaping rule, shared by every renderer. It lived in `emit.js` until
// 2026-08-04, which meant the website imported 325 lines of Tapestry
// frame-building — and, through it, all of `layout.js` — to reach seven lines.
// Retiring the curated generator made that tether the only thing keeping both
// modules alive, so it moved here.

export function escapeHtml(value) {
  return String(value)
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
}

/**
 * Plain text from a fragment of HTML or wikitext.
 *
 * Comments come out first, and whole. A comment can hold a tag —
 * `Rembrandt<!--he never left it.<ref>Bull</ref>--> painted this` is real
 * article wikitext — and a tag pattern reading from `<` to the first `>`
 * consumes the comment's opener together with that inner tag, leaving the
 * comment's tail behind as text. An opener with no `-->` after it runs to the
 * end of the fragment, which is how MediaWiki reads it too.
 *
 * The tag pattern then excludes `<` as well as `>`, so that a run of bare `<`
 * cannot make every failed match rescan to the end of the input. With `[^>]`
 * the cost is quadratic: 80,000 bare `<` took 4.2 seconds, and article text is
 * not a length this code gets to choose.
 */
export function stripTags(text) {
  return stripComments(String(text)).replaceAll(/<[^<>]+>/g, '')
}

function stripComments(text) {
  let out = ''
  let i = 0
  for (;;) {
    const open = text.indexOf('<!--', i)
    if (open < 0) return out + text.slice(i)
    out += text.slice(i, open)
    const close = text.indexOf('-->', open + 4)
    if (close < 0) return out
    i = close + 3
  }
}
