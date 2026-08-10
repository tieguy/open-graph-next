// The non-MediaWiki HTTP client, shared by every pivot: disk-cached, riding
// the same per-host serial queue as the MediaWiki traffic (src/mw.js), with a
// timeout a bare fetch lacks. MediaWiki hosts use m3api via mw.js instead;
// everything else — archive.org, OpenLibrary, OpenAlex, WDQS, museum and
// biodiversity APIs, cover images — comes through here.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { enqueue } from './mw.js'
import { isRetryable, retryAfterMs, userAgent, withMaxlag } from './wmf.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const CACHE = join(HERE, '..', '.cache')

// Defined once for the whole repo, and refuses to build without a contact —
// see src/wmf.js. Set WIKIMEDIA_UA_CONTACT to your own address. Lazy so that
// importing this module never demands the env var — first network use does.
let _ua
const UA = () => (_ua ??= userAgent('tapestry-gen'))

/**
 * Every non-MediaWiki network call is disk-cached, so reruns are offline and
 * reproducible, and rides the same per-host queue as everything else — serial
 * at each API, concurrent across them.
 *
 * The timeout is not optional: a bare `fetch` has none, and one stalled
 * archive.org connection hung an entire run indefinitely. A source that goes
 * quiet must cost one slot, not the whole page.
 */
