#!/usr/bin/env node
/**
 * Regenerate `src/cc-icons.js` — the Creative Commons element glyphs, as one
 * inline SVG sprite.
 *
 *   WIKIMEDIA_UA_CONTACT=you@example.com NODE_USE_ENV_PROXY=1 node tools/build-cc-icons.mjs
 *
 * A sprite rather than data URIs, which is the opposite of what
 * `tools/build-icons.mjs` does for the partner favicons — and the difference is
 * the point. A favicon appears once or twice on a page; a license glyph appears
 * on nearly every card, three or four glyphs at a time, so a data URI would
 * re-embed the same 1.5 KB of path data forty times in one document. Defined
 * once as `<symbol>` and referenced by `<use>`, the whole set costs ~7 KB per
 * page and every reference after the first costs about thirty bytes.
 *
 * Source is Wikimedia Commons, not creativecommons.org: it is a host this
 * project is already a good citizen of, it is in the sandbox allowlist, and the
 * files are stable. The glyphs themselves are Creative Commons' trademarks,
 * used here for their intended purpose — marking the license status of the
 * thing beside them, accurately. That is the use CC's own marking guidance
 * asks for; it is not an endorsement claim and must never be made into one by
 * putting a glyph on a card whose terms we only guessed at.
 *
 * Run it when the mark vocabulary in `src/rights.js` changes. Not part of the
 * build: a deploy must never depend on a third-party host being up.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { coverDataUri, fromDataUri } from '../src/http.js'

const OUT = fileURLToPath(new URL('../src/cc-icons.js', import.meta.url))

// Mark id → [Commons file URL, the title a screen reader reads]. The ids are
// the `marks` vocabulary in src/rights.js and the two must not drift.
const GLYPHS = {
  cc: ['https://upload.wikimedia.org/wikipedia/commons/a/a3/Cc.logo.circle.svg', 'Creative Commons'],
  by: ['https://upload.wikimedia.org/wikipedia/commons/3/3c/Cc-by_new.svg', 'Attribution required'],
  sa: ['https://upload.wikimedia.org/wikipedia/commons/2/29/Cc-sa.svg', 'Share alike'],
  nc: ['https://upload.wikimedia.org/wikipedia/commons/d/db/Cc-nc.svg', 'Non-commercial use only'],
  nd: ['https://upload.wikimedia.org/wikipedia/commons/c/c7/Cc-nd.svg', 'No derivative works'],
  zero: ['https://upload.wikimedia.org/wikipedia/commons/5/52/Cc-zero.svg', 'No rights reserved'],
  pd: ['https://upload.wikimedia.org/wikipedia/commons/6/62/PD-icon.svg', 'Public domain'],
  copyright: ['https://upload.wikimedia.org/wikipedia/commons/b/b0/Copyright.svg', 'In copyright'],
  // The honest-open-question mark (2026-08-08): a stroked ?-in-circle, PD on
  // Commons, visually of a family with the outline CC marks.
  unknown: ['https://upload.wikimedia.org/wikipedia/commons/9/98/Question_Circle.svg', 'Rights status unknown — recorded as an open question'],
}

/** The outer `<svg>`'s box, from its viewBox or from its width/height. */
function viewBoxOf(svg) {
  const vb = /<svg\b[^>]*\bviewBox="([^"]+)"/i.exec(svg)
  if (vb) return vb[1].trim()
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const num = (attr) => Number(new RegExp(`\\b${attr}="([\\d.]+)`, 'i').exec(open)?.[1])
  const w = num('width')
  const h = num('height')
  return Number.isFinite(w) && Number.isFinite(h) ? `0 0 ${w} ${h}` : null
}

/**
 * The drawable body of an SVG, normalized into something safe to inline eight
 * times in one document.
 *
 * Three things have to happen, and all three are correctness rather than
 * tidiness:
 *
 *  - **Editor cruft goes.** Two of these files came out of Inkscape and carry
 *    `<metadata>`, `<defs/>` and `<sodipodi:namedview>` in namespaces the host
 *    page never declares.
 *  - **Ids are prefixed.** `Cc.logo.circle.svg` draws its second "c" as
 *    `<use xlink:href="#c">`. Inline eight sprites in one page and a bare `#c`
 *    is a collision waiting for the next glyph that uses a short id — and the
 *    symptom would be a wrong glyph, not a missing one.
 *  - **Paint becomes inheritable.** These are black-on-transparent designs.
 *    Mapping the ink to `currentColor` lets the credit line's own grey apply,
 *    so the marks sit in the type rather than shouting over it; the knocked-out
 *    parts become a variable so a future dark theme has one thing to set.
 */
