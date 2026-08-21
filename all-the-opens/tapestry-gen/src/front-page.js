// The front page of the live demo: the cover of the same publication the
// article pages belong to. Same serif, same hairline rules — recentered on
// the FRIENDS (2026-08-03 review): the partners and what each one gives, not
// the pipeline. The search field stays the one bold element, because "type
// anything" is still the invitation.
//
// Everything below the showcase is an FAQ as of 2026-08-13. The friends list
// and the two mechanism boxes were three blocks of prose under headings
// nobody had asked for; the same words behind a question let a reader spend
// their attention where their curiosity already is — and the two questions
// that had no answer here at all, why this exists and what it has to do with
// LLMs, are now the first two.

import { escapeHtml } from './html.js'
import { PARTNERS } from './partners.js'
import { ogMeta, sourceLegend } from './emit-html.js'

const OG_DESCRIPTION =
  'Alongside every Wikipedia article there is a wider open world: libraries that lend, ' +
  'museums that publish their own collections, scientists who post their papers openly, ' +
  'and mappers and naturalists who chart the planet for free.'

// The showcase, compressed (2026-08-13). Each card used to carry a sentence
// describing a page the reader had not opened yet; a card of prose apiece is an essay
// standing between a visitor and the first click. A card now says three
// things — the article, the one addition worth arriving for, and who else
// turned up — so the row can be scanned instead of read.
//
// `friends` is HAND-WRITTEN, and this file cannot check it. The front page is
// built once at startup, before any showcase page has been discovered, so the
// only way to derive the row would be the whole showcase's worth of partner
// requests at boot — spending their capacity to draw logos. It is therefore a
// claim to re-check by eye whenever the showcase changes or a partner stops
// answering; a live page is the authority, not this list. A test does assert
// that every slug names a friend this page lists, which catches a rename but
// cannot catch drift. Each row deliberately OMITS the partner named in
// `adds` — "other friends" means the ones the headline did not already say.
// The count, spelled, for the one sentence that still prints a cache
// promise: the busy page's ("These nine are already rendered and stored"),
// over the same nine cards the front page shows. The front page's grid line
// names no number and makes no cache claim (the operator's call,
// 2026-08-20: the promise is good — the warm walk and the admission
// reserve are unchanged — it just does not need stating there). Extend
// this table when a card joins a list: past its end the count degrades to
// digits, and the one guard left is the busy-page test pinning the literal
// "These nine". The number is also hand-spelled where no test derives it —
// twice in this very comment, in the .ready CSS comment below ("nine-card
// grid"), in the showcaseCard docblock ("two pages show the same nine
// cards"), in the busyPage docblock ("shows the same nine cards as the
// front page"), and in CLAUDE.md's busy-page paragraph (the printed
// sentence itself) and its warming and reserve sections (the walk's nine,
// six plus three) — update all of them in the same edit as a card change.
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const storedCount = () =>
  COUNT_WORDS[SHOWCASE.length + HOLDER_SHOWCASE.length] ??
  String(SHOWCASE.length + HOLDER_SHOWCASE.length)

