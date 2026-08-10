// The front page of the live demo: the cover of the same publication the
// article pages belong to. Same serif, same hairline rules — recentered on
// the FRIENDS (2026-08-03 review): the partners and what each one gives, not
// the pipeline. The search field stays the one bold element, because "type
// anything" is still the invitation; the mechanism lives in two quiet boxes
// above the footer.

import { escapeHtml } from './html.js'
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
    domain: 'A writer’s life',
    title: 'José Rizal',
    watch:
      'Noli Me Tangere and five more, every one free to read — Wikidata records that his copyrights expired, and each card shows the scan you can open.',
  },
  {
    domain: 'Ecology',
    title: 'Monarch butterfly',
    watch:
      'iNaturalist’s photographs, and GBIF drawing everywhere a monarch has ever been recorded.',
  },
  {
    domain: 'Art',
    title: 'Rembrandt',
    watch:
      'His paintings are scattered across the Met, the Rijksmuseum and the Art Institute — each museum’s own record of what it holds, gathered in one place.',
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
// media; the hosts close the list. The license line states the terms of the
// gift, because the terms ARE part of the story — and it must stay true of
// the data this demo actually uses, not of the organization in general.
//
// **The register was lowered deliberately on 2026-08-06.** The gift lines had
// drifted into advertising — "Gave away the Dutch Golden Age", "Europe's
// answer", "the opinion, not a paywall", "a copy you can borrow tonight" —
// and a page whose whole argument is that these institutions are worth taking
// seriously undercuts itself by selling them. Each line now says plainly what
// the partner contributes to THIS page. Warmth is fine; a pitch is not.
//
// The optional fifth element is a link to the partner's own statement of its
// terms, so the license claim beside it is checkable rather than merely
// asserted — the same ethic as the ⓘ fold on a card, which links the Wikidata
// statement it rests on. Only added where the page has actually been read;
// an unlinked license line means nobody has verified one yet, NOT that the
// partner publishes nothing.
// Grouped since 2026-08-08, when the sixteenth friend made one long run of
// cards unreadable. The groups are reading aids, not taxonomy — a friend that
// could live in two (IIIF serves libraries too) sits where a first-time
// reader would look for it, and the group line makes no claim a card
// doesn't.
const FRIENDS = [
  { group: 'Books and papers', friends: [
  ['internet_archive', 'Internet Archive',
    'Lends the books. A footnote’s ISBN becomes a copy you can borrow.',
    'Public-domain scans free to read; in-copyright books lent, not copied.'],
  ['openlibrary', 'Open Library',
    'Catalogs the editions of a book, and records which ones are free to read.',
    'Open bibliographic data, downloadable in bulk.'],
  ['openalex', 'OpenAlex',
    'Finds a free, legal copy of the paper behind a citation.',
    'Catalog CC0. Only papers with an open copy are shown — each card names its license; closed ones are counted, not carded.'],
  ['arxiv', 'arXiv',
    'Preprints in physics, maths and computing, open from the day they are posted.',
    'Metadata CC0; each paper names its own license.',
    // Their license help page: the submitter picks a license per paper and the
    // choice is irrevocable, which is the half of our claim that matters here.
    'https://arxiv.org/help/license'],
  ]},
  { group: 'Museums and image collections', friends: [
  ['met', 'The Met',
    'Publishes its own record of each object it holds.',
    'Public-domain works released CC0, images included.'],
  ['artic', 'Art Institute of Chicago',
    'Describes the paintings it holds in its own words.',
    'Public-domain images CC0, served over open IIIF.',
    // States the CC0 designation outright, and that the object data is CC0 too.
    'https://www.artic.edu/open-access/open-access-images'],
  ['rijks', 'Rijksmuseum',
    'Publishes its own photographs of its collection at full resolution.',
    'Works out of copyright carry the public-domain mark; images served over open IIIF, catalog data CC0.',
    // Their own announcement of Collection Online, which is the infrastructure
    // this demo actually reads: it states that the data is released as Linked
    // Open Data "in the public domain", links their Information and Data
    // Policy, and recaps the 2012 Rijksstudio release that started it.
    'https://www.rijksmuseum.nl/en/press/press-releases/rijksmuseum-launches-collection-online'],
  ['iiif', 'IIIF collections',
    'A shared protocol: manuscripts and artworks served by whichever institution holds them.',
    'Terms set per object by its holding institution, stated in each manifest.'],
  ['smithsonian', 'the Smithsonian',
    'Nineteen museums, and 3D scans you can turn around of things like the Apollo 11 command module.',
    'Open Access items are CC0: no rights reserved at all.',
    // NOT si.edu's own announcement of the release, which would be the better
    // citation: www.si.edu is challenge-gated, and a real page and an invented
    // one come back indistinguishable (46,677 vs 46,728 bytes of "Smithsonian
    // request verification", 2026-08-06), so it cannot be verified from here.
    // This is the Smithsonian's own Open Access data repository, which states
    // CC0-1.0 as its licence and which does resolve — 200 for the repo, 404 for
    // one that does not exist. A claim we can check beats a better-worded one
    // we cannot. See LUI-128.
    'https://github.com/Smithsonian/OpenAccess'],
  ]},
  { group: 'Union catalogs', friends: [
  ['dpla', 'DPLA',
    'A union catalog of tens of millions of items from US libraries, archives and museums.',
    'Metadata CC0; each item’s rights stated by its holder.'],
  ['europeana', 'Europeana',
    'Around three thousand European museums, libraries and archives, searchable together.',
    'Only openly licensed items are shown; each card names its license.'],
  ['digitalnz', 'DigitalNZ',
    'More than 150 New Zealand libraries, archives and museums, searchable together.',
    'Each item states in plain words what a reader may do with it — but the API’s metadata is non-commercial by default; see the challenges list below.',
    // Their Developer API terms, read 2026-08-08 (via the Wayback Machine —
    // the live page challenge-gates non-browser clients): metadata is NC by
    // default, a keyed commercial track covers "a selection", and the
    // open-license carve-out names only Europeana, DPLA and data.govt.nz —
    // not the NZ collections themselves.
    'https://digitalnz.org/about/terms-of-use/developer-api-terms-of-use'],
  ]},
  { group: 'The living world and the map', friends: [
  ['inaturalist', 'iNaturalist',
    'Photographs of species taken by naturalists, each credited to the observer.',
    'Each photo carries its observer’s chosen license; only openly licensed ones are shown here.'],
  ['gbif', 'GBIF',
    'Maps where a species has been recorded, from hundreds of millions of observations.',
    'Records CC BY-NC, CC BY or CC0, stated per dataset.',
    // Names all three licenses, including the CC BY-NC that our line used to
    // omit and that most occurrence records actually carry.
    'https://www.gbif.org/terms'],
  ['openstreetmap', 'OpenStreetMap',
    'A map of the world built by volunteers, detailed down to individual buildings.',
    'Map data ODbL: share-alike, credit the contributors.',
    // Says share-alike and credit in almost the same words we do.
    'https://www.openstreetmap.org/copyright'],
  ]},
  { group: 'The public record', friends: [
  ['free_law', 'Free Law Project',
    'Publishes court opinions in full, free to read.',
    'Court opinions are public domain: nobody owns the law.'],
  ]},
]

// Wikimedia Commons is deliberately not on this list (2026-08-04). It is not
// a friend of Wikipedia's, it is part of Wikipedia's own household — and on
// these pages it was drowning everyone else out, ~85% of every page's cards.
// Worse, it undercut the argument the pages exist to make: Commons is the
// single door through which an outside institution's work must pass to be
// seen here, and it arrives on the other side as a Commons file rather than
// as theirs. Shelving it beside the Met implied the two were peers. It now
// appears on an article page only where it truthfully belongs — named in the
// visibility panel as the door. See LUI-122 and src/gap.js.

const wikiHref = (title) => `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

/**
 * The articles the front page links to, for anything that needs the same list.
 * Derived from SHOWCASE rather than written out again: `warm.js` re-warms
 * exactly these after a deploy, and a second hand-maintained copy would drift
 * the first time a showcase article changed.
 */
export const showcaseTitles = () => SHOWCASE.map((c) => c.title)

/**
 * The showcase as cards. Written once because two pages make the same promise:
 * the front page's "ready now" grid and the busy page's (below), which is the
 * one place a reader meets that promise while the demo is refusing everything
 * else.
 */
const showcaseCards = () =>
  SHOWCASE.map(
    (c) => `<a class="show" href="${wikiHref(c.title)}">
  <span class="dom">${escapeHtml(c.domain)}</span>
  <span class="art">${escapeHtml(c.title)}</span>
  <span class="watch">${escapeHtml(c.watch)}</span>
</a>`,
  ).join('\n')

/** The grid those cards sit in, shared for the same reason they are. */
const CARD_STYLE = `.ready{font-size:.8rem;color:var(--muted);margin:22px 0 10px}
.ready .chip{display:inline-block;font-size:.62rem;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--manila-ink);background:var(--manila);
  border:1px solid var(--manila-rule);border-radius:8px;padding:0 8px;margin-right:7px;
  vertical-align:1px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;margin:0 0 8px}
