// The front page of the live demo: the cover of the same publication the
// article pages belong to. Same serif, same hairline rules, same legend
// icons — the page's one bold element is the search field itself, because
// "type anything" IS the thesis. Each showcase card says what to watch
// stream in for its domain, which is the honest way to sell streaming.

import { escapeHtml } from './emit.js'
import { sourceLegend } from './emit-html.js'

const SHOWCASE = [
  {
    domain: 'Spaceflight',
    title: 'Apollo 11',
    watch:
      'Fifty-seven of its books hide in a pooled bibliography. Watch them come back as borrowable copies — with maps of the launch and recovery sites.',
  },
  {
    domain: 'Law',
    title: 'Brown v. Board of Education',
    watch:
      'The opinion itself arrives first, from the Free Law Project — the primary document before any book about it.',
  },
  {
    domain: 'A scientist’s life',
    title: 'Ludwig Prandtl',
    watch:
      'His 1899 dissertation carries no identifier anywhere. It is matched on the description Wikidata states, and the card shows its work.',
  },
  {
    domain: 'Ecology',
    title: 'Monarch butterfly',
    watch:
      'iNaturalist’s community photographs, and GBIF drawing everywhere a monarch has ever been recorded — from a million observations.',
  },
  {
    domain: 'Art',
    title: 'American Gothic',
    watch:
      'The Art Institute of Chicago’s own record of the painting, placed beside the article about it.',
  },
  {
    domain: 'Open science',
    title: 'CRISPR gene editing',
    watch:
      'Forty-two of its cited papers resolve to readable open-access copies through OpenAlex and arXiv.',
  },
]

const wikiHref = (title) => `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

export function frontPage({ inline = new Map() } = {}) {
  const legend = sourceLegend(inline)
  const cards = SHOWCASE.map(
    (c) => `<a class="show" href="${wikiHref(c.title)}">
  <span class="dom">${escapeHtml(c.domain)}</span>
  <span class="art">${escapeHtml(c.title)}</span>
  <span class="watch">${escapeHtml(c.watch)}</span>