const SHOWCASE = [
  {
    // The 3D cards name their format in the description, not the small-caps
    // bar (the operator's line edit, 2026-08-20): glTF is Voyager's package
    // format — every 3d_voyager scan ships it (see the Smithsonian entry in
    // CLAUDE.md) — and .adds keeps its casing without any exemption.
    domain: 'Aviation',
    title: 'Wright Flyer',
    group: 'History and the public record',
    adds: '3D models from the Smithsonian, using glTF',
    friends: ['dpla', 'europeana', 'digitalnz', 'openstreetmap'],
  },
  {
    domain: 'Law',
    title: 'Brown v. Board of Education',
    group: 'History and the public record',
    adds: 'case text from Free Law Project',
    friends: ['internet_archive', 'openlibrary', 'dpla', 'openstreetmap'],
  },
  {
    domain: 'A writer’s life',
    title: 'José Rizal',
    group: 'History and the public record',
    adds: 'books from Open Library',
    friends: ['internet_archive', 'dpla'],
  },
  {
    domain: 'Ecology',
    title: 'Monarch butterfly',
    group: 'Science and the living world',
    adds:
      'photographs from iNaturalist and observation maps from Global Biodiversity ' +
      'Information Facility',
    // GBIF moves out of this row because the line above now names it — see the
    // rule at the head of SHOWCASE.
    friends: ['dpla'],
  },
  {
    domain: 'Open science',
    title: 'CRISPR gene editing',
    group: 'Science and the living world',
    adds: 'open copies of cited papers from OpenAlex',
    friends: ['arxiv', 'internet_archive'],
  },
  {
    domain: 'Natural history',
    title: 'Common seadragon',
    group: 'Science and the living world',
    adds: 'a 3D scan of the Smithsonian’s specimen, using glTF',
    // Read off the rendered page 2026-08-20, per the hand-written rule above.
    friends: ['inaturalist', 'gbif', 'dpla', 'internet_archive'],
  },
]

// The Art group (the operator's front-page call, 2026-08-20; regrouped the
// same day): articles that ARE a held work render as two-party pages, and
// these three — one per museum worth meeting first — are that group,
// standing beside the other groups as peers rather than as an appendix.
// `holder` is the partner slug, for the icon and the small-caps masthead
// echo; the `adds` lines follow the no-pitch register rule above. These
// cards make the same ready-now promise the whole grid makes, and the same
// mechanisms back it: the titles ride the boot warm walk and warm.js's
// default walk (bootWarmTitles in src/warming.js) and the admission
// reserve's title set (src/admission.js).
const HOLDER_SHOWCASE = [
  {
    title: 'The Night Watch',
    holder: 'rijks',
    adds: 'the Rijksmuseum’s record of the painting, merged into the infobox via IIIF',
  },
  {
    title: "Hours of Jeanne d'Evreux",
    holder: 'met',
    adds: 'the Met’s record of the manuscript, and a link to its 210 beautiful pages, merged into the infobox',
  },
  {
    title: 'Spinola Hours',
    holder: 'getty',
    adds: 'the Getty’s record of the book of hours (via IIIF) merged into the infobox, and six more works by its illuminator',
  },
]

export const holderShowcaseTitles = () => HOLDER_SHOWCASE.map((c) => c.title)

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
// Grouped since 2026-08-08, when the sixteenth friend made one long run of
// cards unreadable. The groups are reading aids, not taxonomy — a friend that
// could live in two (IIIF serves libraries too) sits where a first-time
// reader would look for it, and the group line makes no claim a card
// doesn't.
//
// Grouping and order are this page's editorial call — which shelf a
// first-time reader would look for a friend on, and who reads before whom
// (DigitalNZ's line says "that same heading" because DPLA's precedes it).
// Everything SAID about a friend — what it gives, its terms, the optional
// `cite` link to its own statement of those terms (only where that page has
// actually been read; a missing cite means nobody has verified one yet, NOT
// that the partner publishes nothing) — lives in the partner manifest,
// src/partners.js.
const FRIEND_GROUPS = [
  { group: 'Books and papers', slugs: ['internet_archive', 'openlibrary', 'openalex', 'arxiv'] },
  { group: 'Museums and image collections', slugs: ['met', 'artic', 'rijks', 'cleveland', 'getty', 'iiif', 'smithsonian'] },
  { group: 'Union catalogs', slugs: ['dpla', 'europeana', 'digitalnz'] },
  { group: 'The living world and the map', slugs: ['inaturalist', 'gbif', 'openstreetmap'] },
  { group: 'The public record', slugs: ['free_law'] },
]

const FRIENDS = FRIEND_GROUPS.map(({ group, slugs }) => ({
  group,
  friends: slugs.map((slug) => {
    const p = PARTNERS[slug]
    return [slug, p.friend.name ?? p.name, p.friend.gives, p.friend.terms, p.friend.cite]
  }),
}))

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
 * Slug → the name this page calls that friend, read off FRIENDS rather than
 * written again: the showcase rows and the friends list must say the same
 * name for the same partner, and the icon row's accessible label is that name.
 */