.show{display:block;text-decoration:none;color:inherit;border:1px solid var(--rule);
  border-radius:4px;background:var(--bg);padding:10px 12px 12px;min-width:0}
.show:hover,.show:focus-visible{border-color:var(--link)}
.show:hover .art,.show:focus-visible .art{color:var(--link);text-decoration:underline}
.show:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.dom{display:block;font-size:.62rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.art{display:block;font-family:var(--serif);font-size:1.15rem;line-height:1.2;color:var(--head);
  margin-bottom:5px}
.art::after{content:" →";color:var(--rule)}
.show:hover .art::after{color:var(--link)}
.watch{display:block;font-size:.75rem;line-height:1.5;color:var(--muted)}`

export function frontPage({ inline = new Map() } = {}) {
  const legend = sourceLegend(inline)
  const cards = showcaseCards()
  const friendCard = ([slug, name, gift, lic, licHref]) => `<div class="friend">
  <p class="who"><span class="fav fav-${slug}"></span>${escapeHtml(name)}</p>
  <p class="gift">${escapeHtml(gift)}</p>
  <p class="lic"><span class="lic-mark">openness?</span> ${escapeHtml(lic)}${
    licHref
      ? ` <a class="lic-src" href="${escapeHtml(licHref)}">in their words</a>`
      : ''
  }</p>
</div>`
  // Group headings are full-width rows INSIDE the one grid, so the card
  // columns stay aligned from group to group instead of each group finding
  // its own widths.
  const friends = FRIENDS.map(
    ({ group, friends: list }) =>
      `<h3 class="friends-cat">${escapeHtml(group)}</h3>\n${list.map(friendCard).join('\n')}`,
  ).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Help From Our Friends — an open knowledge web experiment</title>
<style>
:root{
  --bg:#faf9f6; --paper:#fffefb; --ink:#202122; --head:#101210; --muted:#555a55;
  --rule:#cfcac0; --faint:#f0ede6; --link:#33684b;
  --manila:#f2e8d5; --manila-rule:#d8c9a4; --manila-ink:#5c5233;
  --serif:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
/* The article skin's bones (2026-08-08 rebuild): 15px sans body, serif
   headings, one white column on the warm ground — the cover of the same
   publication the article pages belong to, not a separate magazine. */
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.65}
a{color:var(--link)}
a:hover{text-decoration:underline}
.page{max-width:1000px;margin:0 auto;background:var(--paper);
  border:1px solid var(--rule);border-width:0 1px}
.wrap{padding:0 32px;min-width:0}
/* The same site strip the article pages open with — chrome, in our voice. */
.kicker{font-size:.8rem;line-height:1.5;color:var(--muted);margin:0 -32px 20px;
  padding:9px 32px;border-bottom:1px solid var(--rule);background:var(--bg)}
.kicker a{color:var(--link);font-weight:600;text-decoration:none}
.kicker a:hover{text-decoration:underline}
.hero{padding:0 0 8px}
h1{font-family:var(--serif);font-size:clamp(2rem,4vw,2.7rem);line-height:1.1;
  margin:.3em 0 12px;color:var(--head);font-weight:400}
.lede{font-size:.95rem;line-height:1.6;max-width:74ch;margin:0 0 6px;color:#3a3f45}
.lede b{color:var(--head)}

/* The search field is the thesis: an encyclopedia headword waiting to be
   written. Serif, oversized, underlined like an entry — not a widget. */
.ask{margin:20px 0 6px;max-width:44rem}
/* appearance:none and the two ::-webkit-search-* rules undo what type=search
   brings with it — Safari's inset chrome and the little grey clear button —
   so the field keeps reading as an encyclopedia headword rather than a widget. */
.ask input{width:100%;background:transparent;border:0;border-bottom:2px solid var(--ink);
  font-family:var(--serif);font-size:clamp(1.3rem,2.8vw,1.9rem);color:var(--head);
  padding:6px 2px 10px;border-radius:0;appearance:none;-webkit-appearance:none}
.ask input::-webkit-search-decoration,
.ask input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.ask input::placeholder{color:#b6babf;font-style:italic}
.ask input:focus{outline:none;border-bottom-color:var(--link)}
.ask input:focus-visible{outline:2px solid var(--link);outline-offset:6px}
.hint{font-family:var(--sans);font-size:.78rem;color:var(--muted);margin:10px 0 0}
.hint kbd{font-family:var(--sans);border:1px solid var(--rule);border-bottom-width:2px;
  border-radius:4px;padding:0 5px;background:var(--paper);font-size:.72rem}

.section{padding:6px 0 22px}
.section h2{font-family:var(--serif);font-size:1.5rem;line-height:1.3;font-weight:400;
  color:var(--head);margin:1em 0 16px;padding-bottom:.17em;border-bottom:1px solid var(--rule)}
/* The ready line: the six warm pages, named as such. A manila chip because a
   statement about availability is the friends' voice, not the article's.
   Shared with the busy page — see CARD_STYLE. */
${CARD_STYLE}

.friends{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 44px}
.friends-cat{grid-column:1/-1;font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);font-weight:700;margin:34px 0 6px}
.friends-cat:first-child{margin-top:0}
.friend{border-top:1px solid var(--rule);padding:18px 0 22px;min-width:0}
.friend .who{display:flex;align-items:center;gap:10px;font-weight:700;
  font-size:.92rem;color:var(--head);margin:0 0 6px}
.fav{width:18px;height:18px;flex:none;border-radius:3px;background:#fff no-repeat center;
  background-size:contain;display:inline-block}
.friend .gift{font-size:.88rem;line-height:1.55;color:#3a3f45;margin:0;max-width:36ch}
.friend .lic{font-family:var(--sans);font-size:.72rem;line-height:1.5;color:var(--muted);
  margin:7px 0 0;max-width:40ch}
.lic-mark{display:inline-block;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;
  color:var(--manila-ink);background:var(--manila);border:1px solid var(--manila-rule);
  border-radius:8px;padding:0 7px;margin-right:5px}
/* The source of the license claim beside it. Deliberately quiet — it is
   evidence for a line the reader may not have doubted, not a call to action. */
.lic-src{white-space:nowrap}
.friend.host{grid-column:1/-1}
.friend.host .gift{max-width:none;font-style:italic;color:var(--muted)}
${legend.style}
.boxes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.box{background:var(--bg);border:1px solid var(--rule);border-radius:4px;padding:20px 24px;min-width:0}
.box h3{font-family:var(--sans);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--head);margin:0 0 10px}
.box p{font-family:var(--sans);font-size:.88rem;line-height:1.65;color:#3a3f45;margin:0 0 10px}
.box p:last-child{margin-bottom:0}
.box h4{font-family:var(--serif);font-size:1.02rem;margin:16px 0 4px;color:var(--head)}

.foot{font-size:.8rem;color:var(--muted)}
.foot-wrap{padding-top:14px;padding-bottom:40px;border-bottom:1px solid var(--rule)}
.foot p{max-width:80ch;margin:0 0 8px;padding-top:0}
.foot p:first-child{border-top:1px solid var(--rule);padding-top:14px}

@media(max-width:960px){.grid,.friends{grid-template-columns:repeat(2,minmax(0,1fr))}.boxes{grid-template-columns:minmax(0,1fr)}}
@media(max-width:900px){.wrap{padding:0 20px}.kicker{margin:0 -20px 18px;padding:9px 20px}}
@media(max-width:640px){
  .wrap{padding:0 14px}
  .kicker{margin:0 -14px 16px;padding:8px 14px}
  .hero{padding:0 0 8px}
  .grid,.friends{grid-template-columns:minmax(0,1fr)}
}
</style>
</head>
<body>
<div class="page">
<header class="hero"><div class="wrap">
  <p class="kicker">Help From Our Friends · an experiment in visualizing open knowledge, by <a href="https://lu.is">Luis Villa</a></p>
  <h1>Wikipedia is not alone.</h1>
  <p class="lede">Alongside every Wikipedia article there is a wider open world: libraries that lend,
    museums that publish their own collections, scientists who post their papers openly, mappers and
    naturalists who chart the planet for free. This experiment invites them in.
    <b>Pick an article, and see who else is out there.</b></p>
  <form class="ask" role="search" onsubmit="location.href='/wiki/'+encodeURIComponent(this.q.value.trim().replace(/ /g,'_'));return false">
    <!-- type=search and role=search are the standards-based half of telling a
         password manager this is not a login: a lone untyped input in a form,
         with autofocus, is exactly the shape they read as a username box. The
         data- attributes are the vendor opt-outs (1Password, LastPass,
         Bitwarden, Dashlane), inert everywhere else. -->
    <!-- "try your hometown" was the invitation until 2026-08-06, and it pointed
         readers at the THINNEST page this site makes. A town resolves to a map,
         a subject heading and little else — Coral Gables renders ~14 cards —
         while a species renders 96 and an artist 116, because both have
         partners holding item-level records of the thing itself. The first
         thing a visitor types decides what they think this is, so it should
         name the cases that answer best. -->
    <input name="q" type="search" placeholder="Any article title — try a species, or an artist" autofocus
      autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
      data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"
      aria-label="English Wikipedia article title">
    <p class="hint">Press <kbd>Enter</kbd>. The article arrives in a second; its friends stream in behind it.</p>
  </form>
  <p class="ready"><span class="chip">ready now</span>Six articles are already rendered and cached — they open at once:</p>
  <div class="grid">
${cards}
  </div>
</div></header>
<main>
  <section class="section"><div class="wrap">
    <h2>Current friends, what they bring, and how they’re licensed</h2>
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
    <h2>How it works, and where it strains</h2>
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
        article&rsquo;s links, its cards split into one labeled shelf per link — and in the opening
        section, works <i>by</i> the subject never share a shelf with works merely <i>cited</i>
        there.</p>
      </div>
      <div class="box">
        <h3>Challenges and future opportunities</h3>
        <p>This is a demo and not intended for production. Among other challenges:</p>
        <h4>There is nowhere for most of this to go</h4>
        <p>Each article page carries a fold — <i>Who helped, and who Wikipedia doesn’t show</i> —
        sorting the friends who filled it into three states: shown and credited, a link only, or
        invisible. Almost everyone lands in the last two, and the reason is the same every time, so
        it is written here once rather than on every page.</p>
        <p>Today, Wikipedia has one established route for putting an outside picture in an article:
        the file must first be handed to Wikimedia, and from then on it is a Wikimedia file rather
        than theirs. Every picture in every article arrived that way. Maps are the single
        exception — OpenStreetMap is the only project outside Wikimedia that a Wikipedia article
        puts on the page and credits by name. Everyone else chooses between handing the work over
        and losing the relationship, or taking a line of text at the bottom. No established route
        lets them show you what they hold <i>and</i> say it is theirs.</p>
        <p>Note what is <i>not</i> being claimed: there is always a route, because a bare external
        link is always possible. What is missing is a route that keeps the content and the credit
        together. And nothing here says Wikipedia <i>cannot</i> — only that it does not. That is a
        fact about established practice, and practice can change.</p>
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
        <h4>Rights nobody has determined</h4>
        <p>Some items arrive with an honest non-answer: the institution has recorded that the
        rights status is unknown, or not yet evaluated. These render here with a small ? mark and
        the institution’s own words behind a click — treated, for now, as peers of the openly
        licensed material, because a recorded open question is a fact about the collection and
        silence would hide it. At scale this is a real challenge: a reader wants to know what they
        may do, and “nobody knows” satisfies no one. The durable fix is rights-clearing work of the
        kind CopyClear and Dominio Público en América Latina do on Wikidata; a demo can only keep
        the question visible.</p>
        <h4>Terms on the pipes, not just the items</h4>
        <p>An item can be openly licensed while the API that serves it is not. DigitalNZ, for
        example: its developer terms make the API&rsquo;s metadata non-commercial by default.
        (There is a commercial tier, but it needs a key and covers only some of the metadata. The
        exceptions for already-open metadata are Europeana, DPLA and data.govt.nz — everything
        except the New Zealand collections themselves.) That&rsquo;s fine for this demo, which
        makes no money. It&rsquo;s a real problem for the goal. Wikipedia lets anyone reuse what
        it publishes, commercially included, so nothing built on a non-commercial API can ever
        become part of Wikipedia — or of anything Wikipedia-like. Getting there would take new
        terms, or an agreement, negotiated source by source. And every source we add makes that
        list longer.</p>
        <h4>Bot volume and caching</h4>
        <p>Because of the volume of Wikipedia, to be deployable at any sort of scale, this would
        likely need extensive caching and likely formal agreements with the other data providers.</p>
      </div>
    </div>
  </div></section>
</main>
<footer class="foot"><div class="wrap foot-wrap">
  <p>Generated, not authored. Every page is discovered live from the article’s own anchors and
    streamed as it is found — this server fetches politely, a few pages at a time, and caches what
    it has seen.</p>
  <p>Code is public domain (CC0) in <a href="https://github.com/tieguy/open-graph-next">open-graph-next</a>.
    Article text CC BY-SA 4.0; every item carries its own license and credit.</p>
  <p>Copyright status comes from
    <a href="https://www.wikidata.org/wiki/Wikidata:CopyClear">CopyClear</a> and
    <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina">Dominio
    Público en América Latina</a>, via Wikidata and
    <a href="https://paulina.toolforge.org">Paulina</a>.</p>
  <p>Inspired by conversations with <a href="https://jennierosehalperin.me">Jennie Rose Halperin</a>
    about cooperative knowledge infrastructure and the future of libraries, and by the work of the
    <a href="https://tapestries.media">tapestries.media</a> team.</p>
</div></footer>
</div>
</body>
</html>
`
}