function normalize(svg, id) {
  let body = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '')
    .replace(/<defs\b[^>]*\/>/gi, '')
    .replace(/<sodipodi:[\s\S]*?\/>/gi, '')

  const open = /<svg\b[^>]*>/i.exec(body)
  const close = body.lastIndexOf('</svg>')
  if (!open || close < 0) return null
  body = body.slice(open.index + open[0].length, close)

  // Namespaced attributes go, except xlink:href which is a real reference.
  // Cc-sa.svg keeps `sodipodi:nodetypes` on a path, and the sprite is inlined
  // into a document that never declares that prefix — an undeclared prefix is
  // invalid XML, and while an HTML parser shrugs at it, anything treating the
  // markup as XML refuses the whole file. Caught by rendering the sprite
  // through rsvg, which does exactly that.
  body = body.replace(/\s(?!xlink:href)[a-zA-Z][\w.-]*:[\w.-]+="[^"]*"/g, '')

  // Ids first, then the references to them, so a reference cannot be rewritten
  // twice. Both spellings: these files predate `href` on `<use>`.
  body = body
    .replace(/\bid="([^"]+)"/g, (_, v) => `id="cc-${id}-${v}"`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_, a, v) => `${a}="#cc-${id}-${v}"`)

  // Ink → currentColor. `#808080` is PD-icon's grey and `#0AD` is
  // Question_Circle's cyan stroke — each is that design's ink and not a shade
  // of anything.
  body = body
    .replace(/\b(fill|stroke)="(#000000|#000|black|#808080|#0AD)"/gi, '$1="currentColor"')
    .replace(/fill:\s*#000000/gi, 'fill:currentColor')
    // Knock-outs → a variable defaulting to the card's own background.
    .replace(/\b(fill|stroke)="(#ffffff|#fff|white)"/gi, '$1="var(--ccmark-hole,#fff)"')

  return body.replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

const symbols = []
let missing = 0
for (const [id, [url, title]] of Object.entries(GLYPHS)) {
  // 64 bytes: these are legitimately tiny — Cc-nd.svg is 204 bytes whole.
  const uri = await coverDataUri(url, { minBytes: 64 })
  const decoded = uri ? fromDataUri(uri) : null
  const svg = decoded?.body?.toString('utf8') ?? ''
  // Same lesson as the favicons: a 200 is not a picture. An HTML error page
  // would sail through a byte-count check and ship as a glyph, and a glyph that
  // silently fails to draw makes an unlicensed card look like a licensed one.
  if (!/^\s*(<\?xml|<!DOCTYPE|<svg)/i.test(svg)) {
    console.error(`MISS ${id} — ${url} did not answer with SVG`)
    missing++
    continue
  }
  const viewBox = viewBoxOf(svg)
  const body = normalize(svg, id)
  if (!viewBox || !body) {
    console.error(`MISS ${id} — no viewBox or no drawable body`)
    missing++
    continue
  }
  console.error(`ok   ${id.padEnd(10)} ${String(body.length).padStart(5)}B  viewBox="${viewBox}"`)
  symbols.push({ id, title, viewBox, body, url })
}

if (missing) console.error(`\n${missing} glyph(s) missing — src/cc-icons.js will be incomplete`)

const sprite = symbols
  .map(
    (s) =>
      `<symbol id="cc-${s.id}" viewBox="${s.viewBox}">` +
      `<title>${s.title}</title>${s.body}</symbol>`,
  )
  .join('')

const out = `// GENERATED by tools/build-cc-icons.mjs — do not edit by hand.
//
// The Creative Commons element glyphs as one inline sprite, sourced from
// Wikimedia Commons and normalized: ids namespaced per glyph, ink mapped to
// currentColor, knock-outs to --ccmark-hole. See the generator for why this set
// is a sprite while the partner favicons in src/icons.js are data URIs.
//
// The glyphs are Creative Commons' trademarks. They appear on a card only when
// the card's terms are actually known — src/rights.js returns null rather than
// guessing, and that refusal is what keeps this honest.
//
// Regenerate with:
//   WIKIMEDIA_UA_CONTACT=you@example.com NODE_USE_ENV_PROXY=1 node tools/build-cc-icons.mjs

/** The mark ids this sprite defines — the vocabulary src/rights.js emits. */
export const CC_MARKS = ${JSON.stringify(symbols.map((s) => s.id))}

/** What each mark means, for the title attribute on a rendered row. */
export const CC_TITLES = ${JSON.stringify(Object.fromEntries(symbols.map((s) => [s.id, s.title])), null, 2)}

/** Where each glyph came from, so a regeneration is checkable. */
export const CC_SOURCES = ${JSON.stringify(Object.fromEntries(symbols.map((s) => [s.id, s.url])), null, 2)}

/**
 * The sprite itself: emitted ONCE per document, hidden, before anything
 * references it. \`<use>\` resolves against the document, so a card rendered
 * into a page without this draws nothing at all.
 */
export const CC_SPRITE =
  '<svg class="cc-sprite" aria-hidden="true" focusable="false" ' +
  'style="position:absolute;width:0;height:0;overflow:hidden">' +
  ${JSON.stringify(sprite)} +
  '</svg>'
`

await writeFile(OUT, out)
console.error(`\nwrote ${OUT} — ${symbols.length} glyphs, ${out.length} bytes`)
