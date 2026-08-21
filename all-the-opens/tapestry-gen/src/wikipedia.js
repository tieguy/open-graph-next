import { cachedRequest } from './mw.js'
import { stripTags } from './html.js'

/**
 * Every English-Wikipedia call goes through the shared m3api transport: disk
 * cache (reruns offline and byte-reproducible), per-host serial queue, UA,
 * maxlag, and Retry-After handling all live in src/mw.js.
 */
function cachedGet(cacheDir, params) {
  return cachedRequest(cacheDir, 'en.wikipedia.org', params)
}

/**
 * Sections down to the second level, in article order.
 *
 * Subsections matter: taking only top-level sections makes "Mission" a single
 * 30,000px band holding a third of the article, which no presentation step can
 * frame usefully. The article already divides itself sensibly — Launch, Lunar
 * descent, Landing — so the canvas follows that division.
 */
/**
 * `prop=tocdata` sections, renamed to the fields the rest of this module has
 * always used. The API renamed `byteoffset` to `codepointOffset` in the move —
 * confirming empirically-discovered behavior: it was never bytes. (It counts
 * code points; JS slicing counts UTF-16 units, which diverge only on astral
 * characters — accepted, as before.)
 */
function fromTocdata(sections) {
  return (sections ?? []).map((s) => ({
    index: s.index,
    toclevel: s.tocLevel,
    line: s.line,
    number: s.number,
    anchor: s.anchor,
    byteoffset: s.codepointOffset ?? null,
  }))
}

export async function fetchSections(cacheDir, page) {
  const body = await cachedGet(cacheDir, { action: 'parse', page, prop: 'tocdata', redirects: '1' })
  return sectionOutline(fromTocdata(body.parse.tocdata?.sections))
}

/**
 * How deep the outline goes: h2 and h3 become bands, anything deeper stays
 * inside its parent's prose. Also the `stopAt` a unit's slice must use — a
 * band at this depth holds only its OWN text, because its children are bands
 * too and their text renders with them (see sliceSectionWikitext).
 */
export const OUTLINE_DEPTH = 2

/** The same outline, derived from an already-fetched section list. */
export function sectionOutline(sections) {
  return sections
    .filter((s) => s.toclevel <= OUTLINE_DEPTH)
    .map((s) => ({
      index: s.index,
      level: s.toclevel,
      number: s.number,
      title: stripTags(s.line).trim(),
    }))
}

/** The lede — section 0, which has no heading of its own. */
export async function fetchLede(cacheDir, page) {
  return fetchSection(cacheDir, page, '0')
}

/**
 * One section's rendered HTML plus its outbound wikilinks. The links are the
 * placement signal: whatever a section links to is what that section is about.
 */
export async function fetchSection(cacheDir, page, index) {
  const body = await cachedGet(cacheDir, {
    action: 'parse',
    page,
    section: index,
    prop: 'text|links',
    // Without this the HTML carries an [edit] link after every heading.
    disableeditsection: '1',
    disabletoc: '1',
    redirects: '1',
  })
  const links = (body.parse.links ?? [])
    .filter((l) => l.ns === 0 && l.exists)
    .map((l) => l.title)
  return { html: body.parse.text, links }
}

/**
 * One section's raw wikitext, disk-cached. The `<ref>` templates that carry a
 * section's citations live here, inline, so a section owns its own evidence.
 */
export async function fetchSectionWikitext(cacheDir, page, index) {
  const body = await cachedGet(cacheDir, {
    action: 'parse',
    page,
    section: String(index),
    prop: 'wikitext',
    redirects: '1',
  })
  return body.parse.wikitext
}

