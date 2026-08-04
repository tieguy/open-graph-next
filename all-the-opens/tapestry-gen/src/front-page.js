// The front page of the live demo: the cover of the same publication the
// article pages belong to. Same serif, same hairline rules — recentered on
// the FRIENDS (2026-08-03 review): the partners and what each one gives, not
// the pipeline. The search field stays the one bold element, because "type
// anything" is still the invitation; the mechanism lives in two quiet boxes
// above the footer.

import { escapeHtml } from './emit.js'
import { sourceLegend } from './emit-html.js'

const SHOWCASE = [
  {
    domain: 'Spaceflight',
    title: 'Apollo 11',
    watch:
      'Fifty-seven books hide in a pooled bibliography. The Archive lends them back — with maps of the launch and recovery sites.',
  },
  {
    domain: 'Law',
    title: 'Brown v. Board of Education',
    watch:
      'Free Law Project delivers the opinion itself first — the primary document before any book about it.',
  },
  {
    domain: 'A scientist’s life',
    title: 'Ludwig Prandtl',
    watch:
      'His 1899 dissertation carries no ISBN, OCLC or LCCN — but Wikidata knows which scan it is, and says so.',
  },
  {
    domain: 'Ecology',
    title: 'Monarch butterfly',
    watch:
      'iNaturalist’s photographs, and GBIF drawing everywhere a monarch has ever been recorded.',
  },
  {
    domain: 'Art',
    title: 'American Gothic',
    watch:
      'The Art Institute of Chicago’s own record of the painting, beside the article about it.',
  },
  {
    domain: 'Open science',
    title: 'CRISPR gene editing',
    watch:
      'Forty-two cited papers resolve to readable copies through OpenAlex and arXiv.',
  },
]