</a>`,
  ).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All the Opens — the article, enriched, live</title>
<style>
:root{
  --bg:#f8f9fa; --paper:#ffffff; --ink:#202122; --head:#0b0d0f; --muted:#54595d;
  --rule:#d5d8dc; --faint:#eceef0; --link:#3366cc;
  --serif:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);
  font-size:19px;line-height:1.7;text-rendering:optimizeLegibility}
a{color:var(--link)}
.wrap{max-width:1180px;margin:0 auto;padding:0 40px}
.kicker{font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:var(--muted);margin:0 0 28px}
.hero{padding:96px 0 40px}
h1{font-size:clamp(2.7rem,6vw,4.6rem);line-height:1.02;letter-spacing:-.02em;
  margin:0 0 24px;color:var(--head);font-weight:600;max-width:16ch}
.lede{font-size:clamp(1.1rem,2vw,1.35rem);line-height:1.55;max-width:52ch;margin:0 0 14px;color:#333}
.lede b{color:var(--head)}

/* The search field is the thesis: an encyclopedia headword waiting to be
   written. Serif, oversized, underlined like an entry — not a widget. */
.ask{margin:44px 0 10px;max-width:44rem}
.ask input{width:100%;background:transparent;border:0;border-bottom:2px solid var(--ink);
  font-family:var(--serif);font-size:clamp(1.5rem,3.4vw,2.3rem);color:var(--head);
  padding:6px 2px 10px;border-radius:0}
.ask input::placeholder{color:#b6babf;font-style:italic}
.ask input:focus{outline:none;border-bottom-color:var(--link)}
.ask input:focus-visible{outline:2px solid var(--link);outline-offset:6px}
.hint{font-family:var(--sans);font-size:.78rem;color:var(--muted);margin:10px 0 0}
.hint kbd{font-family:var(--sans);border:1px solid var(--rule);border-bottom-width:2px;
  border-radius:4px;padding:0 5px;background:var(--paper);font-size:.72rem}

.section{border-top:1px solid var(--rule);padding:52px 0}
.eyebrow{font-family:var(--sans);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--muted);display:block;margin:0 0 26px}

.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0 44px}
.show{display:block;text-decoration:none;color:inherit;border-top:1px solid var(--rule);
  padding:20px 0 26px}
.show:hover .art,.show:focus-visible .art{color:var(--link)}
.show:focus-visible{outline:2px solid var(--link);outline-offset:4px}
.dom{display:block;font-family:var(--sans);font-size:.68rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.art{display:block;font-size:1.45rem;line-height:1.15;font-weight:600;color:var(--head);
  margin-bottom:10px}
.art::after{content:" →";color:var(--rule)}
.show:hover .art::after{color:var(--link)}
.watch{display:block;font-family:var(--sans);font-size:.82rem;line-height:1.6;color:var(--muted);
  max-width:38ch}

.evi{display:grid;grid-template-columns:repeat(3,1fr);gap:0 44px;font-family:var(--sans)}
.evi div{border-top:1px solid var(--rule);padding-top:18px}
.evi h3{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px;color:var(--head)}
.evi p{font-size:.82rem;line-height:1.6;color:var(--muted);margin:0;max-width:38ch}
.swatch{display:inline-block;width:22px;height:13px;border:1px dashed #c9a227;border-radius:3px;
  background:#fffdf5;vertical-align:-2px;margin-right:6px}

.legend{display:flex;flex-wrap:wrap;gap:10px 22px;font-family:var(--sans);font-size:.78rem;color:var(--muted)}
.key{display:inline-flex;align-items:center;gap:8px}
.fav{width:16px;height:16px;flex:none;border-radius:2px;background:#fff no-repeat center;
  background-size:contain;display:inline-block}
${legend.style}
.hard h3{font-family:var(--serif);font-size:1.15rem;margin:1.6em 0 .4em;color:var(--head)}
.hard h3:first-of-type{margin-top:0}
.hard p{font-family:var(--sans);font-size:.86rem;line-height:1.65;color:#3a3f45;max-width:66ch;margin:0 0 .9em}
.hard code{background:var(--faint);padding:1px 5px;border-radius:3px;font-size:.8rem}

.foot{border-top:1px solid var(--rule);padding:40px 0 60px;font-family:var(--sans);
  font-size:.8rem;color:var(--muted)}
.foot p{max-width:70ch;margin:0 0 8px}

@media(max-width:960px){.grid,.evi{grid-template-columns:1fr 1fr}}
@media(max-width:640px){
  .wrap{padding:0 20px}
  .hero{padding:56px 0 30px}
  .grid,.evi{grid-template-columns:1fr}
}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <p class="kicker">All the Opens · Rabbit Hole Browser · a rendering experiment</p>
  <h1>The article, enriched — while you watch.</h1>
  <p class="lede">Pick any English Wikipedia article. The article streams in first; then ten open
    collections — libraries, archives, museums, science databases, maps — assemble around it.
    <b>Nothing is placed by hand:</b> every item is found by an identifier the article itself
    states, and lands in the section whose anchor found it.</p>
  <form class="ask" onsubmit="location.href='/wiki/'+encodeURIComponent(this.q.value.trim().replace(/ /g,'_'));return false">
    <input name="q" placeholder="Any article title — try your hometown" autofocus
      aria-label="English Wikipedia article title">
    <p class="hint">Press <kbd>Enter</kbd> to discover. Pages take a few seconds to finish; they start in one.</p>
  </form>
</div></header>
<main>
  <section class="section"><div class="wrap">
    <span class="eyebrow">Six domains, one pipeline — no per-article code</span>
    <div class="grid">
${cards}
    </div>
  </div></section>
  <section class="section"><div class="wrap">
    <span class="eyebrow">How a connection earns its place</span>
    <div class="evi">
      <div><h3>Identifier</h3><p>The article states an ISBN, DOI, OCLC, LCCN, PMID or arXiv id, and a
        collection answers to exactly it. The strongest claim a card can make.</p></div>
      <div><h3>Statement</h3><p>Wikidata states the connection outright — this painting is Met object
        11417, this species is iNaturalist taxon 48662, this place is here. The card credits the property.</p></div>
      <div><h3><span class="swatch"></span>Corroborated</h3><p>No identifier exists on either side, so
        records are matched on what Wikidata <i>describes</i> — author, date, institution — and the card
        prints the agreeing values rather than asking to be trusted.</p></div>
    </div>
  </div></section>
  <section class="section"><div class="wrap">
    <span class="eyebrow">The collections it reaches</span>
    <div class="legend">${legend.html}</div>
  </div></section>
  <section class="section hard" id="hard-problems"><div class="wrap">
    <span class="eyebrow">Where it gets hard</span>
    <h3>Laying out data you have never seen</h3>
    <p>An arbitrary article gives you arbitrary shape: one section carries forty images and the next
      carries none. The page lets CSS reflow prose around the media rather than computing positions,
      and every image is sized from its real dimensions — so a sparse section closes up instead of
      leaving a hole, and nothing is squashed into a guessed aspect ratio.</p>
    <h3>The citations that hide the books</h3>
    <p>The better-sourced the article, the more likely it keeps its books as <code>{{sfn}}</code>
      pointers into a pooled bibliography — Apollo 11 keeps 57 of 65 that way. Anything that reads
      footnotes alone misses the most books on exactly the best-cited pages; they are joined back on
      surname and year.</p>
    <h3>The works with no identifier anywhere</h3>
    <p>Prandtl’s dissertation is scanned and public, and carries no ISBN, OCLC or LCCN — the normal
      condition for a newly-scanned collection, not an exotic one. The match is made on the object
      Wikidata describes, and the card shows the agreeing values, because a description that agrees
      is a weaker claim than an identifier that matches.</p>
    <h3>Saying what was left out</h3>
    <p>Where a rail shows <i>4 of 1,212</i> depictions, the four are an arbitrary draw, and the page
      says so instead of implying a selection. A section whose sources are all dead ends states that
      too — an absence is a fact about the ecosystem, not a thinner section.</p>
  </div></section>
</main>
<footer class="foot"><div class="wrap">
  <p>Generated, not authored. Every page is discovered live from the article’s own anchors and
    streamed as it is found — this server fetches politely, a few pages at a time, and caches what
    it has seen.</p>
  <p>Code is public domain (CC0) in <a href="https://github.com/tieguy/open-graph-next">open-graph-next</a>.
    Article text CC BY-SA 4.0; every item carries its own licence and credit.</p>
</div></footer>
</body>
</html>
`
}
