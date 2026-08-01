// Phase 2: turn a dataset item's landing-page URL into a rich, playable media
// descriptor the emitter can render as a real Tapestry media item — rather than
// the phase-1 caption card. Resolution that needs the network is done by the
// caller and passed in via `context`, so the rules here stay pure and testable.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { userAgent } from './wmf.js'

const IA_METADATA = 'https://archive.org/metadata/'

/** The Internet Archive identifier in an `archive.org/details/{id}` URL. */
export function iaIdFromUrl(url) {
  const match = /archive\.org\/(?:details|embed)\/([^/?#]+)/.exec(url ?? '')
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * An IA item's metadata API response, disk-cached like every other network call
 * so reruns are offline and byte-reproducible. Returns the full body; the
 * `mediatype` the resolver keys on lives under `body.metadata`.
 */
export async function fetchIaMetadata(cacheDir, id) {
  const url = `${IA_METADATA}${encodeURIComponent(id)}`
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(cacheDir, `${key}.json`)

  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // not cached yet
  }

  const response = await fetch(url, { headers: { 'User-Agent': userAgent('tapestry-gen'), 'Accept-Encoding': 'gzip' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  const body = await response.json()

  await mkdir(cacheDir, { recursive: true })
  await writeFile(path, JSON.stringify(body, null, 2))
  return body
}

/**
 * Which of the viewer's Internet Archive webpage embeddings, if any, fits this
 * item — read from the `mediatype` its metadata API returns.
 *
 * The vendored viewer plays IA media itself: given a `webpage` item whose
 * `webpageType` is `iaVideo`/`iaAudio` and whose `source` is the item's
 * `archive.org/details/…` URL, it fetches `archive.org/metadata/{id}` and builds
 * the player. So all we decide at build time is which player, from `mediatype`.
 * `texts`, `image`, `software`, `data` have no IA player, so they stay captions.
 */
export function iaWebpageType(metadata) {
  if (metadata?.mediatype === 'movies') return 'iaVideo'
  if (metadata?.mediatype === 'audio') return 'iaAudio'
  return null
}

/**
 * Resolve a dataset item to a media descriptor, or null to fall back to the
 * phase-1 caption card. Descriptor shape:
 *   { type: 'webpage'|'audio'|'video'|'book'|'pdf'|'image', source, webpageType? }
 *
 * @param {object} item        a dataset item ({ id, source, url, ... })
 * @param {object} [context]   pre-fetched network data, e.g. { iaMetadata }
 */
export function resolveMedia(item, context = {}) {
  if (item.source === 'internet_archive') {
    const webpageType = iaWebpageType(context.iaMetadata)
    if (!webpageType) return null
    return { type: 'webpage', source: item.url, webpageType }
  }
  return null
}
