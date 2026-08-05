# tapestry-gen

Last verified: 2026-08-05

## Purpose

*"The article, enriched"* — any English Wikipedia article as a linear spine,
the open ecosystem's media on one side, its cited sources on the other. It is
**generated, not authored**: the article's own wikilinks, resolved through
Wikidata QIDs, decide where each item lands, so the placement *is* the
argument. Output is a self-contained HTML page. Fuller narrative in
`README.md`.

**The website is the product** (2026-08-04). The curated-dataset experiment —
`generate.js`, the Apollo 11 dataset, hand placement, and the Internet Archive
`.tapestry` emitter — was retired to
`../../attic/all-the-opens/tapestry-gen-curated/`. It answered its question:
live discovery renders the same article denser, with no dataset and no
per-article code. What survives here is what serves the site. If something
does not help generate the website, it belongs in the attic.

## Contracts

- **Reads** nothing on disk but its own cache. Every page is discovered live
  from the article title.
- **Writes** `demo/spike-<resolved-title>.html` from `spike.js` — gitignored
  since 2026-08-03: no render output is committed; the demo is the live
  streaming server.
- **Network** all goes through `.cache/` (gitignored), keyed by request URL —
  reruns are offline and byte-reproducible. Delete `.cache/` to refetch.

## Two entry points

- **`spike.js`** — batch live discovery: `node spike.js "Any Article Title"`
  builds a self-contained enriched page for an arbitrary English Wikipedia
  article with no dataset and no per-article code, byte-reproducible off its
  cache. Writes `demo/spike-<slug>.html`, slugged from the **resolved** title,
  not argv — `node spike.js "Coral_Gables"` writes
  `demo/spike-coral-gables-florida.html`. Thin wrapper over `src/discover.js`.
  **It is also the only test of the discovery path**: no test imports
  `discover()`, so the acceptance checks in `docs/` are spike renders plus
  greps, and the byte-reproducibility of a warm re-render is how a regression
  is detected. `serve.js` cannot play that role — it emits bands in COMPLETION
  order, which is deliberately nondeterministic.
  Design: `../docs/design-plans/2026-07-25-live-discovery-pipeline.md`;
  state and plan: `../docs/implementation-plans/2026-07-28-live-discovery-next-steps.md`.
- **`serve.js`** — **streaming** live discovery (design-plan Phase 7, added
  2026-08-03): `npm run serve` then visit `/wiki/<Article_Title>`. One chunked
  HTML response: the article spine renders in ~1s (one parse call), and each
  band's rail follows as a `<template>` + one-line mount script the moment its
  own pivots answer. No client framework; the stream is the page. Same
  pipeline, budgets, cache and politeness as batch — only the byte timing
  differs. Byte-reproducibility is a batch-only invariant; streamed pages are
  expected to vary with live data.

Both entry points share `src/discover.js`, which reports progress
through an async `emit('spine'|'band', …)` callback — batch ignores the
events, streaming writes fragments from them. `emit('spine', {page, units,
dropped})` fires before any pivot; `emit('band', band)` fires per band in
COMPLETION order. `discover()` resolves to `{title, bands, stats, dropped,
opinion, reach}`, bands in ARTICLE order. `reach` is what the article itself
already contains — see the visibility panel below.

**Callers must render the resolved title, never their own input** (2026-08-04):
every parse call sends `redirects=1`, `fetchArticle` returns the API's own
`title`, and both the spine event's `page` and the returned `title` are that
resolved title. A redirect that lingered in the caller's string would name an
article the page is not.

Streaming profile: **stale, and the shape has changed** (2026-08-04). The old
figures (spine 0.9s, first rail 4.5s, complete ~9s) were dominated by the
Commons queue, serial by etiquette, and by the depicts chain that put
`categoryFilesPromise` on every band's path. Both are gone with Commons, and
with them the only cross-band dependency — a band now waits solely on the
global batches it will actually read. Cold McClintock measured 62.8s / 21
requests on 2026-08-04 after the change; warm reruns are offline. Re-measure
before quoting anything. The property that matters is that the first rail
still arrives far ahead of completion, not the absolute seconds.

## Deployed demo

