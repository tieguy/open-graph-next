// Tapestry items carry absolute position and size; there is no layout engine.
// All geometry is decided here, deterministically, from section order and lane.

// The spine is wide and the type is large because the article is the subject
// here, not a caption beside the pictures.
export const LANES = {
  // Giant band titles, legible only when zoomed out. Placed far enough left that
  // they fall outside the viewport at reading zoom, so they never compete with
  // the prose — the reader sees them only when they pull back far enough that
  // everything else has become a grey smudge.
  overview: { x: -3000, width: 2300 },
  citations: { x: -520, width: 400 },
  spine: { x: 0, width: 860 },
  media: { x: 980, width: 1000 },
}

// Article text. Sized to hold its own against the photograph beside it.
export const PROSE = {
  lede: 58,
  heading: 42,
  subheading: 30,
  subheadingBand: 34,
  body: 26,
  lineHeight: 1.62,
  paragraphGap: 18,
  // Sized for the zoom level where three or four bands share the screen — the
  // scale at which you are looking for a section rather than reading one. At
  // that zoom this renders around 16px; at reading zoom it is off-screen left.
  overview: 200,
}

// Widths are fixed by lane; heights are not — a text card must hug its content,
// since a Tapestry text frame renders at exactly its declared size and a fixed
// height leaves the card mostly empty.
//
// These widths are deliberately modest. The whole canvas has to fit a laptop viewport, and every
// pixel of media width scales the prose down: at 2900px wide the 26px body text
// renders at about 12px on a 1400px screen. Media is the enrichment here, not
// the subject.
export const WIDTHS = {
  hero: 1000,
  standard: 480,
  minor: 320,
}

export const SIZES = {
  hero: { width: WIDTHS.hero, height: 700 },
  standard: { width: WIDTHS.standard, height: 400 },
  minor: { width: WIDTHS.minor, height: 200 },
}

const BAND_GAP = 160
const ITEM_GAP = 40
const HEADING_HEIGHT = 90
const CAPTION_GAP = 12

// A genuinely extreme portrait would dominate its band, so pictures are capped
// at this multiple of their width. Set above a tall book cover (~1.67) so real
// covers and portraits render at their true shape rather than being squashed;
// only the rare panorama-tall image is clipped.
const MAX_ASPECT = 1.8

/**
 * Picture height from the image's true aspect ratio. Wikimedia files give real
 * dimensions via imageinfo; OpenLibrary covers and Smithsonian photos have theirs
 * read from the image header (see imagesize.js), so nothing is guessed. The 3:2
 * default only applies to a picture whose bytes could not be read at all.
 */
export function imageHeight(width, aspect = 1 / 1.5) {
  return Math.round(width * Math.min(aspect, MAX_ASPECT))
}

// Playable media carries no picture to measure, so its box is a per-kind default
// aspect (height / width). A video is a 16:9 frame; audio a short wide bar with
// just a scrubber; a book stands portrait. Matches the design's per-type sizing.
const MEDIA_ASPECT = {
  video: 9 / 16, // 0.5625, landscape
  audio: 0.3, // a wide short bar — a player, not a picture
  book: 1.4, // portrait
  pdf: 1.29, // ~A4 portrait
  image: 1 / 1.5,
}

/** The box aspect (height / width) to reserve for a resolved media descriptor. */
export function mediaAspect(media) {
  const wt = media.webpageType
  if (wt === 'iaVideo' || wt === 'youtube' || wt === 'vimeo') return MEDIA_ASPECT.video
  if (wt === 'iaAudio') return MEDIA_ASPECT.audio
  return MEDIA_ASPECT[media.type] ?? MEDIA_ASPECT.image
}

/**
 * Stacks bands top to bottom. Each band is one section: a text frame in the
 * spine lane, and its items flowing in the media lane — first item as hero,
 * the rest two-up beneath it.
 *
 * @returns {{items: object[], groups: object[], bands: object[]}}
 */
