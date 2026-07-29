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

function sourceTag(source) {
  const meta = SOURCE[source] ?? { name: source.replace(/_/g, ' '), icon: null }
  const icon = meta.icon ? `<img class="fav" src="${meta.icon}" alt="" loading="lazy">` : ''
  return `<span class="src">${icon}${escapeHtml(meta.name)}</span>`
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
  return (
    `<figure class="card${entry.evidence === 'corroborated' ? ' corroborated' : ''}">${visual}<figcaption>` +
    `<h4>${escapeHtml(entry.title)}</h4>` +
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
    `<div class="carousel"><div class="carousel-head">${sourceTag(source)}${count}</div>` +
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

function band(b, eyebrow, inline) {
  const prose = b.blocks
    ? b.blocks.map((x) => (x.kind === 'h' ? `<h3>${escapeHtml(x.text)}</h3>` : `<p>${escapeHtml(x.text)}</p>`)).join('')
    : `<p class="note-lead">${escapeHtml(b.text ?? '')}</p>`
  // Two columns: the article on the left, and a single right rail carrying the
  // ecosystem's media with the section's cited sources beneath it. The rail
  // floats, so the prose wraps around it and reclaims full width below — no
  // reserved empty column.
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
  const rail = media || sources ? `<aside class="rail">${disclosure}${media}${sources}</aside>` : ''
  return (
    `<section class="band ${b.blocks ? 'section' : 'note'}">` +
    `<header class="band-head"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(b.title)}</h2></header>` +
    `<div class="band-body">${rail}<div class="prose">${prose}</div></div>` +
    `</section>`
  )
}

// `inline` maps a fragile image URL (OpenLibrary covers, which redirect through
// archive.org) to a pre-fetched data: URI, so those covers render without a live
// dependency on the Internet Archive being up.
export function buildHtml({ title, description, bands, inline = new Map() }) {
  let n = 0
  const body = bands
    .map((b) => (b.blocks ? band(b, b.id === 'slede' ? 'lede' : `§${++n}`, inline) : band(b, 'aside', inline)))
    .join('\n')

  const legend = Object.values(SOURCE)
    .map((m) => `<span class="key"><img class="fav" src="${m.icon}" alt="" loading="lazy">${escapeHtml(m.name)}</span>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<header class="hero">
  <p class="kicker">Rabbit Hole Browser · a rendering experiment</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(description)}</p>
  <p class="thesis">Nothing here is placed by hand. Each item sits where the article’s own
    <b>wikilinks</b>, resolved through <b>Wikidata</b> identifiers, put it — the article on the
    left, the open ecosystem’s media and the sources it cites in the margin beside it.</p>
  <div class="legend">${legend}</div>
</header>
<main>
${body}
</main>
<footer class="foot">
  <p>Generated from <code>web-demo/data/apollo-11/</code>. Article text CC BY-SA 4.0;
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
.fav{width:16px;height:16px;object-fit:contain;flex:none;border-radius:2px;background:#fff}

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
.card .desc{font-size:.76rem;line-height:1.4;color:var(--muted);margin:0 0 5px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .credit{font-size:.68rem;color:#7a7f85;margin:0 0 4px}
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
