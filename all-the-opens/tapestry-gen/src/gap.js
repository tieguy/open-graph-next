// What the article itself can and cannot show.
//
// Every other module here answers "what does the open web hold about this
// subject?" This one answers the question that makes the first one matter:
// **of everything we found, how much of it can Wikipedia put in front of a
// reader?** The answer, on almost every page, is almost none of it — and that
// gap is the finding, so it is measured rather than assumed.
//
// Three tiers, and the whole argument lives in the distance between them:
//
//   shown      the partner's own material is IN the article, credited to them.
//              Exactly one kind of partner can reach this tier: OpenStreetMap,
//              through the Kartographer map extension. There is no second.
//   link       the article links to the partner's site somewhere — usually one
//              line of text among the identifiers at the foot of the page.
//   invisible  the article does not reach them at all.
//
// Nothing here costs a request. `fetchArticle` already parses the whole
// article; this reads two more fields off the SAME response (the templates it
// transcludes and the sites it links) and compares them against what the
// pivots found. NOT `prop=images` — see the note on `fetchArticle` for why it
// is the wrong instrument for counting what an article shows. See LUI-122.

/**
 * The sites that ARE a partner, for the purpose of asking whether the article
 * already reaches them. Matched on the registrable host and any subdomain, so
 * `www.gbif.org` and `api.gbif.org` both count as GBIF.
 *
 * `iiif` has no entry on purpose: a IIIF manifest is served by whichever
 * library or museum holds the object, so its hosts can only come from the
 * cards themselves (see `partnerHosts`).
 */
export const PARTNER_HOSTS = {
  internet_archive: ['archive.org'],
  openlibrary: ['openlibrary.org'],
  openstreetmap: ['openstreetmap.org', 'osm.org'],
  met: ['metmuseum.org'],
  artic: ['artic.edu'],
  inaturalist: ['inaturalist.org'],
  gbif: ['gbif.org'],
  dpla: ['dp.la'],
  europeana: ['europeana.eu'],
  // An article never links OpenAlex; what it links is the paper's DOI. That IS
  // the reach question for this partner — the citation is present, and what a
  // reader cannot tell from it is that a free copy exists.
  openalex: ['openalex.org', 'doi.org'],
  arxiv: ['arxiv.org'],
  free_law: ['courtlistener.com'],
  smithsonian: ['si.edu'],
  iiif: [],
}

// A Wayback link is a rescued dead citation, not the Internet Archive's own
// collection appearing in the article. Counting it would let the page claim
// the Archive is visible on nearly every article on Wikipedia, which is a
// different — and much weaker — statement than the one being made.
const NOT_THE_COLLECTION = new Set(['web.archive.org'])

/**
 * A URL's host, lower-cased and without `www.`, or null. Hostless URLs parse
 * fine and yield an empty hostname — `mailto:` is the common one in a
 * reference list — and an empty string would match nothing while still reading
 * as a host to every caller.
 */
export function hostOf(url) {
  if (!URL.canParse?.(url)) return null
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null
}

/** Whether `host` is `base` or a subdomain of it. */
const under = (host, base) => host === base || host.endsWith(`.${base}`)

/**
 * What the ARTICLE contains, read off the parse response `fetchArticle`
 * already made. Pure: hand it the fields, get back the shape the report needs.
 */
export function articleReach({ templates = [], externallinks = [], html = '' } = {}) {
  const hosts = new Set()
  for (const url of externallinks) {
    const host = hostOf(url)
    if (host && !NOT_THE_COLLECTION.has(host)) hosts.add(host)
  }
  const names = new Set(templates.map((t) => (typeof t === 'string' ? t : t.title)))
  return {
    hosts,
    templates: names,
    // Kartographer, read from the rendered HTML rather than from a template
    // name: maps arrive through {{Maplink}}, {{Mapframe}} and a dozen
    // infoboxes that embed one, and every route emits this class.
    kartographer: /mw-kartographer/.test(html),
    // The Wikidata-driven identifier bars. When one of these is present, a
    // partner's link is a number in a list at the foot of the article, and the
    // report can say so precisely instead of vaguely.
    identifierBar: names.has('Template:Authority control') || names.has('Template:Taxonbar'),
  }
}

// The partners whose links, when an identifier bar is present, are IN that bar
// — verified by rendering, 2026-08-04: Open Library rides {{Authority
// control}}; iNaturalist and GBIF ride {{Taxonbar}}. Everyone else's link, if
// there is one, came from a citation instead, so the report does not guess.
const IN_THE_BAR = new Set(['openlibrary', 'inaturalist', 'gbif'])