export async function getJson(url, { timeoutMs = 15000, tries = 2, throttleMs = 0 } = {}) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(CACHE, `spike-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    /* not cached */
  }
  const body = await enqueue(new URL(url).host, async () => {
    let lastError
    for (let attempt = 1; attempt <= tries; attempt++) {
      // Only ever paid on a cache miss, and only by sources that ask for it.
      if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs))
      const control = new AbortController()
      const timer = setTimeout(() => control.abort(), timeoutMs)
      try {
        const res = await fetch(withMaxlag(url), {
          headers: { 'User-Agent': UA(), 'Accept-Encoding': 'gzip' },
          signal: control.signal,
        })
        if (!res.ok) {
          // A 404 is our bad identifier, not the server's bad day: retrying it
          // spends someone else's capacity to get the same answer twice.
          if (!isRetryable(res.status)) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { permanent: true })
          const wait = retryAfterMs(res.headers)
          if (wait !== null && attempt < tries) await new Promise((r) => setTimeout(r, wait))
          throw new Error(`${res.status} ${res.statusText}`)
        }
        return await res.json()
      } catch (e) {
        lastError = e.name === 'AbortError' ? new Error(`timeout after ${timeoutMs}ms`) : e
        if (e.permanent) break
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  })
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, JSON.stringify(body))
  return body
}

/**
 * `data:<type>[;params][;base64],<bytes>` split back into something writable to
 * a socket. The media type may carry parameters — `image/svg+xml;charset=utf-8`
 * — so everything between the scheme and the comma is the type, and `;base64`
 * is only the last of those segments.
 */
export function fromDataUri(uri) {
  const m = /^data:([^,]*),([\s\S]*)$/.exec(uri ?? '')
  if (!m) return null
  const params = m[1].split(';')
  const base64 = params[params.length - 1].trim().toLowerCase() === 'base64'
  if (base64) params.pop()
  return {
    type: params.join(';').trim() || 'text/plain;charset=US-ASCII',
    body: Buffer.from(m[2], base64 ? 'base64' : 'utf8'),
  }
}

/**
 * One response HEADER, by HEAD request, disk-cached like everything else.
 *
 * Some services answer the question in a header and put a large document in the
 * body. id.loc.gov is the case that needed this: it returns the authorized
 * heading as `x-preflabel` (and names it in `access-control-expose-headers`, so
 * it is an interface, not an accident) on a record whose JSON-LD is 88–120 KB.
 * Measured 2026-08-05: 0 bytes and ~0.13s against ~0.25–0.50s for the body.
 *
 * `redirect: 'manual'` is load-bearing and not a preference. id.loc.gov answers
 * **303** with the header on the redirect itself, pointing at an `.html` page
 * that its CDN refuses to non-browser clients — so following the redirect
 * throws away the answer and lands on a 403. Node exposes the 3xx response
 * where a browser would not; that is the whole reason this works.
 *
 * An empty file means "asked, and there was no such header" — a real answer,
 * cached as one, or it is re-asked forever.
 */
export async function getHeader(url, name, { timeoutMs = 15000 } = {}) {
  const key = createHash('sha1').update(`head:${name}:${url}`).digest('hex').slice(0, 16)
  const path = join(CACHE, `header-${key}.txt`)
  try {
    return (await readFile(path, 'utf8')) || null
  } catch {
    /* not asked yet */
  }
  const value = await enqueue(new URL(url).host, async () => {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': UA() },
        signal: AbortSignal.timeout(timeoutMs),
      })
      return res.headers.get(name) ?? ''
    } catch {
      // A header we could not read is not a header that is absent, but the
      // caller's fallback covers both and a failed HEAD must not fail a page.
      return ''
    }
  })
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, value)
  return value || null
}

/**
 * A key→JSON fact cache, one small file per key, for answers that are NOT a
 * URL's response body and so cannot ride `getJson`'s per-URL cache.
 *
 * The case that needed it: WDQS is asked "for these forty classes, what are
 * their ancestors?" in one query, so the cache key is the whole set and a
 * single new class misses on all forty. Measured across seven articles, ~40%
 * of a page's classes were already answered on an earlier page and every one
 * of them was re-queried anyway. Keyed per class instead, only the genuinely
 * new ones cost anything.
 *
 * One file per key rather than one file per kind, because the deployed server
 * runs up to MAX_CONCURRENT discoveries at once and a read-modify-write of a
 * shared file would lose entries. Two writers racing on the same key write the
 * same bytes.
 *
 * Keys must be filename-safe; callers pass Wikidata QIDs. Anything else is
 * refused rather than sanitized, because a sanitized key can collide with
 * another key and return the wrong fact.
 */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/
const factPath = (kind, key) => join(CACHE, `fact-${kind}-${key}.json`)

export async function readFacts(kind, keys) {
  const out = new Map()
  await Promise.all(
    [...new Set(keys)].filter((k) => SAFE_KEY.test(k)).map(async (k) => {
      try {
        out.set(k, JSON.parse(await readFile(factPath(kind, k), 'utf8')))
      } catch {
        /* not cached */
      }
    }),
  )
  return out
}

export async function writeFacts(kind, entries) {
  await mkdir(CACHE, { recursive: true })
  await Promise.all(
    [...entries].map(async ([k, v]) => {
      if (!SAFE_KEY.test(k)) return
      try {
        await writeFile(factPath(kind, k), JSON.stringify(v))
      } catch (e) {
        // A cache that cannot write is slow, never wrong. Say so and continue.
        console.error(`  fact cache write failed (${kind}/${k}): ${e.message}`)
      }
    }),
  )
}

/**
 * Card images both renderers must fetch THEMSELVES — batch by inlining a
 * data: URI, streaming by serving from /img/ — rather than letting a
 * reader's browser hotlink the partner's host. One predicate, because the
 * two renderers kept two copies of the same regex and a reason added to one
 * was a reason silently missing from the other.
 *
 * Three reasons, each earning its line: OpenLibrary covers resolve through
 * an archive.org redirect, so a live dependency blanks the rail whenever IA
 * is down; OSM tiles must never be hotlinked from readers' browsers (OSMF
 * tile policy); and DPLA's and DigitalNZ's thumbnails point at hundreds of
 * PROVIDER hosts — ContentDM instances, Calisphere, NLNZ delivery — that
 * rot and hotlink-block (found 2026-08-09: Museum of Flight answered the
 * browser nothing and every DPLA letter card rendered as text). For the
 * aggregators the SOURCE decides, whatever the host: the long tail is the
 * point. A museum's own CDN (the Met, ids.si.edu, archive.org itself)
 * serves its own images fine, and hotlinking stays the cheap path.
 */
export function hotlinkUnsafe(entry) {
  if (!entry?.imageUrl) return false
  if (entry.source === 'dpla' || entry.source === 'digitalnz') return true
  return /covers\.openlibrary\.org|tile\.openstreetmap\.org/.test(entry.imageUrl)
}

/**
 * The `/img/` path key for a URL the streaming server has decided to serve.
 *
 * Lives here, beside the caches, because it is now used twice: to MINT a path
 * while rendering, and to CHECK one remembered on the volume from a render this
 * process did not do (stored pages outlive the process that made them — see
 * src/page-cache.js). The key being a hash of the URL is what makes the second
 * possible: a remembered entry that does not hash back to its own key was not
 * written by this server, and is not fetched.
 */
export const imgKey = (url) => createHash('sha1').update(url).digest('hex').slice(0, 16)

/**
 * A cover fetched and base64'd, so the page does not depend on the archive.org
 * redirect OpenLibrary covers resolve through. Null when there is no cover —
 * OpenLibrary answers a coverless ISBN with a placeholder a few bytes long, and
 * a broken image in the rail is worse than no image.
 *
 * A REAL non-answer is cached (a 404, a placeholder: asking again gets the
 * same nothing), but a transient failure — timeout, connection reset — is
 * NOT (2026-08-09): it used to be written to disk as the permanent empty
 * answer, so one slow upstream moment cost a card its picture on every
 * future render until someone deleted the cache. A cache may make a page
 * faster, never different.
 */
export async function coverDataUri(url, { minBytes = 1024 } = {}) {
  const key = createHash('sha1').update(`datauri:${url}`).digest('hex').slice(0, 16)
  const path = join(CACHE, `datauri-${key}.txt`)
  try {
    const cached = await readFile(path, 'utf8')
    return cached || null
  } catch {
    /* not fetched yet */
  }
  const uri = await enqueue(new URL(url).host, async () => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return ''
      const bytes = Buffer.from(await res.arrayBuffer())
      // Below the floor it is a placeholder, not the thing. Covers use 1 KB; a
      // favicon is legitimately smaller, so callers can lower it.
      return bytes.length < minBytes ? '' : `data:${res.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  })
  if (uri == null) return null
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, uri)
  return uri || null
}
