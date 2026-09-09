// MediaWiki transport: m3api sessions plus the two invariants every request
// in this project rides on — a per-host serial queue and a disk cache.
//
// m3api replaces the hand-rolled fetch layer for Wikimedia hosts: it owns the
// User-Agent header (ours plus its own, as the policy asks), retries on
// Retry-After / maxlag / readonly, and surfaces API errors as exceptions.
// What it deliberately does not do is pacing across requests, which is where
// the etiquette lives — so that stays here.
//
// The etiquette rule is *serial per host*: never two in-flight requests to the
// same API, batching instead of fanning out. Requests to *different* hosts are
// independent capacity (en.wikipedia ∥ wikidata ∥ commons ∥ archive.org), so
// the queue is keyed by host and wall-clock becomes the longest single host's
// chain rather than the sum of everything. Callers get this by construction:
// route every request through enqueue() and structure code by data dependency,
// not by politeness bookkeeping.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import Session from 'm3api/node.js'
import { userAgent } from './wmf.js'
import { PARTNERS } from './partners.js'

/**
 * m3api's Node session routes every request through its own undici cookie
 * dispatcher, which silently bypasses the env-proxy dispatcher that
 * `NODE_USE_ENV_PROXY=1` installs on global fetch — so in a sandboxed run its
 * requests hang instead of riding the proxy (see the repo gotcha about Node
 * fetch and EAI_AGAIN). Everything here is an anonymous read, so when the
 * proxy is in play the cookie jar is dropped rather than the connection.
 */
class ProxyFriendlySession extends Session {
  getFetchOptions(fetchOptions) {
    const { dispatcher, ...rest } = super.getFetchOptions(fetchOptions)
    // m3api sends no abort signal, and a fetch that never settles is the stall
    // described at QUEUE_DEADLINE_MS. Attached here, on every request, the way
    // every partner fetch in src/http.js already is. m3api retries on maxlag /
    // Retry-After by calling this again, so each attempt gets a fresh clock.
    const signal = AbortSignal.timeout(MW_FETCH_TIMEOUT_MS)
    const opts = process.env.NODE_USE_ENV_PROXY ? rest : { dispatcher, ...rest }
    return { ...opts, signal }
  }
}

/**
 * How long one MediaWiki request may take before it is abandoned. Shorter than
 * QUEUE_DEADLINE_MS on purpose, so a stalled request fails as a timeout that
 * names itself rather than as the queue taking the slot back. A big parse on a
 * lagging wiki can take tens of seconds; a minute is past that.
 */
export const MW_FETCH_TIMEOUT_MS = Number(process.env.MW_FETCH_TIMEOUT_MS ?? 60_000)

const queues = new Map()

/** Network requests actually made this run, by host — cache hits never enqueue. */
export const requestTally = new Map()

/**
 * The most requests this run ever had in flight at one host. The politeness
 * rule is otherwise only a claim in a comment; this is what makes it checkable
 * after the fact, and what a widened limit has to be audited against.
 */
export const peakConcurrency = new Map()

/** Wikimedia projects, where serial-per-host is policy and not a tuning knob. */
const WIKIMEDIA = /(^|\.)(wikipedia|wikimedia|wikidata|wiktionary|wikisource|wikibooks|wikiquote|wikiversity|wikivoyage|mediawiki)\.org$/i

