// Keeping the disk cache inside its volume.
//
// The cache used to be ephemeral, so its size was somebody else's problem: a
// deploy or an idle timeout emptied it. On a Fly volume it is durable, which is
// the whole point — LC headings, class verdicts and partner records accrue
// across every article anyone ever asks for — and durable means it grows. A
// page costs roughly 4 MB, so a 3 GB volume is around 750 articles, and a
// volume that fills up stops the cache WRITING rather than stopping it growing:
// `getJson` would keep answering, `writeFile` would keep failing, and the demo
// would quietly become as slow as it was before the volume existed.
//
// So: a cap, and eviction of what has been read least recently.

import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Which files to drop so the cache fits, least-recently-READ first.
 *
 * Read time, not write time. Every file here is written once and read many
 * times, so evicting by mtime would drop the OLDEST entries first — and the
 * oldest are the most valuable, because a heading or class verdict that has
 * survived a hundred articles is exactly the one the next article will want.
 * (ext4's default `relatime` updates atime at most once a day, which is coarse
 * but correctly ordered for a cache measured in weeks.)
 *
 * Frees down to a floor below the cap rather than to the cap itself, so the
 * next page does not immediately trip the sweep again.
 *
 * @param {{name: string, size: number, atimeMs: number}[]} files
 * @returns {string[]} names to delete, in the order they should go
 */
export function chooseEvictions(files, { capBytes, floor = 0.8 } = {}) {
  let total = files.reduce((n, f) => n + f.size, 0)
  if (total <= capBytes) return []
  const target = capBytes * floor
  const gone = []
  for (const f of [...files].sort((a, b) => a.atimeMs - b.atimeMs)) {
    if (total <= target) break
    gone.push(f.name)
    total -= f.size
  }
  return gone
}

/**
 * Read the cache directory, evict if it is over the cap, and say what happened.
 * Never throws: a sweep that fails makes the cache large, not wrong.
 */
export async function sweep(dir, { capBytes, floor = 0.8 } = {}) {
  let files
  try {
    files = await readdir(dir)
  } catch {
    return { total: 0, evicted: 0, freed: 0 }
  }
  const stats = []
  for (const name of files) {
    try {
      const s = await stat(join(dir, name))
      if (s.isFile()) stats.push({ name, size: s.size, atimeMs: s.atimeMs })
    } catch {
      /* vanished under us — another writer, or a previous sweep */
    }
  }
  const total = stats.reduce((n, f) => n + f.size, 0)
  const doomed = new Set(chooseEvictions(stats, { capBytes, floor }))
  let freed = 0
  for (const f of stats) {
    if (!doomed.has(f.name)) continue
    try {
      await unlink(join(dir, f.name))
      freed += f.size
    } catch {
      /* already gone */
    }
  }
  return { total, evicted: doomed.size, freed }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(0)} MB`

/**
 * Sweep now and then every `everyMs`, reporting only when it actually evicts —
 * a cache comfortably inside its cap should be silent. Unref'd, so it never
 * holds the process open or delays a drain.
 */
export function startSweeping(dir, { capBytes, everyMs = 30 * 60_000 } = {}) {
  const once = async () => {
    const { total, evicted, freed } = await sweep(dir, { capBytes })
    if (evicted) {
      console.error(`cache sweep: ${mb(total)} over ${mb(capBytes)} — dropped ${evicted} files, freed ${mb(freed)}`)
    }
  }
  once()
  return setInterval(once, everyMs).unref()
}
