#!/usr/bin/env node
/**
 * Batch entry point for live discovery: one self-contained HTML file per
 * article, byte-reproducible off its cache. The discovery itself — anchors,
 * lookups, budgets, the per-host queue — lives in src/discover.js and is
 * shared with serve.js, the streaming entry point.
 *
 *   node spike.js "Brown v. Board of Education"
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discover } from './src/discover.js'
import { coverDataUri, hotlinkUnsafe } from './src/http.js'
import { requestTally } from './src/mw.js'
import { userAgent } from './src/wmf.js'
import { buildHtml } from './src/emit-html.js'
import { ICONS } from './src/icons.js'
import { escapeHtml } from './src/html.js'

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
  // Everything below names the article discovery actually read, not argv:
  // `node spike.js "Coral_Gables"` renders Coral Gables, Florida, and the
  // file, the <h1> and the footer must all say so.
  const { title, bands, stats, dropped, opinion, reach } = await discover(page)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out = join(HERE, 'demo', `spike-${slug}.html`)

  // Images that must travel with the page — the shared predicate in
  // src/http.js says why each class is fetched by us rather than hotlinked.
  const inline = new Map()
  for (const b of bands) {
    for (const e of b.entries ?? []) {
      if (!hotlinkUnsafe(e)) continue
      if (inline.has(e.imageUrl)) continue
      const uri = await coverDataUri(e.imageUrl)
      if (uri) inline.set(e.imageUrl, uri)
    }
  }

  // Source icons travel too, and for a sharper reason than the covers: several
  // of these sites refuse cross-origin hotlinks outright (CourtListener answers
  // 403), so a live <img> is a guaranteed broken image for the sources readers
  // are least likely to recognize unaided. They come from src/icons.js now —
  // committed bytes rather than fifteen fetches per run, which also makes a
  // batch render one fewer thing that can differ between two runs.
  for (const [url, uri] of ICONS) if (!inline.has(url)) inline.set(url, uri)

  const html = buildHtml({
    title,
    bands,
    inline,
    // What the article itself already reaches, for the visibility panel.
    reach,
    // The page opens by saying it used no curated dataset; the footer has to
    // agree with it. No timestamp — a rerun off the same cache must produce the
    // same bytes.
    // Where the index that discusses these trade-offs is published. Overridable
    // because anyone can run this; unset it and the page simply states the rule
    // without pointing anywhere, which is right for a file opened off disk.
    home: process.env.SITE_HOME ?? 'https://friendsof.wiki/',
    // No default, unlike `home`: og:url is a CANONICAL claim, and a batch
    // file hosted anywhere else would redirect its shares to friendsof.wiki
    // (ogMeta's contract: no origin, no og:url/og:image). Defaulting it also
    // made batch bytes depend on an env var, against byte-reproducibility.
    siteOrigin: process.env.SITE_ORIGIN,
    provenance:
      `Discovered live from the English Wikipedia article ` +
      `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}">` +
      `${escapeHtml(title)}</a> — no curated dataset.`,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)

  const tally = [...requestTally.entries()].map(([h, n]) => `${h}:${n}`).join(' ')
  console.error(
    `\n${title}: ${stats.sections} sections, ${stats.anchorsCite} citation anchors ` +
      `(${stats.viaShortCite} via the bibliography), ${stats.anchorsScholar} scholarly anchors, ` +
      `${stats.anchorsQid} entity anchors -> ${stats.ia} IA + ${stats.scholar} open papers + ` +
      `${stats.statements} partner-statement items` +
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
