// Phase 3: the left gutter — the evidence behind each section. A section's
// citations live inline in its wikitext as {{cite …}} templates inside <ref>
// tags, so they carry their own section attribution and their identifiers
// (ISBN, DOI, URL) without a second lookup. This module turns that wikitext
// into structured citations; resolving them to media is a separate step.

/** Split a template's interior on top-level `|`, ignoring pipes nested in `{{}}`/`[[]]`. */
function splitTopLevel(str, sep) {
  const parts = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < str.length) {
    const two = str.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      i += 2
      continue
    }
    if (two === '}}' || two === ']]') {
      depth = Math.max(0, depth - 1)
      i += 2
      continue
    }
    if (depth === 0 && str[i] === sep) {
      parts.push(str.slice(start, i))
      start = i + 1
    }
    i++
  }
  parts.push(str.slice(start))
  return parts
}

/** The `key=value` params of a `{{…}}` template, keyed lowercase. */
export function templateParams(text) {
  const inner = text.replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '')
  const params = new Map()
  for (const part of splitTopLevel(inner, '|')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue // the template name, or a positional argument
    params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim())
  }
  return params
}

/** The first balanced `{{…}}` template in a string, braces included, or null. */
function extractTemplate(text) {
  const start = text.indexOf('{{')
  if (start < 0) return null
  let depth = 0
  let i = start
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    if (two === '{{') {
      depth++
      i += 2
      continue
    }
    if (two === '}}') {
      depth--
      i += 2
      if (depth === 0) return text.slice(start, i)
      continue
    }
    i++
  }
  return null
}

/** Reduce wiki markup in a short field (title, publisher) to plain text. */
function stripMarkup(value) {
  if (!value) return null
  const text = value
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1') // [[target|label]] → label
    .replace(/\[\[([^\]]*)\]\]/g, '$1') // [[label]] → label
    .replace(/'''?/g, '') // bold/italic
    .replace(/<[^>]+>/g, '') // stray tags
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** An ISBN reduced to its significant characters (digits plus a trailing X). */
function normalizeIsbn(value) {
  if (!value) return null
  const isbn = value.replace(/[^0-9Xx]/g, '').toUpperCase()
  return isbn || null
}

/**
 * A single citation template → a structured citation, or null when the ref holds
 * no `{{cite …}}`/`{{citation}}` template (a bare explanatory note, say).
 */
export function parseCitation(refInner) {
  const tpl = extractTemplate(refInner)
  if (!tpl) return null
  const name = /^\{\{\s*(?:cite[ _]([a-z]+)|(citation))\b/i.exec(tpl)
  if (!name) return null

  const p = templateParams(tpl)
  return {
    kind: name[1] ? name[1].toLowerCase() : 'generic',
    url: p.get('url') ?? null,
    archiveUrl: p.get('archive-url') ?? p.get('archiveurl') ?? null,
    title: stripMarkup(p.get('title')),
    isbn: normalizeIsbn(p.get('isbn')),
    doi: p.get('doi') ?? null,
    publisher: stripMarkup(p.get('publisher') ?? p.get('work') ?? p.get('website')),
    author: stripMarkup(p.get('last') ?? p.get('author') ?? p.get('last1') ?? p.get('author1')),
  }
}

/**
 * The citations in a section's wikitext, in order of appearance. Reused named
 * refs (`<ref name="x" />`) carry no payload and are skipped; a ref with no
 * citation template is skipped too.
 */
export function sectionCitations(wikitext) {
  const cites = []
  const re = /<ref\b[^>]*>([\s\S]*?)<\/ref>/gi
  let m
  while ((m = re.exec(wikitext ?? ''))) {
    const c = parseCitation(m[1])
    if (c) cites.push(c)
  }
  return cites
}

/**
 * The best link for a citation: the archived copy first (it still resolves when
 * the original has rotted — most of the article's URLs are archived), then a DOI
 * landing page, then the live URL.
 */
export function citationHref(cite) {
  if (cite.archiveUrl) return cite.archiveUrl
  if (cite.doi) return `https://doi.org/${cite.doi}`
  return cite.url ?? null
}

/** The OpenLibrary cover for a citation's ISBN, or null when it has none. */
export function citationCoverUrl(cite) {
  return cite.isbn ? `https://covers.openlibrary.org/b/isbn/${cite.isbn}-M.jpg` : null
}

/**
 * How openly a cited book can be reached, read from an OpenLibrary volumes/brief
 * response — the point of the gutter is not just to name a source but to open a
 * path into the ecosystem. A cited book you can borrow or read is the most
 * interesting kind of citation there is.
 *
 * @returns {{availability: 'full'|'borrow'|'catalog', url: string, label: string}|null}
 */
export function openLibraryAccess(volume) {
  const record = Object.values(volume?.records ?? {})[0]
  if (!record) return null
  const data = record.data ?? {}
  const catalog = data.url ? data.url.replace(/^http:/, 'https:') : null
  const ebook = (data.ebooks ?? [])[0]

  if (ebook?.availability === 'full') {
    return { availability: 'full', label: 'Read free · Internet Archive', url: ebook.read_url ?? ebook.preview_url ?? catalog }
  }
  if (ebook?.availability === 'borrow') {
    return { availability: 'borrow', label: 'Borrow · Internet Archive', url: ebook.preview_url ?? catalog }
  }
  if (catalog) return { availability: 'catalog', label: 'Find in OpenLibrary', url: catalog }
  return null
}

/**
 * How openly reachable a citation is — the lower the number, the more surely a
 * reader can open it. A book you can borrow or read is the richest thing the
 * gutter can offer; an archived page always resolves; a bare live link may have
 * rotted. Requires book citations to have their `.access` attached first (from
 * openLibraryAccess); everything else is decided by the citation alone.
 */
function reachabilityRank(cite) {
  const availability = cite.access?.availability
  if (availability === 'full' || availability === 'borrow') return 0 // open the whole thing
  if (cite.archiveUrl) return 1 // archived — will still resolve
  if (cite.doi) return 2 // a stable scholarly landing page
  if (availability === 'catalog') return 3 // findable in a catalogue, not readable
  if (cite.url) return 4 // a live link that may rot
  return 5 // nothing to open
}

/**
 * Choose which of a section's citations to show, capped — preferring the sources
 * a reader can actually reach. De-duplicated, and stable within each rank so
 * article order breaks ties.
 */
export function prioritizeCitations(cites, cap = 3) {
  const seen = new Set()
  const unique = []
  for (const c of cites) {
    const key = c.isbn ?? citationHref(c) ?? c.title ?? JSON.stringify(c)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  return unique
    .map((c, i) => [c, i])
    .sort((a, b) => reachabilityRank(a[0]) - reachabilityRank(b[0]) || a[1] - b[1])
    .slice(0, cap)
    .map(([c]) => c)
}
