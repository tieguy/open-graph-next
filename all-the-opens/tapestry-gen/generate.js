#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildAdjacency, loadDataset } from './src/dataset.js'
import { bundleImages, needsBundling } from './src/bundle.js'
import {
  articleBlocks,
  commonsFileTitle,
  fetchImageInfo,
  fetchPageImages,
  fetchLede,
  fetchQids,
  fetchSection,
  fetchSections,
  fetchSectionWikitext,
  infoboxLinks,
} from './src/wikipedia.js'
import {
  citationCoverUrl,
  citationHref,
  openLibraryAccess,
  prioritizeCitations,
  sectionCitations,
} from './src/citations.js'
import { imageAspect } from './src/imagesize.js'
import { placeItems } from './src/place.js'
import { fetchIaMetadata, iaIdFromUrl, resolveMedia } from './src/resolve.js'
import { layoutBands, PROSE } from './src/layout.js'
import { buildTapestry, noteFrame, sectionFrame } from './src/emit.js'
import { buildHtml } from './src/emit-html.js'
import { makeZip } from './src/zip.js'
import { parseRootJson, ROOT_FILE } from './vendor/parse-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(HERE, '..', 'web-demo', 'data', 'apollo-11')
const CACHE_DIR = join(HERE, '.cache')
const OUT = join(HERE, '..', 'tapestry', 'apollo-11.tapestry')
const HTML_OUT = join(HERE, '..', 'tapestry', 'apollo-11.html')
const PAGE = 'Apollo 11'
// Fixed so output is byte-reproducible across runs.
const GENERATED_AT = '2026-07-23T00:00:00.000Z'

// Sections that are navigation or apparatus rather than article content.
const SKIP_SECTIONS = new Set([
  'See also',
  'Notes',
  'References',
  'Citations',
  'Sources',
  'Bibliography',
  'External links',
  'Further reading',
])

