import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// The viewer draws images as WebGL textures, which browsers refuse to do for
// cross-origin images served without CORS headers. upload.wikimedia.org and
// covers.openlibrary.org both send `Access-Control-Allow-Origin: *`;
// archive.org sends nothing, so its images can never load by URL alone.
//
// The fix is the one the format already provides: bundle those bytes into the
// .tapestry zip and point the item at `file:/…`, which the import service
// resolves to a blob URL — same-origin, so no CORS involved.
export const NO_CORS_HOSTS = ['archive.org']

export function needsBundling(url) {
  return !!url && NO_CORS_HOSTS.some((host) => new URL(url).hostname.endsWith(host))
}

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/**
 * Downloads the given URLs (disk-cached) and returns zip entries plus a map from
 * original URL to its `file:/` reference.
 *
 * @returns {Promise<{entries: {name: string, data: Buffer}[], refs: Map<string,string>}>}
 */
export async function bundleImages(cacheDir, urls) {
  const entries = []
  const refs = new Map()

  for (const url of urls) {
    const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
    const metaPath = join(cacheDir, `${key}.meta.json`)

    let meta
    let data
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'))
      data = await readFile(join(cacheDir, `${key}.${meta.extension}`))
    } catch {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`  bundle: skipping ${url} (${response.status})`)
        continue
      }
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
      const extension = EXTENSIONS[type]
      if (!extension) {
        console.warn(`  bundle: skipping ${url} (unexpected type ${type || 'none'})`)
        continue
      }
      data = Buffer.from(await response.arrayBuffer())
      meta = { extension, type }
      await mkdir(cacheDir, { recursive: true })
      await writeFile(join(cacheDir, `${key}.${extension}`), data)
      await writeFile(metaPath, JSON.stringify(meta))
    }

    const name = `img/${key}.${meta.extension}`
    entries.push({ name, data })
    refs.set(url, `file:/${name}`)
  }

  return { entries, refs }
}