const FRIEND_NAMES = new Map(
  FRIENDS.flatMap(({ friends }) => friends.map(([slug, name]) => [slug, name])),
)

/**
 * A showcase card's "other friends" row: logos, because the row's job is to
 * show at a glance how MANY different institutions turn up on one article —
 * six names in 11px grey would be read as a list and skipped.
 *
 * The logos are decoration to a screen reader (`aria-hidden` rides the class
 * used everywhere else on this page), so the row carries the names as one
 * label. `title` gives the same answer to a mouse.
 */
const friendIcons = (slugs) => {
  const names = slugs.map((s) => FRIEND_NAMES.get(s) ?? s)
  const marks = slugs
    .map(
      (s, i) =>
        `<span class="fav fav-${s}" title="${escapeHtml(names[i])}" aria-hidden="true"></span>`,
    )
    .join('')
  return `<span class="favs" role="img" aria-label="${escapeHtml(names.join(', '))}">${marks}</span>`
}

/**
 * The articles the front page links to, for anything that needs the same list.
 * Derived from SHOWCASE rather than written out again: `warm.js` re-warms
 * exactly these after a deploy, and a second hand-maintained copy would drift
 * the first time a showcase article changed.
 */
export const showcaseTitles = () => SHOWCASE.map((c) => c.title)

/**
 * The showcase as cards. Written once because two pages show the same nine
 * cards: the front page (in its grouped grid) and the busy page (flat).
 * Only the busy page prints a cache promise over them — so an edit to a
 * card's wording reaches both pages, deliberately.
 */
const showcaseCard = (c) => `<a class="show" href="${wikiHref(c.title)}">
  <span class="dom">${escapeHtml(c.domain)}</span>
  <span class="art">${escapeHtml(c.title)}</span>
  <span class="adds"><b>Adds:</b> ${escapeHtml(c.adds)}</span>
  <span class="also"><b>Other friends:</b>${friendIcons(c.friends)}</span>
</a>`

const showcaseCards = () => SHOWCASE.map(showcaseCard).join('\n')

/**
 * The held-work cards. Same card grammar as the showcase, with the two
 * differences a two-party page earns: the small-caps line names the
 * institution alone ("Wikipedia +" would say nothing — every page on this
 * site is Wikipedia plus someone — and the open standards this site wants
 * to demonstrate, IIIF and glTF, live in the `adds` prose where the
 * operator's line edits put them, 2026-08-20; a standard named there must
 * still be one the lane actually speaks, per CLAUDE.md's Key Files). The
 * foot row names ONE friend, because having exactly one is the point.
 * `show held` rather than `show`, so the counts that pin the showcase
 * grid stay exact. The institution name reads PARTNERS[..].name — the
 * same source the masthead prints through the holder record — so the
 * card and the page it opens cannot disagree.
 */
const holderCards = (held = HOLDER_SHOWCASE) =>
  held.map(
    (c) => `<a class="show held" href="${wikiHref(c.title)}">
  <span class="dom">${escapeHtml(PARTNERS[c.holder].name)}</span>
  <span class="art">${escapeHtml(c.title)}</span>
  <span class="adds"><b>Adds:</b> ${escapeHtml(c.adds)}</span>
  <span class="also"><b>The friend:</b>${friendIcons([c.holder])}</span>
</a>`,
  ).join('\n')

// The grid's reading order: two showcase groups, then the Art group — the
// held works. Group rows are reading aids exactly like the friends list's
// below. A test asserts every SHOWCASE entry names a group in this list,
// so a card cannot silently fall out of the grid.
export const GROUP_ORDER = ['History and the public record', 'Science and the living world']
export const ungroupedShowcaseTitles = () =>
  SHOWCASE.filter((c) => !GROUP_ORDER.includes(c.group)).map((c) => c.title)