// One partner needs saying differently. An article never links OpenAlex; it
// links the paper's DOI, and OpenAlex's whole contribution is knowing that a
// free copy of that paper exists. "A link in the small print" would credit the
// article with something it does not do.
const WHERE_OVERRIDE = {
  openalex: 'its DOI is linked; that anyone can read it free is not',
}

/**
 * Every partner this page drew on, and what each contributed — kept as two
 * separate counts, because they are two different things a reader can see.
 *
 * Cards are the obvious contribution; a footnote whose "Borrow" link resolves
 * through Open Library is a real one too, and a tally counting only cards
 * would report a partner as absent from a page using it twenty times. But the
 * two must not be added together: a panel row reading "13 items on this page"
 * beside a visible shelf of six cards is a number the reader cannot reconcile,
 * and an unreconcilable number in a panel whose point is that it can be
 * checked costs more than it buys.
 *
 * @returns {Map<string, {cards: number, notes: number}>} slug → what it gave
 */
export function partnerTally(bands) {
  const tally = new Map()
  const bump = (slug, kind) => {
    const cur = tally.get(slug) ?? { cards: 0, notes: 0 }
    cur[kind]++
    tally.set(slug, cur)
  }
  const noteHost = (url) => {
    const host = hostOf(url)
    if (!host) return
    for (const [slug, bases] of Object.entries(PARTNER_HOSTS)) {
      // Not doi.org: every second footnote carries one, and OpenAlex did not
      // put it there. A partner earns a tally mark by supplying something.
      if (slug === 'openalex') continue
      if (bases.some((b) => under(host, b))) bump(slug, 'notes')
    }
  }
  for (const b of bands ?? []) {
    for (const e of b.entries ?? []) if (e.source) bump(e.source, 'cards')
    for (const f of b.footnotes ?? []) if (f.access?.url) noteHost(f.access.url)
  }
  return tally
}

/** The hosts that would prove this partner is reachable from the article. */
function partnerHosts(slug, bands) {
  const hosts = new Set(PARTNER_HOSTS[slug] ?? [])
  // A partner with no fixed host — IIIF — is identified by where its own
  // cards point, which is the institution holding the object.
  for (const b of bands ?? []) {
    for (const e of b.entries ?? []) {
      if (e.source !== slug || !e.href) continue
      const host = hostOf(e.href)
      if (host) hosts.add(host)
    }
  }
  return hosts
}

const TIER_ORDER = { shown: 0, link: 1, invisible: 2 }

/**
 * Each partner on this page, and whether the article can show it.
 *
 * @param {Array} bands the discovered bands
 * @param {object} reach what `articleReach` read off the article
 * @returns {Array<{slug, count, tier, where}>} ordered shown → link → invisible
 */
export function visibilityReport(bands, reach) {
  const tally = partnerTally(bands)
  const rows = []
  for (const [slug, count] of tally) {
    // `count` is {cards, notes}; every row carries it through unsummed so the
    // renderer can say what each number is.
    // The one exception in the whole system, and the reason the argument has a
    // shape: OpenStreetMap's data renders inside the article, as OpenStreetMap.
    if (slug === 'openstreetmap' && reach?.kartographer) {
      // Not "this article" — the reader is looking at a page that shows all
      // of these; only naming Wikipedia makes the claim legible.
      rows.push({ slug, count, tier: 'shown', where: 'the map in the original article is theirs' })
      continue
    }
    const hosts = partnerHosts(slug, bands)
    const linked = [...(reach?.hosts ?? [])].some((h) => [...hosts].some((b) => under(h, b)))
    if (!linked) {
      rows.push({ slug, count, tier: 'invisible', where: null })
      continue
    }
    rows.push({
      slug,
      count,
      tier: 'link',
      where:
        WHERE_OVERRIDE[slug] ??
        (reach?.identifierBar && IN_THE_BAR.has(slug)
          ? 'a number in the identifier list at the foot of the article'
          : 'a link, in the small print'),
    })
  }
  const weight = (r) => r.count.cards + r.count.notes
  return rows.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || weight(b) - weight(a))
}

/**
 * The report as counts, for the sentence that opens the panel.
 * `invisible` is the number that matters; the rest give it its denominator.
 */
export function gapCounts(report) {
  const of = (tier) => report.filter((r) => r.tier === tier).length
  return { total: report.length, shown: of('shown'), link: of('link'), invisible: of('invisible') }
}
