// Page-level dedup, decided from article order alone. Bands run and emit in
// COMPLETION order (streaming), so any first-come-wins state consulted at
// band-run time would be nondeterministic; this is pure over article-ordered
// input.
//
// `dropSeenFiles` lived here too until 2026-08-04. It existed for one caller —
// the Commons depicts chain, where the same file could be reached through two
// anchors — and went with it when Commons left the article pages (LUI-122).

// Properties whose value is a PARTICULAR THING rather than a category the
// subject belongs to. The distinction is the whole point: "American Gothic"
// states P170 creator → Grant Wood and P186 material used → beaverboard, and
// only one of those is worth asking a museum about.
//
// This list is deliberately incomplete, and safely so — an entity named by
// some property not listed here still outranks one the subject never mentions
// at all (see the three tiers in `subjectAnchors`). So a property missing from
// this list costs a little ordering, never a wrong answer, which is why an
// allowlist is affordable here where it usually would not be.
const NAMES_A_THING = new Set([
  // Who made it, ran it, appeared in it
  'P170', 'P50', 'P84', 'P86', 'P57', 'P58', 'P175', 'P110', 'P98', 'P112', 'P488',
  // Where it is, was, or came from
  'P195', 'P276', 'P131', 'P159', 'P19', 'P20', 'P189',
  // What it is of, or about, or after
  'P180', 'P921', 'P941', 'P138', 'P144',
  // Who took part, taught, studied, employed
  'P710', 'P108', 'P69', 'P184', 'P185', 'P1344',
  // What it produced or descends from
  'P800', 'P1026', 'P1441', 'P171', 'P793',
])

/**
 * The entities a Wikidata item's own statements point at, ranked by how
 * specifically the statement names them: 0 for a particular thing, 1 for
 * anything else the item mentions.
 *
 * Only entity-valued snaks: a date, a string identifier or a quantity names
 * nothing this page could anchor on. Somevalue/novalue snaks carry no
 * datavalue at all and fall out by the same test. The best rank wins when two
 * properties name the same entity — American Gothic states the American
 * Gothic House as both P180 depicts and P941 inspired by.
 *
 * @returns {Map<string, 0|1>}
 */
export function subjectAnchors(claims) {
  const out = new Map()
  for (const [prop, statements] of Object.entries(claims ?? {})) {
    const rank = NAMES_A_THING.has(prop) ? 0 : 1
    for (const s of statements ?? []) {
      const v = s?.mainsnak?.datavalue
      if (v?.type !== 'wikibase-entityid' || !v.value?.id) continue
      const id = v.value.id
      if (!out.has(id) || rank < out.get(id)) out.set(id, rank)
    }
  }
  return out
}

/**
 * The same candidates, reordered so the ones the subject names most
 * specifically come first — article order preserved inside each tier.
 *
 * Document order is a decent prominence proxy and a poor relevance one, and
 * the lede is where the two come apart hardest. "American Gothic is a 1930 oil
 * painting on beaverboard by Grant Wood" links the medium and the board before
 * it links the painter, and the Art Institute that owns it comes last of
 * seventeen — so the lede of the article about the painting used to look up on
 * `oil painting` and `beaverboard`, and got four Finnish oil paintings for it.
 *
 * Wikidata already knows better and costs nothing to ask: the claims are
 * already fetched for the subject lookups, so this reorders a list the pipeline
 * already has rather than looking anything up.
 *
 * THREE tiers, not two, and the middle one is load-bearing. A flat "does the
 * subject mention it" test still puts beaverboard first, because the item does
 * mention it — as the material. Ranking by which property names it puts Grant
 * Wood and the Art Institute ahead of the board, and the board ahead of "oil
 * painting", which the item never mentions at all.
 *
 * Applied to the LEDE ONLY, because the subject's claims are the only ones
 * fetched — a section deep in the article has no equivalent statement of what
 * it is about, and guessing one would be worse than document order.
 */
export function preferRelated(qids, ranks) {
  const tiers = [[], [], []]
  for (const q of qids) tiers[q ? (ranks.get(q) ?? 2) : 2].push(q)
  return tiers.flat()
}

