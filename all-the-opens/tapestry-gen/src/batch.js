// Batched forms of the citation lookups. archive.org's Solr and OpenLibrary's
// volumes API both answer many identifiers in one request; these helpers build
// those requests and re-associate the combined answer to the citation that
// asked, so the per-citation semantics (and guards) stay exactly what the
// one-request-per-identifier versions established.

/** `items` in runs of at most `size`, order preserved. */
export function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const stop = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'its', 'on', 'for'])
const tokens = (s) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  )

/**
 * One Solr query for a run of ISBNs. `mediatype:texts` is constrained in the
 * query, not filtered after, because book-dealer donation manifests are indexed
 * with every ISBN on the pallet and would otherwise spend the result rows.
 * `fl[]=isbn` is what lets the combined answer be dealt back out: the field is
 * multi-valued, one row can satisfy several queried ISBNs.
 */
export function iaSearchUrl(isbns, { rowsPer = 8 } = {}) {
  const isbnClause = isbns.map((i) => `isbn:${i}`).join(' OR ')
  const q = `(${isbnClause}) AND mediatype:texts`
  return (
    'https://archive.org/advancedsearch.php?q=' +
    encodeURIComponent(q) +
    // `licenseurl` rides the request the search was already making. Uploader-
    // supplied and messy — a 400-item sample carried a GPL URL on a novel — so
    // it is read through ccFromUri, which refuses anything it does not know.
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=isbn&fl%5B%5D=licenseurl' +
    `&rows=${isbns.length * rowsPer}&output=json`
  )
}

/**
 * The best archive.org row for one citation, from a combined result set.
 * Candidacy is a shared ISBN; the title-overlap guard is then the same second,
 * different check the single-lookup version used — against a mis-keyed ISBN in
 * the citation resolving to a real but unrelated book.
 */
export function matchIaDoc(cite, docs) {
  const wanted = tokens(cite.title)
  const shared = (doc) => {
    const held = Array.isArray(doc.isbn) ? doc.isbn : [doc.isbn].filter(Boolean)
    return held.includes(cite.isbn)
  }
  return (
    docs
      .filter(shared)
      .map((d) => {
        const overlap = [...tokens(d.title)].filter((w) => wanted.has(w)).length
        return { d, score: wanted.size ? overlap / wanted.size : 0 }
      })
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)[0]?.d ?? null
  )
}

/**
 * Internet Archive cards for a band, minus the ones its rail already covers.
 * A card exists to offer what the rail does not: when the same work is
 * already among the shown sources — same ISBN, or a link to the same scan —
 * the card yields to the richer rail entry (byline, publisher, access
 * label). Two citations resolving to one scan also collapse to one card.
 */
export function dedupedIaEntries(identified, iaHits, railCites) {
  const railIsbns = new Set(railCites.map((c) => c.isbn).filter(Boolean))
  const railHrefs = railCites.map((c) => c.href).filter(Boolean)
  const seen = new Set()
  const out = []
  for (const cite of identified) {
    const hit = iaHits.get(cite)
    if (!hit) continue
    const iaId = /\/(?:services\/img|details)\/([^/?#]+)/.exec(hit.imageUrl ?? '')?.[1] ?? null
    if (iaId && seen.has(iaId)) continue
    if (cite.isbn && railIsbns.has(cite.isbn)) continue
    if (iaId && railHrefs.some((h) => h.includes(`/details/${iaId}`))) continue
    if (iaId) seen.add(iaId)
    out.push(hit)
  }
  return out
}

/**
 * One Books API request for a run of ISBNs, keyed `ISBN:x` in the response.
 * This is the *fast* batch endpoint: volumes/brief also accepts many keys
 * (`|`-separated) but answers them serially server-side — 25 keys took 27s
 * against the Books API's 2s. `jscmd=data` carries exactly what access
 * resolution reads: the catalog `url` and the `ebooks` availability list.
 */
export function olBooksUrl(isbns) {
  return (
    'https://openlibrary.org/api/books?bibkeys=' +
    isbns.map((i) => `ISBN:${i}`).join(',') +
    '&format=json&jscmd=data'
  )
}