/**
 * Hosts allowed more than one request in flight, each with the published
 * statement that permits it. Nothing goes in this map on the grounds that it
 * "seems fine" — the default is serial, and staying out of it costs only time.
 *
 * - `api.dp.la` → 4, stated in the partner manifest (src/partners.js, where
 *   every widened entry now lives with its policy quoted beside it).
 *
 * Deliberately NOT here, with reasons, so nobody has to re-derive them:
 * - `id.loc.gov` publishes `Crawl-delay: 3` for `User-agent: *` under a notice
 *   that irresponsible clients get blocked. It was the LONGEST chain, and the
 *   answer was to make each request cheap (a HEAD that reads `x-preflabel`,
 *   see src/dpla.js) and then rare (the cache is durable now), never to open
 *   more sockets to it.
 * - `openlibrary.org` rate-limits back-to-back requests already (CLAUDE.md).
 * - `tile.openstreetmap.org` — the OSMF tile policy is explicit about heavy
 *   use, and it is four requests a page anyway.
 * - `api.digitalnz.org` — its docs describe a shared cap on unauthenticated
 *   traffic and say keyed users can negotiate a higher one, but state no
 *   number either way (checked 2026-08-08, LUI-145). No citable figure means
 *   no entry here, same as everything below.
 * - Everything else — nobody has read their terms, and the safe answer to an
 *   unread policy is one.
 */
const WIDENED = new Map(
  Object.values(PARTNERS).flatMap((p) => Object.entries(p.hostLimits ?? {})),
)

/** How many requests may be in flight at `host` at once. One unless argued otherwise. */
export function hostLimit(host) {
  if (WIKIMEDIA.test(host)) return 1
  return WIDENED.get(host) ?? 1
}

/**
 * The longest a task may hold a host's slot before the queue takes it back.
 *
 * Measured on production, 2026-09-04 → 2026-09-08: one task on a Wikimedia
 * host's queue never settled — the process held no socket and no open file,
 * just a promise that stayed pending — and because every discovery needs that
 * host, every later discovery queued behind it, the four admission slots in
 * serve.js filled with renders that could never finish, and every cold page
 * answered 503 for four and a half days until a restart. undici's own header
 * and body timeouts (~5 minutes) are not a substitute — they did not fire in
 * four days. So the queue owns its own end: past this, the waiter is rejected
 * with `stalled: true`, the slot is freed, and the host moves on. The orphaned
 * task, should it ever settle, is logged and dropped.
 *
 * Long on purpose: Wikimedia hosts can legitimately take a minute on a big
 * parse plus a maxlag wait, and m3api's own retry budget is 65s. Two minutes
 * is well past both and still short enough that a stuck host costs a reader a
 * failed page, not the site four days.
 */
export const QUEUE_DEADLINE_MS = Number(process.env.QUEUE_DEADLINE_MS ?? 120_000)

/**
 * How long a task may run before the stall watchdog names it in the log, so
 * that a slow host shows up while it is slow, not only after it is cut off.
 */
export const QUEUE_STALL_WARN_MS = Number(process.env.QUEUE_STALL_WARN_MS ?? 30_000)

/**
 * Run `task` on `host`'s queue, which admits `hostLimit(host)` at a time and
 * starts them in the order they were enqueued. At the default limit of one this
 * is exactly the old strict chain — including the property the lede-first
 * ordering depends on, that whichever call is made first takes the host's turn
 * first (see the `ledeFirst` comment in src/discover.js).
 *
 * Rejections propagate to the caller but do not poison the queue: a failed task
 * frees its slot like any other. So does a task that never settles: after
 * `deadlineMs` the caller is rejected with `stalled: true` and the slot is
 * freed regardless (QUEUE_DEADLINE_MS above).
 *
 * @param {string} host
 * @param {() => Promise<any>} task
 * @param {{deadlineMs?: number}} [o]
 */
export function enqueue(host, task, { deadlineMs = QUEUE_DEADLINE_MS } = {}) {
  let q = queues.get(host)
  if (!q) {
    q = { active: 0, waiting: [], running: new Set() }
    queues.set(host, q)
  }
  return new Promise((resolve, reject) => {
    q.waiting.push({ task, resolve, reject, deadlineMs, queuedAt: Date.now() })
    pump(host, q)
  })
}

