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
    return process.env.NODE_USE_ENV_PROXY ? rest : { dispatcher, ...rest }
  }
}

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
 * - `api.dp.la` — DPLA's developer policy (pro.dp.la/developers/policies):
 *   "Consistent with its philosophical presumption of openness, in general,
 *   the DPLA will not restrict or rate-limit the use of its API." The only
 *   reservation is against activity "denying or unduly degrading service to
 *   other API users", which a demo answering a few pageviews is not. This was
 *   the second-longest chain on a cold page: 21 requests, 3.9s serial.
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
 * - Everything else — nobody has read their terms, and the safe answer to an
 *   unread policy is one.
 */
const WIDENED = new Map([['api.dp.la', 4]])

/** How many requests may be in flight at `host` at once. One unless argued otherwise. */
export function hostLimit(host) {
  if (WIKIMEDIA.test(host)) return 1
  return WIDENED.get(host) ?? 1
}

/**
 * Run `task` on `host`'s queue, which admits `hostLimit(host)` at a time and
 * starts them in the order they were enqueued. At the default limit of one this
 * is exactly the old strict chain — including the property the lede-first
 * ordering depends on, that whichever call is made first takes the host's turn
 * first (see the `ledeFirst` comment in src/discover.js).
 *
 * Rejections propagate to the caller but do not poison the queue: a failed task
 * frees its slot like any other.
 */
export function enqueue(host, task) {
  let q = queues.get(host)
  if (!q) queues.set(host, (q = { active: 0, waiting: [] }))
  return new Promise((resolve, reject) => {
    q.waiting.push({ task, resolve, reject })
    pump(host, q)
  })
}

function pump(host, q) {
  const limit = hostLimit(host)
  while (q.active < limit && q.waiting.length) {
    const { task, resolve, reject } = q.waiting.shift()
    q.active++
    requestTally.set(host, (requestTally.get(host) ?? 0) + 1)
    peakConcurrency.set(host, Math.max(peakConcurrency.get(host) ?? 0, q.active))
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        q.active--
        pump(host, q)
      })
  }
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
 * m3api offers no request timeout; a stalled connection is eventually failed
 * by undici's own header/body timeouts (~5 min). The one observed hang was
 * archive.org, which does not travel this path.
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
