// Page-level dedup, decided from article order alone. Bands run and emit in
// COMPLETION order (streaming), so any first-come-wins state consulted at
// band-run time would be nondeterministic; this is pure over article-ordered
// input.
//
// `dropSeenFiles` lived here too until 2026-08-04. It existed for one caller —
// the Commons depicts chain, where the same file could be reached through two
// anchors — and went with it when Commons left the article pages (LUI-122).

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
