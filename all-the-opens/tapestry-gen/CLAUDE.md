# tapestry-gen

Last verified: 2026-08-03

## Purpose

A second rendering of the shared Apollo 11 dataset as *"the article, enriched"* —
the Wikipedia article as a linear spine, the open ecosystem's media on one side,
its cited sources on the other. It is **generated, not authored**: the article's
own wikilinks, resolved through Wikidata QIDs, decide where each item lands, so
the placement *is* the argument and generalises to any article. Primary output is
a self-contained HTML page; a `.tapestry` (Internet Archive Tapestry format) is
also emitted but secondary (see Key Decisions). Fuller narrative in `README.md`.

## Contracts

- **Reads** `data/apollo-11/` — the curated dataset (formerly shared with the D3
  demo, which now lives in `../../attic/`). Read-only, except deliberate dataset
  re-curation.
- **Writes** `demo/apollo-11.html` and `../tapestry/apollo-11.tapestry` — both
  gitignored since 2026-08-03: no render output is committed; the demo is the
  live streaming server.
- **Network** all goes through `.cache/` (gitignored), keyed by request URL —
  reruns are offline and byte-reproducible. Delete `.cache/` to refetch.

## Three entry points

- **`generate.js`** — the original, dataset-bound: renders Apollo 11 from the
  curated `data/apollo-11/`. Unchanged in intent.
- **`spike.js`** — batch live discovery: `node spike.js "Any Article Title"`
  builds a self-contained enriched page for an arbitrary English Wikipedia
  article with no dataset and no per-article code, byte-reproducible off its
  cache. Writes `demo/spike-<slug>.html`. Thin wrapper over `src/discover.js`.
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

Both discovery entry points share `src/discover.js`, which reports progress
through an async `emit('spine'|'band', …)` callback — batch ignores the
events, streaming writes fragments from them. Cold-article profile (Barbara
McClintock, 2026-08-03): spine at 0.9s, first rail 4.5s, complete ~9s; the
tail is the Commons queue, serial by etiquette.

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
it, which is the accepted trade. Deploy with `flyctl deploy --remote-only` from this
directory. `WIKIMEDIA_UA_CONTACT` is a **Fly secret** (set to the operator),
never in `fly.toml` — a fork must set its own. Guards for public exposure:
`MAX_CONCURRENT` discoveries (default 4, then 503), `robots.txt` disallowing
`/wiki/`, and the per-host queues already bounding upstream traffic globally.
The container cache is ephemeral by design.

Fixtures are Apollo 11 (event, `{{sfn}}` citation style), Brown v. Board (legal,
inline `{{cite}}`), Ludwig Prandtl (person, thesis reachable only by description).

## Evidence classes (spike)

An edge is one of two live things, and the render distinguishes them because
conflating them would overstate what the page knows:

- **identifier** — a shared authority ID (ISBN/OCLC/LCCN → Internet Archive).
- **statement** — a Wikidata claim (`P180 depicts` → Commons).
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
per run of ISBNs, one OpenLibrary volumes request per 25 (`|`-separated), QIDs
and labels at 50 per request. Pivots run concurrently across hosts over the
per-host serial queue. Cold Prandtl: 33.6s/72 requests before, 9.0s/39 after;
warm reruns are 100% offline.

## Partner pivots (2026-08-03)

Beyond IA/OpenLibrary/Commons, two pivot families (both budgeted per section):

- **Scholarly** (`src/scholarly.js`) — citation anchors carrying a DOI or PMID
  batch through **OpenAlex** (no key; `mailto` carries the operator contact);
  a card exists only when the work is genuinely open. **arXiv** citations are
  open by construction and become cards with zero requests. Subject-level:
  ORCID (P496) → the subject's top-cited scholarship, the papers' twin of the
  OpenLibrary author pivot.
