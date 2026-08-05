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
- **`.cache/fact-<kind>-<key>.json`** (`readFacts`/`writeFacts` in `src/http.js`,
  2026-08-05) is the same cache holding *derived* answers rather than response
  bodies — today `fact-class-Q….json`, two booleans per Wikidata class. It is
  **cache, not data**: everything in it is re-derivable from the network, and
  deleting `.cache/` is still the whole reset. The "reads nothing on disk"
  contract above targets baked results and non-algorithmic editorial judgment,
  and a cache is neither — but the files sit beside the request cache and look
  like a dataset, so they are named here to stop that mistake. A cache may make
  a page faster and must **never** make it different (three showcase renders
  are byte-identical across the change, which is how that is checked).

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
  band's enrichment follows as a `<template>` + one-line mount script the moment
  its own pivots answer (`bandRail` ships all three parts — hero float, media
  deck and references — and `__thb` mounts each where it belongs: float before
  `.prose`, deck and refs after).
  No client framework; the stream is the page. Same
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

Streaming profile: a band waits solely on the global batches it will actually
read — the last cross-band dependency (Commons' depicts chain) went with
Commons on 2026-08-04. **The lede is exempt and goes first** (2026-08-05): it
gets its own turn at the front of every per-host queue rather than sharing the
page-wide batches, because it was arriving *last*. Cold Brown v. Board before
that change: spine 0.6s, nothing until 2.6s, then eight bands at once and nine
more at 3.5s — the lede, which carries the hero card and the Free Law opinion,
seventeenth of seventeen. After: first band 1.9s, lede 2.5s and ninth. Its
remaining floor is the WDQS mappability chain, not its citations.

The property that matters is that the first band arrives far ahead of
completion, not the absolute seconds — see the warning under Request shape.

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
it, which is the accepted trade. Since 2026-08-05 part of what accrues is
**shared across articles**: the `fact-class-*` verdicts are a small, near-static
vocabulary that articles draw on the same corner of (25–72% of a page's classes
were already answered for an earlier one, measured across seven articles), so
warming the showcase also warms the class walk for articles nobody has asked
for yet.

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

## Request shape (Tier-1 work 2026-08-03; WDQS and caching through 2026-08-05)

The spike fetches the whole article in ONE parse call (`fetchArticle`:
sections + HTML + wikitext) and reproduces the per-section views locally —
`sliceSectionWikitext` / `sliceSectionHtml` are verified byte-identical to
`parse&section=N` (note: the API's `byteoffset` is a string index, not bytes).
Identifier pivots are batched (`src/batch.js`): one archive.org Solr OR-query
per run of ISBNs, one OpenLibrary volumes request per 40 (`|`-separated), QIDs
and labels at 50 per request. Pivots run concurrently across hosts over the
per-host serial queue. Cold Prandtl: 33.6s/72 requests before the Tier-1 work,
9.0s/39 after (2026-08-03); warm reruns are 100% offline.

Cold McClintock measured **21 requests** on 2026-08-04 after Commons left (it
had been the largest single block on every page; the 47-request before-picture
is in git history). Treat ~21 as the order of magnitude for a modest page.

**WDQS is the part worth counting, because it is on the lede's critical path.**
Cold Brown v. Board, 2026-08-05: **7 requests before the class cache, 5 after**,
and the lede's mappability step 0.7s → 0.1s. The count comes from three query
kinds, each asked twice because the lede goes ahead of the page — partner
statements, item→classes, then classes→ancestors — and it is the third that the
`fact-class-*` cache removes on a warm machine. Query-then-pick raised the
partner half deliberately (Monarch butterfly 3 → 6 WDQS, +0.6s measured) and
that is the cheap half; see Partner pivots.

**Wall-clock here is not quotable.** Same code, same article, same warm class
cache: Monarch butterfly cold measured **26.2s once and 10.7s another time on
identical work** (2026-08-05). The variance is upstream weather — every page
fans out dozens of serial-per-host requests to partners whose latency nobody
here controls — and it swamps the effect of any change this repo can make.
Count requests, which are deterministic; re-measure seconds before quoting any,
and never compare a number across dates. (Cold pages measured 55–67s on
2026-08-04 on code predating that branch, which proves nothing about that
branch.)

## Partner pivots (2026-08-03)

Beyond IA/OpenLibrary, two pivot families (both budgeted per section):

- **Scholarly** (`src/scholarly.js`) — citation anchors carrying a DOI or PMID
  batch through **OpenAlex** (no key; `mailto` carries the operator contact);
  a card exists only when the work is genuinely open. **arXiv** citations are
  open by construction and become cards with zero requests. Subject-level:
  ORCID (P496) → the subject's top-cited scholarship, the papers' twin of the
  OpenLibrary author pivot.
- **Statements** (`src/statements.js`) — WDQS, split into a CHEAP half asked of
  everything and an EXPENSIVE half asked of almost nothing (2026-08-05). The
  split is the load-bearing part; see Query, then pick under Key Decisions.
  `entityStatements` still exists as the both-halves wrapper it always was, but
  **the pipeline no longer calls it** — it needs the halves apart so it can pick
  anchors between them.
  (1) `partnerStatements` — the cheap OPTIONAL query, one per 100 candidates,
  now asked of EVERY candidate anchor on the page rather than the two per
  section picked blind. Answers Met objects (P3634), Art Institute of Chicago (P4610),
  iNaturalist taxa (P3151), GBIF occurrence maps (P846), **IIIF manifests
  (P6108, `src/iiif.js`, added 2026-08-03)** — any IIIF-publishing institution
  with no per-partner code; Presentation v2 and v3 both parsed; best coverage
  today is SMK Denmark and BnF Gallica, and stale manifest URLs (e.g. Trinity
  College Dublin's platform move) degrade to no card — and P625 coordinates.
  (2) `resolveMappability` — place/defunct, asked only of location-bearing
  anchors among the ones a section actually PICKED, never of every candidate.
  Keeping this half narrow is what makes widening the first half affordable:
  widening both would take Apollo 11 from 16 location-bearing items to 95 and
  its class walk from 0.63s to 1.11s, for maps no section will ever render.
  Two small follow-ups: direct P31/P576 on the items (no closure), then a plain
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
  The ancestor walk is cached per class (`fact-class-*`, see Contracts):
  `mergePlaceDefunct` split into `classVerdicts` (rows → verdicts) and
  `applyVerdicts` (verdicts → items) so the class half can come from disk, and
  the old signature and its tests survive the split. **A class the walk
  returned no row for is a real answer — "reaches nothing" — and is cached as
  one**, or it is re-asked forever. Not extended to item→classes (P31/P576) on
  purpose: an item's own statements change far more often than the class
  hierarchy above them, a poor trade for a cache whose only invalidation is
  deleting `.cache/`.
  **`applyVerdicts` must be handed exactly what this pass queried, never a
  wider map** — it writes `place='false'` onto any location-bearing item with no
  class binding in the current batch, so a wider map does not leave already
  resolved items alone, it OVERWRITES them. With the lede resolving ahead of the
  page (see Streaming profile) that was a live race: the page-wide pass stomped
  "Supreme Court of the United States" back to unmappable while the lede band
  was still reading that object, and Brown v. Board lost its lede map.
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
order anchor ownership AND candidate ranking, between the cheap partner query
and the expensive one — see Query, then pick) + `breadth` (is this anchor a
category?) + `citations` (per-section `<ref>` templates, and the coverage
tally/line — moved here from `discover.js` 2026-08-04) → `hero` (which find
leads the section) → `emit-html`.
`src/html.js` holds `escapeHtml`, the one rule every renderer shares.

## Key Decisions

- **HTML is the only output** (2026-08-04). CSS reflow solved what
  hand-computed `.tapestry` pixel geometry could not — dead whitespace,
  squashed images, non-responsive — so the Tapestry emitter
  (`layout`/`emit`/`zip`/`vendor/parse-root.mjs`) retired to the attic with the
  generator that drove it. It still ran when it was retired; nothing used it.
- **The float holds the section's best find; references sit at the foot**
  (2026-08-05, superseding the 2026-08-03 arrangement in which the floated
  `.rail` carried the references). The rail had held the references fold,
  closed, so the most prominent slot on the page — the top right of every
  section — read "REFERENCES IN THIS SECTION · 18" and the prose indented
  around one line of small caps. References belong where a reader goes looking
  for them, which is the bottom. `bandParts` now returns **`{rail, deck,
  refs}`**: `rail` is the hero card (or empty), `deck` the media shelves,
  `refs` the fold at the section foot. Media still rides a full-width deck
  below the float — flex-wrapped, each shelf's flex-basis sized to its cards
  (capped at three) so small shelves share a row — because stacking shelves in
  the 404px rail built columns 2–4× taller than the text and left the whole
  left half of a band blank. At ≤640px the band-body turns flex, the float is
  undone and the order is stated explicitly (hero → prose → media → refs) so a
  future DOM change cannot silently reorder it.
- **The hero is picked by how directly it answers the section**, not by
  quality (`src/hero.js`, `pickHero`/`heroRank`, 2026-08-05). Tiers: the
  subject AS a document (Brown v. Board's opinion must not lose to a
  thumbnail) → a partner's record of the subject, illustrated → the same
  unillustrated → something the subject made → any illustrated record of
  something merely linked → a map (it locates rather than shows) → text-only
  records of things merely mentioned. `standing` is set where the entry is
  made, by the code that knows whether the anchor was the subject, and is
  never re-derived by reading prose. **A section whose best find has neither a
  picture nor the standing of a primary document gets NO float** and its prose
  runs full width — a lone text card blown up to 404px is the thin box this
  change exists to remove. The hero comes out of the entries before they are
  shelved, so nothing is both hoisted and carded.
- **A partner holding more than 300 items under a non-subject anchor gets a
  sentence and a browse link, not four cards** (`src/breadth.js`, `tooBroad` /
  `BROAD_ABOVE` / `broadNote`, 2026-08-05). The signal was already on the page
  and unread as a diagnostic: the DENOMINATOR. Every shelf worth showing came
  from a heading holding tens or low hundreds (54, 83, 126, 190); every shelf
  worth dropping from one holding thousands (465, 652, 831, 1,409, 3,016,
  6,123). **The subject's own heading is exempt at any size** — a thousand
  items filed under this article's subject are about this article's subject;
  a thousand filed under the category it belongs to are about a thousand other
  things. Deliberately no card, no thumbnail, no title: the point is that the
  pipeline cannot tell which four of six thousand belong here, and inventing
  four would claim it can. A threshold fitted to twelve observations from six
  articles — read it as the heuristic it is; the cost of either mistake is
  bounded (a shelf becomes a sentence, or a sentence stays a shelf).
- **The section shows Wikipedia's own footnotes** (2026-08-03, replacing the
  earlier curated three-source shortlist): each band renders the
  actual `reference-text` bodies the section's markers point at, numbered as
  the prose numbers them — closed by default behind a one-line `<details>`
  summary (2026-08-03 late: a wall of citations must never be a section's
  first block; `__open` expands the fold when a marker is clicked). The fold
  moved from the floated rail to the section foot on 2026-08-05 (see above);
  it holds the references and nothing else — the per-section coverage line
  that used to sit outside it became one page-level sentence in the
  visibility panel (2026-08-04). Where a note cites a
  book OpenLibrary says is readable/borrowable, the access link rides on the
  note. Prose keeps its wikilinks — rewritten to `/wiki/…` on this site, so
  readers click through to more enriched renders — and its footnote markers.
  No section numbering: Wikipedia doesn't number, so neither do we.
  `sanitizeFragment` in `src/wikipedia.js` is the only thing that lets
  article HTML through; everything else is still escaped.
- **Every Wikidata-backed card carries a provenance fold, and the why line is
  what opens it** (2026-08-03 late; merged 2026-08-05): a `<details>` whose
  text states the exact chain (`entry.trace`) and links
  the statement it rests on (`entry.fix` — `wikidata.org/wiki/Q…#P…`), because
  Wikidata's statement anchor IS the edit button. The why line and the ⓘ were
  separate until 2026-08-05, which put the most useful thing on the card — a
  "Check or fix it on Wikidata" link, present on 76% of them — in a 12px grey
  glyph below the fold of a 178px caption. The line that says why a card is
  here is now the `<summary>` that opens the working: link-colored, no extra
  height. Three shapes are all real (`provenance()` in `emit-html.js`): why +
  fold, a bare "How we know" fold where the shelf head already said the why,
  and a plain why line where there is no trace. Stamped where the qid is in
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
  Its "N shown earlier on this page" disclosure went with it — nothing is
  dropped as a duplicate any more, so there is nothing left to disclose. The
  rule that a page must never quietly drop what it found survives in the sample
  and broad notes below.
- **Query, then pick — a section chooses anchors that hold something**
  (2026-08-05). Anchor selection used to run *before* the pipeline knew what
  any anchor held: each section took two prose links on document order, asked
  WDQS about those two, and if neither held anything the section rendered
  nothing while its third and fourth links held a Met object or a taxon. On
  Apollo 11 that left 11 of 36 sections empty, 9 with usable material one link
  further down. Measured across that page's 331 candidates: 23% carry an
  item-level identifier, 26% only a subject heading, **50% nothing at all** —
  so picking two blind misses about half the time. Now every candidate is asked
  about first (the cheap half only) and `preferYielding` (`src/dedup.js`) orders
  each section's candidates by `hookRank`: item-level identifier → any other
  hook → nothing. **Tier 1 is deliberately not subdivided.** Ranking headings
  above coordinates cost American Gothic's lede the map of the actual house in
  the painting; ranking coordinates above headings turns Apollo 11's 95
  location-bearing candidates into wallpaper. Neither is defensible from what
  is known at pick time, so document order breaks the tie and `src/breadth.js`
  catches the headings that turn out to be boxes. Cost on Monarch butterfly:
  empty sections 6 → 5, cards 72 → 96 — and the time is not the extra WDQS
  (+0.6s) but the 24 extra partner objects the better anchors earn, fetched
  serially per host as etiquette requires.
- **The lede anchors on what the article is ABOUT, not what it is made of**
  (`subjectAnchors`/`preferRelated` in `src/dedup.js`, 2026-08-05). An
  encyclopedia's first sentence is a definition, so the earliest links in a
  lede name the class the subject belongs to. "American Gothic is a 1930 oil
  painting on beaverboard by Grant Wood" gave the lede `oil painting` and
  `beaverboard`, and four of Europeana's 6,123 openly licensed oil paintings —
  all four Finnish, all four titled "öljymaalaus". Every unhelpful shelf on
  every showcase page came from an anchor of that kind. The lede now ranks
  candidates by the subject's own Wikidata claims, **already fetched for the
  subject pivots, so no new request**. THREE tiers, and the middle one is
  load-bearing: ranking by MEMBERSHIP is not enough, because the item does name
  beaverboard (P186 material used) and a flat test still puts it first. Ranking
  by WHICH PROPERTY names it puts particular things (P170 creator, P195
  collection, P180 depicts) above categories (P186, P135, P31) above
  never-mentioned. `NAMES_A_THING` is deliberately incomplete and safely so —
  a missing property costs a little ordering, never a wrong answer.
  **Lede only**: the subject's claims are the only ones fetched, and no
  statement says what §"Cultural significance" is about, so guessing one would
  be worse than document order. The lede composes both rankings — yield first,
  relevance second — sorting by (subject tier, hook rank).
- **The lede-first ordering must not change the page, only its timing**
  (2026-08-05). It is sound because the lede is unit 0: `claimAnchors` walks
  units in article order, so nothing upstream can take an anchor from it and
  its picks are a function of its own candidates alone. Those picks are seeded
  into the page-wide claim, which therefore reaches an identical result. Three
  showcase renders byte-identical to the previous commit is how that is
  checked, and a test asserts the seeding.
- **A claim about a sample rides the shelf it describes; a note about an
  absence closes the deck in a different voice** (2026-08-05). Bands carry
  `samples` (one record per `(source, topic)` — the same key the renderer
  groups shelves by) and `broad`, replacing the old single joined `disclosure`
  string printed atop the deck. That string put "4 of the 54 items DPLA
  catalogs under…" two shelves above the DPLA cards it counted, with Internet
  Archive and OpenStreetMap in between — a claim a reader cannot attach to
  anything, which is worse than no claim. Each sample now lands on its own
  shelf head as the count badge ("4 of 54" where a bare "4" sat), full sentence
  on the `title`. **A claim whose shelf never rendered — capped away, or
  hoisted into the hero — falls back to the old deck-level paragraph, because a
  disclosure that can silently vanish is not a disclosure.** The broad note
  (above) leads with "Not shown here:" and sits at the END of the deck, with a
  hairline instead of a filled slab: the phrasing collision with "A sample, not
  the whole shelf:" was deliberate, right for continuity with the retired
  coverage line, and wrong the moment both could appear at once — one describes
  cards the reader can see and the other describes cards that are not there.
  The shared-why hoist fires on any shelf whose cards agree, not only on a
  source split across anchors, because a badge with no sentence beneath it
  needs something to say what the 54 ARE.
- **Images are sized by CSS, not by measurement** — `.shot` is `width:100%` and
  lets the intrinsic aspect stand; `.frame` fixes 16/9 only for embeds, which
  have no intrinsic size. Reading true dimensions from JPEG/PNG headers
  (`imagesize`) was a requirement of the hand-computed `.tapestry` geometry and
  went to the attic with it on 2026-08-04; nothing in the live tree reads image
  headers, and no `<img>` here carries width/height. If a layout ever needs to
  reserve space before load, that code is in
  `../../attic/all-the-opens/tapestry-gen-curated/`.
- **OpenLibrary covers are inlined** as data URIs — they redirect through
  archive.org, so a live dependency would break whenever IA is down.

## Invariants

- Pipeline modules never assume an output format; the renderer is the only
  format-specific layer.
- No rendered image is squashed by a guessed aspect: the renderer states no
  dimensions and lets the file's own aspect stand (see Key Decisions).
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
- `src/citations.js` — citation extraction, OpenLibrary
  access, and the citation tally (`citationCoverage` per band → `pageCitations`
  summed → `citationHeadline`). `prioritizeCitations` and `reachabilityRank`
  were **deleted 2026-08-05**, dead since the gutter switched to rendering
  Wikipedia's own footnotes; four passing tests kept them looking live for
  weeks, and a green test is not a caller. Said **once per page**, in the visibility
  panel: per section it fired 36 times on San Francisco and 26 of those
  reported nothing but a failure to find, and its "27 works" sat directly under
  the fold's "18 notes" — two totals of different things reading as a
  contradiction (2026-08-04 review).
- `src/dedup.js` — anchor ownership AND anchor ranking; five exports, all pure
  over article-ordered input (see Key Decisions for why purity is
  load-bearing). `claimAnchors` assigns each QID to the band of its first
  mention. `subjectAnchors` + `preferRelated` rank the LEDE's candidates by
  which property of the subject's item names them; `hookRank` +
  `preferYielding` rank ANY section's candidates by what its partner
  statements turn out to hold. `dropSeenFiles` left with Commons 2026-08-04.
- `src/hero.js` — `pickHero`/`heroRank`: which of a section's finds is hoisted
  into the floated rail, and when a section gets no float at all.
- `src/breadth.js` — `tooBroad`/`broadNote`/`BROAD_ABOVE`: when a partner's
  holdings under an anchor are a category rather than a subject, so the shelf
  becomes a sentence and a browse link.
- `src/http.js` — the URL-keyed request cache, plus `readFacts`/`writeFacts`,
  the key→JSON cache for derived answers (see Contracts). Keys must be
  filename-safe and are **REFUSED, never sanitized** — a sanitized key can
  collide with another and return the wrong fact. One file per key, not per
  kind, because the deployed server runs up to `MAX_CONCURRENT` discoveries at
  once and a read-modify-write of a shared file would lose entries; two writers
  racing on one key write the same bytes. A cache that cannot write logs and
  continues: it makes the page slow, never wrong.
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