export function layoutBands(bands) {
  const items = []
  const groups = []
  const placed = []
  let y = 0

  for (const band of bands) {
    const groupId = `group-${band.id}`
    groups.push({
      id: groupId,
      color: band.color ?? null,
      hasBorder: false,
      hasBackground: false,
    })

    // The overview title sits outside every group, so zooming to a presentation
    // step frames the band's content and not this 200px heading.
    items.push({
      kind: 'overview',
      id: `overview-${band.id}`,
      groupId: null,
      title: band.title,
      position: { x: LANES.overview.x, y },
      size: { width: LANES.overview.width, height: Math.round(PROSE.overview * 1.35) },
    })

    const textHeight = band.blocks
      ? proseHeight(band.blocks, LANES.spine.width, band.headingSize ?? PROSE.heading)
      : estimateTextHeight(band.text, LANES.spine.width) + HEADING_HEIGHT
    items.push({
      kind: 'text',
      id: `text-${band.id}`,
      groupId,
      title: band.title,
      position: { x: LANES.spine.x, y },
      size: { width: LANES.spine.width, height: textHeight },
      html: band.html,
    })

    // The hero spans the lane; the rest flow two-up, each into whichever column
    // is currently shorter. Heights vary per card, so a fixed grid would leave
    // ragged gaps.
    const columnX = [LANES.media.x, LANES.media.x + WIDTHS.standard + ITEM_GAP]
    const columnY = [y, y]

    band.entries.forEach((entry, index) => {
      const isHero = index === 0
      const width = isHero ? WIDTHS.hero : WIDTHS.standard
      const sizeClass = isHero ? 'hero' : 'standard'
      // A resolved media object (playable IA video/audio, a book) takes priority
      // over the still thumbnail; only its box aspect differs.
      const visualAspect = entry.media ? (entry.media.aspect ?? mediaAspect(entry.media)) : entry.aspect
      const hasVisual = !!entry.media || !!entry.thumbnail
      const visualHeight = hasVisual ? imageHeight(width, visualAspect) : 0
      const captionH = cardHeight(entry.title ?? '', entry.description ?? '', width, isHero, !!entry.attribution)
      const height = visualHeight ? visualHeight + CAPTION_GAP + captionH : captionH

      let column = 0
      if (isHero) {
        columnY[0] = columnY[1] = Math.max(columnY[0], columnY[1])
      } else {
        column = columnY[0] <= columnY[1] ? 0 : 1
      }

      const x = isHero ? LANES.media.x : columnX[column]
      let cursor = columnY[column]

      // A figure: the picture or player, then its caption directly beneath it.
      if (visualHeight) {
        items.push({
          kind: entry.media ? 'media' : 'image',
          id: entry.media ? `media-${entry.id}` : `img-${entry.id}`,
          groupId,
          entry,
          media: entry.media,
          sizeClass,
          position: { x, y: cursor },
          size: { width, height: visualHeight },
        })
        cursor += visualHeight + CAPTION_GAP
      }

      items.push({
        kind: 'entry',
        id: entry.id,
        groupId,
        entry,
        sizeClass,
        position: { x, y: cursor },
        size: { width, height: captionH },
      })

      if (isHero) {
        columnY[0] = columnY[1] = columnY[0] + height + ITEM_GAP
      } else {
        columnY[column] += height + ITEM_GAP
      }
    })

    const mediaHeight = band.entries.length ? Math.max(...columnY) - ITEM_GAP - y : 0

    // The left gutter: this band's evidence, stacked top-down. A book cover sits
    // above its card; a web or news source is card-only.
    let cy = y
    for (const citation of band.citations ?? []) {
      const width = WIDTHS.minor
      const coverHeight = citation.cover ? imageHeight(width, citation.coverAspect ?? 1.5) : 0
      const cardHeightPx = citationCardHeight(citation.title ?? '', citation.publisher ?? '', width)
      let cursor = cy
      if (coverHeight) {
        items.push({
          kind: 'citation-cover',
          id: `cite-cover-${citation.id}`,
          groupId,
          citation,
          position: { x: LANES.citations.x, y: cursor },
          size: { width, height: coverHeight },
        })
        cursor += coverHeight + CAPTION_GAP
      }
      items.push({
        kind: 'citation',
        id: `cite-${citation.id}`,
        groupId,
        citation,
        position: { x: LANES.citations.x, y: cursor },
        size: { width, height: cardHeightPx },
      })
      cy = cursor + cardHeightPx + ITEM_GAP
    }
    const citationsHeight = (band.citations?.length ?? 0) ? cy - ITEM_GAP - y : 0

    const bandHeight = Math.round(Math.max(textHeight, mediaHeight, citationsHeight))
    // The real extent of what this band drew, which is not the lane layout: the
    // citations lane holds nothing until phase 3, and framing it wastes a fifth
    // of the opening view on blank canvas.
    const drawn = items.filter((i) => i.groupId === groupId && i.kind !== 'overview')
    const bounds = {
      x: Math.min(...drawn.map((i) => i.position.x)),
      y: Math.min(...drawn.map((i) => i.position.y)),
      right: Math.max(...drawn.map((i) => i.position.x + i.size.width)),
      bottom: Math.max(...drawn.map((i) => i.position.y + i.size.height)),
    }
    placed.push({ id: band.id, groupId, y, height: bandHeight, title: band.title, bounds })
    y += bandHeight + BAND_GAP
  }

  return { items, groups, bands: placed, totalHeight: y }
}