function pump(host, q) {
  const limit = hostLimit(host)
  while (q.active < limit && q.waiting.length) {
    const { task, resolve, reject, deadlineMs, queuedAt } = q.waiting.shift()
    q.active++
    const run = { startedAt: Date.now(), waitedMs: Date.now() - queuedAt }
    q.running.add(run)
    requestTally.set(host, (requestTally.get(host) ?? 0) + 1)
    peakConcurrency.set(host, Math.max(peakConcurrency.get(host) ?? 0, q.active))
    let settled = false
    const release = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      q.active--
      q.running.delete(run)
      pump(host, q)
    }
    const timer = setTimeout(() => {
      if (settled) return
      const held = Date.now() - run.startedAt
      console.error(
        `${host}: task held its slot for ${held}ms (deadline ${deadlineMs}ms) and never settled — ` +
          `releasing it; ${q.waiting.length} waiting behind it`,
      )
      reject(Object.assign(
        new Error(`${host}: request did not settle within ${deadlineMs}ms`),
        { stalled: true },
      ))
      release()
    }, deadlineMs)
    Promise.resolve()
      .then(task)
      .then(
        (v) => {
          if (settled) {
            console.error(`${host}: a task cut off at its deadline settled after all, ${Date.now() - run.startedAt}ms in — dropped`)
            return
          }
          resolve(v)
          release()
        },
        (e) => {
          if (settled) {
            console.error(`${host}: a task cut off at its deadline failed after all, ${Date.now() - run.startedAt}ms in — ${e?.message ?? e}`)
            return
          }
          reject(e)
          release()
        },
      )
  }
}

/**
 * Every host with work in hand or in line, and how long its oldest task has
 * run — the view of the queues that the outage above had no way to give.
 * Idle hosts are omitted. serve.js prints this when it turns a reader away and
 * from its stall watchdog, so a stuck host is named in the log while it is
 * stuck.
 *
 * @param {number} now epoch ms
 * @returns {{host: string, active: number, waiting: number, oldestActiveMs: number}[]}
 */
export function queueSnapshot(now = Date.now()) {
  const rows = []
  for (const [host, q] of queues) {
    if (!q.active && !q.waiting.length) continue
    let oldestActiveMs = 0
    for (const run of q.running) oldestActiveMs = Math.max(oldestActiveMs, now - run.startedAt)
    rows.push({ host, active: q.active, waiting: q.waiting.length, oldestActiveMs })
  }
  return rows.sort((a, b) => b.oldestActiveMs - a.oldestActiveMs)
}

/** One line of the snapshot, for the log. Empty when every host is idle. */
export function describeQueues(now = Date.now()) {
  return queueSnapshot(now)
    .map((r) => `${r.host} active=${r.active} waiting=${r.waiting} oldest=${(r.oldestActiveMs / 1000).toFixed(1)}s`)
    .join('; ')
}

const sessions = new Map()

/** One m3api session per wiki, created lazily so the UA check fires on use. */
export function mwSession(host) {
  if (!sessions.has(host)) {
    sessions.set(
      host,
      new ProxyFriendlySession(
        host,
        {
          formatversion: 2,
          // Batch traffic yields to interactive users when replication lags.
          // m3api treats the resulting maxlag error as retryable and waits.
          maxlag: 5,
        },
        { userAgent: userAgent('tapestry-gen') },
      ),
    )
  }
  return sessions.get(host)
}

/**
 * A disk-cached Action API request. Reruns are offline and byte-reproducible.
 *
 * The cache key is the canonical URL the pre-m3api client would have fetched,
 * so the transport swap did not orphan the existing cache: params must arrive
 * in the same insertion order call sites always used. `prefix` namespaces the
 * spike's files the way its own cache always did.
 *
 * m3api offers no request timeout of its own, so the session adds one
 * (MW_FETCH_TIMEOUT_MS, in mwSession) and the queue bounds the task around it
 * (QUEUE_DEADLINE_MS). Both exist because of the 2026-09-04 stall described at
 * QUEUE_DEADLINE_MS: a MediaWiki request that never settled held the site.
 */
export async function cachedRequest(cacheDir, host, params, { prefix = '' } = {}) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(cacheDir, `${prefix}${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // not cached yet
  }
  const body = await enqueue(host, () => mwSession(host).request(params))
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path, JSON.stringify(body, null, 2))
  return body
}
