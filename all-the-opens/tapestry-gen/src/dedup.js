// Page-level dedup, decided from article order alone. Bands run and emit in
// COMPLETION order (streaming), so any first-come-wins state consulted at
// band-run time would be nondeterministic; both functions here are pure over
// article-ordered input.

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
 * Drop entries whose key already appeared in an earlier list (or in `seen`),
 * so one file never renders twice on a page. Keyless entries always pass —
 * refusing to dedup is safer than dedup-by-accident on a null key.
 */
export function dropSeenFiles(lists, keyOf, seen = new Set()) {
  return lists.map((list) =>
    list.filter((e) => {
      const key = keyOf(e)
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}
