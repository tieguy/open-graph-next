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

/** A template's positional arguments (the parts with no `key=`), trimmed. */
function positionalArgs(text) {
  const inner = text.replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '')
  return splitTopLevel(inner, '|')
    .slice(1) // the template name
    .filter((part) => !part.includes('='))
    .map((part) => part.trim())
    .filter(Boolean)
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
 * An ISBN only if it is one. A malformed value costs a catalog lookup and
 * returns nothing, so it is dropped here rather than searched for.
 */
function validIsbn(value) {
  const isbn = normalizeIsbn(value)
  return isbn && (isbn.length === 10 || isbn.length === 13) ? isbn : null
}

/**
 * The people a citation template names, as one display string: numbered
 * last/first pairs joined the way a byline reads, `null` when none are
 * stated, `A, B & C et al.` past three — a rail card is a byline, not a
 * bibliography record.
 */
export function citationAuthors(p) {
  const names = []
  for (let i = 1; i <= 4; i++) {
    // The first author may be written either numbered or bare: `last1` and
    // `last` are the same field, and only for i === 1.
    const field = (name) => {
      const bare = i === 1 ? p.get(name) : null
      return stripMarkup(p.get(`${name}${i}`) ?? bare)
    }
    const last = field('last')
    const author = field('author')
    if (!last && !author) break
    const first = last ? field('first') : null
    names.push(author ?? (first ? `${first} ${last}` : last))
  }
  if (!names.length) return null
  if (names.length <= 3) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
  }
  return `${names.slice(0, 3).join(', ')} et al.`
}

/**
 * A single citation template → a structured citation, or null when the ref holds
 * no `{{cite …}}`/`{{citation}}` template (a bare explanatory note, say).
 * Everything the rail can show travels along: byline, stated date, and the
 * archived copy with the date it was taken.
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
    archiveDate: stripMarkup(p.get('archive-date') ?? p.get('archivedate')),
    title: stripMarkup(p.get('title')),
    isbn: normalizeIsbn(p.get('isbn')),
    doi: p.get('doi') ?? null,
    publisher: stripMarkup(p.get('publisher') ?? p.get('work') ?? p.get('website')),
    author: citationAuthors(p),
    date: stripMarkup(p.get('date') ?? p.get('year')),
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

// --- shortened footnotes ----------------------------------------------------
//
// The extraction above assumes each <ref> carries its own identifiers. Mature
// articles routinely do not: they cite with {{sfn|Last|Year|p=N}} pointers into
// one pooled bibliography, so the sections hold the attribution and a section
// called "Sources" holds every ISBN. Apollo 11 keeps 19 of its 22 ISBNs that
// way — read as ordinary refs it yields nothing at all.
//
// Recovering those is a join, not a heuristic: parse the bibliography into
// (surname, year) → identifiers, parse each section's pointers, and attribute
// the result to the section holding the pointer. The article still decides
// placement; in this style it does so with two hops instead of one.

/** A publication year as short citations write it — 1994, or 1969a when disambiguated. */
const YEAR = /^\d{4}[a-z]?$/i

/** The join key a surname and year make. Case is not significant in either. */
const harvardKey = (surname, year) => `${surname.toLowerCase()}|${year.toLowerCase()}`

/**
 * The short-citation pointers in a section's wikitext, in document order and
 * including repeats — a work cited five times is five pointers here, and the
 * caller decides whether that means anything.
 *
 * A pointer with no year cannot be joined against a bibliography, so it is not
 * a pointer for our purposes.
 */
export function shortCitePointers(wikitext) {
  const out = []
  const re = /\{\{\s*(?:sfnp?|sfnm|harvnb|harvtxt|harv)\s*\|([^{}]*)\}\}/gi
  let m
  while ((m = re.exec(wikitext ?? ''))) {
    const args = positionalArgs(`{{x|${m[1]}}}`)
    const yearAt = args.findLastIndex((a) => YEAR.test(a))
    if (yearAt < 1) continue // no year, or no surname in front of it
    const surnames = args.slice(0, yearAt).map((s) => s.toLowerCase())
    out.push({ surnames, year: args[yearAt], key: harvardKey(surnames[0], args[yearAt]) })
  }
  return out
}

/**
 * A bibliography section's full citations, keyed the way its article's short
 * citations point at them. Entries carrying no identifier are left out — they
 * name a source but open no path to it, which is all this map is for.
 *
 * @returns {Map<string, {title: string|null, isbn: string|null, oclc: string|null, lccn: string|null}>}
 */