async function main() {
  const { items, seed, connections } = await loadDataset(DATA_DIR)
  const adj = buildAdjacency(connections)
  console.log(`dataset: ${items.size} items, ${Object.keys(connections).length} connection sources`)

  // --- QIDs for dataset items -------------------------------------------------
  // Most come free from the data; the rest are resolved from the item's Wikipedia
  // URL via pageprops, so no call to wikidata.org is needed.
  const itemQids = new Map()
  const needsLookup = []
  for (const [id, item] of items) {
    const known = item.identifiers?.wikidata
    if (known) {
      itemQids.set(id, known)
      continue
    }
    const title = wikipediaTitle(item.url)
    if (title) needsLookup.push([id, title])
  }
  if (needsLookup.length) {
    const resolved = await fetchQids(CACHE_DIR, needsLookup.map(([, t]) => t))
    for (const [id, title] of needsLookup) {
      const qid = resolved.get(title)
      if (qid) itemQids.set(id, qid)
    }
  }
  console.log(
    `qids: ${itemQids.size}/${items.size} items ` +
      `(${itemQids.size - (items.size - needsLookup.length - countMissing(items))} backfilled)`,
  )

  // --- Article structure ------------------------------------------------------
  const allSections = await fetchSections(CACHE_DIR, PAGE)
  // Drop apparatus sections, and any subsection nested beneath one.
  const sections = []
  let skippingChildren = false
  for (const section of allSections) {
    if (section.level === 1) skippingChildren = SKIP_SECTIONS.has(section.title)
    if (SKIP_SECTIONS.has(section.title) || (section.level === 2 && skippingChildren)) continue
    sections.push(section)
  }
  const lede = await fetchLede(CACHE_DIR, PAGE)

  // Full prose, not a summary sentence: the article is the subject of this
  // canvas, and a single line cannot hold its own beside a 1240px photograph.
  const sectionContent = new Map()
  const sectionLinks = new Map()
  for (const section of sections) {
    const { html, links } = await fetchSection(CACHE_DIR, PAGE, section.index)
    let blocks = articleBlocks(html)
    // A subsection's own fetch repeats its heading; the band already shows it.
    if (blocks[0]?.kind === 'h' && blocks[0].text === section.title) blocks = blocks.slice(1)
    // A parent section's fetch contains its children, so keep only the intro.
    if (section.hasChildren) {
      const firstHeading = blocks.findIndex((b) => b.kind === 'h')
      if (firstHeading >= 0) blocks = blocks.slice(0, firstHeading)
    }
    sectionContent.set(section.index, blocks)
    sectionLinks.set(section.index, links)
  }
  sectionContent.set('lede', articleBlocks(lede.html))
  // The infobox is part of the lede; fold its wikilinks in so facts the prose
  // leaves to the box (the landing site, the launch pad) still place their items.
  sectionLinks.set('lede', [...new Set([...lede.links, ...infoboxLinks(lede.html)])])

  // Resolve every wikilink to a QID so placement can match on identifiers.
  const allLinks = [...new Set([...sectionLinks.values()].flat())]
  const linkQids = await fetchQids(CACHE_DIR, allLinks)
  const sectionQids = new Map()
  for (const [index, links] of sectionLinks) {
    sectionQids.set(index, links.map((t) => linkQids.get(t)).filter(Boolean))
  }
  const resolvedLinks = allLinks.filter((t) => linkQids.has(t)).length
  console.log(
    `article: ${sections.length} content sections, ` +
      `${allLinks.length} wikilinks, ${resolvedLinks} resolved to QIDs`,
  )

  // --- Placement --------------------------------------------------------------
  const spine = [{ index: 'lede', title: PAGE, level: 1 }, ...sections]
  const result = placeItems({
    items,
    sections: spine,
    sectionQids,
    itemQids,
    adj,
    seedId: seed.id,
  })

  report(result, items)

  // --- Pictures ---------------------------------------------------------------
  // Each Wikipedia article's own lead image, which is distinct per subject. The
  // dataset's thumbnails are not: several point at different crops of the same
  // photograph, so Apollo 11, the Moon landing and Buzz Aldrin all looked alike.
  const articleTitles = new Map()
  for (const [id, item] of items) {
    const title = wikipediaTitle(item.url)
    if (title) articleTitles.set(id, title)
  }
  const leadImages = await fetchPageImages(CACHE_DIR, [...new Set(articleTitles.values())])

  // Fallback for non-Wikipedia items: the dataset thumbnail, resolved through the
  // Commons API where possible so the URL is one Wikimedia will actually serve.
  const fileTitles = new Map()
  for (const [id, item] of items) {
    const title = commonsFileTitle(item.thumbnail)
    if (title) fileTitles.set(id, title)
  }
  // Credit is fetched for the standalone Commons items and for every article
  // lead image, so no rendered picture goes uncredited.
  const leadFileTitles = [...leadImages.values()].map((l) => l.fileTitle).filter(Boolean)
  const dimensions = await fetchImageInfo(CACHE_DIR, [
    ...new Set([...fileTitles.values(), ...leadFileTitles]),
  ])

  // --- Playable media (phase 2) -----------------------------------------------
  // Internet Archive items become native players rather than caption cards: the
  // viewer fetches archive.org/metadata itself given the details URL, so we only
  // ask that API which player fits (movies → video, audio → audio).
  const mediaById = new Map()
  const iaItems = [...items.values()].filter((i) => i.source === 'internet_archive')
  for (const item of iaItems) {
    const iaId = iaIdFromUrl(item.url)
    if (!iaId) continue
    const body = await fetchIaMetadata(CACHE_DIR, iaId)
    const media = resolveMedia(item, { iaMetadata: body?.metadata })
    if (media) mediaById.set(item.id, media)
  }
  console.log(`media: ${mediaById.size} playable of ${iaItems.length} Internet Archive items`)

  // True aspect for the fallback pictures with no API dimensions — OpenLibrary
  // covers and Smithsonian object photos. Without this the layout guesses, and a
  // portrait cover gets squashed into a landscape box.
  const thumbAspects = new Map()
  for (const item of items.values()) {
    if (!item.thumbnail || mediaById.has(item.id)) continue
    if (leadImages.get(articleTitles.get(item.id))) continue
    if (dimensions.get(fileTitles.get(item.id))?.thumbUrl) continue
    if (!thumbAspects.has(item.thumbnail)) {
      thumbAspects.set(item.thumbnail, (await imageMeta(CACHE_DIR, item.thumbnail)).aspect)
    }
  }

  const pictureFor = (item) => {
    const lead = leadImages.get(articleTitles.get(item.id))
    if (lead) {
      const credit = lead.fileTitle ? dimensions.get(lead.fileTitle)?.credit : null
      return { url: lead.source, aspect: lead.height / lead.width, attribution: credit ?? null }
    }

    const commons = dimensions.get(fileTitles.get(item.id))
    if (commons?.thumbUrl) {
      return { url: commons.thumbUrl, aspect: commons.height / commons.width, attribution: commons.credit }
    }
    if (!item.thumbnail) return null
    // OpenStreetMap map tiles carry a required attribution; everything else here
    // is a bare thumbnail whose credit, if any, comes from its own source.
    const attribution =
      item.source === 'openstreetmap' ? { author: '© OpenStreetMap contributors', license: null } : null
    return { url: item.thumbnail, aspect: thumbAspects.get(item.thumbnail) ?? undefined, attribution }
  }

  // Images from hosts that send no CORS headers are downloaded and bundled into
  // the zip, since the viewer cannot draw them as WebGL textures from a URL.
  // Items that resolved to a player render as that player, so their still
  // thumbnail is never drawn and need not be bundled.
  const toBundle = [...new Set(
    [...items.values()]
      .filter((i) => !mediaById.has(i.id))
      .map((i) => pictureFor(i)?.url)
      .filter((u) => needsBundling(u)),
  )]
  const { entries: bundledEntries, refs: bundledRefs } = await bundleImages(CACHE_DIR, toBundle)

  const withPictures = [...items.values()].filter((i) => pictureFor(i)).length
  console.log(
    `pictures: ${withPictures}/${[...items.values()].filter((i) => i.thumbnail).length} usable ` +
      `(${leadImages.size} article lead images, ${dimensions.size} via Commons, ` +
      `${bundledEntries.length} bundled for CORS)`,
  )

  // --- Bands ------------------------------------------------------------------
  // Entries carry the text they will render so the layout can size each card to
  // its content rather than to a fixed box.
  const entryFor = (itemId, info) => {
    const item = items.get(itemId)
    const media = mediaById.get(itemId)
    const picture = media ? null : pictureFor(item)
    return {
      id: itemId,
      ...info,
      source: item.source,
      title: item.title,
      description: item.description ?? '',
      // A resolved player supersedes the still thumbnail; otherwise the dataset's
      // own picture (via the article lead image or the Commons API).
      media,
      thumbnail: picture && (bundledRefs.get(picture.url) ?? picture.url),
      // The un-bundled URL, for the HTML render: an <img> has no CORS/WebGL
      // constraint, so it uses the original rather than the zip's file:/ entry.
      imageUrl: picture?.url ?? null,
      aspect: picture?.aspect,
      attribution: picture?.attribution ?? null,
    }
  }

  const bySection = new Map()
  for (const [itemId, info] of result.placement) {
    // The article is not one of its own enrichments — the seed links to itself.
    if (itemId === seed.id) continue
    if (!bySection.has(info.section)) bySection.set(info.section, [])
    bySection.get(info.section).push(entryFor(itemId, info))
  }
  // Tier 1 first, so a section's hero is something the article itself named.
  for (const entries of bySection.values()) {
    entries.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
  }

  // --- Citations (phase 3): the left gutter -----------------------------------
  // Only sections that become bands need their evidence resolved. A section owns
  // its citations inline in its wikitext, so attribution is free; we cap and rank
  // them (books, then archived sources) so the gutter stays legible.
  const CITATIONS_PER_BAND = 3
  const citationsBySection = new Map()
  for (const section of spine) {
    if (!(bySection.get(section.index) ?? []).length) continue
    const apiIndex = section.index === 'lede' ? '0' : section.index
    const wikitext = await fetchSectionWikitext(CACHE_DIR, PAGE, apiIndex)
    // Enrich each cited book with its OpenLibrary reachability *before* ranking,
    // so the selection can prefer sources a reader can actually open — a
    // borrowable or readable Internet Archive scan over a bare, rot-prone link.
    const candidates = sectionCitations(wikitext)
    for (const cite of candidates) {
      if (cite.isbn) cite.access = openLibraryAccess(await fetchOpenLibraryVolume(CACHE_DIR, cite.isbn))
    }
    const chosen = prioritizeCitations(candidates, CITATIONS_PER_BAND)
    const built = []
    for (let i = 0; i < chosen.length; i++) {
      const cite = chosen[i]
      const coverUrl = citationCoverUrl(cite)
      // A book cover only earns its place if OpenLibrary actually has one — an
      // ISBN with no cover answers with a placeholder a few bytes long — and its
      // true aspect sizes the box so the cover is not squashed.
      const cover = coverUrl ? await imageMeta(CACHE_DIR, coverUrl) : { ok: false, aspect: null }
      // A resolved book points at the copy you can reach; everything else keeps
      // its best citation link (archived copy, then DOI, then the live URL).
      const access = cite.access ?? null
      built.push({
        id: `${section.index}-${i}`,
        kind: cite.kind,
        title: cite.title ?? 'Untitled source',
        publisher: cite.publisher ?? null,
        href: access ? access.url : citationHref(cite),
        linkLabel: access ? access.label : null,
        cover: coverUrl && cover.ok ? coverUrl : null,
        coverAspect: cover.aspect,
      })
    }
    if (built.length) citationsBySection.set(section.index, built)
  }
  const totalCitations = [...citationsBySection.values()].reduce((n, a) => n + a.length, 0)
  const withCovers = [...citationsBySection.values()].flat().filter((c) => c.cover).length
  console.log(
    `citations: ${totalCitations} across ${citationsBySection.size} bands (${withCovers} with covers)`,
  )

  const bands = []
  if (result.prologue.length) {
    bands.push({
      id: 'prologue',
      title: 'Where',
      text: PROLOGUE_TEXT,
      html: noteFrame('Where', PROLOGUE_TEXT),
      entries: result.prologue.map((id) => entryFor(id, { tier: 0, reason: 'linked by place' })),
    })
  }
  for (const section of spine) {
    const entries = bySection.get(section.index) ?? []
    const blocks = sectionContent.get(section.index) ?? []
    // A section with nothing linked to it has no enrichment to show, so it is
    // only article text the reader could get from Wikipedia. Dropping those
    // keeps the canvas to the parts where the open ecosystem has something.
    if (!entries.length) continue
    bands.push({
      id: `s${section.index}`,
      title: section.title,
      blocks,
      headingSize:
        section.index === 'lede' ? PROSE.lede : section.level === 2 ? PROSE.subheadingBand : PROSE.heading,
      html: sectionFrame(
        section.title,
        blocks,
        section.index === 'lede' ? 'lede' : section.level === 2 ? 'subsection' : 'section',
      ),
      entries,
      citations: citationsBySection.get(section.index) ?? [],
    })
  }
  if (result.coda.length) {
    bands.push({
      id: 'coda',
      title: 'Same place, different subject',
      text: CODA_TEXT,
      html: noteFrame('Same place, different subject', CODA_TEXT),
      entries: result.coda.map((id) => entryFor(id, { tier: 0, reason: 'linked by place' })),
    })
  }
  // Items no mechanical rule reached. Shown rather than dropped: where the
  // identifier graph runs out is part of what this demo is arguing about.
  if (result.unplaced.length) {
    bands.push({
      id: 'unreached',
      title: 'Out of reach',
      text: UNREACHED_TEXT,
      html: noteFrame('Out of reach', UNREACHED_TEXT),
      entries: result.unplaced.map((id) => entryFor(id, { tier: 0, reason: 'no path from the article' })),
    })
  }

  // Inline the OpenLibrary covers (item covers and citation covers) as data URIs
  // so the HTML does not depend on the archive.org redirect they resolve through.
  const inline = new Map()
  const coverUrls = new Set()
  for (const b of bands) {
    for (const e of b.entries ?? []) if (e.imageUrl?.includes('covers.openlibrary.org')) coverUrls.add(e.imageUrl)
    for (const c of b.citations ?? []) if (c.cover?.includes('covers.openlibrary.org')) coverUrls.add(c.cover)
  }
  for (const url of coverUrls) {
    const uri = await dataUri(CACHE_DIR, url)
    if (uri) inline.set(url, uri)
  }
  console.log(`inlined ${inline.size}/${coverUrls.size} OpenLibrary covers into the HTML`)

  // Second rendering: the same bands as a single scrolling HTML page, where the
  // prose reflows around the media instead of leaving a fixed lane empty.
  await writeFile(
    HTML_OUT,
    buildHtml({
      title: 'Apollo 11 — an article, enriched',
      description:
        'The Wikipedia article as a canvas: every item placed by the article’s own wikilinks, ' +
        'resolved through Wikidata identifiers, with the open ecosystem’s media in place.',
      bands,
      inline,
    }),
  )
  console.log(`wrote ${HTML_OUT}`)

  const laidOut = layoutBands(bands)

  const placementInfo = new Map(result.placement)
  for (const id of [...result.prologue, ...result.coda]) {
    placementInfo.set(id, { tier: 0, reason: 'linked by place, not by text' })
  }
  for (const id of result.unplaced) {
    placementInfo.set(id, { tier: 0, reason: 'no wikilink, no connection — unreachable' })
  }

  const doc = buildTapestry({
    title: 'Apollo 11 — an article, enriched',
    description:
      'The Wikipedia article as a canvas. Every item is placed by the article’s own ' +
      'wikilinks, resolved through Wikidata identifiers, with Internet Archive footage ' +
      'and audio playable in place and each section’s sources in the left margin.',
    laidOut,
    items,
    placementInfo,
    generatedAt: GENERATED_AT,
  })

  // --- Validate against the real upstream parser before writing ---------------
  const parsed = parseRootJson(JSON.parse(JSON.stringify(doc)))
  if (!parsed) throw new Error('generated root.json failed upstream parseRootJson')
  console.log(`\nvalidated: parsed as v${parsed.version}, ${parsed.items.length} items`)

  const zip = makeZip([
    { name: ROOT_FILE, data: JSON.stringify(doc, null, 2) },
    ...bundledEntries,
  ])
  await writeFile(OUT, zip)
  console.log(`wrote ${OUT} (${(zip.length / 1024).toFixed(1)} kB)`)
  console.log(`canvas: ${laidOut.bands.length} bands, ${laidOut.totalHeight}px tall`)
}