/**
 * The whole article in one request: section list, rendered HTML, raw wikitext,
 * and what the article already contains. This is the spine — what used to cost
 * two requests per section costs one per article, and the splitters below
 * reproduce the per-section views from it exactly.
 *
 * `templates|externallinks` ride along for free. They answer a question no
 * lookup can: not what the open web holds, but how much of it this article is
 * able to show (see `src/gap.js`). The house rule is to batch onto a request
 * already being made rather than add one, and this is that rule paying out —
 * two more fields on a response we were fetching anyway.
 *
 * `images` is deliberately NOT among them, and should not be added back as a
 * way of counting what an article shows: on San Francisco it returns 108 files,
 * of which one is a pronunciation recording, one is the red pushpin dot, three
 * are relief-map base layers behind a single visible map, and a couple of dozen
 * are template icons. The article displays 92. Count the rendered HTML.
 */
export async function fetchArticle(cacheDir, page) {
  const body = await cachedGet(cacheDir, {
    action: 'parse',
    page,
    prop: 'tocdata|text|wikitext|templates|externallinks',
    disableeditsection: '1',
    disabletoc: '1',
    // Without this a redirect title (e.g. "Coral Gables") parses as its own
    // one-line stub instead of the article it points at.
    redirects: '1',
  })
  return {
    // The API's own title once redirects are resolved — never the caller's
    // input, which may be the redirect source.
    title: body.parse.title,
    sections: fromTocdata(body.parse.tocdata?.sections),
    html: body.parse.text,
    wikitext: body.parse.wikitext,
    templates: body.parse.templates ?? [],
    externallinks: body.parse.externallinks ?? [],
  }
}

/**
 * One section's wikitext sliced from the whole article, reproducing what
 * `action=parse&section=N` returns: the section *including its subsections*,
 * i.e. from its own heading to the next heading at its level or above.
 *
 * `stopAt` (2026-08-09) narrows that: a section ends at the next heading at
 * `stopAt` OR ABOVE, so a parent sliced with the outline's own depth keeps
 * only its intro — its children's text belongs to their own slices. This is
 * the trim the `hasChildren` comment in sectionOutline promised and nothing
 * ever performed: without it every subsection on every page rendered twice,
 * once inside its parent's band and once as its own (found on Apollo 11's
 * Preparations; shipping since the original generator). Headings BELOW
 * `stopAt` still travel with their nearest sliced ancestor — they are not
 * bands, and text that stopped at them would fall off the page. Default
 * behavior is unchanged and stays byte-identical to parse&section=N.
 *
 * Despite its name, `byteoffset` lines up with JS string indices, not UTF-8
 * bytes — measured empirically on a page full of multi-byte umlauts, where
 * byte-wise slicing drifted by exactly the multi-byte character count and
 * string slicing landed on every heading. Sections a template transcludes
 * carry a null byteoffset and a `T-` index; they cannot be sliced, and callers
 * get null back rather than someone else's text.
 */
export function sliceSectionWikitext(wikitext, sections, index, { stopAt } = {}) {
  if (String(index) === '0') {
    const end = sections.find((s) => s.byteoffset != null)?.byteoffset ?? wikitext.length
    return wikitext.slice(0, end).trimEnd()
  }
  const at = sections.findIndex((s) => String(s.index) === String(index))
  const own = sections[at]
  if (own?.byteoffset == null) return null
  const boundary = Math.max(stopAt ?? own.toclevel, own.toclevel)
  const next = sections
    .slice(at + 1)
    .find((s) => s.byteoffset != null && s.toclevel <= boundary)
  // parse&section=N returns the section without its trailing blank lines;
  // matching that exactly is what lets the slicer claim equivalence.
  return wikitext.slice(own.byteoffset, next?.byteoffset ?? wikitext.length).trimEnd()
}

/**
 * One section's HTML cut from the whole rendered page, on the same
 * include-subsections rule as the wikitext slicer — and the same `stopAt`
 * narrowing (see sliceSectionWikitext). Headings are located by the
 * anchor ids the section list states. The fragments are not balanced HTML — a
 * heading's wrapper div is cut mid-element — which the regex-based consumers
 * (articleBlocks, proseLinks) never notice.
 */
