import { escapeHtml } from './emit.js'

// A second rendering of the same model (bands, entries, citations) as a single
// scrolling HTML page. Where the Tapestry emitter reserves fixed pixel lanes and
// leaves dead canvas when the prose dwarfs the media, HTML lets the prose reflow
// around and below floated media/citation rails — so the layout costs nothing to
// balance. This is a comparison spike, not the finished thing.

// Each source identified by its own site's icon, not a colour key. The two logos
// hosted on Wikimedia are pulled at a width its thumbnail allowlist still serves
// (32px is rejected now — the same restriction that broke the dataset thumbnails).
const SOURCE = {
  internet_archive: { name: 'Internet Archive', icon: 'https://archive.org/favicon.ico' },
  wikipedia: { name: 'Wikipedia', icon: 'https://en.wikipedia.org/favicon.ico' },
  wikimedia_commons: { name: 'Wikimedia Commons', icon: 'https://commons.wikimedia.org/favicon.ico' },
  openlibrary: { name: 'OpenLibrary', icon: 'https://openlibrary.org/favicon.ico' },
  smithsonian: {
    name: 'Smithsonian',
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Smithsonian_sun_logo_no_text.svg/120px-Smithsonian_sun_logo_no_text.svg.png',
  },
  openstreetmap: { name: 'OpenStreetMap', icon: 'https://www.openstreetmap.org/favicon.ico' },
  free_law: { name: 'Free Law Project', icon: 'https://www.courtlistener.com/favicon.ico' },
  inaturalist: { name: 'iNaturalist', icon: 'https://www.inaturalist.org/favicon.ico' },
  gbif: { name: 'GBIF', icon: 'https://www.gbif.org/favicon.ico' },
  openalex: { name: 'OpenAlex', icon: 'https://openalex.org/favicon.ico' },
  arxiv: { name: 'arXiv', icon: 'https://arxiv.org/favicon.ico' },
  met: {
    name: 'The Met',
    // The museum's own favicon answers 429 to non-browser fetches; the logo
    // hosted on Commons serves at an allowlisted thumb width instead.
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/The_Metropolitan_Museum_of_Art_Logo.svg/120px-The_Metropolitan_Museum_of_Art_Logo.svg.png',
  },
  artic: { name: 'Art Institute of Chicago', icon: 'https://www.artic.edu/favicon.ico' },
}

const CITATION_KIND = {
  web: 'web source', news: 'news', book: 'book', journal: 'journal article',
  magazine: 'magazine', press: 'press release', av: 'audio / video',
  arxiv: 'preprint', generic: 'source',
}

