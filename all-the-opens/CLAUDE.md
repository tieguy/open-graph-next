# Jenifesto - the article, enriched

Last verified: 2026-08-20

## Purpose

Speculative design prototypes for cooperative knowledge infrastructure. The one
active project is **`tapestry-gen/`** — a generator that renders a Wikipedia
article as *"the article, enriched"*: the article as a spine, with the open
ecosystem's media and cited sources placed by the article's own wikilinks and
citations (resolved through Wikidata QIDs and authority identifiers). It is a
live website before it is a generator — <https://friendsof.wiki/>
renders any English Wikipedia article on demand — and every page it renders also
*measures* how little of what it found the original Wikipedia article can show.
See `tapestry-gen/CLAUDE.md`.

Earlier renderings — the D3.js force-directed graph (`web-demo/`), the Firefox
extension, and the Netlify site build — were retired to the repo-root `attic/`
on 2026-08-03. The published index at all-the-opens.netlify.app is stale as of
that date.

## Tech Stack

Node 22+, one npm dependency (m3api, for MediaWiki requests — see
`tapestry-gen/src/mw.js`); disk-cached, byte-reproducible.

## Commands

- `cd tapestry-gen && cp .env.example .env` — first run only. `.env` holds this
  working copy's `WIKIMEDIA_UA_CONTACT` and partner API keys; it is gitignored,
  and the `spike`/`serve`/`warm` scripts load it with
  `node --env-file-if-exists=.env`. Without it a clone still runs and the keyed
  lookups skip. The deployed apps carry the same names as Fly secrets.
- `cd tapestry-gen && npm run spike -- "Article Title"` —
  build a self-contained render for any article.
- `cd tapestry-gen && npm test` — the test suite (pure functions; no network).
- `cd tapestry-gen && npm run serve` —
  streaming server: `http://localhost:8787/wiki/<Article_Title>` renders the
  spine in ~1s and streams enrichment in behind it.
- `cd tapestry-gen && npm run deploy` — Fly deploy to **production**
  (friendsof.wiki); the server warms its own showcase on startup.
- `cd tapestry-gen && npm run deploy:staging` — Fly deploy to **staging**
  (staging.friendsof.wiki), no warming. Review here first; prod is a separate,
  deliberate `npm run deploy`. Details in `tapestry-gen/CLAUDE.md`.
- Single-institution work pages are part of every render: an article about
  a held painting, sculpture, or manuscript renders as Wikipedia plus that
  one institution, every other partner sitting out. The rules, the gate and
  the measured population are in `tapestry-gen/CLAUDE.md`.

## Project Structure

- `tapestry-gen/` — the generator; render output (`demo/`) is gitignored as of
  2026-08-03 — the demo is the live streaming server, nothing pre-generated is
  committed. The curated Apollo 11 dataset and the generator that read it
  retired to `../attic/all-the-opens/tapestry-gen-curated/` on 2026-08-04:
  live discovery renders the same article denser, for every article.
- `tapestry/` — **gitignored**: a vendored Internet Archive Tapestry viewer plus
  stale `.tapestry` artifacts. Nothing emits them any more — the emitter
  retired to the attic 2026-08-04 with the generator that drove it.
- `docs/design-plans/`, `docs/implementation-plans/` — design documentation.
- `docs/data/` — dated measurement files a tool regenerates and a human reads:
  today the holder census and the QA sample drawn from it
  (`<date>-holder-census.json`, `<date>-holder-qa-sample.json`). They are
  checked in so a measurement can be re-run against the same population, and
  **nothing in the live tree reads them at request time** — see the Data
  Contracts section below.
- **Two running logs, appended to as things are found.** Both date every claim
  and show the command that produced it, because these findings decay — an
  undated "partner X blocks us" is worthless within months.
  - `docs/reaching-open-collections.md` — openly licensed material that is hard
    to *reach*: bot mitigation, retired endpoints, robots rules, missing
    metadata. Read the two rules at its head before adding an entry; in
    particular, run the real-id/bogus-id control before recording a failure,
    because a host that answers both identically is refusing to talk to you,
    not reporting a broken link.
  - `docs/internet-archive-issues.md` — data-quality problems in one partner's
    index, in the same form.

## Data Contracts

**None.** Nothing in the live tree reads a dataset — every page is discovered
from the article title. The curated Apollo 11 dataset and the node/connection
shapes it used retired to
`../attic/all-the-opens/tapestry-gen-curated/data-apollo-11/` on 2026-08-04,
where that README still documents them.

The checked-in populations of the holder pages (`docs/data/`, and
`tapestry-gen/tools/holder-flagships.mjs`) are not an exception: they are
measurement inputs and a warming list, read by tools, never by a render. A
page that consulted a checked-in file to decide what to show would be the
curated generator again.

## Key Decisions

- **The website is the product** (2026-08-04). Live discovery renders the same
  article denser than the hand-curated dataset did, with no dataset and no
  per-article code, so the curated generator, its data, the placement rules and
  the Internet Archive `.tapestry` emitter went to the attic. If something does
  not help generate the website, it belongs there too.
- **HTML is the only output.** CSS reflow solved what hand-computed `.tapestry`
  pixel geometry could not — dead whitespace, squashed images, nothing
  responsive. The emitter still ran when it was retired; nothing used it.
- **Wikimedia Commons is not one of the partners** (2026-08-04). It was ~85% of
  every page's cards, which drowned out the non-Wikimedia partners the demo
  exists to show — and it argued against the thesis, because Commons is the
  single door an outside institution's work must pass through to be seen on
  Wikipedia, so shelving it beside the Met implied the two were peers. Article
  pages no longer call commons.wikimedia.org at all; Commons appears only in
  the visibility panel, named as the door. Density was the price, paid
  deliberately (Angkor Wat 107 cards → 15).
- **The gap is the finding, so it is measured** (2026-08-04, LUI-122). Every
  page reports how much of what it found the *original Wikipedia article*
  actually surfaces — shown and credited, a link only, or invisible. It is a
  measurement and never a request: a request walks straight into WP:ELBURDEN, a
  report does not. The copy rules that follow from this are in
  `tapestry-gen/CLAUDE.md` and are arguments, not style preferences.

## Invariants

- American English throughout this subtree (2026-08-04).
- `WIKIMEDIA_UA_CONTACT` has no default and must name whoever is *running* the
  code, not whoever wrote it. The full Wikimedia compliance rules are in
  `tapestry-gen/CLAUDE.md` and are not optional — a block lands on the operator.

## Gotchas

- Issue tracking moved from chainlink to Linear (2026-07-15).