export function sliceSectionHtml(html, sections, index, { stopAt } = {}) {
  const headingStart = (s) => {
    const id = html.indexOf(`id="${s.anchor}"`)
    if (id < 0) return -1
    return html.lastIndexOf('<h', id)
  }
  if (String(index) === '0') {
    const first = sections.map(headingStart).find((p) => p >= 0)
    return first == null ? html : html.slice(0, first)
  }
  const at = sections.findIndex((s) => String(s.index) === String(index))
  const own = sections[at]
  if (!own) return null
  const start = headingStart(own)
  if (start < 0) return null
  const boundary = Math.max(stopAt ?? own.toclevel, own.toclevel)
  const next = sections
    .slice(at + 1)
    .filter((s) => s.toclevel <= boundary)
    .map(headingStart)
    .find((p) => p >= 0)
  return html.slice(start, next ?? html.length)
}

/**
 * Wikidata QIDs for article titles, via Wikipedia's own pageprops — no call to
 * wikidata.org needed. Batched at the API's 50-title limit.
 */
export async function fetchQids(cacheDir, titles) {
  const qids = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const body = await cachedGet(cacheDir, {
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      redirects: '1',
      titles: batch.join('|'),
    })
    for (const page of body.query?.pages ?? []) {
      const qid = page.pageprops?.wikibase_item
      if (qid) qids.set(page.title, qid)
    }
    // Follow redirects so a link to "Buzz Aldrin (astronaut)" still resolves.
    for (const r of body.query?.redirects ?? []) {
      const target = qids.get(r.to)
      if (target) qids.set(r.from, target)
    }
  }
  return qids
}

/**
 * The File: title behind a Wikimedia thumbnail URL, e.g.
 * .../commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/200px-Aldrin….jpg
 * → File:Aldrin_Apollo_11_original.jpg
 */
export function commonsFileTitle(url) {
  const match = /upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(
    url ?? '',
  )
  // Underscores are normalized to spaces because that is how the API returns
  // titles; keying on the raw URL form silently misses every lookup.
  return match ? `File:${decodeURIComponent(match[1]).replaceAll(/_/g, ' ')}` : null
}

/**
 * Thumbnail URL and intrinsic dimensions for File: titles, plus the credit the
 * file carries.
 *
 * The URL must come from the API, not be constructed by hand. Wikimedia
 * restricts thumbnail rendering to an allowlist of widths and answers anything
 * else with `400 Use thumbnail sizes listed on https://w.wiki/GHai` — which is
 * why the dataset's stored 200px and 220px URLs are all dead. Asking for
 * `iiurlwidth` returns a `thumburl` that is valid by construction.
 *
 * `extmetadata` comes back in the same call, so license and author cost no extra
 * request. A demo arguing for cooperative knowledge infrastructure should carry
 * the credit, not strip it.
 */
export async function fetchImageInfo(cacheDir, fileTitles, width = 1280) {
  const sizes = new Map()
  for (let i = 0; i < fileTitles.length; i += 50) {
    const batch = fileTitles.slice(i, i + 50)
    const body = await cachedGet(cacheDir, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'size|url|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|Artist',
      iiextmetadatalanguage: 'en',
      iiurlwidth: String(width),
      titles: batch.join('|'),
    })
    for (const page of body.query?.pages ?? []) {
      const info = page.imageinfo?.[0]
      if (info?.width && info?.height) {
        sizes.set(page.title, {
          width: info.width,
          height: info.height,
          thumbUrl: info.thumburl ?? info.url ?? null,
          credit: imageCredit(info.extmetadata),
        })
      }
    }
  }
  return sizes
}

/**
 * License and author from a Commons file's `extmetadata`, or null when the file
 * carries neither. Both values arrive as HTML (the Artist field is often an
 * anchor), so markup is stripped to plain text.
 */