- **Statements** (`src/statements.js`) — one WDQS query per page answers every
  anchor's partner statements: Met objects (P3634), Art Institute of Chicago
  (P4610), iNaturalist taxa (P3151), GBIF occurrence maps (P846), and P625
  coordinates → OpenStreetMap map cards (one per section max; non-Earth
  globes are refused — Tranquility Base gets no map of the Atlantic). The
  subject's own statements enrich the lede. Map images are single OSM tiles
  fetched server-side and inlined as data URIs — **never**
  `maps.wikimedia.org` (Wikimedia-projects-only; refuses outside referrers)
  and never browser-hotlinked (OSMF tile policy). Ordering is deliberate:
  Commons carousels come LAST in every band — the demo's point is the
  breadth of non-Wikimedia partners.

Deliberately excluded: Wikisource (prefer non-wiki partners in the demo),
OCLC/loc.gov (overlaps OpenLibrary), Wayback cards (no thumbnail API — a
card with no visual is just a link, and links are already inline).

## Pipeline (output-agnostic core → renderer)

`dataset` → `wikipedia` (sections, prose, wikilinks, QIDs, lead images, infobox
links, section wikitext) → `place` (wikilink→QID placement, tier-2 via
connections, prologue/coda for place-only items) → `resolve` (media) +
`citations` (per-section `<ref>` templates) + `imagesize` → `emit-html` (or the
Tapestry `layout`/`emit`/`zip`).

## Key Decisions

- **HTML is primary.** CSS reflow solves what hand-computed `.tapestry` pixel
  geometry could not (dead whitespace, squashed images, non-responsive). Only
  `layout.js`/`emit.js`/`zip.js`/`vendor/parse-root.mjs` are Tapestry-specific;
  everything else is output-agnostic and reused by the HTML render.
- **The gutter shows Wikipedia's own footnotes** (2026-08-03, replacing the
  earlier curated three-source shortlist): each band's rail renders the
  actual `reference-text` bodies the section's markers point at, numbered as
  the prose numbers them, folded past the first eight. Where a note cites a
  book OpenLibrary says is readable/borrowable, the access link rides on the
  note. Prose keeps its wikilinks — rewritten to `/wiki/…` on this site, so
  readers click through to more enriched renders — and its footnote markers.
  No section numbering: Wikipedia doesn't number, so neither do we.
  `sanitizeFragment` in `src/wikipedia.js` is the only thing that lets
  article HTML through; everything else is still escaped.
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
- 429/503 honour `Retry-After`; other 4xx are **never** retried — a 404 is our
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
  through an HTTP proxy; `curl` honours `HTTP_PROXY` automatically but Node's
  `fetch` does not, so every request fails with `EAI_AGAIN` without it. Set in
  `../../.claude/settings.local.json` along with the host allowlist (Wikipedia,
  Wikidata, Commons, archive.org, OpenLibrary, CourtListener, upload/maps
  wikimedia). Verifying reachability with `curl` does **not** prove the
  generator can reach a host. m3api's own cookie dispatcher would bypass that
  proxy and hang — `src/mw.js` drops it whenever `NODE_USE_ENV_PROXY` is set.
- First run needs network (fills `.cache`); reruns are offline.
- OpenLibrary rate-limits back-to-back requests — the volume lookup retries with
  backoff.
- OSM place items resolve to keyless `maps.wikimedia.org` static-map thumbnails.
- The dataset's IA/OpenLibrary/Smithsonian identifiers were fabricated and have
  been re-curated to real ones (see `../CLAUDE.md`).

## Key Files

- `generate.js` — pipeline entry point + coverage report.
- `src/place.js` — placement rules. `src/citations.js` — citation extraction,
  reachability ranking, OpenLibrary access. `src/resolve.js` — media resolvers.
- `src/emit-html.js` — the HTML render. `src/emit.js` / `layout.js` / `zip.js` —
  the Tapestry emitter.
- `spike.js` — the live-discovery entry point (see Two entry points).
  `src/corroborate.js` — described-object matching for the `corroborated` class.
- `src/citations.js` also handles Wikipedia's **second** citation style:
  `{{sfn|Last|Year}}` pointers into a pooled bibliography, joined on
  `(surname, year)`. Mature and featured articles use it heavily — Apollo 11 keeps
  19 of its 22 ISBNs there — so reading `<ref>` contents alone misses most of the
  books on exactly the best-sourced pages.
