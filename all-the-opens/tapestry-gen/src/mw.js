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
 * Run `task` after every earlier task enqueued for `host` has settled.
 * Rejections propagate to the caller but do not poison the queue.
 */
export function enqueue(host, task) {
  const prev = queues.get(host) ?? Promise.resolve()
  const run = prev.then(() => {
    requestTally.set(host, (requestTally.get(host) ?? 0) + 1)
    return task()
  })
  queues.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
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