`serve.js` runs publicly at **https://help-from-our-friends.fly.dev/**
(Fly.io app `help-from-our-friends` — renamed from `article-tapestry`
2026-08-03; personal org, sjc, scale-to-zero; `Dockerfile` + `fly.toml`
here). The public name is *"Help From Our Friends: An Open Knowledge Web
Experiment"*. Deliberately **one machine** (scaled down 2026-08-03; use
`flyctl deploy --remote-only --ha=false` if ever recreating): the disk cache
is per-machine, and Fly's default second "HA" machine made requests alternate
between two independent cold caches — every page felt cold forever. One
machine = one cache that accrues (18s cold → 0.3s warm); deploys still wipe
it, which is the accepted trade.

**Deploy with `npm run deploy`** from this directory — `flyctl deploy
--remote-only && node warm.js`. The second half matters: a deploy takes the
machine's cache with it, so without it the six showcase links on the front page
— the first thing anyone clicks — are each a cold minute at exactly the wrong
moment. `warm.js` walks them once, **serially** (every page fans out dozens of
upstream requests, `MAX_CONCURRENT` 503s past four, and warming earns no
exemption from the per-host queues). Its titles come from `showcaseTitles()`,
the list the front page renders its own cards from; a test asserts the two
agree, because drift would show up as a slow demo link rather than an error. It
exits non-zero if a page did not finish — checked via `window.__tapdone`, the
flag `streamClose` writes last — but a failure there means the site is slow,
not broken, and the deploy itself already succeeded. `npm run warm [url]`
re-runs it alone. `WIKIMEDIA_UA_CONTACT` is a **Fly secret** (set to the operator),
never in `fly.toml` — a fork must set its own. Guards for public exposure:
`MAX_CONCURRENT` discoveries (default 4, then 503), `robots.txt` disallowing
`/wiki/`, and the per-host queues already bounding upstream traffic globally.
The container cache is ephemeral by design.

Fixtures are Apollo 11 (event, `{{sfn}}` citation style), Brown v. Board (legal,
inline `{{cite}}`), Ludwig Prandtl (person, thesis reachable only by description).

## The visibility panel — and why Commons left (2026-08-04, LUI-122)

Under the masthead's credit bar sits one quiet line — *"Who helped, and who
Wikipedia doesn't show"* — **shut by default**, opening into a two-column table
of the partners this page drew on: *Helping here* (cards and footnotes it gave
this page) against *On Wikipedia* (`shown, and credited` / `a link only` /
`invisible`), then the page's citation tally and the explanation. It is a
*measurement*, not a request — "these exist, no established route surfaces them
here" — because a request walks straight into WP:ELBURDEN and a report does
not. Two columns because they answer two different questions and prose kept
running them together; shut by default because a reader who has not yet
wondered whether Wikipedia shows any of this should meet a line, not a table.
Built by `src/gap.js` (pure) from two extra `prop=` fields on the parse call the
spine already makes (`templates|externallinks`), so it costs **zero** requests.
Only Kartographer reaches the `shown` tier; detection is `mw-kartographer` in
the rendered HTML, not a template name, because a dozen infoboxes embed a map.

**`prop=images` is deliberately not the third field, and must not be added back**
as a way of counting what an article shows: on San Francisco it returns 108
files, of which one is a pronunciation recording, one is the red pushpin dot,
three are relief-map base layers behind a single visible map, and a couple of
dozen are template icons — against 92 the article actually displays. Count the
rendered HTML instead (`fetchArticle` in `src/wikipedia.js` says the same).

**Never write "there is no route."** A bare external link is always possible.
The defensible claim is that no *established* route preserves the content
*and* the credit.

**Never write "Wikipedia can't show."** It could; it doesn't. "Can't" asserts
an impossibility and so argues against the whole point of the exercise —
nothing stops Wikipedia showing these things but established practice, which
is a thing that can change. Say "doesn't" (caught in review, 2026-08-04).

**Never write the bare phrase "the article" in reader-facing copy.** The reader
is looking at a page that shows every partner, so "the article can show you one
of them" reads as a flat contradiction until you know it means the article *on
Wikipedia*. Say "the Wikipedia article" every time (`THE_ARTICLE` in
`emit-html.js`). Caught in review, 2026-08-04.