/**
 * The page a visitor gets when every discovery slot is taken (serve.js, 503).
 *
 * It used to be one sentence of system-ui on a blank page — true, and a dead
 * end: a reader who wanted to see what this demo does was told to come back
 * later by a site that had six finished pages sitting warm on disk. It now
 * makes the same "ready now" offer the front page makes, with the same cards,
 * and that offer is not decoration — `src/admission.js` keeps a reserve of
 * slots for exactly these six, so the links here are open when this page is
 * being served. A busy page linking to pages that would also answer 503 would
 * be worse than the dead end it replaced.
 *
 * Rendered once at startup, like the front page: the moment this page is
 * needed is the moment the server has no capacity to build anything.
 */
export function busyPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Busy just now — Help From Our Friends</title>
<style>
:root{
  --bg:#faf9f6; --paper:#fffefb; --ink:#202122; --head:#101210; --muted:#555a55;
  --rule:#cfcac0; --link:#33684b;
  --manila:#f2e8d5; --manila-rule:#d8c9a4; --manila-ink:#5c5233;
  --serif:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.65}
a{color:var(--link)}
a:hover{text-decoration:underline}
.page{max-width:1000px;margin:0 auto;background:var(--paper);
  border:1px solid var(--rule);border-width:0 1px;padding-bottom:40px}
