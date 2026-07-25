

/**
 * Placement is the design's central claim: nothing is positioned by hand. An
 * item lands in a section because the article's own wikilinks put it there,
 * resolved through Wikidata QIDs.
 *
 * Two tiers, because only Wikipedia-sourced items can be wikilinked at all:
 *
 *   Tier 1 — an item whose QID matches a QID the section links to.
 *   Tier 2 — an item connected (in connections.json) to a tier-1 item, placed
 *            in that item's section. This is how the media lands: the Internet
 *            Archive's speech recording is not wikilinked by the article, but
 *            it is linked to wiki-jfk, which is.
 *
 * Anything still unplaced but linked by geography goes to the prologue or coda.
 */
export function placeItems({ items, sections, sectionQids, itemQids, adj, seedId }) {
  const placement = new Map() // itemId -> {section, tier, via}
  const qidToItem = new Map()
  for (const [itemId, qid] of itemQids) {
    if (qid && !qidToItem.has(qid)) qidToItem.set(qid, itemId)
  }

  // The article's own subject is never wikilinked from within the article, so
  // the seed would otherwise go unplaced — and with it everything that hangs off
  // it, which is most of the mission media. It belongs in the lede by definition.
  if (items.has(seedId)) {
    placement.set(seedId, { section: sections[0].index, tier: 1, via: 'article subject' })
  }

  // Tier 1: direct wikilink match.
  //
  // Body sections are matched before the lede. The lede summarises the article,
  // so it links nearly every entity the body discusses; letting it match first
  // drags most of the dataset into the opening band and leaves the rest of the
  // spine empty. An entity the body discusses belongs with that discussion.
  const lede = sections[0]
  for (const section of [...sections.slice(1), lede]) {
    for (const qid of sectionQids.get(section.index) ?? []) {
      const itemId = qidToItem.get(qid)
      if (!itemId || placement.has(itemId)) continue
      placement.set(itemId, { section: section.index, tier: 1, via: qid })
    }
  }

  // Items whose every edge is justified by geography belong to place rather than
  // to narrative, so they are set aside before tier 2 can absorb them into a
  // section. Without this, the OSM entries disappear into whichever section
  // happens to mention the launch site.
  const placeOnly = new Set(
    [...items.keys()].filter((id) => !placement.has(id) && isPlaceOnly(adj, id)),
  )

  // Tier 2: one hop from a tier-1 item. Sorted for determinism, and an item
  // adjacent to several placed items goes to the earliest section so the
  // article's first mention wins — matching how a reader encounters it.
  const tier1 = [...placement.entries()]
  const order = new Map(sections.map((s, i) => [s.index, i]))
  for (const item of [...items.keys()].sort()) {
    if (placement.has(item) || placeOnly.has(item)) continue
    let best = null
    for (const neighbour of (adj.get(item) ?? []).map((e) => e.id).sort()) {
      const anchor = placement.get(neighbour)
      if (!anchor || anchor.tier !== 1) continue
      // Same reasoning as tier 1: prefer a body section over the lede, and among
      // body sections the earliest, so the article's first real discussion wins.
      const isLede = anchor.section === lede.index
      const bestIsLede = best && best.section === lede.index
      const better =
        !best ||
        (bestIsLede && !isLede) ||
        (bestIsLede === isLede && order.get(anchor.section) < order.get(best.section))
      if (better) best = { section: anchor.section, tier: 2, via: neighbour }
    }
    if (best) placement.set(item, best)
  }

  // Prologue holds pure places — every edge is a `location` edge, so the item is
  // part of the mission's geography. Coda holds things that merely sit at those
  // coordinates: they take part in `subject` edges, so they are their own topic.
  const prologue = []
  const coda = []
  for (const itemId of [...placeOnly].sort()) {
    const edges = adj.get(itemId) ?? []
    ;(edges.every((e) => e.type === 'location') ? prologue : coda).push(itemId)
  }

  const unplaced = [...items.keys()].filter((id) => !placement.has(id) && !placeOnly.has(id)).sort()

  return { placement, prologue, coda, unplaced, tier1Count: tier1.length }
}

// Authority systems that assert only where something is, never what it is.
const GEOGRAPHIC_ONLY = new Set(['coordinates', 'geonames'])

/**
 * True when every edge touching this item is justified *solely* by geographic
 * authorities — the item is connected to the story only by where it is.
 *
 * Testing the authority tokens rather than the edge `type` matters: the Sea of
 * Tranquility is joined to the moon landing by a `location` edge, but that edge
 * is also backed by Wikidata, which is a claim about what it is and not merely
 * where. It belongs in the narrative, so it must not be swept out here.
 *
 * Items with no edges at all are not place-only; they are simply unreachable.
 */
function isPlaceOnly(adj, itemId) {
  const edges = adj.get(itemId) ?? []
  if (!edges.length) return false
  return edges.every(
    (e) => e.linkedVia.length > 0 && e.linkedVia.every((via) => GEOGRAPHIC_ONLY.has(via)),
  )
}
