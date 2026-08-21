// The non-MediaWiki HTTP client, shared by every lookup: disk-cached, riding
// the same per-host serial queue as the MediaWiki traffic (src/mw.js), with a
// timeout a bare fetch lacks. MediaWiki hosts use m3api via mw.js instead;
// everything else — archive.org, OpenLibrary, OpenAlex, WDQS, museum and
// biodiversity APIs, cover images — comes through here.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_COOLOFF_MS, coolingFor, noteRateLimited } from './cooloff.js'
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
export async function getJson(url, { timeoutMs = 15000, tries = 2, throttleMs = 0, as = 'json' } = {}) {
  // Text-mode responses key separately: sha1(url) alone would let a URL
  // fetched both ways serve one mode's cached body to the other.
  const key = createHash('sha1').update(as === 'text' ? `text:${url}` : url).digest('hex').slice(0, 16)
  const path = join(CACHE, `spike-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    /* not cached */
  }
  const host = new URL(url).host
  const body = await enqueue(host, async () => {
    // Checked here rather than before queueing, because that is the point: the
    // chunks of one page's lookups queue together, and the second must see the
    // refusal the first earned instead of sleeping its own minute for it.
    const quiet = coolingFor(host, Date.now())
    if (quiet) {
      throw Object.assign(new Error(`${host} asked for ${Math.ceil(quiet / 1000)}s of quiet`), {
        permanent: true,
      })
    }
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
          // 429 is about US — this client is asking for more than this host will
          // give. Sleeping and retrying inside a reader's request answers it
          // once and re-earns it on the next chunk; arming a cool-off answers it
          // for the page (src/cooloff.js). 503 keeps the wait below: that is
          // "busy, come back shortly", the shape maxlag uses, and waiting is the
          // right answer to it.
          if (res.status === 429) {
            const until = noteRateLimited(host, retryAfterMs(res.headers, MAX_COOLOFF_MS), Date.now())
            throw Object.assign(
              new Error(
                `429 Too Many Requests — not asking ${host} again for ` +
                  `${Math.ceil((until - Date.now()) / 1000)}s`,
              ),
              { permanent: true },
            )
          }
          const wait = retryAfterMs(res.headers)
          if (wait !== null && attempt < tries) await new Promise((r) => setTimeout(r, wait))
          throw new Error(`${res.status} ${res.statusText}`)
        }
        return as === 'text' ? await res.text() : await res.json()
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
 * getJson's machinery — cache, per-host queue, cool-off, retries — for a
 * source whose record surface is a PAGE rather than a JSON API (the Getty's
 * embedded JSON-LD). The cache entry is the JSON-encoded string, so replayed
 * runs read it back through the same JSON.parse path as everything else.
 */
export async function getText(url, opts = {}) {
  return getJson(url, { ...opts, as: 'text' })
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
  const base64 = params.at(-1).trim().toLowerCase() === 'base64'
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
  try {
    await mkdir(CACHE, { recursive: true })
  } catch (e) {
    // Same rule as the per-entry writes below, and it has to hold here too: a
    // cache that cannot write is slow, never wrong. Unguarded, this rejected —
    // and one caller (serve.js's imgPath) writes without awaiting, where a
    // rejection with no handler takes the whole server down rather than costing
    // one thumbnail.
    console.error(`  fact cache dir unavailable (${kind}): ${e.message}`)
    return
  }
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
 * The answer is EVERY partner image (the operator's decision, 2026-08-17,
 * resolving the tension recorded against VALUES.md's 2026-08-16 entry: the
 * reader's browser talks to us, not to the partners). Two reasons, both
 * structural. Partner hosts bot-block and hotlink-block unpredictably —
 * DPLA's provider long tail proved it first (2026-08-09: Museum of Flight
 * answered the browser nothing and every card rendered as text), and the
 * IIIF-lane diagnosis of 2026-08-17 found the same pattern across hosts.
 * And hotlinking does not scale to the adoption this project aims at: a
 * page read at Wikipedia scale would aim every reader's browser at a
 * museum's image server, where our own fetch is one cached request, ever,
 * bounded by the per-host queues.
 *
 * upload.wikimedia.org is exempt as a defensive guard: today no ENTRY
 * carries such an imageUrl — the article's own infobox images bypass the
 * card path entirely and hotlink from there — but any future
 * Wikimedia-hosted entry must keep hotlinking, because that is Wikipedia's
 * household content on infrastructure built for the load, and Commons is
 * deliberately not a partner (all-the-opens/CLAUDE.md).
 */
export function hotlinkUnsafe(entry) {
  if (!entry?.imageUrl) return false
  if (entry.imageUrl.startsWith('data:')) return false
  return !entry.imageUrl.startsWith('https://upload.wikimedia.org/')
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
/**
 * Below this many bytes the answer is a placeholder, not the thing. A fact
 * about ONE host: OpenLibrary answers a coverless ISBN with a stub a few
 * bytes long, so covers need 1 KB. Every other URL keeps only a
 * refuse-empty-bodies floor — under the never-hotlink rule the cover path
 * fetches every partner image, and a page-wide 1 KB floor voided
 * legitimately tiny images and cached the void (caught in review,
 * 2026-08-17). Exported so the derivation is a test, not a comment.
 */
export const placeholderFloor = (url) => (/covers\.openlibrary\.org/.test(url) ? 1024 : 32)

/**
 * Whether a content type may travel as a card image or leave /img/. One
 * definition for both layers, exported so the gate is a test rather than
 * two literals that can drift. Parameters are stripped before the check
 * ("image/jpeg; charset=UTF-8" is an image), and image/svg+xml is refused
 * even though it is an image type: an SVG is a document that runs script
 * on top-level navigation, and a partner document must never render from
 * our origin (caught in review, 2026-08-17 — a planted scripted SVG served
 * 200 same-origin). Our own SVG glyphs are unaffected: the CC sprite is
 * inlined into page markup and never rides this path.
 */
export const isImageType = (type) =>
  // Anchored subtype: the split is load-bearing (a parameterized type must
  // still pass), and svg is refused with or without its +xml suffix — the
  // open question of whether any renderer treats bare image/svg as SVG is
  // closed by not finding out. The guarantee is that whatever PASSES is a
  // single well-formed media type — and that exact split value is what
  // gets stored and served. A bare comma-joined duplicate header
  // ("image/png, text/html") is not one and is refused; a parameterized
  // join ("image/png; charset=x, text/html") passes because the split
  // already reduced it to its one safe leading type.
  /^image\/(?!svg(?:\+xml)?$)[a-z0-9!#$&^_.+-]+$/i.test((type ?? '').split(';')[0].trim())

/**
 * The /img/ decision as a pure seam: a decoded cache entry leaves the
 * origin only when it is a servable image. serve.js consults this rather
 * than inlining the gate, so the layer's decision is testable offline.
 */
export const servableImage = (decoded) => (decoded && isImageType(decoded.type) ? decoded : null)

export async function coverDataUri(url, { minBytes = null } = {}) {
  minBytes ??= placeholderFloor(url)
  // The effective floor is part of the cache key: one URL fetched at two
  // floors must not share a verdict, or whichever ran first decides for
  // both — the mechanism that made the wide-floor bug permanent. (This
  // re-keys every cached data URI once; the refetch also retires verdicts
  // the pre-2026-08-17 gates cached wrongly.)
  const key = createHash('sha1').update(`datauri:${minBytes}:${url}`).digest('hex').slice(0, 16)
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
      // Size is not enough to know a picture arrived — the icon tools
      // learned it first (openalex.org answered 200 with an HTML error page)
      // and the DPLA long tail repeated it at page scale: a thumbnail URL
      // answering HTML or a PDF is a non-answer, cached as one, and the
      // card degrades to text. Without this, /img/ would serve a partner's
      // document from OUR origin (caught in review, 2026-08-17).
      const media = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!isImageType(media)) return ''
      const bytes = Buffer.from(await res.arrayBuffer())
      // Below the floor it is a placeholder, not the thing (placeholderFloor
      // above; explicit callers may still override in either direction).
      // The data URI carries the bare media type: header parameters are not
      // RFC 2397 URI material, and the gate already ran on the same value.
      return bytes.length < minBytes ? '' : `data:${media};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  })
  if (uri == null) return null
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, uri)
  return uri || null
}