// Group rows are <p>, not headings: they are reading aids inside the hero,
// and a heading here would sit at no level — the page's outline runs h1
// (the masthead) straight to the FAQ's h2. A group no card claims renders
// nothing, heading included — the Art group too. The list parameters exist
// for the test that pins exactly that; the page always renders the real
// lists.
export const groupedShowcase = (showcase = SHOWCASE, held = HOLDER_SHOWCASE) =>
  [
    ...GROUP_ORDER.map((g) => {
      const cards = showcase.filter((c) => c.group === g)
      if (!cards.length) return ''
      return `<p class="show-cat">${escapeHtml(g)}</p>\n` + cards.map(showcaseCard).join('\n')
    }),
    held.length ? `<p class="show-cat">Art</p>\n` + holderCards(held) : '',
  ]
    .filter(Boolean)
    .join('\n')

/** The grid those cards sit in, shared for the same reason they are. */
const CARD_STYLE = `.ready{font-size:.8rem;color:var(--muted);margin:22px 0 10px}

.ready .chip{display:inline-block;font-size:.62rem;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--manila-ink);background:var(--manila);
  border:1px solid var(--manila-rule);border-radius:8px;padding:0 8px;margin-right:7px;
  vertical-align:1px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;margin:0 0 8px}
/* A column, so the logo rows line up across a row of cards however long the
   "Adds:" line runs — six ragged icon rows read as six unrelated cards. */
.show{display:flex;flex-direction:column;text-decoration:none;color:inherit;
  border:1px solid var(--rule);border-radius:4px;background:var(--bg);
  padding:10px 12px 12px;min-width:0}
.show:hover,.show:focus-visible{border-color:var(--link)}
.show:hover .art,.show:focus-visible .art{color:var(--link);text-decoration:underline}
.show:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.dom{display:block;font-size:.62rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.art{display:block;font-family:var(--serif);font-size:1.15rem;line-height:1.2;color:var(--head);
  margin-bottom:5px}
.art::after{content:" →";color:var(--rule)}
.show:hover .art::after{color:var(--link)}
.adds{display:block;font-size:.75rem;line-height:1.5;color:var(--muted)}
.adds b,.also b{font-weight:600;color:#3a3f45}
.also{display:flex;align-items:center;flex-wrap:wrap;gap:4px 7px;font-size:.75rem;
  color:var(--muted);margin-top:auto;padding-top:9px}
.favs{display:flex;align-items:center;gap:5px}
/* Shared with the friends list below, and needed here too: the busy page
   renders these cards with no friends list under them. */
.fav{width:18px;height:18px;flex:none;border-radius:3px;background:#fff no-repeat center;
  background-size:contain;display:inline-block}
.also .fav{width:16px;height:16px}`

export function frontPage({ inline = new Map(), siteOrigin = '' } = {}) {
  const legend = sourceLegend(inline)
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
${ogMeta({
    title: 'Help From Our Friends — an open knowledge web experiment',
    description: OG_DESCRIPTION,
    path: '/',
    siteOrigin,
  })}
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
/* .ready is the grid's intro line. On the front page it introduces the
   variety and claims nothing about caching (the operator's call,
   2026-08-20 — the promise is real, the warm walk and reserve back it,
   the sentence just does not state it); on the busy page it still wears
   the manila chip and prints the cache promise over its nine-card grid,
   and CARD_STYLE keeps the chip rule for exactly that. */
${CARD_STYLE}

.friends{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 44px}
.friends-cat{grid-column:1/-1;font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);font-weight:700;margin:34px 0 6px}
.friends-cat:first-child{margin-top:0}
/* The showcase grid's group rows: the friends list's reading-aid pattern,
   tighter, because these sit inside the header rather than a section. */
