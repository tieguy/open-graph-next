// Rendered pages, kept whole.
//
// `.cache/` has always been a REQUEST cache: one file per upstream URL, so a
// warm page's discovery is 100% offline. What it never was is a PAGE cache — so
// every view re-ran `discover()` from scratch, re-deriving the same page from
// the same frozen bytes: parse the cached article, slice the sections, run every
// lookup, rank, render. About a quarter-second of work per view for an answer
// that could not have changed, because nothing in this cache expires. Repeat
// views bought no freshness; they bought a recomputation.
//
// So a repeat view is now a file read. The stored bytes are the ones actually
// SENT — bands stream in completion order, deliberately nondeterministic, so a
// re-render is not guaranteed to reproduce them and there is nothing to gain by
// trying. The concatenated response is already a valid standalone document:
// that is exactly what `warm.js` fetches and what a browser renders today.
//
// Three things this has to get right, and they are all here rather than
// scattered through serve.js:
//
// 1. **Keyed by a build id.** Every deploy changes the markup this repo emits,
//    and a page cache with no build key would serve last week's layout forever
//    — silently, which is the worst failure available to a cache. The id is a
//    fingerprint of the exact files the Dockerfile ships (`src/` and
//    `serve.js`), so it changes when and only when the rendering does. Stale
//    builds' pages are purged at startup rather than left for the sweep.
// 2. **Keyed by the title as the reader spelled it**, normalized the way
//    MediaWiki normalizes it (`titleKey`, shared with src/admission.js — both
//    answer "which article is this reader asking for, however they typed it").
//    A REDIRECT gets its own entry under its own name, which costs a duplicate
//    render and never serves the wrong article.
// 3. **Never a partial page.** Written through a temp file and renamed, so a
//    reader can only ever see a whole document, and written only after a
//    discovery has actually finished. Two writers racing on one title write two
//    valid renders and the last rename wins.
//
// These files live in `.cache/` with everything else, so `src/sweep.js` already
// bounds them: they are swept by least-recently-read like any other entry, and
// a page nobody visits ages out before the request-cache entries that back it.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { titleKey } from './admission.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16)

/**
 * A stable fingerprint of the rendering code.
 *
 * Pure, and takes the bytes rather than reading them, so a test can prove the
 * property that matters: the id moves when any shipped byte moves, and does not
 * move for anything else (file order included — `readdir` promises none).
 *
 * @param {{name: string, bytes: string}[]} files
 */
export function sourceFingerprint(files) {
  const parts = [...files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => `${f.name}:${f.bytes.length}:${sha(f.bytes)}`)
  return sha(parts.join('\n'))
}

/**
 * This process's build id: `BUILD_ID` if the operator set one, else a
 * fingerprint of `src/*.js` plus `serve.js` — the exact set the Dockerfile
 * COPYs, so the id describes what is deployed rather than what is checked out.
 *
 * Synchronous and at startup by design: it is a few dozen small disk reads, it
 * must be settled before the first request, and the rule it has to respect is
 * that nothing touches the NETWORK before `server.listen()`.
 */
export function buildId() {
  if (process.env.BUILD_ID) return sha(process.env.BUILD_ID)
  try {
    const files = readdirSync(HERE)
      .filter((n) => n.endsWith('.js'))
      .map((n) => ({ name: `src/${n}`, bytes: readFileSync(join(HERE, n), 'utf8') }))
    files.push({ name: 'serve.js', bytes: readFileSync(join(HERE, '..', 'serve.js'), 'utf8') })
    // Environment that is BAKED INTO stored page bytes belongs in the key
    // (2026-08-11): og:url/og:image carry SITE_ORIGIN absolutely, so an
    // origin change with unchanged source must retire the stored pages too,
    // or they replay the old origin forever.
    files.push({ name: 'env:SITE_ORIGIN', bytes: process.env.SITE_ORIGIN ?? '' })
    return sourceFingerprint(files)
  } catch (e) {
    // Unreadable source is not a reason to refuse to serve; it is a reason not
    // to trust a cache key. A random-ish id means this process caches into a
    // namespace of its own and nothing stale can be served.
    console.error(`build id: falling back to a per-process key (${e.message})`)
    return sha(`${process.pid}:${process.hrtime.bigint()}`)
  }
}

const PAGE = /^page-([0-9a-f]{16})-[0-9a-f]{16}(?:\.thin)?\.html$/

/**
 * `degraded` marks a render made while some source was refusing us
 * (src/cooloff.js): whole — the stream finished — and missing whatever that
 * source would have contributed. It is a different FILE rather than metadata
 * inside the page, because the page's bytes are the artifact and must replay
 * exactly as sent; the name is the one place a fact about the render can live
 * without touching them.
 */
export const pagePath = (dir, build, title, degraded = false) =>
  join(dir, `page-${build}-${sha(titleKey(title))}${degraded ? '.thin' : ''}.html`)

/**
 * The stored render as `{html, degraded}`, or null if this title has none for
 * this build. A full render outranks a thin one, though both should never
 * exist — writePage retires the counterpart.
 */
export async function readPage(dir, build, title) {
  for (const degraded of [false, true]) {
    try {
      return { html: await readFile(pagePath(dir, build, title, degraded), 'utf8'), degraded }
    } catch {
      /* try the other kind */
    }
  }
  return null
}

/**
 * Store a finished render. Temp file then rename, so a concurrent reader sees
 * either the whole previous page or the whole new one and never a prefix. One
 * stored answer per title: writing either kind retires the other, so the full
 * render that follows a recovery replaces the thin one instead of shadowing it.
 *
 * Never throws: a page cache that cannot write makes the demo slow, exactly as
 * it was before this existed, and never wrong.
 */
export async function writePage(dir, build, title, html, degraded = false) {
  const path = pagePath(dir, build, title, degraded)
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, html)
    await rename(tmp, path)
    await unlink(pagePath(dir, build, title, !degraded)).catch(() => {})
    return true
  } catch (e) {
    console.error(`  page cache write failed (${title}): ${e.message}`)
    await unlink(tmp).catch(() => {})
    return false
  }
}

/**
 * Which stored pages belong to a build this process is not serving.
 *
 * Pure, so the "only ever our own page files, only ever other builds" rule is
 * checkable: this deletes files, and a pattern that matched one character too
 * many would eat the request cache the pages are built from.
 */
export function chooseStalePages(names, build) {
  return names.filter((n) => {
    const m = PAGE.exec(n)
    return m ? m[1] !== build : false
  })
}

/**
 * Drop the previous build's renders. Runs after `listen()`, like the sweep: a
 * deploy invalidates every stored page at once, and leaving them for the LRU
 * sweep would hold a share of the volume for pages that can never be served.
 */
export async function purgeStalePages(dir, build) {
  let gone = 0
  try {
    for (const name of chooseStalePages(readdirSync(dir), build)) {
      await unlink(join(dir, name)).catch(() => {})
      gone++
    }
  } catch {
    /* no cache dir yet, or unreadable — nothing to purge either way */
  }
  if (gone) console.error(`page cache: dropped ${gone} render${gone === 1 ? '' : 's'} from earlier builds`)
  return gone
}