The flat "Today, help came from:" credit bar stays, and is what the masthead
leads with. It was briefly merged into the panel — the two named the same
organizations — but once the panel folded shut the duplication stopped costing
anything and the bar is the friendlier opening.

**Wikimedia Commons is no longer a partner on article pages.** It was ~85% of
every page's cards (Angkor Wat 92/107, Coral Gables 88/102), which drowned out
the non-Wikimedia partners the demo exists to show — and worse, it argued
against the page's own thesis: Commons is the single door through which an
outside institution's work must pass to be seen here, arriving as a Commons
file rather than as theirs, so shelving it beside the Met implied they were
peers. Removing it took the P180 depicts pivot, the P373 category pivot,
`dropSeenFiles`, and the whole unit-to-unit `seen` chain with it — that
machinery existed for Commons alone. Commons now appears only in the
visibility panel, named as the door. Page density is the cost, paid
deliberately: Angkor Wat 107 cards → 15, Coral Gables 102 → 14.

## Evidence classes (spike)

An edge is one of two live things, and the render distinguishes them because
conflating them would overstate what the page knows:

- **identifier** — a shared authority ID (ISBN/OCLC/LCCN → Internet Archive).
- **statement** — a Wikidata claim (`P3634` → the Met's own record of the object).
- **corroborated** — *retired 2026-08-03 (front-page review)*: the
  described-object search fallback (`P1026` → author + year + institution) is
  commented out in `src/discover.js`. Its one exemplar was closed the right
  way — Wikidata learned the scan's identifier (P724 on Prandtl's thesis), so
  the stated-identifier route answers and a fix in the graph is inherited by
  every reuser. `src/corroborate.js`, its tests, and the dashed-card render
  path are kept intact for revival if a genuinely unidentified work warrants
  it.

## Request shape (Tier-1 performance work, 2026-08-03)