export function imageCredit(extmetadata) {
  if (!extmetadata) return null
  const license = extmetadata.LicenseShortName?.value ?? null
  const rawAuthor = extmetadata.Artist?.value ?? null
  const author = rawAuthor ? decodeEntities(stripTags(rawAuthor)).trim() || null : null
  if (!license && !author) return null
  return { license, author }
}

/**
 * Each Wikipedia article's own lead image.
 *
 * The dataset's thumbnails are not reliably distinct — several items point at
 * different crops of the same iconic photograph, so Apollo 11, the Moon landing
 * and Buzz Aldrin all render as the same visor portrait. Asking the article
 * which image represents it gives one picture per subject.
 */
export async function fetchPageImages(cacheDir, titles, size = 1280) {
  const images = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const body = await cachedGet(cacheDir, {
      action: 'query',
      prop: 'pageimages',
      // `name` gives the underlying File: title, so the lead image can be
      // credited through the same imageinfo call as the standalone Commons items.
      piprop: 'thumbnail|name',
      pithumbsize: String(size),
      redirects: '1',
      titles: titles.slice(i, i + 50).join('|'),
    })
    for (const page of body.query?.pages ?? []) {
      const thumb = page.thumbnail
      if (thumb?.source) {
        images.set(page.title, {
          source: thumb.source,
          width: thumb.width,
          height: thumb.height,
          fileTitle: page.pageimage ? `File:${page.pageimage.replaceAll(/_/g, ' ')}` : null,
        })
      }
    }
    for (const r of body.query?.redirects ?? []) {
      const target = images.get(r.to)
      if (target) images.set(r.from, target)
    }
  }
  return images
}

/**
 * Where the infobox table starts and ends, walking table open/close tags so a
 * nested table (a crew list, say) does not cut the scan short at its inner
 * </table>. Null when the page has no infobox.
 */
function infoboxExtent(source) {
  const start = source.search(/<table[^>]*class="[^"]*infobox[^"]*"/i)
  if (start < 0) return null
  const tag = /<(\/?)table\b/gi
  tag.lastIndex = start
  let depth = 0
  let match
  while ((match = tag.exec(source))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) {
      // lastIndex sits after "</table"; the extent runs through its ">".
      const close = source.indexOf('>', tag.lastIndex)
      return [start, close < 0 ? source.length : close + 1]
    }
  }
  return [start, source.length]
}

/**
 * Article wikilinks inside the lede's infobox.
 *
 * The infobox is structurally part of section 0, but the article body often
 * links a fact only there — the landing site, the launch pad — because the
 * infobox already carries it. Those links never reach `prop=links` per section,
 * so without this the landing site has no wikilink to place it by. Treating the
 * infobox as part of the lede keeps the "wikilinks decide placement" rule intact
 * while recovering the links the prose leaves to the box.
 */
export function infoboxLinks(html) {
  const extent = infoboxExtent(html ?? '')
  if (!extent) return []
  const block = (html ?? '').slice(extent[0], extent[1])
  const titles = []
  const seen = new Set()
  const link = /<a\b[^>]*\bhref="\/wiki\/([^"#?]+)"/gi
  let a
  while ((a = link.exec(block))) {
    let title
    try {
      title = decodeURIComponent(a[1]).replaceAll(/_/g, ' ')
    } catch {
      title = a[1].replaceAll(/_/g, ' ')
    }
    if (title.includes(':')) continue // File:, Category:, Help:, and other namespaces
    if (seen.has(title)) continue
    seen.add(title)
    titles.push(title)
  }
  return titles
}

