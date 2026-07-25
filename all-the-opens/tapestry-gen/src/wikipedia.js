import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const API = 'https://en.wikipedia.org/w/api.php'
const UA = 'all-the-opens-tapestry-gen/0.1 (https://github.com/tieguy/open-graph-next)'

/**
 * Every network call goes through here. Reruns are offline and byte-reproducible,
 * matching the project's existing "pre-cached data over live APIs" decision.
 */
async function cachedGet(cacheDir, params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(cacheDir, `${key}.json`)

  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // not cached yet
  }

  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  const body = await response.json()

  await mkdir(cacheDir, { recursive: true })
  await writeFile(path, JSON.stringify(body, null, 2))
  return body
}

/**
 * Sections down to the second level, in article order.
 *
 * Subsections matter: taking only top-level sections makes "Mission" a single
 * 30,000px band holding a third of the article, which no presentation step can
 * frame usefully. The article already divides itself sensibly — Launch, Lunar
 * descent, Landing — so the canvas follows that division.
 */
export async function fetchSections(cacheDir, page) {
  const body = await cachedGet(cacheDir, { action: 'parse', page, prop: 'sections' })
  return body.parse.sections
    .filter((s) => s.toclevel <= 2)
    .map((s, i, all) => ({
      index: s.index,
      level: s.toclevel,
      number: s.number,
      title: s.line.replace(/<[^>]+>/g, '').trim(),
      // A parent's own fetch includes all of its subsections, so its prose must
      // be trimmed to the intro or the text appears twice.
      hasChildren: all[i + 1]?.toclevel === 2 && s.toclevel === 1,
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
  const body = await cachedGet(cacheDir, { action: 'parse', page, section: String(index), prop: 'wikitext' })
  return body.parse.wikitext
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
  // Underscores are normalised to spaces because that is how the API returns
  // titles; keying on the raw URL form silently misses every lookup.
  return match ? `File:${decodeURIComponent(match[1]).replace(/_/g, ' ')}` : null
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
 * `extmetadata` comes back in the same call, so licence and author cost no extra
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
 * Licence and author from a Commons file's `extmetadata`, or null when the file
 * carries neither. Both values arrive as HTML (the Artist field is often an
 * anchor), so markup is stripped to plain text.
 */
export function imageCredit(extmetadata) {
  if (!extmetadata) return null
  const license = extmetadata.LicenseShortName?.value ?? null
  const rawAuthor = extmetadata.Artist?.value ?? null
  const author = rawAuthor ? decodeEntities(rawAuthor.replace(/<[^>]+>/g, '')).trim() || null : null
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
          fileTitle: page.pageimage ? `File:${page.pageimage.replace(/_/g, ' ')}` : null,
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
  const source = html ?? ''
  const start = source.search(/<table[^>]*class="[^"]*infobox[^"]*"/i)
  if (start < 0) return []

  // Walk table open/close tags to find the infobox's real end, so a nested table
  // (a crew list, say) does not cut the scan short at its inner </table>.
  const tag = /<(\/?)table\b/gi
  tag.lastIndex = start
  let depth = 0
  let end = source.length
  let match
  while ((match = tag.exec(source))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) {
      end = tag.lastIndex
      break
    }
  }

  const block = source.slice(start, end)
  const titles = []
  const seen = new Set()
  const link = /<a\b[^>]*\bhref="\/wiki\/([^"#?]+)"/gi
  let a
  while ((a = link.exec(block))) {
    let title
    try {
      title = decodeURIComponent(a[1]).replace(/_/g, ' ')
    } catch {
      title = a[1].replace(/_/g, ' ')
    }
    if (title.includes(':')) continue // File:, Category:, Help:, and other namespaces
    if (seen.has(title)) continue
    seen.add(title)
    titles.push(title)
  }
  return titles
}

// Apparatus that would be noise on a canvas: infoboxes, navboxes, figures,
// footnote markers, hatnotes, coordinates, and edit links.
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
 */
export function articleBlocks(html) {
  let cleaned = html
  for (const pattern of STRIP_BLOCKS) cleaned = cleaned.replace(pattern, ' ')

  const blocks = []
  const pattern = /<(p|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  while ((match = pattern.exec(cleaned))) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (text.length < 2) continue
    blocks.push({ kind: match[1].toLowerCase() === 'p' ? 'p' : 'h', text })
  }
  return blocks
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[\d+\]/g, '')
}

const BLOCK_TAGS = /<(table|figure|style|sup|div class="hatnote"|ref)[\s\S]*?<\/\1>/gi

/**
 * First N sentences of a section, as plain text. Wikipedia HTML carries
 * infoboxes, footnote markers, and hatnotes that would be noise on a canvas.
 */
export function firstSentences(html, count = 2) {
  const text = html
    .replace(BLOCK_TAGS, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '') // footnote markers
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, '') // remaining tags
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[\d+\]/g, '') // leftover citation brackets
    .replace(/\s+/g, ' ')
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