const PROLOGUE_TEXT =
  'Before the article begins: the place itself. These are linked to Apollo 11 by ' +
  'coordinates rather than by anything the prose says.'

const CODA_TEXT =
  'The launch complex sits inside a wildlife refuge. These share coordinates with ' +
  'everything above and belong to an entirely different domain — reachable only ' +
  'because the location is an identifier too.'

const UNREACHED_TEXT =
  'These are in the dataset but no rule could place them: the article never links ' +
  'them, and nothing links them to anything the article does link. Where the ' +
  'identifier graph runs out is worth seeing, not hiding.'

// OpenLibrary's holdings for an ISBN, disk-cached. Tells us whether a cited book
// can be borrowed or read in the open ecosystem, and where.
async function fetchOpenLibraryVolume(cacheDir, isbn) {
  const url = `https://openlibrary.org/api/volumes/brief/isbn/${isbn}.json`
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(cacheDir, `olvol-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // not fetched yet
  }
  // OpenLibrary rate-limits back-to-back requests, so retry with a short backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'all-the-opens-tapestry-gen/0.1 (https://github.com/tieguy/open-graph-next)' },
      })
      if (response.ok) {
        const body = await response.json()
        await mkdir(cacheDir, { recursive: true })
        await writeFile(path, JSON.stringify(body))
        return body
      }
    } catch {
      // network hiccup — fall through to the backoff and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
  }
  return null
}

// A pre-fetched data: URI for a fragile image. OpenLibrary cover URLs redirect
// through archive.org to serve the bytes, so at view time they depend on the
// Internet Archive being up; inlining them keeps the HTML self-contained and
// reliable, matching the project's pre-cached-data decision. Cached to disk.
async function dataUri(cacheDir, url) {
  const key = createHash('sha1').update(`datauri:${url}`).digest('hex').slice(0, 16)
  const path = join(cacheDir, `datauri-${key}.txt`)
  try {
    return await readFile(path, 'utf8')
  } catch {
    // not fetched yet
  }
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    const type = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
    const uri = `data:${type};base64,${bytes.toString('base64')}`
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path, uri)
    return uri
  } catch {
    return null
  }
}

// Fetch an image once to learn two things the API cannot tell us: whether it is
// real (OpenLibrary answers an ISBN with no cover with a placeholder a few dozen
// bytes long) and its true aspect ratio (so the layout sizes the box to the
// picture instead of squashing it). Cached, so reruns stay offline.
async function imageMeta(cacheDir, url) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const path = join(cacheDir, `imeta-${key}.json`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // not fetched yet
  }
  let meta = { ok: false, aspect: null }
  try {
    const response = await fetch(url)
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      meta = { ok: bytes.byteLength > 1500, aspect: imageAspect(bytes) }
    }
  } catch {
    meta = { ok: false, aspect: null }
  }
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path, JSON.stringify(meta))
  return meta
}

function wikipediaTitle(url) {
  const match = /en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(url ?? '')
  return match ? decodeURIComponent(match[1]).replace(/_/g, ' ') : null
}

function countMissing(items) {
  let n = 0
  for (const item of items.values()) if (!item.identifiers?.wikidata) n++
  return n
}

function report({ placement, prologue, coda, unplaced }, items) {
  const tier1 = [...placement.values()].filter((p) => p.tier === 1).length
  const tier2 = [...placement.values()].filter((p) => p.tier === 2).length
  const total = items.size
  const pct = (n) => `${((n / total) * 100).toFixed(0)}%`

  console.log('\nplacement:')
  console.log(`  tier 1 (direct wikilink)      ${String(tier1).padStart(3)}  ${pct(tier1)}`)
  console.log(`  tier 2 (via connection)       ${String(tier2).padStart(3)}  ${pct(tier2)}`)
  console.log(`  prologue (pure place)         ${String(prologue.length).padStart(3)}  ${pct(prologue.length)}`)
  console.log(`  coda (subject at that place)  ${String(coda.length).padStart(3)}  ${pct(coda.length)}`)
  console.log(`  unreached                     ${String(unplaced.length).padStart(3)}  ${pct(unplaced.length)}`)
  if (unplaced.length) console.log(`  → ${unplaced.join(', ')}`)
}

await main()