// What must not survive extraction. Each is apparatus that either cannot work
// off-wiki (Kartographer needs its JS; a footnote marker points at an anchor
// this page renders under a different id) or should not (the v·t·e navbar
// links template pages; hidden rows are hidden on Wikipedia's own desktop).
const INFOBOX_STRIP = [
  /<tr[^>]*class="[^"]*\binfobox-hiddenrow\b[^"]*"[\s\S]*?<\/tr>/gi,
  /<tr[^>]*>\s*<t[dh][^>]*class="[^"]*\binfobox-navbar\b[\s\S]*?<\/tr>/gi,
  /<div[^>]*class="[^"]*\bnavbar\b[^"]*"[\s\S]*?<\/div>/gi,
  /<div[^>]*class="[^"]*mw-kartographer[^"]*"[\s\S]*?<\/div>/gi,
  /<a[^>]*class="[^"]*mw-kartographer[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
  /<span[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/gi,
  /<sup[^>]*class="[^"]*\breference\b[^"]*"[\s\S]*?<\/sup>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<link[^>]*\/?>/gi,
  /(?<!\s)\s+srcset="[^"]*"/gi,
]

/** An image URL as this page will serve it: scheme'd, no tracking params. */
function cleanImageUrl(raw) {
  const url = raw.startsWith('//') ? `https:${raw}` : raw
  const [path, query] = url.split('?')
  if (!query) return url
  const kept = query
    .split(/&(?:amp;)?/)
    .filter((p) => p && !p.startsWith('utm_'))
    .join('&')
  return kept ? `${path}?${kept}` : path
}

/**
 * The article's own infobox, sanitized for this page, or null when the
 * article has none. This is the lede rail's fallback when no find with
 * subject standing earns the slot (design:
 * docs/design-plans/2026-08-08-infobox-retention.md).
 *
 * Links: article links stay root-relative — the renderer's `relink` re-bases
 * them onto the demo like every prose link, so clicking through lands on
 * another enriched render. Namespace links (`File:` above all — the image's
 * attribution trail) go absolute to en.wikipedia.org instead, because relink
 * would otherwise point them at pages this server does not have.
 *
 * `images` reports every cleaned image URL in document order, deduplicated.
 * They are upload.wikimedia.org URLs and STAY hotlinked — the article's own
 * content on Wikimedia's own infrastructure, the one host the
 * never-hotlink-a-partner rule exempts — so unlike every other picture on
 * the page they never enter the inline map.
 */
export function extractInfobox(html) {
  const source = html ?? ''
  const extent = infoboxExtent(source)
  if (!extent) return null
  let block = source.slice(extent[0], extent[1])
  for (const pattern of INFOBOX_STRIP) block = block.replace(pattern, '')

  const images = []
  block = block.replaceAll(/(<img\b[^>]*\ssrc=")([^"]+)(")/gi, (_, pre, raw, post) => {
    const url = cleanImageUrl(raw.replaceAll(/&amp;/g, '&'))
    if (!images.includes(url)) images.push(url)
    return `${pre}${url}${post}`
  })

  block = block.replaceAll(/href="\/wiki\/([^"]+)"/gi, (whole, target) => {
    let decoded
    try {
      decoded = decodeURIComponent(target)
    } catch {
      decoded = target
    }
    return decoded.includes(':') ? `href="https://en.wikipedia.org/wiki/${target}"` : whole
  })

  return { html: block, images }
}

// Apparatus that would be noise on a canvas: infoboxes, navboxes, figures,
// footnote markers, hatnotes, coordinates, and edit links. The lede's infobox
// is the one piece retained on a separate path (`extractInfobox`, 2026-08-08)
// — stripped from the PROSE here, it stands in the lede rail when no find
// with subject standing earns that slot.
const STRIP_BLOCKS = [
  /<table[\s\S]*?<\/table>/gi,
  /<figure[\s\S]*?<\/figure>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<sup[\s\S]*?<\/sup>/gi,
  /<div[^>]*class="[^"]*(hatnote|navbox|thumb|infobox|metadata|reflist|mw-editsection)[^"]*"[\s\S]*?<\/div>/gi,
  /<span[^>]*class="[^"]*(mw-editsection|geo|coordinates)[^"]*"[\s\S]*?<\/span>/gi,
]