// What a candidate's partner statements promise, best first. The sections have
// no equivalent of the subject's Wikidata item — nothing states what §"Cultural
// significance" is about — so where the lede ranks by which property names a
// link, a section can only rank by what the link turns out to HOLD.
//
// Measured on Apollo 11 (2026-08-05): of 331 candidate anchors, 23% name a
// particular thing, 26% name only a heading, and 50% have no partner hook at
// all. Picking two per section blind therefore lands on nothing about half the
// time, which is why 11 of 36 sections rendered no cards while their own later
// links held Met objects and taxa.
// An identifier that points at ONE object: whatever comes back is the thing
// the article linked, by construction. Nothing else on this list offers that.
// `si` and not `siinv`: the collapsed field is set only when the museum holding
// the object is a Smithsonian one, which is what makes it a guarantee. A bare
// P217 inventory number is not — other museums state it too. See statements.js.
const ITEM_LEVEL = ['met', 'aic', 'rijks', 'cleveland', 'iiif', 'inat', 'gbif', 'si']
const SOME_HOOK = [...ITEM_LEVEL, 'lc', 'eu', 'coord', 'osmr', 'osmw', 'osmn']

/**
 * How likely an anchor is to yield something that belongs, lowest first.
 *
 * THREE tiers, and the shortness of the list is deliberate:
 *
 * 0. An item-level identifier — a Met object, an Art Institute artwork, a IIIF
 *    manifest, a taxon. A guarantee, and the only one available here.
 * 1. Any other hook: a subject heading, a Europeana entity, a coordinate.
 * 2. Nothing at all.
 *
 * Tier 1 is deliberately NOT subdivided. A first attempt ranked headings above
 * coordinates, reasoning that a heading always returns items while a
 * coordinate may fail `mappable()` — and it immediately cost American Gothic's
 * lede the map of the actual house in the painting, promoting Nan Wood Graham
 * (a heading, contents unknown) over the American Gothic House (a coordinate
 * on a place the subject explicitly names). The reverse ordering fails just as
 * badly the other way: Apollo 11 has 95 location-bearing candidates, and a
 * page of maps of Houston, Canberra and Seattle is wallpaper.
 *
 * Neither ordering is defensible from what is known at pick time, so document
 * order — the article's own emphasis — breaks the tie, and src/breadth.js
 * catches the headings that turn out to be boxes. Prefer something over
 * nothing; do not pretend to know more than that.
 */
export function hookRank(statements) {
  if (!statements) return 2
  if (ITEM_LEVEL.some((k) => statements[k])) return 0
  return SOME_HOOK.some((k) => statements[k]) ? 1 : 2
}

/**
 * A unit's candidates, best-yielding first, article order inside each tier.
 *
 * This is what "query then pick" buys. The pipeline used to pick two anchors
 * per section and only then ask what they held; now it asks about every
 * candidate first — one cheap WDQS query per hundred — and picks anchors that
 * have something. The ordering is stable and pure over article-ordered input,
 * so streaming's completion-order emission still cannot change an assignment.
 */
export function preferYielding(qids, statements) {
  const tiers = [[], [], []]
  for (const q of qids) tiers[q ? hookRank(statements.get(q)) : 2].push(q)
  return tiers.flat()
}

/**
 * How openly a cited paper can be shown: `0` a free copy on stated terms, `1`
 * a free copy on terms nobody stated, `2` no free copy at all.
 *
 * The predicate for tier 0 is `rights.copy`, which is `ccFromSlug`'s verdict
 * and therefore already carries this project's "a mark is never a guess" rule
 * — OpenAlex's `other-oa` and a missing slug both land in tier 1, where the
 * card says "Free to read" and claims nothing about reuse.
 *
 * Deliberately NOT ranked on `open_access.oa_status` (checked 2026-08-14).
 * Its `diamond` value is inferred from an ABSENT article-processing charge
 * rather than a stated one — OpenAlex holds no fee figure for 17,904 of the
 * 23,235 DOAJ journals it knows, so "charges authors nothing" and "nobody
 * told us" arrive as the same word. It is also the weaker signal on the axis
 * this project actually cares about: of 200 diamond works sampled, 99 state
 * no license at all against 27 of 200 gold, so promoting diamond would push
 * a CC BY paper off the shelf in favor of one that may reserve every right.
 * The status is carried on the entry as data (`entry.oa.status`) and printed
 * nowhere. Wikidata's diamond class is not a substitute: better asserted,
 * zero recall on real citation graphs. Full measurements and commands:
 * ../../docs/2026-08-14-oa-tier-data-quality.md.
 */