.wrap{padding:0 32px;min-width:0}
.kicker{font-size:.8rem;line-height:1.5;color:var(--muted);margin:0 -32px 20px;
  padding:9px 32px;border-bottom:1px solid var(--rule);background:var(--bg)}
.kicker a{color:var(--link);font-weight:600;text-decoration:none}
.kicker a:hover{text-decoration:underline}
h1{font-family:var(--serif);font-size:clamp(1.7rem,3.4vw,2.3rem);line-height:1.15;
  margin:.4em 0 12px;color:var(--head);font-weight:400}
.lede{font-size:.95rem;line-height:1.6;max-width:74ch;margin:0 0 6px;color:#3a3f45}
${CARD_STYLE}
.after{font-size:.8rem;color:var(--muted);margin:18px 0 0;max-width:74ch}
@media(max-width:960px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.wrap{padding:0 20px}.kicker{margin:0 -20px 18px;padding:9px 20px}}
@media(max-width:640px){
  .wrap{padding:0 14px}
  .kicker{margin:0 -14px 16px;padding:8px 14px}
  .grid{grid-template-columns:minmax(0,1fr)}
}
</style>
</head>
<body>
<div class="page"><div class="wrap">
  <p class="kicker"><a href="/">Help From Our Friends</a> · an experiment in visualizing open knowledge</p>
  <h1>Busy discovering, just now.</h1>
  <p class="lede">The demo is busy discovering other pages right now — it fetches politely, a few at a
    time. Try again in a moment.</p>
  <p class="ready"><span class="chip">ready now</span>These six are already rendered and cached, and
    the demo keeps room for them even while it is busy:</p>
  <div class="grid">
${showcaseCards()}
  </div>
  <p class="after">Everything else — who the friends are, what each one gives, and how any of this
    works — is on <a href="/">the front page</a>, which needs no discovery at all.</p>
</div></div>
</body>
</html>
`
}