/**
 * A section's body as an ordered list of plain-text paragraphs and subheadings,
 * ready to be re-styled for the canvas. Wikipedia's HTML is far richer than a
 * Tapestry text frame can render, so it is reduced rather than passed through.
 *
 * With `notePrefix` set, each block also carries `html`: the same content kept
 * as sanitized inline HTML — intra-wiki links and the article's own footnote
 * markers survive, re-anchored under the prefix so a marker and its gutter
 * note meet on this page the way they do on Wikipedia. The plain `text` stays
 * exactly what it always was; the Tapestry canvas keeps reading it.
 */
export function articleBlocks(html, { notePrefix = null } = {}) {
  let cleaned = html
  const strip = notePrefix
    ? STRIP_BLOCKS.filter((p) => !p.source.startsWith('<sup'))
    : STRIP_BLOCKS
  for (const pattern of strip) cleaned = cleaned.replace(pattern, ' ')

  const blocks = []
  const pattern = /<(p|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  while ((match = pattern.exec(cleaned))) {
    const text = decodeEntities(stripTags(match[2])).replaceAll(/\s+/g, ' ').trim()
    if (text.length < 2) continue
    const block = { kind: match[1].toLowerCase() === 'p' ? 'p' : 'h', text }
    if (notePrefix)
      block.html = sanitizeFragment(match[2], { notePrefix })
        .replaceAll(/&#91;/g, '[')
        .replaceAll(/&#93;/g, ']')
        .replaceAll(/\s+/g, ' ')
        .trim()
    blocks.push(block)
  }
  return blocks
}

/**
 * A fragment of Wikipedia's rendered HTML, reduced to what this page can
 * honestly re-serve. Kept: intra-wiki links (they stay `/wiki/…`, so on this
 * server they resolve to more of these renders — the renderer may re-base
 * them), footnote markers re-anchored under `notePrefix`, external links, and
 * inline emphasis. Everything else is unwrapped to its text. Anchors whose
 * target this page cannot honor — namespace links, `#CITEREF` biblio jumps —
 * are unwrapped rather than left to 404.
 */
/** Tags kept as themselves, opening and closing. */
const KEPT_INLINE = new Set(['b', 'i', 'cite', 'sub'])

/**
 * An opening `<a>` rewritten to the one form this page allows, or '' when the
 * link goes somewhere the fragment will not carry. Returns null in that case
 * too, so the caller knows whether the matching `</a>` should survive.
 */
function keptAnchor(tag, notePrefix) {
  const href = /\shref="([^"]*)"/i.exec(tag)?.[1] ?? ''
  const wiki = /^\/wiki\/([^"#]+)/.exec(href)
  if (wiki && !decodeEntities(wiki[1]).includes(':')) return `<a class="wl" href="${href}">`
  const note = notePrefix && /^#cite_note-(.+)$/.exec(href)
  if (note) return `<a href="#${notePrefix}-note-${note[1]}">`
  if (/^https?:\/\//.test(href)) {
    return `<a class="ext" href="${href}" target="_blank" rel="noopener">`
  }
  return null
}

export function sanitizeFragment(html, { notePrefix = null } = {}) {
  let aKept = false
  // Elements whose CONTENT must go too: MediaWiki injects the CS1 stylesheet
  // inline into the first styled citation on a page, and stripping only the
  // tags would print the stylesheet as prose.
  const cleaned = html.replaceAll(/<(style|script)[\s\S]*?<\/\1>/gi, '')
  return cleaned.replaceAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, rawName) => {
    const name = rawName.toLowerCase()
    const closing = tag.startsWith('</')
    if (name === 'a') {
      if (closing) {
        const kept = aKept
        aKept = false
        return kept ? '</a>' : ''
      }
      const opened = keptAnchor(tag, notePrefix)
      aKept = opened !== null
      return opened ?? ''
    }
    if (name === 'sup') {
      if (closing) return '</sup>'
      return /class="[^"]*\breference\b/.test(tag) ? '<sup class="ref">' : '<sup>'
    }
    if (KEPT_INLINE.has(name)) return closing ? `</${name}>` : `<${name}>`
    return ''
  })
}