export function bibliographyIdentifiers(wikitext) {
  const bib = new Map()
  // Footnote bodies are not bibliography entries; a Notes section can hold both.
  const text = (wikitext ?? '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
  const re = /\{\{\s*(?:cite[ _][a-z]+|citation)\b/gi
  let m
  while ((m = re.exec(text))) {
    const tpl = extractTemplate(text.slice(m.index))
    if (!tpl) continue
    const p = templateParams(tpl)

    const surname = stripMarkup(p.get('last') ?? p.get('last1') ?? p.get('author') ?? p.get('author1'))
    const stated = p.get('year')?.trim()
    const year = stated && YEAR.test(stated) ? stated : /\b(\d{4})\b/.exec(p.get('date') ?? '')?.[1]
    if (!surname || !year) continue

    const entry = {
      title: stripMarkup(p.get('title')),
      publisher: stripMarkup(p.get('publisher') ?? p.get('work')),
      isbn: validIsbn(p.get('isbn')),
      oclc: p.get('oclc')?.trim() || null,
      lccn: p.get('lccn')?.trim() || null,
      author: citationAuthors(p),
      date: year,
    }
    if (!entry.isbn && !entry.oclc && !entry.lccn) continue

    // An explicit {{sfnref|Name|Year}} overrides the surname the entry states —
    // it exists precisely because the two disagree.
    const custom = /\{\{\s*sfnref\s*\|([^{}]*)\}\}/i.exec(p.get('ref') ?? '')
    if (custom) {
      const args = positionalArgs(`{{x|${custom[1]}}}`)
      if (args.length >= 2) bib.set(harvardKey(args[0], args.at(-1)), entry)
    }
    const key = harvardKey(surname, year)
    if (!bib.has(key)) bib.set(key, entry) // first entry wins, as the article lists it
  }
  return bib
}

/**
 * A section's short citations resolved through a bibliography — the identifiers
 * it cites, in the order it cites them, each work once. Pointers with no
 * matching entry resolve to nothing: a dangling {{sfn}} is a flaw in the
 * article, and inventing a target for it would be worse than dropping it.
 */
export function resolveShortCites(wikitext, bibliography) {
  const seen = new Set()
  const out = []
  for (const pointer of shortCitePointers(wikitext)) {
    if (seen.has(pointer.key)) continue
    seen.add(pointer.key)
    const entry = bibliography.get(pointer.key)
    if (entry) out.push(entry)
  }
  return out
}

/**
 * The best primary link for a citation: the URL the article states, then a
 * DOI landing page, then the archived copy. The archive used to be preferred
 * here; now that the rail shows it as its own dated link, the primary link
 * says what the citation says, and the archive stands by in the same card
 * for when the original has rotted.
 */
export function citationHref(cite) {
  if (cite.url) return cite.url
  if (cite.doi) return `https://doi.org/${cite.doi}`
  return cite.archiveUrl ?? null
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
  if (catalog) return { availability: 'catalog', label: 'Cataloged · Open Library', url: catalog }
  return null
}

/**
 * What the section cites versus what a reader can actually open. The gutter
 * now shows the article's own footnotes rather than a curated shortlist, so
 * this is the summary line under them: without it the difference between a
 * section whose sources are all reachable and one whose sources are all dead
 * ends is invisible. Holdings arrive pre-fetched (one batched request for
 * the whole article); access lands on the candidates as a side effect, which
 * is also what lets footnotes borrow it by ISBN. `unchecked` names
 * the ISBNs whose OpenLibrary batch failed this run: those works get no
 * access verdict at all, because "we could not look" must never render as
 * "there is no copy".
 */
/**
 * The identity a cited work is counted and claimed under, page-wide. Strongest
 * identifier first — bibliography entries carry isbn/oclc/lccn, direct cites
 * carry isbn/doi/url — and title as the last resort. Null when the citation
 * states nothing usable: the callers (claimCitations, the page-wide counter)
 * treat a null key as "keep, claim nothing", because folding two
 * unidentifiable works into one would miscount the other way.
 */
export const citationKey = (c) =>
  c.isbn ?? c.oclc ?? c.lccn ?? c.doi ?? c.url ?? (c.title || null) ?? null

/**
 * Access verdicts onto the candidates — split out of citationCoverage
 * (2026-08-14) because the side effect and the count now cover DIFFERENT
 * sets. Access must land on every section's own candidate objects: the
 * footnotes read `cite.access` by ISBN from their band's railCandidates, and
 * a later section's copy of a twice-cited book is a distinct object. The
 * TALLY, by contrast, counts each distinct work once (see pageCitations).
 */
export function applyAccess(candidates, volumes) {
  for (const cite of candidates) {
    if (!cite.isbn) continue
    cite.access = openLibraryAccess(volumes.get(cite.isbn))
  }
}

export function citationCoverage(candidates, volumes, unchecked = new Set(), { searched = true } = {}) {
  applyAccess(candidates, volumes)
  const isUnchecked = (c) => c.isbn && !c.access && unchecked.has(c.isbn)
  const open = candidates.filter(
    (c) => c.access?.availability === 'full' || c.access?.availability === 'borrow',
  ).length
  const cataloged = candidates.filter((c) => c.access?.availability === 'catalog').length
  const linked = candidates.filter(
    (c) => !c.access && !isUnchecked(c) && (c.archiveUrl || c.doi || c.url),
  ).length
  return {
    total: candidates.length,
    open,
    cataloged,
    linked,
    unchecked: candidates.filter(isUnchecked).length,
    // Whether any access lookup ran for this band at all. Carried as a fact
    // rather than inferred from counts, because most citations carry no ISBN
    // and a count comparison cannot tell "asked and found nothing" from
    // "never asked" (a single-institution page's lookups sit out entirely).
    searched,
  }
}

/**
 * The coverage line, phrased so an absence reads as a fact about the ecosystem
 * rather than as a thin section — and so every bucket says where it points:
 * "readable" means the Internet Archive links on the notes above, "catalog"
 * means OpenLibrary knows the book but holds no scan, and works we add nothing
 * to are said to be exactly that. Says nothing when there is nothing to say.
 */
/**
 * The whole page's citation tally, summed from the per-band ones.
 *
 * This used to be said per section and is now said once (2026-08-04, review).
 * On San Francisco the per-section line fired 36 times and 26 of those said
 * nothing but a variation of "we found no free copy" — 26 repetitions of a
 * negative to deliver 21 positives. Summed, the same data is one sharp
 * sentence: 620 works cited, 6 you can read right now. It also ends a
 * collision, since "References in this section · 18" and "Of the 27 works
 * these notes cite" no longer share a box and read as a contradiction.
 */
export function pageCitations(bands) {
  const sum = { total: 0, open: 0, cataloged: 0, linked: 0, unchecked: 0 }
  const papers = { total: 0, open: 0 }
  let searched = false
  for (const b of bands ?? []) {
    for (const k of Object.keys(sum)) sum[k] += b.citations?.[k] ?? 0
    papers.total += b.papers?.total ?? 0
    papers.open += b.papers?.open ?? 0
    if (b.citations?.searched === true) searched = true
  }
  return { ...sum, papers, searched }
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve']
const spell = (n) => WORDS[n] ?? n.toLocaleString()

/**
 * What the open ecosystem holds of what this article cites, in a sentence or
 * two. The same finding as the visibility tiers, measured on citations rather
 * than institutions, which is why it belongs in the same panel.
 */
export function citationHeadline({ total, open, cataloged, unchecked = 0, papers, searched = true } = {}) {
  if (!total) return null
  // What a reader can actually open: the OpenLibrary verdicts AND the open
  // papers. `open` alone is books, and counting only books rendered a flat
  // self-contradiction on Monarch butterfly (2026-08-14): "We could not find
  // a free copy of any of them" three sentences before "34 are free to
  // read". The papers clause below remains as this number's breakdown.
  const readable = open + (papers?.open ?? 0)
  // "This article" would read as the page in front of the reader. It means
  // the one on Wikipedia, and has to say so.
  const out = [
    `The original Wikipedia article cites ${total.toLocaleString()} work${total === 1 ? '' : 's'}.`,
  ]
  // "We could not find" claims a search happened. On a single-institution
  // page the access lookups sit out entirely, so no search did — the
  // negative must not stand ("we could not look" must never render as
  // "there is no copy"), and the could-not-check line below speaks for the
  // whole citation list rather than only the ISBN-carrying part of it.
  let accessLine
  if (readable) {
    accessLine = `${cap(spell(readable))} of them you can read or borrow right now.`
  } else if (!searched && total > 0) {
    accessLine = null
  } else {
    // Never "no free copy exists" — we searched, we did not survey the world.
    accessLine = `We could not find a free copy of any of them.`
  }
  if (accessLine) out.push(accessLine)
  // "More" only reads if something came before it. With nothing readable, the
  // cataloged ones are not "more" — they are the whole of what was found.
  if (cataloged) {
    const them = cataloged === 1 ? 'it' : 'them'
    out.push(
      readable
        ? `Open Library has cataloged ${spell(cataloged)} more that nobody has scanned.`
        : `Open Library has cataloged ${spell(cataloged)} of them, but nobody has scanned ` +
          `${them}.`,
    )
  }
  // "We could not look" must never be left to read as "there is nothing there".
  if (!searched && total > 0)
    out.push(`${cap(spell(total))} we could not check this time.`)
  else if (unchecked)
    out.push(`${cap(spell(unchecked))} we could not check this time.`)
  // The papers clause claims a search too. When none ran, the could-not-check
  // line above already speaks for every cited work, papers included.
  if (papers?.total && searched) {
    const paperWord = papers.total === 1 ? 'paper' : 'papers'
    const openClause = papers.open
      ? `${spell(papers.open)} ${papers.open === 1 ? 'is' : 'are'} free to read`
      : 'we found none free to read'
    out.push(
      `Of the ${papers.total.toLocaleString()} research ${paperWord} among them, ` + `${openClause}.`,
    )
  }
  return out.join(' ')
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// `prioritizeCitations` and `reachabilityRank` were retired here on
// 2026-08-05. They chose which few of a section's citations to show, ranked by
// how surely a reader could open each one — and they stopped running when the
// gutter switched to rendering Wikipedia's own footnotes in full, which needs
// no shortlist and no ranking. They survived that change for weeks because
// four tests kept them green: a passing test is not evidence of a caller.
// Ranking now happens where the page actually chooses — over finds, not
// citations. See src/hero.js.