.show-cat{grid-column:1/-1;font-family:var(--sans);font-size:.68rem;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);font-weight:700;margin:14px 0 0}
.show-cat:first-child{margin-top:0}
.friend{border-top:1px solid var(--rule);padding:18px 0 22px;min-width:0}
.friend .who{display:flex;align-items:center;gap:10px;font-weight:700;
  font-size:.92rem;color:var(--head);margin:0 0 6px}
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
/* The questions. Everything below the showcase is somebody's question about
   this experiment, answered — which is what the two side-by-side boxes were
   already doing without saying so, and what the friends list was doing under
   a heading nobody had asked for. A question makes the answer optional: a
   reader can decide, in six words, whether the next four paragraphs are for
   them. The index is here for the same reason and does the same work a
   contents list does on an article page. */
.qindex{list-style:none;margin:20px 0 0;padding:0;font-size:.85rem;
  border-top:1px solid var(--rule)}
.qindex li{border-bottom:1px solid var(--faint);padding:7px 0}
.qindex a{text-decoration:none}
.qindex a:hover{text-decoration:underline}
.faq h2{margin-top:1.6em}
.faq h3{font-family:var(--serif);font-size:1.06rem;font-weight:400;margin:20px 0 4px;
  color:var(--head)}
.faq p{font-size:.9rem;line-height:1.7;color:#3a3f45;margin:0 0 11px;max-width:74ch}
.faq ul.why{margin:0 0 12px;padding-left:1.15em;max-width:74ch}
.faq ul.why li{font-size:.9rem;line-height:1.7;color:#3a3f45;margin:0 0 10px}
.faq ul.why b{color:var(--head)}

.foot{font-size:.8rem;color:var(--muted)}
.foot-wrap{padding-top:14px;padding-bottom:40px;border-bottom:1px solid var(--rule)}
.foot p{max-width:80ch;margin:0 0 8px;padding-top:0}
.foot p:first-child{border-top:1px solid var(--rule);padding-top:14px}

@media(max-width:960px){.grid,.friends{grid-template-columns:repeat(2,minmax(0,1fr))}}
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
  <p class="ready">A variety of articles, chosen to show off both the cool stuff they bring in,
    and the open institutions and technologies they build on:</p>
  <div class="grid">
${groupedShowcase()}
  </div>
</div></header>
<main>
  <section class="section faq"><div class="wrap">
    <h2>Frequently asked questions</h2>
    <ul class="qindex">
      <li><a href="#why">Why did you build this?</a></li>
      <li><a href="#how">How does it work?</a></li>
      <li><a href="#llms">Can this protect Wikipedia from LLMs?</a></li>
      <li><a href="#link">How do you link the article to knowledge from other sources?</a></li>
      <li><a href="#friends">Who are the friends, and how is their work licensed?</a></li>
      <li><a href="#challenges">What are the challenges?</a></li>
    </ul>

    <h2 id="why">Why did you build this?</h2>
    <p>I build this for many different reasons, which makes it hard to explain. But among
    others:</p>
    <ul class="why">
      <li><b>&ldquo;Open knowledge&rdquo; has become such a diffuse thing</b> that it is hard even
      for its advocates to visualize it. I wanted something that shows it whole.</li>
      <li><b>Wikipedia is isolated, and that&rsquo;s a problem.</b> The best way I know to fix
      that is by demonstrating what would be cool about a wiki with strong ties to the rest of
      open.</li>
      <li><b>I wanted to understand the possibilities of a tightly-knit open.</b> The best way I
      know to learn has always been to learn-by-doing, and that&rsquo;s more fun than ever right
      now.</li>
    </ul>

    <h2 id="how">How does it work?</h2>
    <p>When you load an article, this service scans it and extracts Wikidata information,
    citations, and other sources of metadata. It then uses those data points to find what our
    friends have to say.</p>
    <p>This is not trivial, so it can be slow and would need to be re-engineered to work on the
    real Wikipedia. But the information is all as real and accurate as Wikipedia and our friends
    have made it.</p>

    <h2 id="llms">Can this protect Wikipedia from LLMs?</h2>
    <p>Maybe! One theory of the near-future is that <b>human curation</b> will be rarer, but more
    valuable. If that&rsquo;s true, one way to strengthen open knowledge might be to highlight
    — and tighten — the connections between curators.</p>
    <p>We&rsquo;re blessed to live in a time of great abundance of such people. iNaturalist has
    built an awesome community — we should elevate them as peers in our work. The Met and the
    Rijksmuseum have some of the most skilled curators on the planet, and their material is
    freely given to all of us. A world in which we treat them as peers who work with Wikipedia,
    rather than just sources to import, will be a better one for open knowledge.</p>

    <h2 id="link">How do you link the article to knowledge from other sources?</h2>
    <p>Most Wikipedia articles contain one or more citations and wikilinks, each pointing at
    something outside the encyclopedia. Two kinds of statement turn a pointer into a card:</p>
    <h3>Identifier</h3>
    <p>The article states an ISBN, DOI, OCLC, LCCN, PMID or arXiv id, and a collection answers to
    exactly it. The strongest claim a card can make.</p>
    <h3>Statement</h3>
    <p>Wikidata states the connection outright — this painting is Met object 11417, this species
    is iNaturalist taxon 48662, this place is here. The card credits the property.</p>
    <p>Each group of results also says <i>who asked</i>: when one friend answers several of
    the article&rsquo;s links, its results split into one labeled group per link — and in the
    opening section, works <i>by</i> the subject are kept separate from works merely
    <i>cited</i> there.</p>

    <h2 id="friends">Who are the friends, and how is their work licensed?</h2>
    <div class="friends">
${friends}
      <div class="friend host">
  <p class="who"><span class="fav fav-wikipedia"></span>Wikidata &amp; Wikipedia</p>
  <p class="gift">The hosts: one writes the article that convenes everyone; the other makes the
    introductions — it knows every friend&rsquo;s name for every thing.</p>
  <p class="lic"><span class="lic-mark">openness?</span> Article text CC BY-SA 4.0; Wikidata CC0.</p>
</div>
    </div>

    <h2 id="challenges">What are the challenges?</h2>
    <p>This is a demo and not intended for production. Among other challenges:</p>
    <h3>There is nowhere for most of this to go</h3>
    <p>Each article page carries a closed panel — <i>Who helped, and who Wikipedia doesn’t show</i> —
    sorting the friends who filled it into three states: shown and credited, a link only, or
    invisible. Most data points are either &lsquo;link only&rsquo; or &lsquo;invisible&rsquo;.</p>
    <p>This is because Wikipedia requires most external links to be fairly plain, and because
    external media must be hosted on Commons. There are good reasons for both of these rules,
    but they make it hard to surface information in rich ways, and make it hard to be a good
    partner to our friends.</p>
    <h3>Page layout</h3>
    <p>Arbitrary content means great layout is somewhere between difficult and impossible. Work
    with designers on this challenge would be necessary (though even rudimentary
    implementations, like this one, would likely be very enjoyable for certain types of data
    nerds!)</p>
    <h3>Content curation</h3>
    <p>Sources can return thousands of responses. (Think the Smithsonian on the Apollo Program,
    for example.) A gallery with a thousand items is not very helpful to the reader, so some
    sort of curation (or at least ability to tune algorithmic prioritization) would be necessary
    before widespread deployment.</p>
    <h3>Source curation</h3>
    <p>Similarly, there are many collections of open content these days. Picking and
    prioritizing them would be an important challenge if we wanted to expand this.</p>
    <h3>Metadata gaps</h3>
    <p>Metadata quality leaves a fair amount to be desired. For example,
    <a href="https://archive.org/details/leiden-university">Internet Archive&rsquo;s recent
    scan of thousands of theses</a> will be nice sources of information for articles — once it
    has metadata. Ideally the fix is to deploy Wikipedian energy to other repositories to
    improve the metadata, not have it curated only inside Wikipedia.</p>
    <h3>Rights are complicated at best, murky or unknown at worst</h3>
    <p>Some items arrive with an honest non-answer: the institution has recorded that the
    rights status is unknown, or not yet evaluated. These render here with a small ? mark and
    the institution’s own words behind a click — treated, for now, as peers of the openly
    licensed material, because a recorded open question is a fact about the collection and
    silence would hide it. At scale this is a real challenge: a reader wants to know what they
    may do, and “nobody knows” satisfies no one. The durable fix is rights-clearing work of the
    kind <a href="https://www.wikidata.org/wiki/Wikidata:CopyClear">CopyClear</a> and
    <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina">Dominio
    Público en América Latina</a> do on Wikidata; a demo can only keep the question visible.</p>
    <h3>Open data increasingly arrives through priced pipes</h3>
    <p>The catalog behind every paper card here — OpenAlex — is free to download and openly
    licensed, but as of February 2026 the convenient way to read it, its API,
    <a href="https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/">requires
    a key and bills by usage</a>. A demo like this fits comfortably inside the free daily
    allowance, and charging for a service while keeping the data open is a defensible way to
    keep the lights on. But expect more of this: running an API costs money that open licenses
    do not pay, so even institutions with genuinely open data will increasingly meter or put
    terms on the pipe — DigitalNZ&rsquo;s metadata API, non-commercial by default, is the same
    problem in a different shape. Anything Wikipedia-scale built on lookups like these would
    need formal agreements, or its own copies of the open datasets, rather than goodwill rate
    limits.</p>
    <h3>Bot volume and caching</h3>
    <p>Because of the volume of Wikipedia, to be deployable at any sort of scale, this would
    likely need extensive caching and likely formal agreements with the other data providers.</p>
  </div></section>
</main>
<footer class="foot"><div class="wrap foot-wrap">
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
 * later by a site that had a showcase of finished pages sitting warm on
 * disk. It now shows the same nine cards as the front page — the operator's
 * line edit, 2026-08-20, widened its grid from the showcase six so the
 * sentence "These nine" counts what it points at — under a "ready now" offer
 * only this page prints. That offer is not decoration: a stored render is
 * replayed from disk before the concurrency gate is consulted at all
 * (`src/page-cache.js`), so these links do not queue behind the discoveries
 * that caused this page. For the windows where the showcase is genuinely
 * cold — a fresh volume, the minutes after a deploy — `src/admission.js`
 * keeps a reserve of slots for exactly these pages, so the offer holds there
 * too. A busy page linking to pages that would also answer 503 would be
 * worse than the dead end it replaced.
 *
 * Rendered once at startup, like the front page: the moment this page is
 * needed is the moment the server has no capacity to build anything.
 */
// `inline` matters here for one reason: the showcase cards carry the partner
// logos now, and those bytes live in the stylesheet (`faviconStyle`). A busy
// page built without them would render rows of blank squares — the offer
// still works, but it would look broken exactly where the site is claiming a
// friend showed up.
export function busyPage({ inline = new Map(), siteOrigin = '' } = {}) {
  // Share scrapers arrive exactly when a link gets popular — which is when
  // this server is busiest — and platforms cache a tagless scrape for days.
  // So the busy page carries the site's card (title, description, image)
  // with NO og:url: it answers for many article URLs at once, and a
  // canonical claim here would misdirect every one of them (2026-08-11).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Busy just now — Help From Our Friends</title>
${ogMeta({
    title: 'Help From Our Friends — an open knowledge web experiment',
    description: OG_DESCRIPTION,
    path: null,
    siteOrigin,
  })}
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
${sourceLegend(inline).style}
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
  <p class="lede">The demo is busy responding to other users right now — being polite to our friends
    means fetching only a few pages at a time. Try again in a moment, or try one of the
    pre-rendered examples below.</p>
  <p class="ready"><span class="chip">ready now</span>These ${storedCount()} are already rendered and stored, so
    they are served from disk without waiting for the demo to be free:</p>
  <div class="grid">
${showcaseCards()}
${holderCards()}
  </div>
  <p class="after">Everything else — who the friends are, what each one gives, and how any of this
    works — is on <a href="/">the front page</a>, which needs no discovery at all.</p>
</div></div>
</body>
</html>
`
}
