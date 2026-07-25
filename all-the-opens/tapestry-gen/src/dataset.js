import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Loads the Apollo 11 dataset shared with the D3 demo. Read-only: the generator
 * never mutates web-demo/data.
 */
export async function loadDataset(dataDir) {
  const itemsDir = join(dataDir, 'items')
  const files = (await readdir(itemsDir)).filter((f) => f.endsWith('.json'))

  const items = new Map()
  for (const file of files) {
    const item = JSON.parse(await readFile(join(itemsDir, file), 'utf8'))
    items.set(item.id, item)
  }

  const seed = JSON.parse(await readFile(join(dataDir, 'seed.json'), 'utf8'))
  // Known dataset issue: wiki-apollo-11 is a connection source and the seed, but
  // has no file in items/. Fold it in so downstream code can treat it uniformly.
  if (!items.has(seed.id)) items.set(seed.id, seed)

  const connections = JSON.parse(await readFile(join(dataDir, 'connections.json'), 'utf8'))

  return { items, seed, connections }
}

/**
 * Adjacency in both directions. connections.json is almost entirely one-way
 * (38 of 40 edges), but for "which section does this media item belong to" we
 * care that two things are related, not which way the arrow points.
 */
export function buildAdjacency(connections) {
  const adj = new Map()
  const add = (a, b, edge) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push({ id: b, ...edge })
  }
  for (const [sourceId, edges] of Object.entries(connections)) {
    for (const edge of edges) {
      const meta = { type: edge.type, label: edge.label, linkedVia: edge.linkedVia ?? [] }
      add(sourceId, edge.targetId, meta)
      add(edge.targetId, sourceId, meta)
    }
  }
  return adj
}

/** Hop distance from a starting id, over the undirected adjacency. */
export function hopDistances(adj, startId) {
  const dist = new Map([[startId, 0]])
  const queue = [startId]
  while (queue.length) {
    const current = queue.shift()
    for (const { id } of adj.get(current) ?? []) {
      if (dist.has(id)) continue
      dist.set(id, dist.get(current) + 1)
      queue.push(id)
    }
  }
  return dist
}

/** Distinct authority systems backing the edges between two items. */
export function corroboration(adj, a, b) {
  const systems = new Set()
  for (const edge of adj.get(a) ?? []) {
    if (edge.id === b) for (const via of edge.linkedVia) systems.add(via)
  }
  return systems
}
