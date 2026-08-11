// Walking the showcase through the server's own front door.
//
// This lived in warm.js — a script on the OPERATOR'S machine, run by `npm run
// deploy` after flyctl returned, which meant the last step of every deploy was
// a process attached to somebody's shell, fetching the site from outside
// through the Fly proxy. It lives in src/ now so the server can do its own
// warming at startup (serve.js, WARM_ON_START): the machine that just booted
// with an empty page cache is the one that knows it, and no operator's laptop
// needs to stay open for the showcase to be warm. warm.js remains as the
// by-hand form of the same walk.
//
// SERIAL, one page at a time, and that is not incidental: every cold page fans
// out dozens of upstream requests, the server caps concurrent discoveries at
// MAX_CONCURRENT (then answers 503), and the whole point of the per-host queues
// is that this project does not open parallel connections to other people's
// APIs. Warming is ordinary traffic and gets no special license — the showcase
// reserve (src/admission.js) is capacity kept for READERS of warm pages, and
// warming happens to travel in the same lane.

const path = (title) => `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`

/**
 * The marker a render carries when some source was refusing us while it was
 * made (src/cooloff.js). Written by serve.js just before streamClose's
 * `__tapdone`, so it is only ever present in complete pages, and rides inside
 * the stored bytes — which is the point: a thin page says so to whoever reads
 * it back, this walker included. A single script tag assigning a JSON literal;
 * host names cannot break out of it.
 *
 * @param {string[]} hosts
 */
export const thinMarker = (hosts) => `<script>window.__tapthin=${JSON.stringify(hosts)}</script>\n`

/** The hosts a fetched page says were refusing it, or []. */
function thinHosts(body) {
  const m = /window\.__tapthin=(\[[^\]]*\])/.exec(body)
  try {
    return m ? JSON.parse(m[1]) : []
  } catch {
    return []
  }
}

/**
 * Fetch one page and read it to the end.
 *
 * Draining the body is the whole job: the response is a chunked stream that the
 * server writes as each band's lookups answer, so hanging up early would cut the
 * discovery partway and cache only what had landed. `window.__tapdone` is the
 * flag `streamClose` writes last — its presence is the server's own statement
 * that the run finished rather than being interrupted.
 *
 * @returns {Promise<{ok: boolean, status: number, bytes: number, ms: number,
 *   complete: boolean, thin: string[]}>}
 */
export async function warmPage(base, title, { timeoutMs = 300_000 } = {}) {
  const url = `${base}${path(title)}`
  const started = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const body = await res.text()
  const complete = body.includes('__tapdone')
  return {
    ok: res.ok && complete,
    status: res.status,
    // A page can be served whole and still be a short one; the byte count is
    // here so an unexpectedly thin result is visible rather than silent.
    bytes: body.length,
    ms: Date.now() - started,
    complete,
    thin: complete ? thinHosts(body) : [],
  }
}

/**
 * Warm every title, serially, and say how it went — line by line through `log`
 * so the CLI and the in-process caller report identically.
 *
 * "Warm" and "thin" are separate answers on purpose: a thin page IS warm — it
 * replays — but it was rendered while a source was refusing us and will be
 * re-rendered when that source answers again (serve.js), and a warm report
 * that cannot say so would read "all warm" over a showcase that is entirely
 * provisional.
 *
 * @returns {Promise<{failed: number, thin: number}>}
 */
export async function warmAll(base, titles, { timeoutMs = 300_000, log = console.error } = {}) {
  log(`warming ${titles.length} showcase pages at ${base}`)
  let failed = 0
  let thin = 0
  for (const title of titles) {
    try {
      const r = await warmPage(base, title, { timeoutMs })
      if (r.ok && r.thin.length) {
        thin++
        log(`  ◐ ${title} — ${secs(r.ms)}, ${(r.bytes / 1024).toFixed(0)}KB — thin, ${r.thin.join(', ')} refusing; re-renders when it answers`)
      } else if (r.ok) {
        log(`  ✓ ${title} — ${secs(r.ms)}, ${(r.bytes / 1024).toFixed(0)}KB`)
      } else {
        failed++
        // 503 is the server saying it is already busy discovering, which is a
        // real answer and not a broken deploy — name it rather than lumping it in.
        const why = r.status === 503 ? 'busy (503)' : !r.complete ? 'stream cut short' : `HTTP ${r.status}`
        log(`  ✗ ${title} — ${why} after ${secs(r.ms)}`)
      }
    } catch (e) {
      failed++
      log(`  ✗ ${title} — ${e.name === 'TimeoutError' ? `no answer in ${secs(timeoutMs)}` : e.message}`)
    }
  }
  log(
    failed
      ? `${failed} of ${titles.length} did not warm`
      : thin
        ? `all warm — ${thin} thin, refreshing when their sources answer`
        : 'all warm',
  )
  return { failed, thin }
}