/**
 * Height of a spine frame holding the section heading and its full prose.
 * Measured block by block, since paragraph count and subheadings both matter.
 */
export function proseHeight(blocks, width, headingSize = PROSE.heading) {
  const inner = width - 64
  let height = 56 + headingSize * 1.2 + 26 // padding + section heading + its margin

  for (const block of blocks) {
    if (block.kind === 'h') {
      height +=
        wrappedLines(block.text, inner, PROSE.subheading) * PROSE.subheading * 1.3 +
        PROSE.paragraphGap * 1.5
    } else {
      height +=
        wrappedLines(block.text, inner, PROSE.body) * PROSE.body * PROSE.lineHeight +
        PROSE.paragraphGap
    }
  }
  return Math.round(height)
}

/** Rough text box height. Errs tall — an oversized frame is harmless, a clipped one isn't. */
export function estimateTextHeight(text, width, fontSize = 22, floor = 200) {
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.5)))
  const lines = Math.ceil(text.length / charsPerLine)
  return Math.max(floor, Math.round(lines * fontSize * 1.6 + 80))
}

// Mirrors the card markup in emit.js. Kept adjacent to it deliberately: if the
// card CSS changes and these do not, cards get clipped or float in empty space.
export const CARD_STYLE = {
  padding: 52, // frame padding, top + bottom
  label: { size: 18, lineHeight: 1.4, marginBottom: 12 },
  title: { hero: 40, standard: 30, lineHeight: 1.3, marginBottom: 14 },
  body: { hero: 26, standard: 22, lineHeight: 1.5, marginBottom: 16 },
  note: { size: 17, lineHeight: 1.4 },
}

// A citation card in the left gutter: minor, so it never competes with the
// spine or the media. Mirrored in emit.js citationCard — keep the two in step.
export const CITATION_STYLE = {
  padding: 34,
  label: { size: 13, lineHeight: 1.4, marginBottom: 8 },
  title: { size: 20, lineHeight: 1.3, marginBottom: 8 },
  publisher: { size: 16, lineHeight: 1.4 },
}

/** Height of a citation card: kind label, title, publisher. No description. */
export function citationCardHeight(title, publisher, width) {
  const s = CITATION_STYLE
  const inner = width - 40
  const label = s.label.size * s.label.lineHeight + s.label.marginBottom
  const heading =
    wrappedLines(title, inner, s.title.size) * s.title.size * s.title.lineHeight + s.title.marginBottom
  const pub = publisher
    ? wrappedLines(publisher, inner, s.publisher.size) * s.publisher.size * s.publisher.lineHeight
    : 0
  return Math.round(s.padding + label + heading + pub)
}

/** Wrapped line count for a run of text at a given size and column width. */
export function wrappedLines(text, width, fontSize) {
  if (!text) return 0
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.52)))
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

/**
 * Height of a phase-1 placeholder card: source label, title, description, and
 * the placement note. Each block is measured at the size it actually renders at,
 * rather than approximated once and padded.
 */
export function cardHeight(title, description, width, isHero = false, hasAttribution = false) {
  const s = CARD_STYLE
  const inner = width - 48 // horizontal frame padding
  const titleSize = isHero ? s.title.hero : s.title.standard
  const bodySize = isHero ? s.body.hero : s.body.standard

  const label = s.label.size * s.label.lineHeight + s.label.marginBottom
  const heading =
    wrappedLines(title, inner, titleSize) * titleSize * s.title.lineHeight + s.title.marginBottom
  const body = description
    ? wrappedLines(description, inner, bodySize) * bodySize * s.body.lineHeight + s.body.marginBottom
    : 0
  const note = s.note.size * s.note.lineHeight
  // The credit line under the card: one note-sized line plus its top margin.
  const attribution = hasAttribution ? s.note.size * (s.note.lineHeight + 0.5) : 0

  return Math.round(s.padding + label + heading + body + note + attribution)
}

// Roughly a landscape laptop. The viewer scales startView to fit the viewport,
// so the rectangle's aspect decides where the slack goes: too wide and it fits
// horizontally then floats mid-screen, leaving empty canvas above the content.
const VIEWPORT_ASPECT = 0.62
const START_PADDING = 60

/**
 * Frames the first band on open, around what it actually drew rather than around
 * the lane grid. Height is grown to the viewport aspect only if the band is
 * shorter than that — never width, since widening scales the prose down.
 */
export function startView(bands) {
  const first = bands[0]
  if (!first?.bounds) return null
  const { x, y, right, bottom } = first.bounds
  const width = right - x + START_PADDING * 2
  const height = Math.max(bottom - y + START_PADDING * 2, Math.round(width * VIEWPORT_ASPECT))
  return {
    position: { x: x - START_PADDING, y: y - START_PADDING },
    size: { width, height },
  }
}
