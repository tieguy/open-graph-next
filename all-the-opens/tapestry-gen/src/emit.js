import { CARD_STYLE, CITATION_STYLE, PROSE, startView } from './layout.js'

// Wikipedia's own palette, so the canvas reads as the article it is enriching
// rather than as a separate application.
const THEME = {
  background: '#f8f9fa', // Wikipedia site background
  card: '#ffffff', // content background
  heading: '#000000',
  body: '#202122', // Wikipedia body text
  muted: '#54595d', // Wikipedia secondary text
  link: '#3366cc', // Wikipedia link blue
  overview: '#c8ccd1', // Wikipedia border grey — a whisper at reading zoom
}

// Per-source identity, matching the D3 demo's vocabulary but darkened for a
// light background — the dark-theme versions fail contrast on white.
const SOURCE_COLOR = {
  wikipedia: '#3366cc',
  wikimedia_commons: '#0f7b53',
  internet_archive: '#a15c00',
  openlibrary: '#6b3fa0',
  smithsonian: '#8a6d00',
  openstreetmap: '#0b6e8f',
  inaturalist: '#1a7340',
  gbif: '#a4262c',
}

/**
 * Phase 1 emits text frames only — no resolved media. Each dataset item becomes
 * a labelled card so placement is visible and checkable in the viewer before any
 * media resolution work is done.
 */
export function buildTapestry({ title, description, laidOut, items, placementInfo, generatedAt }) {
  const tapestryItems = []

  for (const node of laidOut.items) {
    if (node.kind === 'overview') {
      tapestryItems.push({
        id: node.id,
        type: 'text',
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: null,
        notes: null,
        thumbnail: null,
        text: overviewFrame(node.title),
        backgroundColor: null,
      })
      continue
    }

    if (node.kind === 'text') {
      tapestryItems.push({
        id: node.id,
        type: 'text',
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: node.groupId,
        notes: null,
        thumbnail: null,
        text: node.html,
        backgroundColor: null,
      })
      continue
    }

    if (node.kind === 'citation-cover') {
      tapestryItems.push({
        id: node.id,
        type: 'image',
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: node.groupId,
        notes: node.citation.href ?? null,
        thumbnail: null,
        source: node.citation.cover,
      })
      continue
    }

    if (node.kind === 'citation') {
      tapestryItems.push({
        id: node.id,
        type: 'text',
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: node.groupId,
        notes: node.citation.href ?? null,
        thumbnail: null,
        text: citationCard(node.citation),
        backgroundColor: THEME.card,
      })
      continue
    }

    const item = items.get(node.entry.id)
    const info = placementInfo.get(node.entry.id)

    if (node.kind === 'media') {
      // A resolved, playable item: a v7 media type the viewer renders natively.
      // `webpage` carries the embedding hint; `audio`/`video` carry a playback
      // range. All share the same `source` URL the media loads from.
      const media = node.media
      const isTimed = media.type === 'audio' || media.type === 'video'
      tapestryItems.push({
        id: node.id,
        type: media.type,
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: node.groupId,
        notes: placementNote(info),
        thumbnail: null,
        source: media.source,
        ...(media.type === 'webpage' ? { webpageType: media.webpageType ?? null } : {}),
        ...(isTimed ? { startTime: null, stopTime: null } : {}),
      })
      continue
    }

    if (node.kind === 'image') {
      tapestryItems.push({
        id: node.id,
        type: 'image',
        position: node.position,
        size: node.size,
        title: null,
        dropShadow: false,
        groupId: node.groupId,
        notes: placementNote(info),
        thumbnail: null,
        // The entry's URL, not the dataset item's: the raw one is a dead 200px
        // Wikimedia thumbnail, while the entry carries the resolved API URL.
        source: node.entry.thumbnail,
      })
      continue
    }

    tapestryItems.push({
      id: node.id,
      type: 'text',
      position: node.position,
      size: node.size,
      title: null,
      dropShadow: false,
      groupId: node.groupId,
      notes: placementNote(info),
      thumbnail: null,
      text: card(item, info, node.sizeClass, node.entry.attribution),
      backgroundColor: THEME.card,
    })
  }

  const presentation = []
  let prevStepId = null
  for (const band of laidOut.bands) {
    const id = `step-${band.id}`
    presentation.push({ id, type: 'group', groupId: band.groupId, prevStepId })
    prevStepId = id
  }

  return {
    version: 7,
    id: 'apollo-11-article',
    title,
    description,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    background: THEME.background,
    theme: 'light',
    parentId: null,
    thumbnail: null,
    startView: startView(laidOut.bands),
    groups: laidOut.groups,
    items: tapestryItems,
    rels: [],
    presentation,
  }
}

/**
 * A section of the article: its heading, then its full prose. Sizes come from
 * PROSE so the layout's height estimate and the rendered text agree.
 */
