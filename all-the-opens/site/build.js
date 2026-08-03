#!/usr/bin/env node
/**
 * Assembles the publishable site into `_site/`.
 *
 * The renders live where they are generated — `tapestry-gen/demo/` for the
 * enriched pages, `web-demo/` for the graph — and neither directory is shaped
 * like a website. Rather than move them (which would break `npm run generate`
 * and the D3 demo's relative data paths), this copies them into one directory
 * with the URLs a reader should see: the `spike-` prefix is an implementation
 * detail of which entry point made the file, not something to publish.
 *
 * Output is a plain static directory. Any host that serves files will do.
 *
 *   node site/build.js
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '_site')

// [from, to] — `to` is the URL path readers get.
const FILES = [
  ['site/index.html', 'index.html'],
  ['tapestry-gen/demo/spike-apollo-11.html', 'apollo-11.html'],
  ['tapestry-gen/demo/spike-brown-v-board-of-education.html', 'brown-v-board-of-education.html'],
  ['tapestry-gen/demo/spike-ludwig-prandtl.html', 'ludwig-prandtl.html'],
  ['tapestry-gen/demo/apollo-11.html', 'curated-apollo-11.html'],
]

// The D3 demo is copied whole: it loads `data/apollo-11/**` at runtime by
// relative path, so it only works with its data sitting beside it.
const DIRS = [['web-demo', 'graph']]

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  let bytes = 0
  for (const [from, to] of FILES) {
    const src = join(ROOT, from)
    // A missing render means someone published a site with a dead link in it.
    // Fail loudly here rather than at whatever point a reader clicks it.
    const info = await stat(src).catch(() => null)
    if (!info) throw new Error(`missing render: ${from} — run its generator first`)
    await cp(src, join(OUT, to))
    bytes += info.size
    console.log(`${to.padEnd(34)} ${String(Math.round(info.size / 1024)).padStart(5)} KB`)
  }

  for (const [from, to] of DIRS) {
    await cp(join(ROOT, from), join(OUT, to), { recursive: true })
    console.log(`${(to + '/').padEnd(34)}     — copied`)
  }

  console.log(`\n_site/ built — ${Math.round(bytes / 1024)} KB of renders plus the graph demo.`)
  console.log('Preview: python3 -m http.server 8000 -d _site')
}

await main()