The spike fetches the whole article in ONE parse call (`fetchArticle`:
sections + HTML + wikitext) and reproduces the per-section views locally —
`sliceSectionWikitext` / `sliceSectionHtml` are verified byte-identical to
`parse&section=N` (note: the API's `byteoffset` is a string index, not bytes).
Identifier pivots are batched (`src/batch.js`): one archive.org Solr OR-query
per run of ISBNs, one OpenLibrary volumes request per 40 (`|`-separated), QIDs
and labels at 50 per request. Pivots run concurrently across hosts over the
per-host serial queue. Cold Prandtl: 33.6s/72 requests before the Tier-1 work,
9.0s/39 after (2026-08-03); warm reruns are 100% offline.

Re-measured cold on 2026-08-04 (empty `.cache`, isolated clone): **61.1s/47
requests**. Two of the eight extra requests are the mappability follow-ups
(`query.wikidata.org` is 3 per page now, not 1); the rest are partner pivots
this profile never separated out. Two changes push the other way — batching the
subject lookup into the title batch costs one fewer en.wikipedia.org request
per page (Prandtl and Dapples both 4→3).

**That 47 is superseded by the Commons removal** (2026-08-04):
commons.wikimedia.org is no longer called at all, and it was the largest single
block of requests on every page — cold McClintock measured **21 requests** after
the change. Treat ~21 as the current order of magnitude and 47 as the
before-picture. The wall-clock in either figure is **not** comparable across
dates: cold runs are dominated by live upstream latency, and a review the same
day measured cold pages at 55–67s on code that predates this branch. Seconds are
weather; re-measure before quoting any.

## Partner pivots (2026-08-03)

Beyond IA/OpenLibrary, two pivot families (both budgeted per section):

- **Scholarly** (`src/scholarly.js`) — citation anchors carrying a DOI or PMID
  batch through **OpenAlex** (no key; `mailto` carries the operator contact);
  a card exists only when the work is genuinely open. **arXiv** citations are
  open by construction and become cards with zero requests. Subject-level:
  ORCID (P496) → the subject's top-cited scholarship, the papers' twin of the
  OpenLibrary author pivot.
- **Statements** (`src/statements.js`) — THREE WDQS queries per page: one
  answers every anchor's partner statements, and two more answer the
  place/defunct gates (Phase 2, 2026-08-04):
  (1) Main query answers Met objects (P3634), Art Institute of Chicago (P4610),
  iNaturalist taxa (P3151), GBIF occurrence maps (P846), **IIIF manifests
  (P6108, `src/iiif.js`, added 2026-08-03)** — any IIIF-publishing institution
  with no per-partner code; Presentation v2 and v3 both parsed; best coverage
  today is SMK Denmark and BnF Gallica, and stale manifest URLs (e.g. Trinity
  College Dublin's platform move) degrade to no card — and P625 coordinates.
  (2) Mappability (place/defunct), asked only of location-bearing anchors, as
  two small follow-ups: direct P31/P576 on the items (no closure), then a plain
  `?class wdt:P279* ?super` ancestor walk over just the distinct classes that
  came back, intersected against the allowset **in JS**. Both the shape and the
  order matter and are load-bearing. Asking the closure of *items* cost 16–37s
  cold and blew the 15s timeout; asking WDQS the membership question directly
  (`EXISTS` with a nested `VALUES`) cost 11–24s where the plain ancestor
  walk costs 0.32–0.50s. And because the first version rode the query answering
  every partner pivot, its timeout cost the page Met/AIC/GBIF/iNat/IIIF/DPLA/
  Europeana too. Now failure of either follow-up costs only maps (they are gated
  on the place/defunct booleans), never the partner pivots. Result: P625 →
  OpenStreetMap map cards for locatable, extant places only (one per section max;
  non-Earth globes are refused — Tranquility Base gets no map of the Atlantic).
- **DPLA** (`src/dpla.js`, added 2026-08-03) — one subject-heading lookup per
  band on its most prominent labeled anchor; the anchor is a *cataloger's*
  LCSH subject heading, not a Wikidata statement, and the cards say so.
  Requires the `DPLA_API_KEY` env var (free by mail); absent the key the
  pivot silently skips, so clones run keyless.
- **Europeana** (`src/europeana.js`, added 2026-08-03) — anchors pivot only
  through their stated Europeana entity (P7704); the search asks for items
  enriched with exactly that entity URI, `reusability=open` only, and each
  card names its item's license. Gated on `EUROPEANA_API_KEY`, same keyless-
  skip rule. The
  subject's own statements enrich the lede. Map images are single OSM tiles
  fetched server-side and inlined as data URIs — **never**
  `maps.wikimedia.org` (Wikimedia-projects-only; refuses outside referrers)
  and never browser-hotlinked (OSMF tile policy). Every partner here is
  outside Wikimedia by design — that breadth IS the demo.

Deliberately excluded: Wikisource (prefer non-wiki partners in the demo),
OCLC/loc.gov (overlaps OpenLibrary), Wayback cards (no thumbnail API — a
card with no visual is just a link, and links are already inline).

## Pipeline (output-agnostic core → renderer)

`wikipedia` (sections, prose, wikilinks, QIDs, lead images, infobox links,
section wikitext) → `discover` (anchors, pivots, budgets) → `dedup` (article-
order anchor ownership and page-wide file dedup, between the QID map and the
pivots) + `citations` (per-section `<ref>` templates, and the coverage
tally/line — moved here from `discover.js` 2026-08-04) → `emit-html`.
`src/html.js` holds `escapeHtml`, the one rule every renderer shares.

## Key Decisions

- **HTML is the only output** (2026-08-04). CSS reflow solved what
  hand-computed `.tapestry` pixel geometry could not — dead whitespace,
  squashed images, non-responsive — so the Tapestry emitter
  (`layout`/`emit`/`zip`/`vendor/parse-root.mjs`) retired to the attic with the
  generator that drove it. It still ran when it was retired; nothing used it.
- **References float right; media rides a full-width deck** (2026-08-03
  evening): the floated `.rail` carries only the section's references — they
  pace the prose — while the media shelves render as a `.deck` below it:
  full-width, flex-wrapped, each shelf's flex-basis sized to its cards
  (capped at three) so small shelves share a row. Stacking shelves in the
  404px rail built columns 2–4× taller than the text, leaving the whole left
  half of a band blank. `__thb` mounts both parts (rail before `.prose`,
  deck after); at ≤640px the band-body turns flex so the order becomes
  prose → refs → media.
- **The gutter shows Wikipedia's own footnotes** (2026-08-03, replacing the
  earlier curated three-source shortlist): each band's rail renders the
  actual `reference-text` bodies the section's markers point at, numbered as
  the prose numbers them — closed by default behind a one-line `<details>`
  summary (2026-08-03 late: a wall of citations must never be a section's
  first block; `__open` expands the fold when a marker is clicked). The rail
  now holds the references and nothing else — the per-section coverage line
  that used to sit outside the fold became one page-level sentence in the
  visibility panel (2026-08-04). Where a note cites a
  book OpenLibrary says is readable/borrowable, the access link rides on the
  note. Prose keeps its wikilinks — rewritten to `/wiki/…` on this site, so
  readers click through to more enriched renders — and its footnote markers.
  No section numbering: Wikipedia doesn't number, so neither do we.
  `sanitizeFragment` in `src/wikipedia.js` is the only thing that lets
  article HTML through; everything else is still escaped.
- **Every Wikidata-backed card carries a provenance fold** (2026-08-03 late):
  an ⓘ `<details>` whose text states the exact chain (`entry.trace`) and links
  the statement it rests on (`entry.fix` — `wikidata.org/wiki/Q…#P…`), because
  Wikidata's statement anchor IS the edit button. Stamped where the qid is in
  scope: `statementEntries` (Met/AIC/IIIF/iNat/GBIF/maps), lede extras
  (P648/P496), DPLA (P244), Europeana (P7704). Citation-derived cards
  (OpenAlex/arXiv/IA) have no fold — nothing there is editable on Wikidata.
  The fold's text is written for a reader who has never heard of Wikidata: it
  says what Wikidata is on first mention, and the P-number rides along in
  parentheses rather than standing in for the explanation.
- **Nothing enriches twice, and article order decides who owns it**
  (`src/dedup.js`, 2026-08-04). An anchor QID belongs to the band of its
  *first* mention (`claimAnchors`; a band whose early candidates were claimed
  upstream backfills from its later ones, and the subject QID is seeded to the
  lede). It is **pure over article-ordered input** because bands run and emit
  in COMPLETION order — any first-come-wins state read at band-run time would
  make the page nondeterministic and break batch byte-reproducibility. The
  companion `dropSeenFiles` and its unit-to-unit `seen` chain went with
  Commons on 2026-08-04; if page-wide dedup is ever needed again, read that
  deleted code first — the purity argument is why it looked the way it did.
  Nothing
  vanishes silently: the disclosure line says "N shown earlier on this page".
- **True image dimensions** are read from JPEG/PNG headers (`imagesize`) so covers
  and photos are never squashed by a guessed aspect.
- **OpenLibrary covers are inlined** as data URIs — they redirect through
  archive.org, so a live dependency would break whenever IA is down.

## Invariants

- Pipeline modules never assume an output format; the renderer is the only
  format-specific layer.
- Every rendered image is sized from real dimensions (API or header), not a guess.
- **The footer's provenance is the caller's to state**, via `buildHtml({provenance})`.
  It was once hardcoded to the curated dataset, which made every live-discovery
  page contradict its own opening claim. Whatever goes there must be true of the
  run that produced the file, and must not include a timestamp — reruns off the
  same cache are byte-identical, and that is how a regeneration is verified.

## Wikimedia compliance (required)

Wikimedia runs on donations and blocks non-compliant clients without notice; the
block lands on whoever ran the code. `src/wmf.js` is the **single** UA definition
for the whole repo — never write a User-Agent string anywhere else. MediaWiki
requests go through **m3api** via `src/mw.js`, which owns maxlag, Retry-After
and retries; non-MediaWiki sources (archive.org, OpenLibrary, CourtListener)
keep the hand-rolled client in `spike.js`.

- **`WIKIMEDIA_UA_CONTACT` must be set** or `userAgent()` throws at startup. There
  is no default on purpose: anyone can clone this, and a baked-in address would
  attribute their traffic to someone who never ran it. Set it to *your own*
  address.
- `maxlag=5` rides every Action API request (an m3api default param in
  `src/mw.js`) — nothing here is a human waiting on a response, so this batch
  traffic yields to interactive users. `withMaxlag()` remains for the
  hand-rolled client, where it no-ops on non-Wikimedia URLs.
- 429/503 honor `Retry-After`; other 4xx are **never** retried — a 404 is our
  bad identifier, not the server's bad day.
- Requests are **serial per host** by construction: every request rides the
  per-host queue in `src/mw.js` (`enqueue`). Different hosts run concurrently —
  that is where the Tier-1 speedup lives — but never two in-flight requests to
  the same API. Batch with `titles=A|B|C` (and the batched pivots in
  `src/batch.js`) instead of adding parallelism.
- The browser extension must use **`Api-User-Agent`** — browsers silently drop a
  script-set `User-Agent` — and takes its contact from extension storage, since
  the installer is the operator.

Policy: <https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy>
Etiquette: <https://www.mediawiki.org/wiki/API:Etiquette>

## Gotchas

- **Sandboxed runs need `NODE_USE_ENV_PROXY=1`.** The sandbox routes egress
  through an HTTP proxy; `curl` honors `HTTP_PROXY` automatically but Node's
  `fetch` does not, so every request fails with `EAI_AGAIN` without it. Set in
  `../../.claude/settings.local.json` along with the host allowlist (Wikipedia,
  Wikidata, Commons, archive.org, OpenLibrary, CourtListener, upload/maps
  wikimedia). Verifying reachability with `curl` does **not** prove the
  generator can reach a host. m3api's own cookie dispatcher would bypass that
  proxy and hang — `src/mw.js` drops it whenever `NODE_USE_ENV_PROXY` is set.
- First run needs network (fills `.cache`); reruns are offline.
- OpenLibrary rate-limits back-to-back requests — the volume lookup retries with
  backoff. A whole batch that still fails retries once after 2s, and whatever
  fails again comes back in `openLibraryVolumes`' `unchecked` set (it returns
  `{volumes, unchecked}`, not a bare Map). Those ISBNs get **no** access verdict
  and `citationHeadline` says "N we could not check this time" in the visibility
  panel — "we could not look" must never render as "there is no copy".
