#!/usr/bin/env node
/**
 * Streaming entry point for live discovery — Phase 7 of the design plan, the
 * "actually dynamic" experiment: visit /wiki/<Article Title> and the article
 * spine renders in the time one parse call takes, with the ecosystem's media
 * and sources streaming into the margins as each pivot answers.
 *
 * One chunked HTML response per page; no client framework, no polling. The
 * discovery pipeline, its budgets and its per-host politeness are exactly the
 * batch ones (src/discover.js) — the only difference is when the bytes leave.
 * Repeat views ride the same disk cache as spike.js, so a page you have seen
 * before arrives essentially at once.
 *
 *   WIKIMEDIA_UA_CONTACT=you@example.com node serve.js [port]
 */
import { createServer } from 'node:http'

import { discover } from './src/discover.js'
import { frontPage } from './src/front-page.js'
import { coverDataUri } from './src/http.js'
import { userAgent } from './src/wmf.js'
import {
  iconUrls,
  streamBand,
  streamClose,
  streamHeroExtras,
  streamOpen,
} from './src/emit-html.js'
import { escapeHtml } from './src/emit.js'

// Fail at startup, not mid-stream, if the operator contact is unset.
userAgent('tapestry-gen')

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787)

// Source icons are page furniture, not findings: fetch them once at startup
// (disk-cached, so usually instant) and serve every page from the same map.
const icons = new Map()
for (const url of iconUrls()) {
  const uri = await coverDataUri(url, { minBytes: 64 })
  if (uri) icons.set(url, uri)
}

/** The images one band must carry inline, resolved from disk cache. */
async function bandInline(b) {
  const inline = new Map(icons)
  for (const e of b.entries ?? []) {
    // OpenLibrary covers redirect through archive.org; OSM tiles must not be
    // hotlinked from readers' browsers (tile policy) — both travel inline.
    if (!/covers\.openlibrary\.org|tile\.openstreetmap\.org/.test(e.imageUrl ?? '')) continue
    if (inline.has(e.imageUrl)) continue
    const uri = await coverDataUri(e.imageUrl)
    if (uri) inline.set(e.imageUrl, uri)
  }
  return inline
}

// The front page: rendered once at startup, with the same inlined source
// icons the article pages carry.
const INDEX = frontPage({ inline: icons })

// Each discovery fans out dozens of upstream requests (politely — the
// per-host queues serialize them globally), so inbound load must be capped
// where it arrives: a few pages at a time is a demo, an unbounded queue of
// them is someone else's traffic problem.
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 4)
let inFlight = 0

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(INDEX)
    return
  }
  if (url.pathname === '/robots.txt') {
    // Every /wiki/ visit spends upstream API capacity; crawlers must not.
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('User-agent: *\nDisallow: /wiki/\n')
    return
  }
  const m = /^\/wiki\/(.+)$/.exec(url.pathname)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found\n')
    return
  }
  if (inFlight >= MAX_CONCURRENT) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '15' })
    res.end(
      '<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;margin:15vh auto;max-width:40rem">' +
        'The demo is busy discovering other pages right now — it fetches politely, a few at a time. ' +
        'Try again in a moment.</p>\n',
    )
    return
  }
  inFlight++
  const page = decodeURIComponent(m[1]).replace(/_/g, ' ')
  const started = Date.now()
  let streaming = false
  try {
    const { bands, stats } = await discover(page, {
      async emit(type, data) {
        if (type === 'spine') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            // Every view re-runs discovery (the disk cache is the cache);
            // a stale copy of a streaming page is worth less than a fresh run.
            'Cache-Control': 'no-store',
          })
          res.write(
            streamOpen({
              title: page,
              units: data.units,
              inline: icons,
              home: process.env.SITE_HOME ?? '/',
            }),
          )
          streaming = true
        }
        if (type === 'band') {
          // Build the fragment fully (cover inlining awaits disk) before the
          // single write, so concurrent band tasks never interleave bytes.
          const fragment = streamBand(data, await bandInline(data))
          if (fragment) res.write(fragment)
        }
      },
    })
    const inline = new Map(icons)
    for (const b of bands) for (const [k, v] of await bandInline(b)) inline.set(k, v)
    // The front page IS the home now; the draw-note's discussion link points
    // at its #hard-problems section on this same host.
    res.write(streamHeroExtras(bands, { inline, home: process.env.SITE_HOME ?? '/' }))
    res.write(
      streamClose({
        provenance:
          `Discovered live from the English Wikipedia article ` +
          `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}">` +
          `${escapeHtml(page)}</a> — no curated dataset, streamed as it was found.`,
      }),
    )
    res.end()
    console.error(
      `${page}: ${stats.sections} sections in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
  } catch (e) {
    console.error(`${page}: ${e.message}`)
    if (!streaming) {
      const missing = /missingtitle|invalidtitle/.test(e.message)
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;margin:15vh auto;max-width:40rem">` +
          (missing
            ? `No English Wikipedia article called “${escapeHtml(page)}”.`
            : `Discovery failed: ${escapeHtml(e.message)}`) +
          ` <a href="/">Try another</a>.</p>\n`,
      )
    } else {
      // The spine is already on the wire; say what happened where the reader is.
      res.write(
        `<p class="disclosure">Discovery stopped early: ${escapeHtml(e.message)}</p>` +
          streamClose({}),
      )
      res.end()
    }
  } finally {
    inFlight--
  }
}).listen(PORT, '0.0.0.0', () => {
  console.error(`live discovery on http://localhost:${PORT}/ — try /wiki/Ludwig_Prandtl`)
})
