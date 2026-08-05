#!/usr/bin/env node
/**
 * Re-warm the deployed disk cache for the articles the front page links to.
 *
 *   node warm.js [base-url]
 *
 * A deploy replaces the machine's image and takes its `.cache/` with it (see
 * CLAUDE.md, "Deployed demo"), so the six showcase links — the first thing a
 * visitor clicks — are cold immediately after every deploy, which is the worst
 * possible moment for them to take a minute each. This walks them once so the
 * next person to arrive gets the warm page.
 *
 * The titles come from `showcaseTitles()`, the same list the front page renders
 * its cards from. There is deliberately no second copy to keep in step.
 *
 * SERIAL, one page at a time, and that is not incidental: every page fans out
 * dozens of upstream requests, the server caps concurrent discoveries at
 * MAX_CONCURRENT (then answers 503), and the whole point of the per-host queues
 * is that this project does not open parallel connections to other people's
 * APIs. Warming is ordinary traffic and gets no special licence.
 */
import { showcaseTitles } from './src/front-page.js'

const BASE = (process.argv[2] ?? process.env.SITE_URL ?? 'https://help-from-our-friends.fly.dev')
  .replace(/\/+$/, '')
// A genuinely cold page can take a minute; the timeout only has to be longer
// than the slowest honest run, not tight.
const TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS ?? 300_000)

const path = (title) => `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`

/**
 * Fetch one page and read it to the end.
 *
 * Draining the body is the whole job: the response is a chunked stream that the
 * server writes as each band's pivots answer, so hanging up early would cut the
 * discovery partway and cache only what had landed. `window.__tapdone` is the
 * flag `streamClose` writes last — its presence is the server's own statement
 * that the run finished rather than being interrupted.
 */
async function warm(title) {
  const url = `${BASE}${path(title)}`
  const started = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  const body = await res.text()
  return {
    ok: res.ok && body.includes('__tapdone'),
    status: res.status,
    // A page can be served whole and still be a short one; the byte count is
    // here so an unexpectedly thin result is visible rather than silent.
    bytes: body.length,
    ms: Date.now() - started,
    complete: body.includes('__tapdone'),
  }
}

const titles = showcaseTitles()
console.error(`warming ${titles.length} showcase pages at ${BASE}`)
let failed = 0
for (const title of titles) {
  try {
    const r = await warm(title)
    if (r.ok) {
      console.error(`  ✓ ${title} — ${secs(r.ms)}, ${(r.bytes / 1024).toFixed(0)}KB`)
    } else {
      failed++
      // 503 is the server saying it is already busy discovering, which is a
      // real answer and not a broken deploy — name it rather than lumping it in.
      const why = r.status === 503 ? 'busy (503)' : !r.complete ? 'stream cut short' : `HTTP ${r.status}`
      console.error(`  ✗ ${title} — ${why} after ${secs(r.ms)}`)
    }
  } catch (e) {
    failed++
    console.error(`  ✗ ${title} — ${e.name === 'TimeoutError' ? `no answer in ${secs(TIMEOUT_MS)}` : e.message}`)
  }
}
console.error(failed ? `${failed} of ${titles.length} did not warm` : 'all warm')
// Non-zero on failure so `npm run deploy` cannot report success over a half-warmed
// site — but the deploy itself already succeeded, and a failure here means the
// pages are slow, not broken.
process.exit(failed ? 1 : 0)