- **A redirect title is not the article.** Without `redirects=1` the API parses
  e.g. "Coral Gables" as its own one-line stub, so the page rendered 1 section
  of redirect syntax instead of a city. Every parse call now sends it; the cost
  is that the caller's input and the article's title can differ (see Two entry
  points).

## Key Files

- `src/discover.js` — the live-discovery pipeline both entry points share.
- `src/citations.js` — citation extraction, reachability ranking, OpenLibrary
  access, and the citation tally (`citationCoverage` per band → `pageCitations`
  summed → `citationHeadline`). Said **once per page**, in the visibility
  panel: per section it fired 36 times on San Francisco and 26 of those
  reported nothing but a failure to find, and its "27 works" sat directly under
  the fold's "18 notes" — two totals of different things reading as a
  contradiction (2026-08-04 review).
- `src/dedup.js` — `claimAnchors`, its only export since `dropSeenFiles` left
  with Commons: page-wide, article-ordered, pure. See Key Decisions for why
  purity is load-bearing.
- `src/gap.js` — pure: what the ARTICLE reaches, and each partner's visibility
  tier against it. See the visibility panel above.
- `src/emit-html.js` — the HTML render, batch and streaming.
  `src/html.js` — `escapeHtml`, shared by every renderer.
- `spike.js` — the batch live-discovery entry point (see Two entry points).
  `src/corroborate.js` — described-object matching for the `corroborated` class.
- `src/citations.js` also handles Wikipedia's **second** citation style:
  `{{sfn|Last|Year}}` pointers into a pooled bibliography, joined on
  `(surname, year)`. Mature and featured articles use it heavily — the Apollo 11
  article keeps 19 of its 22 ISBNs there — so reading `<ref>` contents alone
  misses most of the books on exactly the best-sourced pages.
