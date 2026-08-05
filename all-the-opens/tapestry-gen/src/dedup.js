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
 * seventeen — so the lede of the article about the painting used to pivot on
 * `oil painting` and `beaverboard`, and got four Finnish oil paintings for it.
 *
 * Wikidata already knows better and costs nothing to ask: the claims are
 * already fetched for the subject pivots, so this reorders a list the pipeline
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