export function sectionFrame(title, blocks, kind = 'section') {
  const headingSize =
    kind === 'lede' ? PROSE.lede : kind === 'subsection' ? PROSE.subheadingBand : PROSE.heading
  const heading =
    `<h2 style="color:${THEME.heading};font-size:${headingSize}px;line-height:1.2;` +
    `margin:0 0 26px">${escapeHtml(title)}</h2>`

  const body = blocks
    .map((block) =>
      block.kind === 'h'
        ? `<h3 style="color:${THEME.heading};font-size:${PROSE.subheading}px;line-height:1.3;` +
          `margin:${PROSE.paragraphGap * 1.5}px 0 ${PROSE.paragraphGap}px">${escapeHtml(block.text)}</h3>`
        : `<p style="color:${THEME.body};font-size:${PROSE.body}px;line-height:${PROSE.lineHeight};` +
          `margin:0 0 ${PROSE.paragraphGap}px">${escapeHtml(block.text)}</p>`,
    )
    .join('')

  return heading + body
}

// How a citation's kind reads on its card.
const CITATION_KIND = {
  web: 'web source',
  news: 'news',
  book: 'book',
  journal: 'journal article',
  magazine: 'magazine',
  press: 'press release',
  av: 'audio / video',
  arxiv: 'preprint',
  generic: 'source',
}

/**
 * A citation card in the left gutter: what kind of source it is, its title, and
 * its publisher. The link itself lives in the item's notes. Deliberately quiet —
 * evidence beside the claim, not competing with it.
 */
function citationCard(citation) {
  const s = CITATION_STYLE
  const kind = CITATION_KIND[citation.kind] ?? 'source'
  const publisher = citation.publisher
    ? `<p style="color:${THEME.muted};font-size:${s.publisher.size}px;line-height:${s.publisher.lineHeight};` +
      `margin:0">${escapeHtml(citation.publisher)}</p>`
    : ''
  return (
    `<p style="color:${THEME.muted};font-size:${s.label.size}px;letter-spacing:.09em;` +
    `text-transform:uppercase;margin:0 0 ${s.label.marginBottom}px">${escapeHtml(kind)}</p>` +
    `<p style="color:${THEME.heading};font-size:${s.title.size}px;line-height:${s.title.lineHeight};` +
    `margin:0 0 ${s.title.marginBottom}px;font-weight:600">${escapeHtml(citation.title ?? 'Untitled source')}</p>` +
    publisher
  )
}

/**
 * A band's title at overview scale. Right-aligned so it hugs the spine, and in a
 * light grey so that at reading zoom — where it is off-screen anyway — it would
 * not compete with the article if it did drift into view.
 */
export function overviewFrame(title) {
  return (
    `<p style="color:${THEME.overview};font-size:${PROSE.overview}px;line-height:1.2;` +
    `text-align:right;margin:0;font-weight:700">${escapeHtml(title)}</p>`
  )
}

export function noteFrame(title, body) {
  return (
    `<h2 style="color:${THEME.heading};font-size:${PROSE.heading}px;line-height:1.2;margin:0 0 20px">` +
    `${escapeHtml(title)}</h2>` +
    `<p style="color:${THEME.muted};font-size:${PROSE.body}px;line-height:${PROSE.lineHeight};` +
    `margin:0;font-style:italic">${escapeHtml(body)}</p>`
  )
}

function card(item, info, sizeClass, attribution = null) {
  const s = CARD_STYLE
  const isHero = sizeClass === 'hero'
  const color = SOURCE_COLOR[item.source] ?? THEME.muted
  const titleSize = isHero ? s.title.hero : s.title.standard
  const bodySize = isHero ? s.body.hero : s.body.standard
  // No truncation: cards are sized to their content, so the box always fits.
  const description = item.description ?? ''

  return (
    `<p style="color:${color};font-size:${s.label.size}px;letter-spacing:.09em;` +
    `text-transform:uppercase;margin:0 0 ${s.label.marginBottom}px">` +
    `${escapeHtml(item.source.replace(/_/g, ' '))}</p>` +
    `<h3 style="color:${THEME.heading};font-size:${titleSize}px;line-height:${s.title.lineHeight};` +
    `margin:0 0 ${s.title.marginBottom}px">${escapeHtml(item.title)}</h3>` +
    `<p style="color:${THEME.body};font-size:${bodySize}px;line-height:${s.body.lineHeight};` +
    `margin:0 0 ${s.body.marginBottom}px">${escapeHtml(description)}</p>` +
    `<p style="color:${THEME.muted};font-size:${s.note.size}px;margin:0">` +
    `${escapeHtml(placementNote(info))}</p>` +
    attributionLine(attribution)
  )
}

/**
 * A one-line credit — "author · licence" — under an item's card. The article
 * text is CC BY-SA and every Commons image carries its own licence; a demo
 * about cooperative knowledge infrastructure should model the reciprocity.
 */
export function attributionLine(credit) {
  if (!credit) return ''
  const parts = [credit.author, credit.license].filter(Boolean)
  if (!parts.length) return ''
  const s = CARD_STYLE
  return (
    `<p style="color:${THEME.muted};font-size:${s.note.size}px;margin:${s.note.size * 0.5}px 0 0;` +
    `opacity:.85">${parts.map(escapeHtml).join(' · ')}</p>`
  )
}

/**
 * Every card says why it is where it is. During phase 1 this is the point of the
 * artifact: it makes the placement rule auditable at a glance.
 */
export function placementNote(info) {
  if (!info) return 'unplaced'
  if (info.tier === 1) return `placed by wikilink → ${info.via}`
  if (info.tier === 2) return `placed via connection to ${info.via}`
  return info.reason ?? 'placed'
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