export function openRank(entry) {
  if (!entry) return 2
  return entry.rights?.copy ? 0 : 1
}

/**
 * A section's cited papers, best-shown first, article order inside each tier
 * — and WITHOUT the ones that have no open copy.
 *
 * The citations twin of `preferYielding` (2026-08-14), fixing the same bug in
 * the same way. Each section took its first three cited DOIs on document
 * order and only then asked OpenAlex what was readable, so a closed paper
 * spent a slot and rendered nothing: 32 of Monarch butterfly's 82 cited DOIs
 * are closed, about a third of every section's budget. Dropping them here
 * rather than letting the cap discard them is the point — a closed paper can
 * never become a card, so keeping it in the running is not caution, it is the
 * blind pick this replaces.
 *
 * Pure over article-ordered input, like everything in this module: the pick
 * is a function of the page-wide lookup and the section's own citation order,
 * so a band's completion order still cannot change who shows which paper.
 */
export function preferOpen(cites, entryOf) {
  const tiers = [[], []]
  for (const c of cites) {
    const rank = openRank(entryOf(c))
    if (rank < 2) tiers[rank].push(c)
  }
  return tiers.flat()
}

/**
 * Assign each anchor QID to the first unit (article order) whose prose
 * mentions it, capping each unit at `perUnit` owned anchors; a unit whose
 * early candidates were claimed upstream backfills from its later ones.
 * `seeded` pre-assigns QIDs to a unit index — the subject's QID belongs to
 * the lede no matter who else links it.
 *
 * @param {Array<Array<string|null>>} candidates per-unit QID candidates, article order
 * @returns {Array<Array<string>>} per-unit owned anchors, same outer order
 */
export function claimAnchors(candidates, { perUnit, seeded = new Map() }) {
  const owner = new Map(seeded)
  return candidates.map((qids, i) => {
    const own = []
    for (const q of qids) {
      if (own.length >= perUnit) break
      if (!q || own.includes(q)) continue
      const holder = owner.get(q)
      if (holder != null && holder !== i) continue
      owner.set(q, i)
      own.push(q)
    }
    return own
  })
}

/**
 * The citations twin of claimAnchors (2026-08-09): a cited WORK belongs to
 * the first section that cites it, page-wide. Apollo 11 cites Carrying the
 * Fire in eight sections through the bibliography, and once singles floated
 * (the gutter rule) the same cover marched down the whole page's margin.
 *
 * Pure over article-ordered calls, like everything in this module: the units
 * loop runs sections in ARTICLE order and threads one `claimed` set through
 * these calls, so ownership is decided before any lookup runs — a band's
 * completion order can never change who shows the book, which is the same
 * argument that shaped claimAnchors and the deleted dropSeenFiles.
 *
 * The cap applies AFTER the page-wide drop (a section whose early cites were
 * claimed upstream backfills from its later ones), and only what a section
 * actually keeps is claimed — a cite squeezed out by the cap must stay
 * unclaimed, or a section that never rendered the book would own it and it
 * would appear nowhere. A keyless cite passes and claims nothing: refusing
 * to dedup is safer than dedup-by-accident on a null key.
 */
export function claimCitations(cites, claimed, cap, keyOf) {
  const kept = []
  for (const c of cites) {
    if (kept.length >= cap) break
    const key = keyOf(c)
    if (key && claimed.has(key)) continue
    if (key) claimed.add(key)
    kept.push(c)
  }
  return kept
}