/**
 * Every footnote body on the page: note name → the `reference-text` inner
 * HTML, exactly as Wikipedia rendered it. The parse HTML entity-escapes the
 * `id` attributes (`cite&#95;note-…`) but not the markers' hrefs, so names
 * are decoded before keying — that is where the two sides meet.
 */
export function referenceNotes(html) {
  const notes = new Map()
  const li = /<li id="(cite[^"]*?note-[^"]+)">([\s\S]*?)<\/li>/gi
  let m
  while ((m = li.exec(html))) {
    const name = decodeEntities(m[1]).replace(/^cite_note-/, '')
    const text = /<span class="reference-text">([\s\S]*)$/.exec(m[2])?.[1]
    if (text != null && !notes.has(name)) notes.set(name, text.replace(/<\/span>\s*$/, ''))
  }
  return notes
}

/**
 * The footnotes a band's prose actually points at, in first-marker order —
 * Wikipedia's own citations, renumbered by nothing: `num` is the number the
 * marker prints, so the gutter agrees with the text. Each carries the ISBN
 * its `Special:BookSources` link states, when one does, so the renderer can
 * append what the open ecosystem holds of it.
 */
export function footnotesFor(blocks, notes, notePrefix) {
  const out = []
  const seen = new Set()
  const marker = new RegExp(String.raw`<a href="#${notePrefix}-note-([^"]+)">\[([^\]<]+)\]`, 'g')
  for (const b of blocks) {
    let m
    while ((m = marker.exec(b.html ?? ''))) {
      const name = m[1]
      if (seen.has(name)) continue
      seen.add(name)
      const body = notes.get(decodeEntities(name))
      if (body == null) continue
      const rawIsbn = /Special:BookSources\/([0-9Xx-]+)/.exec(body)?.[1]?.replaceAll(/[^0-9Xx]/g, '')
      out.push({
        id: `${notePrefix}-note-${name}`,
        num: m[2],
        isbn: rawIsbn && (rawIsbn.length === 10 || rawIsbn.length === 13) ? rawIsbn : null,
        html: sanitizeFragment(body, { notePrefix }),
      })
    }
  }
  return out
}

export function decodeEntities(value) {
  return value
    .replaceAll(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replaceAll(/&nbsp;/g, ' ')
    .replaceAll(/&amp;/g, '&')
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/\[\d+\]/g, '')
}

const BLOCK_TAGS = /<(table|figure|style|sup|div class="hatnote"|ref)[\s\S]*?<\/\1>/gi

/**
 * First N sentences of a section, as plain text. Wikipedia HTML carries
 * infoboxes, footnote markers, and hatnotes that would be noise on a canvas.
 */
export function firstSentences(html, count = 2) {
  const blocksRemoved = html
    .replace(BLOCK_TAGS, ' ')
    .replaceAll(/<sup[\s\S]*?<\/sup>/gi, '') // footnote markers
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<table[\s\S]*?<\/table>/gi, ' ')
  const text = stripTags(blocksRemoved) // remaining tags
    .replaceAll(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replaceAll(/&nbsp;/g, ' ')
    .replaceAll(/&amp;/g, '&')
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/\[\d+\]/g, '') // leftover citation brackets
    .replaceAll(/\s+/g, ' ')
    .trim()

  // Split on sentence-final punctuation, avoiding common abbreviations and initials.
  const sentences = []
  let start = 0
  for (let i = 0; i < text.length && sentences.length < count; i++) {
    if (!'.!?'.includes(text[i])) continue
    const next = text[i + 1]
    if (next && next !== ' ') continue
    const before = text.slice(Math.max(0, i - 4), i)
    if (/\b(Mr|Mrs|Dr|Jr|Sr|St|No|vs|etc|Inc|Ltd|[A-Z])$/.test(before)) continue
    sentences.push(text.slice(start, i + 1).trim())
    start = i + 1
  }
  return sentences.join(' ').trim() || text.slice(0, 400)
}