const iaEmbed = (source) => {
  const m = /archive\.org\/(?:details|embed)\/([^/?#]+)/.exec(source ?? '')
  return m ? `https://archive.org/embed/${m[1]}` : null
}

/**
 * A source's icon as an inlined data: URI, or nothing.
 *
 * Never a live hotlink. Two of these sites refuse them — CourtListener answers
 * 403, GBIF varies by referrer — so a page built on live URLs shows broken
 * images for exactly the sources a reader is least likely to recognise by name.
 * The generator fetches what it can into `inline`; whatever failed renders as a
 * named entry with no picture, which is the honest degradation.
 */
function favicon(slug, inline) {
  const url = SOURCE[slug]?.icon
  // A class, never the bytes: Apollo 11 has ~100 carousels, and inlining the
  // data URI at each one added 242 KB of the same few images repeated. The
  // bytes go in the stylesheet once (see faviconStyle) and every use is a
  // 30-byte class reference.
  return url && inline.has(url) ? `<span class="fav fav-${slug}" aria-hidden="true"></span>` : ''
}

/** Each used icon's bytes, exactly once, as background-image rules. */
function faviconStyle(slugs, inline) {
  const rules = slugs
    .map((s) => [s, inline.get(SOURCE[s]?.icon)])
    .filter(([, data]) => data)
    .map(([s, data]) => `.fav-${s}{background-image:url("${data}")}`)
  return rules.length ? `\n${rules.join('\n')}\n` : ''
}

function sourceTag(source, inline = new Map()) {
  const meta = SOURCE[source] ?? { name: source.replace(/_/g, ' '), icon: null }
  return `<span class="src">${favicon(source, inline)}${escapeHtml(meta.name)}</span>`
}

// A citation is a link, not an item, so it carries no source slug — but a page
// that sends the reader to OpenLibrary twenty times is using OpenLibrary, and a
// legend that omits it is describing the carousels rather than the page.
const CITED_HOST = [
  [/(^|\.)openlibrary\.org/, 'openlibrary'],
  [/(^|\.)archive\.org/, 'internet_archive'],
  [/(^|\.)courtlistener\.com/, 'free_law'],
]

/** The source slugs this page actually shows, in the order SOURCE declares them. */
export function sourcesUsed(bands) {
  const seen = new Set()
  for (const b of bands ?? []) {
    for (const e of b.entries ?? []) if (e.source) seen.add(e.source)
    for (const c of b.citations ?? []) {
      if (c.source) seen.add(c.source)
      for (const url of [c.href, c.cover]) {
        if (!url) continue
        const host = URL.canParse?.(url) ? new URL(url).hostname : null
        if (host) for (const [re, slug] of CITED_HOST) if (re.test(host)) seen.add(slug)
      }
    }
  }
  return Object.keys(SOURCE).filter((s) => seen.has(s))
}

/** Every icon URL a page will need, so the generator can prefetch them. */
export const iconUrls = () => Object.values(SOURCE).map((m) => m.icon).filter(Boolean)

/**
 * The full source legend — every partner this pipeline can reach — with the
 * same inlined icons the article pages use. For pages ABOUT the system (the
 * front page), where the legend describes capability rather than one page's
 * findings; article pages keep building theirs from `sourcesUsed`.
 */
export function sourceLegend(inline = new Map()) {
  const keys = Object.keys(SOURCE)
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')
  return { html: keys, style: faviconStyle(Object.keys(SOURCE), inline) }
}

// A compact card for a horizontal carousel. The source is not repeated here — it
// labels the whole carousel — so the card carries only the item and why it landed.
function card(entry, inline) {
  const embed = entry.media ? iaEmbed(entry.media.source) : null
  let visual = ''
  if (embed) {
    const tall = entry.media.webpageType === 'iaAudio' ? ' audio' : ''
    visual =
      `<div class="frame${tall}"><iframe src="${escapeHtml(embed)}" loading="lazy" ` +
      `allowfullscreen title="${escapeHtml(entry.title)}"></iframe></div>`
  } else if (entry.imageUrl) {
    const src = inline.get(entry.imageUrl) ?? entry.imageUrl
    visual = `<img class="shot" src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(entry.title)}">`
  }
  const credit = entry.attribution
    ? `<p class="credit">${escapeHtml([entry.attribution.author, entry.attribution.license].filter(Boolean).join(' · '))}</p>`
    : ''
  // An edge made by matching a description is a weaker claim than one made by a
  // shared identifier, and must not look the same. The card says so and shows
  // the agreeing signals, so a reader can judge the match rather than trust it.
  const evidence =
    entry.evidence === 'corroborated'
      ? `<p class="evidence">corroborated — no shared identifier</p>` +
        `<ul class="signals">${(entry.corroboratedBy ?? [])
          .map(
            (s) =>
              `<li><span class="sig-field">${escapeHtml(s.field)}</span>` +
              `<span class="sig-pair">${escapeHtml(String(s.holding))}</span>` +
              `<span class="sig-vs">matches</span>` +
              `<span class="sig-pair">${escapeHtml(String(s.claimed))}</span></li>`,
          )
          .join('')}</ul>`
      : ''
  // A card with an href is an open door, and the whole card says so: the
  // title links out. Cards without one (most Commons media) stay as they were.
  const heading = entry.href
    ? `<h4><a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener">${escapeHtml(entry.title)}</a></h4>`
    : `<h4>${escapeHtml(entry.title)}</h4>`
  return (
    `<figure class="card${entry.evidence === 'corroborated' ? ' corroborated' : ''}">${visual}<figcaption>` +
    heading +
    (entry.description ? `<p class="desc">${escapeHtml(entry.description)}</p>` : '') +
    evidence +
    credit +
    `</figcaption></figure>`
  )
}

// One horizontal, scroll-snapping carousel per source: the strip is labelled with
// the source's own icon, and its items scroll sideways rather than stacking into a
// tall column.
function carousel(source, items, inline) {
  // Only badge the count when there is more than one — "1" in the corner is noise.
  const count = items.length > 1 ? `<span class="count">${items.length}</span>` : ''
  return (
    `<div class="carousel"><div class="carousel-head">${sourceTag(source, inline)}${count}</div>` +
    `<div class="carousel-track">${items.map((e) => card(e, inline)).join('')}</div></div>`
  )
}

function citation(cite, inline) {
  const kind = CITATION_KIND[cite.kind] ?? 'source'
  const cover = cite.cover
    ? `<img class="cover" src="${escapeHtml(inline.get(cite.cover) ?? cite.cover)}" loading="lazy" alt="${escapeHtml(cite.title)}">`
    : ''
  const link = cite.href
    ? `<a class="cite-link${cite.linkLabel ? ' access' : ''}" href="${escapeHtml(cite.href)}" ` +
      `target="_blank" rel="noopener">${escapeHtml(cite.linkLabel ?? 'view source')} ↗</a>`
    : ''
  return (
    `<li class="cite">${cover}<span class="cite-kind">${escapeHtml(kind)}</span>` +
    `<span class="cite-title">${escapeHtml(cite.title)}</span>` +
    (cite.publisher ? `<span class="cite-pub">${escapeHtml(cite.publisher)}</span>` : '') +
    link +
    `</li>`
  )
}

/**
 * A band's right rail — media carousels, cited sources, disclosure — as its
 * own fragment, because the streaming renderer sends it separately from the
 * spine it belongs to. Empty string when the band has nothing to show.
 */
export function bandRail(b, inline = new Map()) {
  // Group the band's media by source, in first-appearance order, one carousel each.
  const bySource = new Map()
  for (const e of b.entries ?? []) {
    if (!bySource.has(e.source)) bySource.set(e.source, [])
    bySource.get(e.source).push(e)
  }
  const media = [...bySource].map(([source, items]) => carousel(source, items, inline)).join('')
  // The coverage line goes with the sources, not the media: it is a statement
  // about what this section cites and how much of it the open ecosystem holds.
  // A section whose sources are all dead ends must not look like a section with
  // few sources — the rail shows three either way.
  const coverage = b.coverage ? `<p class="coverage">${escapeHtml(b.coverage)}</p>` : ''
  const sources = (b.citations ?? []).length
    ? `<div class="sources"><p class="rail-label">Selected sources from this section</p><ul>${b.citations
        .map((c) => citation(c, inline))
        .join('')}</ul>${coverage}</div>`
    : coverage
      ? `<div class="sources">${coverage}</div>`
      : ''
  // An optional line stating how this band's media was selected. Used when the
  // anchor that produced it is broad enough that the selection is arbitrary —
  // the prototype discloses that rather than filtering it out of sight.
  const disclosure = b.disclosure
    ? `<p class="disclosure">${escapeHtml(b.disclosure)}</p>`
    : ''
  return media || sources ? `<aside class="rail">${disclosure}${media}${sources}</aside>` : ''
}

function band(b, eyebrow, inline) {
  const prose = b.blocks
    ? b.blocks.map((x) => (x.kind === 'h' ? `<h3>${escapeHtml(x.text)}</h3>` : `<p>${escapeHtml(x.text)}</p>`)).join('')
    : `<p class="note-lead">${escapeHtml(b.text ?? '')}</p>`
  // Two columns: the article on the left, and a single right rail carrying the
  // ecosystem's media with the section's cited sources beneath it. The rail
  // floats, so the prose wraps around it and reclaims full width below — no
  // reserved empty column.
  const rail = bandRail(b, inline)
  const id = b.id ? ` id="${escapeHtml(b.id)}"` : ''
  return (
    `<section class="band ${b.blocks ? 'section' : 'note'}"${id}>` +
    `<header class="band-head"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(b.title)}</h2></header>` +
    `<div class="band-body">${rail}<div class="prose">${prose}</div></div>` +
    `</section>`
  )
}

// `inline` maps a fragile image URL (OpenLibrary covers, which redirect through
// archive.org) to a pre-fetched data: URI, so those covers render without a live
// dependency on the Internet Archive being up.
export function buildHtml({ title, description, bands, inline = new Map(), provenance = '', home = '' }) {
  let n = 0
  const body = bands
    .map((b) => (b.blocks ? band(b, b.id === 'slede' ? 'lede' : `§${++n}`, inline) : band(b, 'aside', inline)))
    .join('\n')

  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')

  // Where a rail draws four files out of hundreds, the four are arbitrary and the
  // page used to say so on every single anchor — eight times on a five-section
  // article, which reads as hedging rather than as disclosure. The ratio already
  // carries it; the rule is stated once here instead.
  // The note states the rule; the argument about it lives on the index, and is
  // only linked when a caller says where that index is. A page opened straight
  // off disk has no site around it, so an unconditional link would dangle.
  const discussion = home
    ? ` Challenges to layout and selection are discussed on the
       <a href="${escapeHtml(home)}#hard-problems">main page</a>.`
    : ''
  const drawNote = bands.some((b) => b.broad)
    ? `<p class="draw-note">Where a rail shows <i>4 of 182</i>, the four are an arbitrary draw from
       the whole set.${discussion}</p>`
    : ''

  // Explain the one visual distinction that carries an argument, and only when
  // the page actually uses it — a key to a style nothing on the page has is
  // noise, and worse, implies a rigour this render did not exercise.
  const hasCorroborated = bands.some((b) => (b.entries ?? []).some((e) => e.evidence === 'corroborated'))
  const evidenceKey = hasCorroborated
    ? `<p class="evidence-key"><span class="swatch"></span>A dashed card is a <b>corroborated</b> match. ` +
      `No identifier is shared by the two records — none exists on either side — so it was matched on the ` +
      `object Wikidata <i>describes</i>: an author, a date and an institution that all agree. The agreeing ` +
      `values are printed on the card, because a description that agrees is a weaker claim than an ` +
      `identifier that matches, and must not be read as one.</p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}${faviconStyle(used, inline)}
</style>
</head>
<body>
<header class="hero">
  <p class="kicker">Rabbit Hole Browser · a rendering experiment</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(description)}</p>
  <p class="thesis">The article runs down the left; the open ecosystem’s media and the sources it
    cites sit in the margin beside it. <b>Nothing here is placed by hand.</b></p>
  <div class="legend">${legend}</div>
  ${drawNote}
  ${evidenceKey}
</header>
<main>
${body}
</main>
<footer class="foot">
  <p>${provenance ? `${provenance} ` : ''}Article text CC BY-SA 4.0;
  media under their own licences, shown on each item.</p>
</footer>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Streaming (Phase 7): the same page, delivered as one chunked response. The
// shell and full spine go out first — the article renders before any pivot
// answers — and each band's rail follows as a <template> plus a one-line
// script that moves it into place as the browser parses it. No framework, no
// client round-trips: the stream IS the page.

// The relocation helpers, inlined into the head so they exist before the
// first fragment arrives. `__thb` mounts a band's rail; `__fill`/`__append`
// place the hero's legend and notes once the page knows its sources.
const RELOCATE_JS = `<script>
function __thb(t,b){var p=document.getElementById(t),s=document.getElementById(b);
if(p&&s){var e=p.content.firstElementChild;if(e)s.querySelector(".band-body").insertBefore(e,s.querySelector(".prose"));p.remove()}}
function __fill(t,q){var p=document.getElementById(t),e=document.querySelector(q);
if(p&&e){e.replaceChildren(p.content.cloneNode(true));p.remove()}}
function __append(t,q){var p=document.getElementById(t),e=document.querySelector(q);
if(p&&e){e.appendChild(p.content.cloneNode(true));p.remove()}}
</script>`

/**
 * Everything up to and including the spine: head, hero (with an empty legend
 * the stream fills later), and every band with its prose but no rail. Icon
 * styles for ALL sources are emitted up front — a streaming page cannot know
 * yet which it will use, and the unused rules cost bytes, not correctness.
 */
export function streamOpen({ title, description, units, inline = new Map() }) {
  let n = 0
  const spine = units
    .map((u) =>
      band(
        { id: u.index === '0' ? 'slede' : `s${u.index}`, title: u.title, blocks: u.blocks },
        u.index === '0' ? 'lede' : `§${++n}`,
        inline,
      ),
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}${faviconStyle(Object.keys(SOURCE), inline)}
</style>
${RELOCATE_JS}
</head>
<body>
<header class="hero">
  <p class="kicker">Rabbit Hole Browser · a rendering experiment · streaming</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(description)}</p>
  <p class="thesis">The article runs down the left; the open ecosystem’s media and the sources it
    cites sit in the margin beside it. <b>Nothing here is placed by hand.</b></p>
  <div class="legend"></div>
</header>
<main>
${spine}
`
}

/**
 * One band's enrichment as a stream fragment: the rail in a template, and the
 * instruction to mount it. Empty string when the band has nothing to add —
 * a band with no findings needs no bytes, and its absence IS the finding.
 */
export function streamBand(b, inline = new Map()) {
  const rail = bandRail(b, inline)
  if (!rail) return ''
  return `<template id="tpl-${escapeHtml(b.id)}">${rail}</template><script>__thb("tpl-${escapeHtml(b.id)}","${escapeHtml(b.id)}")</script>\n`
}

/**
 * The hero's legend and per-page notes, streamed once every band has landed —
 * only then does the page know which sources it used and whether any anchor
 * drew arbitrarily.
 */
export function streamHeroExtras(bands, { inline = new Map(), home = '' } = {}) {
  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')
  const discussion = home
    ? ` Challenges to layout and selection are discussed on the
       <a href="${escapeHtml(home)}#hard-problems">main page</a>.`
    : ''
  const notes =
    (bands.some((b) => b.broad)
      ? `<p class="draw-note">Where a rail shows <i>4 of 182</i>, the four are an arbitrary draw from
       the whole set.${discussion}</p>`
      : '') +
    (bands.some((b) => (b.entries ?? []).some((e) => e.evidence === 'corroborated'))
      ? `<p class="evidence-key"><span class="swatch"></span>A dashed card is a <b>corroborated</b> match. ` +
        `No identifier is shared by the two records — none exists on either side — so it was matched on the ` +
        `object Wikidata <i>describes</i>: an author, a date and an institution that all agree. The agreeing ` +
        `values are printed on the card, because a description that agrees is a weaker claim than an ` +
        `identifier that matches, and must not be read as one.</p>`
      : '')
  return (
    `<template id="tpl-legend">${legend}</template><script>__fill("tpl-legend",".legend")</script>\n` +
    (notes ? `<template id="tpl-notes">${notes}</template><script>__append("tpl-notes",".hero")</script>\n` : '')
  )
}

/** The close of the stream: footer and document end. */
export function streamClose({ provenance = '' } = {}) {
  return `</main>
<footer class="foot">
  <p>${provenance ? `${provenance} ` : ''}Article text CC BY-SA 4.0;
  media under their own licences, shown on each item.</p>
</footer>
</body>
</html>
`
}

const STYLE = `
:root{
  --bg:#f8f9fa; --paper:#ffffff; --ink:#202122; --head:#0b0d0f; --muted:#54595d;
  --rule:#d5d8dc; --faint:#eceef0; --link:#3366cc;
  --serif:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);
  font-size:19px;line-height:1.7;text-rendering:optimizeLegibility}
a{color:var(--link)}
img{max-width:100%;display:block}

.hero{max-width:1180px;margin:0 auto;padding:96px 40px 56px}
.kicker{font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:var(--muted);margin:0 0 28px}
.hero h1{font-size:clamp(2.7rem,6vw,4.6rem);line-height:1.02;letter-spacing:-.02em;
  margin:0 0 24px;color:var(--head);font-weight:600}
.hero .lede{font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.5;max-width:40ch;margin:0 0 20px;color:#333}
.hero .thesis{font-family:var(--sans);font-size:1rem;line-height:1.65;max-width:60ch;color:var(--muted);margin:0 0 36px}
.hero .thesis b{color:var(--ink);font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:var(--sans);font-size:.75rem;color:var(--muted);
  border-top:1px solid var(--rule);padding-top:22px}
.key{display:inline-flex;align-items:center;gap:8px}
.fav{width:16px;height:16px;flex:none;border-radius:2px;background:#fff no-repeat center;background-size:contain;display:inline-block}

main{max-width:1180px;margin:0 auto;padding:0 40px}
.band{padding:52px 0;border-top:1px solid var(--rule)}
.band-head{margin:0 0 26px}
.eyebrow{font-family:var(--sans);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--muted);display:block;margin-bottom:8px}
.band-head h2{font-size:clamp(1.7rem,3vw,2.5rem);line-height:1.1;letter-spacing:-.01em;
  margin:0;color:var(--head);font-weight:600}
.note .band-head h2{font-style:italic}

/* The load-bearing layout choice: the body is a flow-root, media and citations
   float to the rails, and the prose reflows around and below them — no reserved
   empty column, so a long section with sparse media has no dead space. */
.band-body{display:flow-root}
.prose{}
.prose p{margin:0 0 1.05em;max-width:42em}
.prose h3{font-family:var(--sans);font-size:1.05rem;letter-spacing:.01em;font-weight:700;
  color:var(--head);margin:1.8em 0 .5em}
.note-lead{font-size:1.15rem;font-style:italic;color:#3a3f45;max-width:46em}

/* The rail narrows in steps so the two-column layout survives well below a full
   desktop width — a hi-DPI laptop at default scaling reports a narrow CSS width,
   and it should still read as article + margin, not stack. */
.rail{float:right;width:404px;margin:6px 0 24px 46px}
@media(max-width:1040px){.rail{width:344px;margin-left:38px}}
@media(max-width:860px){.rail{width:290px;margin-left:28px}}

/* One scroll-snapping strip per source; items scroll sideways instead of stacking. */
.carousel{margin:0 0 22px}
.carousel-head{display:flex;align-items:center;gap:8px;margin:0 0 10px}
.carousel-head .count{margin-left:auto;font-family:var(--sans);font-size:.7rem;font-weight:600;color:#9aa0a6}
.carousel-track{display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;
  padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#c1c6cc transparent;overscroll-behavior-x:contain}
.carousel-track::-webkit-scrollbar{height:8px}
.carousel-track::-webkit-scrollbar-thumb{background:#c1c6cc;border-radius:4px}
.card{flex:0 0 178px;scroll-snap-align:start}
.src{display:inline-flex;align-items:center;gap:7px;font-size:.68rem;letter-spacing:.08em;
  text-transform:uppercase;font-weight:700;color:var(--muted)}
.frame{position:relative;aspect-ratio:16/9;background:#111;border-radius:5px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.14)}
.frame.audio{aspect-ratio:auto;height:52px;background:#1d1d20;border-radius:5px}
.frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.frame.audio iframe{position:static;height:52px}
.shot{width:100%;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.14);background:var(--faint)}
.card figcaption{padding-top:8px;font-family:var(--sans)}
.card h4{font-family:var(--serif);font-size:.95rem;line-height:1.22;margin:0 0 4px;color:var(--head);font-weight:600;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card h4 a{color:inherit;text-decoration:none;border-bottom:1px solid var(--rule)}
.card h4 a:hover{color:var(--link);border-bottom-color:var(--link)}
.card .desc{font-size:.76rem;line-height:1.4;color:var(--muted);margin:0 0 5px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .credit{font-size:.68rem;color:#7a7f85;margin:0 0 4px}
.draw-note{font-family:var(--sans);font-size:.72rem;line-height:1.55;color:var(--muted);max-width:62ch;margin:14px 0 0}
.draw-note i{color:var(--ink);font-style:normal;font-weight:600}
.evidence-key{display:flex;align-items:baseline;gap:9px;font-family:var(--sans);font-size:.72rem;line-height:1.55;color:var(--muted);max-width:62ch;margin:14px 0 0}
.evidence-key .swatch{flex:none;width:22px;height:14px;border:1px dashed #c9a227;border-radius:3px;background:#fffdf5;transform:translateY(2px)}
.coverage{font-family:var(--sans);font-size:.66rem;line-height:1.5;color:#8a8f95;margin:12px 0 0;padding-top:9px;border-top:1px dotted var(--rule)}
/* Corroborated edges read differently on purpose: a dashed rule and a stated
   reason, so a described-object match is never mistaken for a shared identifier. */
.card.corroborated{border:1px dashed #c9a227;border-radius:4px;padding:6px;background:#fffdf5}
.card .evidence{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:#8a6d1f;margin:0 0 5px;font-weight:600}
.card .signals{list-style:none;margin:0 0 6px;padding:0;font-size:.66rem;line-height:1.45;color:#6b6f75}
.card .signals li{display:block;margin-bottom:3px}
.card .sig-field{display:block;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:#a0a4a9}
.card .sig-pair{color:#4a4f55}
.card .sig-vs{color:#a0a4a9;margin:0 4px}
.card .why{font-size:.67rem;color:var(--muted);margin:0;padding-top:6px;border-top:1px dotted var(--rule)}

.disclosure{font-family:var(--sans);font-size:.68rem;line-height:1.45;color:var(--muted);
  margin:0 0 14px;padding:7px 9px;background:var(--faint);border-left:2px solid var(--rule);border-radius:3px}
.sources{margin-top:28px;padding-top:22px;border-top:1px solid var(--rule)}
.rail-label{font-family:var(--sans);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);margin:0 0 14px}
.sources ul{list-style:none;margin:0;padding:0}
.cite{font-family:var(--sans);border-left:2px solid var(--rule);padding:1px 0 1px 12px;margin:0 0 16px}
.cite .cover{width:78px;border-radius:3px;margin:0 0 8px;box-shadow:0 1px 2px rgba(0,0,0,.18)}
.cite-kind{display:block;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:#8a8f95;margin-bottom:3px}
.cite-title{display:block;font-size:.84rem;line-height:1.3;font-weight:600;color:var(--ink)}
.cite-pub{display:block;font-size:.75rem;color:var(--muted);margin-top:2px}
.cite-link{display:inline-block;font-size:.72rem;margin-top:6px;text-decoration:none}
.cite-link:hover{text-decoration:underline}
/* A book you can actually borrow or read gets a stronger, pill-shaped call. */
.cite-link.access{margin-top:8px;padding:3px 9px;border:1px solid var(--link);border-radius:999px;font-weight:600}
.cite-link.access:hover{background:var(--link);color:#fff;text-decoration:none}

.foot{max-width:1180px;margin:0 auto;padding:40px;border-top:1px solid var(--rule);
  font-family:var(--sans);font-size:.8rem;color:var(--muted)}
.foot code{background:var(--faint);padding:1px 5px;border-radius:3px}

@media(max-width:900px){main{padding:0 26px}.hero{padding:72px 26px 44px}}
@media(max-width:640px){
  .hero{padding:52px 20px 34px}
  main{padding:0 20px}
  .rail{float:none;width:auto;margin:26px 0}
  .sources ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}
  .cite{margin:0}
}
`
