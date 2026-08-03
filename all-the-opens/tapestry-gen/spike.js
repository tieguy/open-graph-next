#!/usr/bin/env node
/**
 * Batch entry point for live discovery: one self-contained HTML file per
 * article, byte-reproducible off its cache. The discovery itself — anchors,
 * pivots, budgets, the per-host queue — lives in src/discover.js and is
 * shared with serve.js, the streaming entry point.
 *
 *   node spike.js "Brown v. Board of Education"
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discover } from './src/discover.js'
import { coverDataUri } from './src/http.js'
import { requestTally } from './src/mw.js'
import { userAgent } from './src/wmf.js'
import { buildHtml, iconUrls } from './src/emit-html.js'
import { escapeHtml } from './src/emit.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// Fail before any network if the contact is unset — see src/wmf.js.
userAgent('tapestry-gen')

async function main() {
  const started = Date.now()
  const page = process.argv[2]
  if (!page) {
    console.error('usage: node spike.js "Article title"')
    process.exit(1)
  }
  const slug = page.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out = join(HERE, 'demo', `spike-${slug}.html`)

  const { bands, stats, dropped, opinion } = await discover(page)

  // Images that must travel with the page: works by the subject carry
  // OpenLibrary covers on the entry itself (they resolve through the
  // archive.org redirect, so a live dependency would blank the rail whenever
  // the Internet Archive is down); OSM map tiles must not be hotlinked from
  // readers' browsers (tile policy).
  const inline = new Map()
  for (const b of bands) {
    for (const e of b.entries ?? []) {
      if (!/covers\.openlibrary\.org|tile\.openstreetmap\.org/.test(e.imageUrl ?? '')) continue
      if (inline.has(e.imageUrl)) continue
      const uri = await coverDataUri(e.imageUrl)
      if (uri) inline.set(e.imageUrl, uri)
    }
  }

  // Source icons travel too, and for a sharper reason than the covers: several
  // of these sites refuse cross-origin hotlinks outright (CourtListener answers
  // 403), so a live <img> is a guaranteed broken image for the sources readers
  // are least likely to recognise unaided. Only the icons this page will show
  // are fetched, and anything that fails simply renders as a name.
  for (const url of iconUrls()) {
    if (inline.has(url)) continue
    const uri = await coverDataUri(url, { minBytes: 64 })
    if (uri) inline.set(url, uri)
  }

  const html = buildHtml({
    title: page,
    bands,
    inline,
    // The page opens by saying it used no curated dataset; the footer has to
    // agree with it. No timestamp — a rerun off the same cache must produce the
    // same bytes.
    // Where the index that discusses these trade-offs is published. Overridable
    // because anyone can run this; unset it and the page simply states the rule
    // without pointing anywhere, which is right for a file opened off disk.
    home: process.env.SITE_HOME ?? 'https://help-from-our-friends.fly.dev/',
    provenance:
      `Discovered live from the English Wikipedia article ` +
      `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}">` +
      `${escapeHtml(page)}</a> — no curated dataset.`,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)

  const tally = [...requestTally.entries()].map(([h, n]) => `${h}:${n}`).join(' ')
  console.error(
    `\n${page}: ${stats.sections} sections, ${stats.anchorsCite} citation anchors ` +
      `(${stats.viaShortCite} via the bibliography), ${stats.anchorsScholar} scholarly anchors, ` +
      `${stats.anchorsQid} entity anchors -> ${stats.ia} IA + ${stats.scholar} open papers + ` +
      `${stats.commons} Commons + ${stats.statements} partner-statement items` +
      (opinion ? ' + 1 Free Law opinion' : '') +
      (dropped > 0 ? ` (${dropped} sections dropped by MAX_SECTIONS)` : ''),
  )
  console.error(
    `${((Date.now() - started) / 1000).toFixed(1)}s` +
      (tally ? `, network requests — ${tally}` : ', fully from cache'),
  )
  console.error(out)
}

await main()