// The friends, each with its gift — the page's actual subject. Order is
// roughly a reader's journey: books, papers, museums, nature, place, law,
// media; the hosts close the list. The licence line states the terms of the
// gift, because the terms ARE part of the story — and it must stay true of
// the data this demo actually uses, not of the organisation in general.
const FRIENDS = [
  ['internet_archive', 'Internet Archive',
    'Lends the books. A footnote’s ISBN becomes a copy you can borrow tonight.',
    'Public-domain scans free to read; in-copyright books lent, not copied.'],
  ['openlibrary', 'OpenLibrary',
    'Knows every edition of every book — and which ones are actually open.',
    'Open bibliographic data, downloadable in bulk.'],
  ['openalex', 'OpenAlex',
    'Finds the free, legal copy of the paper behind the citation.',
    'Catalog CC0. Only papers with an open copy are shown — each card names its licence; closed ones are counted, not carded.'],
  ['arxiv', 'arXiv',
    'Keeps whole sciences open by construction — the preprint is the publication.',
    'Metadata CC0; each paper names its own licence.'],
  ['met', 'The Met',
    'Shares its own record of its own objects, public domain wherever it can be.',
    'Public-domain works released CC0, images included.'],
  ['artic', 'Art Institute of Chicago',
    'The painting’s home, telling you about the painting.',
    'Public-domain images CC0, served over open IIIF.'],
  ['iiif', 'IIIF collections',
    'One protocol, many doors: manuscripts and artworks served by whichever institution holds them.',
    'Terms set per object by its holding institution, stated in each manifest.'],
  ['dpla', 'DPLA',
    'America’s union catalog — tens of millions of items from local libraries, archives and museums.',
    'Metadata CC0; each item’s rights stated by its holder.'],
  ['europeana', 'Europeana',
    'Europe’s answer: three thousand museums, libraries and archives behind one door.',
    'Only openly licensed items are shown; each card names its licence.'],
  ['inaturalist', 'iNaturalist',
    'A community’s living field guide — photographs with the observer’s name on them.',
    'Each photo carries its observer’s chosen licence; only openly licensed ones are shown here.'],
  ['gbif', 'GBIF',
    'Draws where a species has been seen, from hundreds of millions of records.',
    'Records CC0 or CC BY, stated per dataset.'],
  ['openstreetmap', 'OpenStreetMap',
    'Maps the world down to the building — by hand, by volunteers.',
    'Map data ODbL: share-alike, credit the contributors.'],
  ['free_law', 'Free Law Project',
    'Publishes the law itself. The opinion, not a paywall.',
    'Court opinions are public domain: nobody owns the law.'],
  ['wikimedia_commons', 'Wikimedia Commons',
    'Brings the photographs, freely licensed, of very nearly everything.',
    'Every file free-licensed or public domain, credit shown on the file.'],
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
  const friends = FRIENDS.map(
    ([slug, name, gift, lic]) => `<div class="friend">
  <p class="who"><span class="fav fav-${slug}"></span>${escapeHtml(name)}</p>
  <p class="gift">${escapeHtml(gift)}</p>
  <p class="lic"><span class="lic-mark">openness?</span> ${escapeHtml(lic)}</p>
</div>`,
  ).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Help From Our Friends — an open knowledge web experiment</title>
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
.wrap{max-width:1180px;margin:0 auto;padding:0 40px;min-width:0}
.kicker{font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:var(--muted);margin:0 0 28px}
.hero{padding:96px 0 40px}
h1{font-size:clamp(2.7rem,6vw,4.6rem);line-height:1.02;letter-spacing:-.02em;
  margin:0 0 24px;color:var(--head);font-weight:600;max-width:16ch}
.lede{font-size:clamp(1.1rem,2vw,1.35rem);line-height:1.55;max-width:54ch;margin:0 0 14px;color:#333}
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

.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 44px}
.show{display:block;text-decoration:none;color:inherit;border-top:1px solid var(--rule);
  padding:20px 0 26px;min-width:0}
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

.friends{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 44px}
.friend{border-top:1px solid var(--rule);padding:18px 0 22px;min-width:0}
.friend .who{display:flex;align-items:center;gap:10px;font-family:var(--sans);font-weight:700;
  font-size:1rem;color:var(--head);margin:0 0 8px}
.fav{width:18px;height:18px;flex:none;border-radius:3px;background:#fff no-repeat center;
  background-size:contain;display:inline-block}
.friend .gift{font-size:1.02rem;line-height:1.5;color:#3a3f45;margin:0;max-width:34ch}
.friend .lic{font-family:var(--sans);font-size:.72rem;line-height:1.5;color:var(--muted);
  margin:7px 0 0;max-width:40ch}
.lic-mark{display:inline-block;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:#8a8f95;margin-right:3px}
.friend.host{grid-column:1/-1}
.friend.host .gift{max-width:none;font-style:italic;color:var(--muted)}
${legend.style}
.boxes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.box{background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:22px 26px;min-width:0}
.box h3{font-family:var(--sans);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--head);margin:0 0 10px}
.box p{font-family:var(--sans);font-size:.88rem;line-height:1.65;color:#3a3f45;margin:0 0 10px}
.box p:last-child{margin-bottom:0}
.box h4{font-family:var(--serif);font-size:1.02rem;margin:16px 0 4px;color:var(--head)}

.foot{border-top:1px solid var(--rule);padding:40px 0 60px;font-family:var(--sans);
  font-size:.8rem;color:var(--muted)}
.foot p{max-width:70ch;margin:0 0 8px}

@media(max-width:960px){.grid,.friends{grid-template-columns:repeat(2,minmax(0,1fr))}.boxes{grid-template-columns:minmax(0,1fr)}}
@media(max-width:640px){
  .wrap{padding:0 20px}
  .hero{padding:56px 0 30px}
  .grid,.friends{grid-template-columns:minmax(0,1fr)}
}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <p class="kicker">Help From Our Friends · an open knowledge web experiment</p>
  <h1>Wikipedia is not alone.</h1>
  <p class="lede">Alongside every Wikipedia article there is a wider open world: libraries that lend,
    museums that publish their own collections, scientists who post their papers openly, mappers and
    naturalists who chart the planet for free. This experiment invites them in.
    <b>Pick an article, and watch its friends arrive.</b></p>
  <form class="ask" onsubmit="location.href='/wiki/'+encodeURIComponent(this.q.value.trim().replace(/ /g,'_'));return false">
    <input name="q" placeholder="Any article title — try your hometown" autofocus
      aria-label="English Wikipedia article title">
    <p class="hint">Press <kbd>Enter</kbd>. The article arrives in a second; its friends stream in behind it.</p>
  </form>
</div></header>
<main>
  <section class="section"><div class="wrap">
    <span class="eyebrow">Or start with one of these</span>
    <div class="grid">
${cards}
    </div>
  </div></section>
  <section class="section"><div class="wrap">
    <span class="eyebrow">Current friends, and what they bring</span>
    <div class="friends">
${friends}
      <div class="friend host">
  <p class="who"><span class="fav fav-wikipedia"></span>Wikidata &amp; Wikipedia</p>
  <p class="gift">The hosts: one writes the article that convenes everyone; the other makes the
    introductions — it knows every friend&rsquo;s name for every thing.</p>
  <p class="lic"><span class="lic-mark">openness?</span> Article text CC BY-SA 4.0; Wikidata CC0.</p>
</div>
    </div>
  </div></section>
  <section class="section"><div class="wrap">
    <div class="boxes">
      <div class="box">
        <h3>How it works</h3>
        <p>The goal of this experiment is to demonstrate that open knowledge is not just hugely
        successful, but also increasingly hugely interlinked. So when you load an article, a small
        script on our server pulls existing linking information (from citations and Wikidata) and
        then grabs context from those sources to enrich the article — in one of two ways, and each
        card says which.</p>
        <h4>Identifier</h4>
        <p>The article states an ISBN, DOI, OCLC, LCCN, PMID or arXiv id, and a collection answers to
        exactly it. The strongest claim a card can make.</p>
        <h4>Statement</h4>
        <p>Wikidata states the connection outright — this painting is Met object 11417, this species
        is iNaturalist taxon 48662, this place is here. The card credits the property.</p>
        <p>Each shelf says <i>who asked</i>, too: when one friend answers several of the
        article&rsquo;s links, its cards split into one labelled shelf per link — and in the opening
        section, works <i>by</i> the subject never share a shelf with works merely <i>cited</i>
        there.</p>
      </div>
      <div class="box">
        <h3>Challenges and future opportunities</h3>
        <p>This is a demo and not intended for production. Among other challenges:</p>
        <h4>Page layout</h4>
        <p>Arbitrary content means great layout is somewhere between difficult and impossible. Work
        with designers on this challenge would be necessary (though even rudimentary implementations
        would likely be very enjoyable for certain types of data nerds!)</p>
        <h4>Content curation</h4>
        <p>Sources can return thousands of responses. (Think the Smithsonian on the Apollo Program,
        for example.) A gallery with a thousand items is not very helpful to the reader, so some
        sort of curation (or at least ability to tune algorithmic prioritization) would be necessary
        before widespread deployment.</p>
        <h4>Source curation</h4>
        <p>Similarly, there are many collections of open content these days. Picking and
        prioritizing them would be an important challenge if we wanted to expand this.</p>
        <h4>Metadata gaps</h4>
        <p>The recent scan of thousands of theses from historical figures will be nice sources of
        context, but very little of it has metadata yet. Ideally the fix is to deploy Wikipedian
        energy to other repositories to improve the metadata, not have it curated only inside
        Wikipedia.</p>
        <h4>Bot volume and caching</h4>
        <p>Because of the volume of Wikipedia, to be deployable at any sort of scale, this would
        likely need extensive caching and likely formal agreements with the other data providers.</p>
      </div>
    </div>
  </div></section>
</main>
<footer class="foot"><div class="wrap">
  <p>Generated, not authored. Every page is discovered live from the article’s own anchors and
    streamed as it is found — this server fetches politely, a few pages at a time, and caches what
    it has seen.</p>
  <p>Code is public domain (CC0) in <a href="https://github.com/tieguy/open-graph-next">open-graph-next</a>.
    Article text CC BY-SA 4.0; every item carries its own licence and credit.</p>
  <p>Inspired by conversations with <a href="https://jennierosehalperin.me">Jennie Rose Halperin</a>
    about cooperative knowledge infrastructure and the future of libraries, and by the work of the
    <a href="https://tapestries.media">tapestries.media</a> team.</p>
</div></footer>
</body>
</html>
`
}
