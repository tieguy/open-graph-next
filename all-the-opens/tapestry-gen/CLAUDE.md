# tapestry-gen

Last verified: 2026-08-17

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

- **Reads** nothing on disk but its own cache and `src/icons.js` — the partner
  favicons, which are page furniture rather than findings and are generated, not
  authored (`tools/build-icons.mjs`). Every page is discovered live from the
  article title.
- **Writes** `demo/spike-<resolved-title>.html` from `spike.js` — gitignored
  since 2026-08-03: no render output is committed; the demo is the live
  streaming server.
- **Network** all goes through `.cache/` (gitignored), keyed by request URL —
  reruns are offline and byte-reproducible. Delete `.cache/` to refetch. On the
  deployed server this directory is a **Fly volume**, not container scratch (see
  Deployed demo), and `src/sweep.js` bounds its size.
- **`.cache/page-<build>-<title>.html`** (`src/page-cache.js`, 2026-08-10) is the
  streaming server's finished renders — see The page cache under Deployed demo.
- **`.cache/fact-<kind>-<key>.json`** (`readFacts`/`writeFacts` in `src/http.js`,
  2026-08-05) is the same cache holding *derived* answers rather than response
  bodies — today `fact-class-Q….json`, two booleans per Wikidata class,
  `fact-lc-labels-….json` (2026-08-08), the LC label set per P244 id, and
  `fact-img-<key>.json` (2026-08-10), the `/img/` registry the streaming server
  reads back after a restart so a replayed page's images resolve — null
  included, because a permanent 404 re-asked every render would break the
  once-ever promise to id.loc.gov (see `lcLabels` in `src/lc.js`). It is
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
  its own lookups answer (`bandRail` ships all three parts — hero float, media
  deck and references — and `__thb` mounts each where it belongs: float before
  `.prose`, deck and refs after).
  No client framework; the stream is the page. Same
  pipeline, budgets, cache and politeness as batch — only the byte timing
  differs. Byte-reproducibility is a batch-only invariant; streamed pages are
  expected to vary with live data.
  **Images are the one place the two renderers genuinely differ** (2026-08-05).
  Batch inlines them as `data:` URIs because its output must be one
  self-contained file; streaming serves them from `/img/<sha1-of-url>` instead.
  Inlining cost the streamed page three ways: every cover and tile was fetched
  serially *before* its band's fragment could be written, base64 was a third of
  the bytes (164 KB of Angkor Wat's 494 KB), and the same fifteen icons were
  re-embedded in every page so a browser could never cache one across two
  articles. Measured after: front page 111 KB → 19 KB, an article 252 KB → 62
  KB. The fetch is still server-side under our User-Agent, which is all the OSMF
  tile policy and the OpenLibrary-redirect argument ever required — neither
  asked for the bytes to be *in the HTML*. The `/img/` registry only holds URLs
  the server itself chose: an image proxy that fetches whatever a caller names
  is an open proxy.
  **Which images both renderers fetch themselves is one predicate** —
  `hotlinkUnsafe` in `src/http.js` (2026-08-09; the two copies of the host
  regex it replaced had already begun to drift in comments). Three classes:
  OpenLibrary covers (the archive.org redirect), OSM tiles (tile policy), and
  DPLA/DigitalNZ thumbnails, which point at hundreds of PROVIDER hosts that
  rot and hotlink-block — decided by SOURCE, not host, because the long tail
  is the point (log entry 9 in `../docs/reaching-open-collections.md`: one
  Apollo 11 render met an NXDOMAIN'd thumbnail hostname, a 403-to-bots host,
  and a both-ids-404 host). A thumbnail the server cannot fetch 404s from
  `/img/`, the card's `onerror` drops the image, and the six-line text clamp
  takes over — an honest text card, never a broken-image icon. `coverDataUri`
  caches real non-answers (404, placeholder) but not transient failures
  (2026-08-09) — one upstream timeout must not blank a card forever.

Both entry points share `src/discover.js`, which reports progress
through an async `emit('spine'|'band', …)` callback — batch ignores the
events, streaming writes fragments from them. `emit('spine', {page, units,
dropped})` fires before any lookup; `emit('band', band)` fires per band in
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

`serve.js` runs publicly at **https://friendsof.wiki/**
(Fly.io app `help-from-our-friends` — renamed from `article-tapestry`
2026-08-03; personal org, sjc, one machine always up since 2026-08-05 —
scale-to-zero until then; `Dockerfile` + `fly.toml`
here). The public name is *"Help From Our Friends: An Open Knowledge Web
Experiment"*. Deliberately **one machine** (scaled down 2026-08-03; use
`flyctl deploy --remote-only --ha=false` if ever recreating): the disk cache
is per-machine, and Fly's default second "HA" machine made requests alternate
between two independent cold caches — every page felt cold forever. One
machine = one cache that accrues. Part of what accrues is **shared across
articles**: the `fact-class-*` verdicts are a small, near-static vocabulary that
articles draw on the same corner of (25–72% of a page's classes were already
answered for an earlier one, measured across seven articles), and Library of
Congress authorized headings behave the same way — so warming the showcase also
warms articles nobody has asked for yet.

**The cache is on a Fly volume as of 2026-08-05, and "accrues" was not true
before that.** A Fly machine's rootfs is rebuilt from the image on every START,
not merely on deploy, so `auto_stop_machines = "stop"` emptied the cache a few
minutes after the last visitor left. Measured: after a forced stop/start the
machine held **107 cache files / 2.0 MB** against 968 / 40 MB in a warm local
one, and Angkor Wat — rendered cold minutes earlier — cost 5.9s again rather
than 0.3s. On a low-traffic demo that meant nearly every visitor was a cold
visitor and `warm.js` was warming something that evaporated on the next idle
timeout. The earlier claim here that deploys wiping the cache was "the accepted
trade" was an argument about deploys that never checked what idling did.
`[[mounts]]` in `fly.toml` now maps `tapestry_cache` to `/app/.cache`; the
volume is 3 GB, `serve.js` caps usage at `CACHE_MAX_MB` (default 2048) and
evicts least-recently-**read** files above that (`src/sweep.js` — read time, not
write time, because the oldest entries here are the most shared and so the most
valuable). A full volume fails cache *writes* while reads keep working, which
presents as the demo mysteriously being slow again.

**Deploy with `npm run deploy`** from this directory — just `flyctl deploy
--remote-only` since 2026-08-10. **The server warms its own showcase**: after
`listen()`, when `WARM_ON_START` is set (prod's `fly.toml` sets it; staging and
local dev deliberately do not), it walks the six showcase pages through its own
front door (`src/warming.js`) — **serially**, as ordinary traffic with no
exemption from the per-host queues or the admission gate. Before this the walk
was `node warm.js` appended to the deploy script, which meant every deploy
ended attached to the operator's shell and a fresh volume stayed cold until
someone remembered. Now the machine that boots over an empty page cache is the
one that fills it, and a restart on a warm volume pays six local replays.
Titles come from `showcaseTitles()`, the list the front page renders its own
cards from; a test asserts the two agree, because drift would show up as a slow
demo link rather than an error. `npm run warm [url]` is the same walk by hand —
refill after an eviction sweep, warm a staging volume once, or verify a deploy
serves pages. It exits non-zero if a page did not finish (`window.__tapdone`,
the flag `streamClose` writes last — the site is slow, not broken), and reports
**thin** pages separately: warm but provisional, rendered while a source was
refusing us (next section). `WIKIMEDIA_UA_CONTACT` is a **Fly secret** (set to
the operator), never in `fly.toml` — a fork must set its own. Guards for public
exposure: `MAX_CONCURRENT` discoveries (default 4, then 503), `robots.txt`
offering crawlers nothing but the front page (`src/robots.js`), and the
per-host queues already bounding upstream traffic globally.

### The page cache (2026-08-10)

**A page is discovered once.** `.cache/` was only ever a REQUEST cache, so every
view re-ran `discover()` — parse the cached article, slice the sections, run
every lookup, rank, render — about a quarter-second of work to re-derive an
answer that could not have changed, because **nothing in this cache expires**.
Repeat views never bought freshness; they bought a recomputation. `serve.js` now
stores the bytes a finished stream actually sent and replays them: a repeat view
is one file read, taken **before the concurrency gate**, since a replay is not a
discovery and the cap exists to bound discoveries.

Four things it has to get right, all of them in `src/page-cache.js`:

- **Keyed by a build id**, a fingerprint of the exact files the Dockerfile ships
  (`src/*.js` + `serve.js`; `BUILD_ID` overrides). Without it a deploy would
  serve the previous build's markup forever, silently — the worst failure a
  cache has available. Earlier builds' renders are purged at startup (after
  `listen()`, like the sweep) rather than left to age out. Verified live: one
  appended comment moved the id and the stored page stopped being served.
- **Keyed by the title as the reader spelled it**, via `titleKey` shared with
  `src/admission.js`, so `apollo_11` and `Apollo 11` replay one render. A
  redirect earns its own entry under its own name — a duplicate render, never
  the wrong article.
- **Never a partial page**: temp file then rename, and written only on the path
  where discovery finished. A page cut short by an upstream failure must be
  discovered again, not served to everyone who asks next.
- **The `/img/` registry has to survive the process.** It was an in-memory Map,
  and a replayed page names paths a later process never minted, so every image
  on it would have 404'd after a restart. It writes through to
  `fact-img-<key>.json` now. This does **not** open the proxy: an entry exists
  only where `imgPath` put one, and because the key IS the hash of the URL a
  remembered entry is *verified* rather than trusted — anything that does not
  hash back to its own key is refused. Both halves verified live (a remembered
  key resolves; a planted mismatched one 404s).

**The footer now dates the render**, and that disclosure was owed before this
change and not made: with a never-expiring request cache, a "live" repeat view
has always shown the ecosystem as it stood when someone first asked. The line
says so — "Discovered live from … on August 10, 2026 … Later visits are served
this same render". `no-store` stays on the response deliberately: the volume
holds the copy, and a browser's copy could not be retired by a deploy.

Storage is cheap next to what it replaces: a streamed article is ~62 KB against
~4 MB of request cache per page, and these files ride the same LRU sweep.

**The showcase has a reserve past that cap** (`src/admission.js`, 2026-08-10).
`MAX_CONCURRENT` used to be applied to every `/wiki/` request alike, which broke
the promise the front page prints — the six showcase articles are "already
rendered and cached", and a reader arriving while four cold discoveries were in
flight got the busy page for a page that would have been served entirely off
disk. `SHOWCASE_RESERVE` (default 2) is slots only those six may take, admitted
on the reader's own requested title (a redirect *to* a showcase article is not
known to be one until the parse call answers, so it rides the general lane).
**It widens nothing anyone else sees** — `hostLimit()` bounds upstream
concurrency globally and knows nothing about in-flight discoveries; the worst
case, a cold volume, is two more discoveries waiting on those same per-host
queues. The reserve is finite on purpose: a showcase page is refused too once it
is full.

**The page cache shrank this job but did not retire it.** A stored showcase page
never reaches the gate at all now, so the reserve covers only the windows where
the showcase is genuinely cold: a fresh volume, the minutes after a deploy while
the startup warm refills, an eviction sweep. Deleting it would make the busy page's
offer false in exactly those windows, which is the one thing that page must not
be.
**The busy page and the reserve are one change.** The 503 was a single sentence
of system-ui on a blank page — a dead end offered by a site with six finished
pages warm on disk. It is `busyPage()` in `src/front-page.js` now, built once at
startup (the moment it is needed is the moment there is no capacity to build
anything), sharing the showcase cards and their CSS with the front page so the
"ready now" promise reads the same in both places. A busy page linking to pages
that would themselves answer 503 would be worse than the dead end it replaced,
which is why the two must not be separated.
**It therefore needs the icon bytes too** (2026-08-13): a showcase card carries
its page's other friends as logos, and those bytes live in the stylesheet
(`faviconStyle`), so `busyPage({inline: icons})` — not `busyPage({})` — is what
`serve.js` must call, or every card renders a row of blank white squares.

### The front page is an FAQ below the showcase (2026-08-13)

Two questions readers actually asked — *why did you build this* and *how might
this help protect Wikipedia from LLMs* — had no answer anywhere on the site,
while the friends list, "How it works" and "Challenges" sat under headings
nobody had asked for. All five are questions now, with an index above them, and
the two new ones lead. The showcase cards were compressed in the same change:
article, one `Adds:` line naming the best single addition, and the page's other
friends as a row of logos, replacing a sentence per card that described a page
the reader had not opened yet.

**The `friends` slugs in `SHOWCASE` are hand-written and unverifiable from the
code.** The front page is built once at startup, before any of those pages has
been discovered, so deriving the row would mean six discoveries' worth of
partner requests at boot to draw logos. A live page is the authority; re-eyeball
the rows whenever the showcase changes or a partner stops answering. A test
asserts only that each slug names a friend the page lists — it catches a rename,
never drift.

### When a source refuses us (2026-08-10)

Measured on production the day the page cache shipped: every render cost
214–240s, and all of it was one lookup — OpenAlex answering 429 to chunk after
chunk of one page's DOI lookups, each chunk honoring `Retry-After` with its own
minute of sleep inside a reader's request. Correct per request, wrong per page.
From the operator's own IP the same query answered 200 in 0.39s at the same
moment: rate limits are per-client, and the fix must not be "try harder."

**`src/cooloff.js` remembers a refusal per host.** A 429 arms a cool-off; every
later request to that host inside the interval fails immediately instead of
queueing behind another sleep (measured: three chunks, one upstream request,
30ms). Declining to send a request honors `Retry-After` more strictly than
sleeping-and-retrying ever did. **503 keeps the old wait-and-retry** — that is
"busy, come back shortly", the shape MediaWiki's maxlag protocol uses, and a
lagging Wikimedia must make this site slow, never blank. Only 429 — "you,
specifically, are asking too much" — arms a cool-off, capped at 15 minutes
because `Retry-After` is whatever the other end says.

**A render made during a cool-off is whole and missing things at once**, so it
is stored *marked* — `page-<build>-<hash>.thin.html`, with
`window.__tapthin=[hosts]` written into its bytes just before `__tapdone`. It
replays for exactly as long as the refusal stands (re-rendering sooner would
reproduce it and burn a discovery slot doing so) and is replaced by the first
render after everyone answers; writing either kind of page retires the other.
Both simpler policies were measured wrong first: storing it plain froze five
minutes of someone's rate limit into days of a thinner article, and not storing
it at all suspended the page cache site-wide for the length of every cool-off.
A re-render touches no other provider — 0 upstream requests on a repeat view,
the request cache absorbs all of it — so the only costs in play are CPU,
latency, and staleness, and the thin mark trades them deliberately.

**Staging: `npm run deploy:staging`** (2026-08-09) deploys the same image to
**https://staging.friendsof.wiki/** (Fly app `help-from-our-friends-staging`,
`fly.staging.toml`; a Hover CNAME points the subdomain at the fly.dev host)
for review-before-deploy — the answer to UI work piling up on main with prod
withheld. It differs from production exactly where staging should: its own
3 GB `tapestry_cache` volume, scale-to-zero (a reviewer can eat the cold
start), no self-warming (`WARM_ON_START` is deliberately absent from
`fly.staging.toml` — nobody to keep warm for, and warming per review round's
deploy would spend partner API capacity to save no reader any time; warm by
hand ONCE on a fresh volume with `node warm.js https://staging.friendsof.wiki`
and the volume keeps it), and `ROBOTS_DISALLOW_ALL=1`, which flips
`robots.txt` to `Disallow: /` so no staging render is ever indexed.
`WIKIMEDIA_UA_CONTACT` is a separate secret on the staging app, same
no-default rule — as are the partner keys (`DPLA_API_KEY`,
`EUROPEANA_API_KEY`, `SMITHSONIAN_API_KEY`), without which those lookups
silently skip and staging renders sparser than the same commit would on
prod. Fly secrets are write-only, so they cannot be copied app-to-app
through the API; the working route (2026-08-09) is reading them off the
running prod machine — `fly ssh console --app help-from-our-friends -C
printenv` — piping into `fly secrets set` on staging, and verifying by
digest match in `fly secrets list` (the digest hashes the value). Deploying
to staging never touches production; promoting is the ordinary
`npm run deploy`, a separate decision.

**Nothing may touch the network before `server.listen()`.** The source icons
used to be fetched at startup — fifteen hosts, serial, at module top level — on
a machine whose cache had just been wiped, so they were real requests every
time. They are committed bytes now (`src/icons.js`, from
`tools/build-icons.mjs`).

Be precise about what that bought, because the first estimate was too
generous. Cold start decomposes as: Firecracker + init **1.2s** (Fly's, fixed),
then `docker-entrypoint.sh` to the `live discovery on…` line, which was **6–8s**
before and is **~4–5s** now. The application's own share of that is **180ms**,
measured import-by-import on the machine — `mw.js` pulling m3api is 162ms of it
and everything else is single-digit milliseconds. So the icon loop was worth
roughly 3s, and **the remaining ~4s is Node itself starting off a cold rootfs**,
not this code. Front page cold: 9.9s → 6.8s.

That residual is a platform cost with only platform answers, and the answer
taken was **`min_machines_running = 1`** (2026-08-05): the machine no longer
stops, so there is no cold start to pay. Do not go looking for it in `serve.js`;
there is 180ms there in total. The remaining lever, if a cold start ever matters
again, is a smaller base image.

The demo is therefore no longer scale-to-zero, and costs a few dollars a month
rather than nothing. That was a deliberate trade against a **6.8s front page** —
a page that does no discovery at all — for a site whose argument is what the
open ecosystem can show you.

Fixtures are Apollo 11 (event, `{{sfn}}` citation style), Brown v. Board (legal,
inline `{{cite}}`), Ludwig Prandtl (person, thesis reachable only by description).

**Rembrandt replaced American Gothic as the art showcase on 2026-08-06**, and
the swap is what drove the artworks lookup: the Met and the Rijksmuseum were
both landmark open-access releases, and an artist article shows them together
where a single painting shows one museum. An article ABOUT a painting gets
nothing from `src/artworks.js` — The Night Watch fired the lookup zero times,
because P170 points *from* the painting *to* Rembrandt and not the other way.
Johannes Vermeer is the tighter alternative if the page is ever felt to be too
busy: 2 museums and 60 cards against Rembrandt's 3 and 116, with the nicer
disclosure ("3 of 5 works ... the Met", "3 of 4 ... the Rijksmuseum").

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
peers. Removing it took the P180 depicts lookup, the P373 category lookup,
`dropSeenFiles`, and the whole unit-to-unit `seen` chain with it — that
machinery existed for Commons alone. Commons now appears only in the
visibility panel, named as the door. Page density is the cost, paid
deliberately: Angkor Wat 107 cards → 15, Coral Gables 102 → 14.

## Single-institution work pages — the holder experiment (2026-08-17)

Where an article IS a museum-held painting or sculpture, the page stops being
a multi-partner assembly and becomes a **two-party collaboration**: Wikipedia
plus the one institution that holds the work. The masthead says so ("This
page: Wikipedia + <institution>"), the work leads in the hero, the museum's
own record of it merges with the Wikipedia infobox, and **every other partner
sits out**. Design:
`../docs/design-plans/2026-08-16-single-institution-work-pages.md`; the QA
window that measured it: `../docs/2026-08-17-holder-page-qa.md`.

**It is behind `HOLDER_PAGE=1` and off in production**, and flipping the
default is the operator's decision on that QA document. `HOLDER_PAGE` is part
of the page-cache build id (`src/page-cache.js`), so a flag-on and a flag-off
render can never share a stored page.

**Detection and selection are pure and cost nothing** (`src/holder.js`, over
the subject claims `discover.js` already fetches; the module fetches nothing).
`WORK_CLASSES` is direct P31 membership — painting (Q3305213), sculpture
(Q860861) — deliberately WITHOUT the ancestry walk, because the census counted
the population by direct P31 and the walk would sit on the lede's critical
path. The measured cost is 35 articles whose subject is P31 of a subclass only
(~2.4% of the population). `HOLDERS` is the precedence list: Rijksmuseum
P13234, Met P3634, AIC P4610, Cleveland P11110, Getty P2582, and the IIIF door
P6108 last. Where a work states several museum ids, the one whose museum
matches the subject's P195 wins over precedence. **No fuzzy matching, here or
downstream** — a work whose graph states no holder id gets no holder page.
`bestRankValues` reads those claims at best rank by hand (preferred if any,
else normal) because this path reads raw `wbgetentities` claims rather than
`wdt:` — see Invariants.

**The IIIF door yields a candidate, not a holder.** P6108 arrives from
whichever institution holds that object, so the record fetch must resolve the
manifest's own stated institution and a manifest naming none — or several —
gets no holder page: the masthead must never read "Wikipedia + IIIF
collections". Measured across two independently drawn windows, **0 of 44
manifest-held work-articles clear the gate** (30 in the Phase 2 inspection, 14
in the QA sample), mostly because the stated manifest URL does not answer with
a parseable manifest or the manifest names no single provider. The lane stays wired at the cost of one
manifest fetch before the page falls back; whether to accept, relax a leg, or
retire the lane is a standing item.

**One record shape, one gate** (`src/holder-record.js`). Each museum's catalog
response normalizes to the same record — title, creator, date, medium,
dimensions, accession, credit, rights, image, object page, institution — with
missing fields null rather than invented. `gateFailure` returns the FIRST
failing leg, in order: `no-record`, `no-institution` / `several-institutions`,
`non-pd-rights`, `no-image`, `no-object-page`. Every failure ships the ordinary
multi-partner page unchanged, which is why a refusal is never an error. The
rights leg reads the museum's own per-object flag and nothing else — in the QA
sample all six museum-lane refusals were modern works (Picasso, de Chirico,
Klee, Rückriem, Domínguez) whose museums do not flag them public-domain.

**Single-source discipline is enforced before a request is built, not after a
card is dropped.** `holderStatements` filters an anchor's partner statements
so no request is made at all: a museum holder keeps only its own property's
lookup, a manifest holder keeps none, and the Smithsonian pair, taxa,
occurrence maps and coordinates drop with them. `sitsOut` in `discover.js`
suspends the rest — the citation access lookups, mappability, DPLA, Europeana,
DigitalNZ, the scholarly batches, the Free Law opinion. Measured on the 25
holder pages of the QA window: zero foreign partner URLs anywhere in
enrichment markup, and the 42 that do appear all sit inside Wikipedia's own
footnote bodies, which render `reference-text` verbatim by design.

**"We could not look" must not render as "there is nothing there."**
`citationCoverage` takes `{searched}` and `pageCitations` carries it up, so on
a page whose access lookups sat out the visibility panel withholds the negative
("We could not find a free copy of any of them") and says the works could not
be checked this time. Carried as a fact rather than inferred from counts,
because most citations hold no ISBN and a count cannot tell "asked and found
nothing" from "never asked".

**The hero and the merged panel render together — the merge is the point, not
a fallback.** `heroRank` gains a tier above `subject-document` for
`holder-work` (the page's reason for existing), and that entry is exempt from
`FLOAT_MIN_PROSE` so a stub still leads with the work; the hero carries a
labeled link out to the museum's own viewer and the museum's required
statement where it has one. `src/panel.js` (pure) merges the sanitized
Wikipedia infobox rows with the holder's record into one table, **attributed
per source and showing disagreements side by side rather than resolving
them** — 19 of the QA window's 25 panels showed at least one genuine
two-party conflict. `FIELD_LABELS` is deliberately incomplete: an unmapped
infobox label passes through unmerged. A conflict is normalized text only, so
"363 cm × 437 cm" and "363 cm × 437 cm (142.9 in × 172.0 in)" differ — a real
difference must show.

**The related shelf asks the graph, not a museum search API.**
`subjectArtworks(qid, {property})` restricts the works-by-creator query to the
holder's own property, so the shelf is the creator's other works at the same
museum. The unrestricted UNION URL is untouched and pinned by a test — see
Gotchas for what that pin costs an ordinary page.

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
Identifier lookups are batched (`src/batch.js`): one archive.org Solr OR-query
per run of ISBNs, one OpenLibrary volumes request per 40 (`|`-separated), QIDs
and labels at 50 per request. Lookups run concurrently across hosts over the
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
that is the cheap half; see Partner lookups.

**Where a cold page's time actually went, measured 2026-08-05.** The `settled in
Xs` stderr lines only wrap the article-global batches, and by this date those
were no longer the problem: on production, every batch settled by **1.8–2.0s**
while the pages finished at **9.5s** (Angkor Wat) and **13.6s** (Hedy Lamarr) —
79–87% of the page in a tail nothing measured. That tail is the per-band partner
work, and almost all of it was two hosts: `id.loc.gov` 27 requests / 5.1s serial
and `api.dp.la` 21 / 3.9s, against 73 requests and 15.1s of total network time
for the whole page. If a cold page feels slow again, count requests per host
before believing the `settled` lines — they describe a part of the page that was
already fast. `requestTally` and `peakConcurrency` in `src/mw.js` are the
instruments; `spike.js` prints the tally at the end of a run.

**Production after the 2026-08-05 work**, for orientation only (see the warning
below before quoting any of it): warm showcase pages 0.23–0.50s; a genuinely
cold article ~7s; **the same article on a later visit 0.26s, and that now
survives the machine idling out** — which is the change that matters most and
the one a single measurement hides. Cold Angkor Wat measured locally 7.9s → 5.7s
with *more* content (56 → 60 cards), since the LC fix earns six more anchors.

**Wall-clock here is not quotable.** Same code, same article, same warm class
cache: Monarch butterfly cold measured **26.2s once and 10.7s another time on
identical work** (2026-08-05). The variance is upstream weather — every page
fans out dozens of serial-per-host requests to partners whose latency nobody
here controls — and it swamps the effect of any change this repo can make.
Count requests, which are deterministic; re-measure seconds before quoting any,
and never compare a number across dates. (Cold pages measured 55–67s on
2026-08-04 on code predating that branch, which proves nothing about that
branch.)

## Copyright, and who actually knows it (2026-08-06)

Every card can now say what a reader may DO with the thing on it, and the page
distinguishes two questions that look like one:

- **`rights.copy`** — the license the HOST serves this copy under. Europeana's
  rights URI, OpenAlex's slug, iNaturalist's `license_code`, DPLA's contributor
  statement, the Met's and the Art Institute's public-domain flags, a US court
  opinion. A promise somebody made about these bytes.
- **`rights.work`** — the copyright status of the WORK, from Wikidata `P6216`,
  qualified by jurisdiction (`P1001`) and by how anyone decided (`P459`), plus
  the creator-level `P7763`.

**They can disagree, and the disagreement is the point.** An institution
asserting terms over a photograph of a painting whose copyright expired is
exactly the situation the public-domain community built tooling to expose, so
the two are separate fields all the way to the renderer and neither is ever
printed as the other.

The work half is not an API. It is Wikidata, where **CopyClear**
(`Wikidata:CopyClear`, Dutch) runs bots — dodbot, lifesignbot, DACSbot,
ADAGPbot — establishing the copyright status of creators and of works in museum
collections, and where **Dominio Público en América Latina** maps Latin American
terms. Counted 2026-08-06: `P6216` on **2,004,830** items, `P7763` on
**473,320**, `P275` on **117,243**. **Paulina** (`paulina.toolforge.org`, 2025
Coolest Tool Award) is the tool that turns a status into a per-country answer;
it takes deep links by QID on `/work/`, `/author/` and `/term/`. Its funded
2026/27 work is a public-domain calculator meant to be reusable by other tools —
when that ships, `src/rights.js` is where it would be called from. Until then a
link is the honest integration: we do not reimplement a term calculation we
would get wrong. Neither is a "friend" in the front-page list or the visibility
panel, because both count collections that contribute cards and these contribute
none; they are credited in the rights copy, which is where their work is used.

### The rules, which are arguments and not preferences

- **The freest answer leads** (chosen 2026-08-06). Where a work is public domain
  somewhere and in copyright elsewhere, the card says so in that order. The cost
  is real and named: a reader in a longer-term country could take the first
  clause and stop. It is mitigated structurally — `rightsView` never emits the
  free clause alone, and the Paulina link answers for where the reader actually
  is.
- **A qualified status is shown qualified.** The rights line appears when the
  answers disagree AND when the only answer is free but names a jurisdiction.
  The second case came from a real card: American Gothic is public domain in
  countries whose terms run 70 years or less from the author's death, Wikidata
  records no contrary status, so the disagreement test found nothing and the
  card rendered a bare public-domain mark beside the Art Institute's name. That
  reads as a worldwide answer. An UNqualified status still gets no line — there
  is nothing to narrow.
- **A creator-level status gets a mark, and always says whose it is.** Trusting
  CopyClear's determination was a deliberate call (2026-08-06): it is a ruling
  on a body of work, recorded where anyone can check it. What it may not do is
  stand alone, so `line` names the author on any card whose answer came from the
  creator rather than the work.
- **A mark is never a guess.** `ccFromUri`/`ccFromSlug`/`ccFromLabel` return
  null for anything unrecognized. `other-oa` is the case worth remembering:
  OpenAlex knows the copy is free to read and does NOT know on what terms, and
  free to read is not a license. A rights-reserved Met object gets no © either —
  the Met asserting rights over its photograph says nothing about the object.
- **The rightsstatements.org vocabulary is read only where it is unambiguous.**
  Sampled across DPLA 2026-08-06 it outnumbered CC roughly three to one, so
  dropping it wholesale left most DPLA cards silent. `NoC-US` and `NKC` are
  genuine free statements and get the public-domain mark; `InC*` gets the ©.
  **`NoC-OKLR`, `NoC-CR` and `NoC-NC` deliberately get nothing** — all three mean
  "the copyright expired, and a contract or donor agreement or non-commercial
  condition still restricts you", so a public-domain mark would promise exactly
  what the statement withholds. `CNE` and `UND` — the rightsstatements twins
  of "not yet determined" — got nothing until 2026-08-08 and now carry the
  **? mark** (see the honest-unknowns rule below), with labels that keep them
  apart: CNE is "nobody has looked", UND is "looked, and could not tell".
- **Open Library's lending status beats a ruling about the author** (2026-08-06,
  `accessRights`). Found on a real card: Open Library files *Prentice Hall
  Literature — World Masterpieces* (1991) under Franz Kafka, and CopyClear's
  ruling on Kafka is "copyrights on works have expired", so a modern classroom
  anthology came out wearing a public-domain mark. The ruling was not wrong; it
  was about the wrong thing — Kafka's texts are free, a 1991 compilation of them
  is a new work. `ebook_access` fixes it because it describes **the edition the
  card is showing**: the Internet Archive lends one copy at a time precisely for
  books still in copyright, so `borrowable`/`printdisabled` replaces the creator
  claim with "Lent, not free — one copy at a time" and the ©. `public` lets the
  creator ruling stand. `no_ebook` and any unrecognized value change nothing —
  nobody digitizing an edition is evidence of nothing, the same stance
  `openLibraryVolumes` takes when a batch fails.
- **A creator-level ruling covers a work only if the creator is its SOLE
  author** (`soleAuthor` in `src/works.js`, 2026-08-06). Found on a live card:
  *Rembrandt, the Master & His Workshop* (1991) is filed by Open Library under
  Rembrandt Harmenszoon van Rijn **alongside Holm Bevers, Peter Schatborn and
  Barbara Welzel**, so a modern scholarly catalogue by three living authors
  rendered a public-domain mark. CopyClear's ruling was not wrong; it was about
  what Rembrandt made, and this is not that.
  **`ebook_access` could not catch it**: Open Library answers `no_ebook`, which
  is silence rather than a statement, and silence correctly changes nothing —
  so there was no OpenLibrary claim being overridden, only a creator ruling
  reaching somewhere it does not go. This **generalizes the Kafka fix below**
  rather than duplicating it: that case was caught only because the edition
  happened to be borrowable, while the sole-author test catches the whole class
  whether or not anyone digitized it.
  **A translator counts as a co-author, deliberately.** Kafka's 1915
  *Metamorphosis* is co-credited because an English translation is a new work
  with its own living rights holder — precisely where an author's expired
  copyright settles nothing. Cost, measured across three authors: co-authored
  works are ~20% of a shelf and only those without a lending statement change
  (6 of 40 for Rembrandt, 2 for Kafka). `copy` is never touched — a lent
  co-authored book still says it is lent, because that describes the object.
- **Wikidata's status attaches only to cards that ARE the entity.** Every entry
  `statementEntries` returns is the partner's own record of its QID, so the
  status is the status of the thing on the card. DPLA and Europeana shelves are
  items merely filed UNDER an anchor and carry `copy` only. The subject's own
  shelves (`subject-work`) carry the subject's creator-level status, because
  there the subject is the author.
- **A mark rides the ITEM, and the partner icon rides the credit** (2026-08-06,
  from a live card). The marks used to lead the credit line, which put them
  immediately before the institution's name: "⊘ Open Library" reads as a claim
  about Open Library, and the one thing a licence mark is never about is who
  handed you the bytes. They now lead the title, outside its anchor — they
  describe the item, they are not part of its name. The vacated slot took the
  partner's own favicon, which suited a source all along. The hero is exempt: it
  already carries a full source tag above its title.
- **The picture must depict the thing the claim is about** (`coverUrl` in
  `src/works.js`, 2026-08-06). `cover_i` is OpenLibrary's REPRESENTATIVE cover
  across every edition of a work; `ebook_access` is a work-level rollup meaning
  "some edition is free". Pairing them blindly produced the reported bug:
  **Macbeth has 1,867 editions**, so the card rendered a public-domain mark over
  the jacket of Harold Bloom's 1999 critical edition. Neither field was wrong —
  pairing them was. When the access verdict came from a scan, the cover now
  comes from that same scan (`ia` → `archive.org/services/img/<id>`), so Macbeth
  shows `macbethfacsimile0000will`, which genuinely is free. A work with no scan
  keeps the representative cover and makes no edition-level claim.
  **Not fixed, because it is theirs:** OpenLibrary reports Macbeth's
  `first_publish_year` as **1508**, about a century before it was written. A
  work with 1,867 editions has unreliable first-publication data and nothing
  here can know better.
- **A scan's word is checked before the shelf takes it** (`scanMatchesWork` in
  `src/works.js`, 2026-08-07). The Macbeth rule trusts Open Library's
  edition→scan link, and that link is sometimes somebody else's book: von
  Braun's *Das Marsprojekt* wore an 1874 railroad pamphlet as its cover, free-
  to-read claim and all (`docs/internet-archive-issues.md` #8). Each scan the
  shelf will show costs one cached `archive.org/metadata/<id>/metadata` request
  (≤ `WORKS_BY_SUBJECT`); the scan stays if the item's `openlibrary_work`
  backlink names the work OR the titles overlap — either alone, because the
  backlink goes stale on genuine scans too. Disowned means reverting to the
  no-scan posture: representative cover, no edition-level claim. Rejection only
  withholds, so a false one understates a card rather than misstating it. A
  KEPT scan whose own title reads differently gets a `scanned as “…”` caption —
  Rizal's *Noli Me Tangere* is scanned as its English translation *The Social
  Cancer*, and the card owns that instead of hoping nobody notices. "Reads
  differently" means neither folded title contains the other: Kafka's
  Tagebücher scanned as "TAGEBUCHER 1910-1923 (GESAMMELTE WERKE …)" is the same
  title wearing cataloging residue, and quoting it at the reader is not a
  disclosure.
- **A shelf ranks by edition count and folds shard records** (`authorWorksUrl`
  `sort=editions` + `dedupeShards` in `src/works.js`, 2026-08-07). Open Library
  answers "what did Rizal write?" with **186 works** for a man with a shelf of
  ten — the same book resurfaces as work records split by article, spelling, or
  diacritic (*El filibusterismo* / *Filibusterismo* / *El Filibusterismo*…),
  each with a sliver of the editions. The genuine record beats its shards by
  one or two orders of magnitude (Noli: 134 editions; shards: 1–12), so the
  server-side editions sort guarantees the real books are inside the 40-work
  fetch window, and a leading-article-and-diacritics title fold keeps one
  record per group — the one with the most editions, chosen explicitly so
  cached relevance-era responses fold correctly too. Translations filed as
  their own works under their own titles (*An eagle flight*, *The Social
  Cancer*) are beyond a title fold and stay, ranked down by their own edition
  counts; merging them would take external knowledge, not string logic.
  Kafka, the control: editions order agrees with the relevance order this
  lookup used before.
- **The article's own status goes at the head of the lede** (`subjectRights`,
  chosen 2026-08-06). An article ABOUT a work — The Great Gatsby — often has the
  richest rights data on the site and, before this, nowhere to put it: no
  partner here holds a record of a novel. It renders above the first paragraph,
  full width, never floated, and ONLY when no card on the lede already carries
  the same claim, so a page never says it twice.
- **An honestly recorded unknown is shown as one — the ? mark** (2026-08-08,
  revising the earlier renders-as-nothing rule; decided during the DigitalNZ
  review). "Not yet determined" (Q59496158), rightsstatements' `CNE`/`UND`,
  and DigitalNZ's `Unknown` are all somebody having looked and recorded that
  the question is open — which is not an answer and not an absence, and
  silence made it indistinguishable from a partner that publishes no rights
  fields at all. All three vocabularies now render the `unknown` glyph (a ?
  in a circle, `src/cc-icons.js`), whose click-fold says exactly which
  non-answer was recorded (`UNKNOWN_COPY` in `emit-html.js`, and
  `rightsView`'s open-question branch for the Wikidata case). The rules that
  keep it honest: it is never composed with a license mark, it never
  competes with a real answer (the Wikidata unknown surfaces only when it is
  the only thing recorded; `known: false` still keeps it out of the
  freest-leads ordering), and the stance — an honest unknown is a peer to
  the open statements, for now — is stated on the front page's challenges
  list, where its scaling cost is named.

### Partner audit, 2026-08-06

Every card-producing partner was checked against its own API rather than only
the ones already wired. What each one actually offers, and what we now do:

| partner | rights data available | status |
|---|---|---|
| Europeana | `rights` URI per item | read |
| DPLA | `rights` + `sourceResource.rights` | read (fields added to the query) |
| OpenAlex | `best_oa_location.license` | read |
| The Met | `isPublicDomain` (its CC0 flag) | read |
| Art Institute | `is_public_domain` | read |
| Rijksmuseum | `subject_to` on the VisualItem | read — see the trap below |
| Cleveland Museum of Art | `share_license_status` per object (its CC0 flag) | read |
| J. Paul Getty Museum | per-object `license` URI in the object page’s embedded JSON-LD | read |
| iNaturalist | `license_code` per photo | read |
| Free Law | none needed — 17 USC §105 | public-domain mark, stated |
| Open Library | `ebook_access` per work | read; overrides creator status |
| **IIIF** | **`rights` (v3) / `license` (v2)** | **was ignored — now read** |
| **Internet Archive** | **`licenseurl` in the search index** | **was not requested — now is** |
| GBIF | per-record `license`, but mixed | words only, corrected (see below) |
| OpenStreetMap | ODbL | words only — not a CC license, no glyph exists |
| arXiv | **nothing** | genuine dead end, see below |
| Smithsonian | n/a | no lookup builds cards; visibility panel only |
| DigitalNZ | `usage` array (plain-English capability words, not a URI/slug) | `All rights reserved` read via `ccFromUri`'s existing InC branch; `Unknown` gets the ? mark (honest-unknowns rule above); the fully-open combination words only, same stance as GBIF/OSM below — LUI-145, verified against live responses 2026-08-08, see `src/digitalnz.js` |

The Rijksmuseum trap is the one to remember, because the record hands you the
wrong answer first: it states TWO Creative Commons URIs, and the CC0 licenses
the catalogue text rather than the image. See `src/rijks.js` under Key Files.

Three real defects came out of it, and all three predate the rights work:

- **`ccFromUri` dropped 81% of the licenses archive.org states.** In a 400-item
  sample the two commonest values were `creativecommons.org/licenses/publicdomain/`
  (33) — CC's RETIRED pre-CC0 dedication, which the general
  `/licenses/<elements>/` branch read as an element list, found no `by` in, and
  discarded — and `usa.gov/government-works` (22), which is not a Creative
  Commons URL at all. Both now map to the public-domain mark, and both are
  tested against the literal strings archive.org returns.
- **IIIF manifests state their terms and nobody read them.** Sampled across real
  P6108 manifests, SMK answers `publicdomain/mark` and Yale `publicdomain/zero`.
  Presentation 3.0 requires the value to come from CC or rightsstatements.org —
  precisely the vocabulary `ccFromUri` already parses — so this was a partner
  handing us clean data into `license: null`.
- **The GBIF credit line named the wrong licenses.** It read "CC0 or CC BY".
  Sampled across four taxa, **85–94% of the occurrence records behind those maps
  are CC BY-NC**, with CC0 and CC BY the small remainder. The line omitted the
  commonest license and the omitted one was the restrictive one. Now "CC BY-NC,
  CC BY or CC0", still with no glyph: a tile aggregates records under all three,
  so any single mark would be a guess about which record a reader is looking at.

Two partners are deliberately left with words and no mark, and neither is a gap:

- **arXiv states no license anywhere in its API.** The Atom feed has no license
  element at all (checked 2026-08-06). The card claims only "Free to read", which
  is exactly what is known; anything more would need a request per citation
  against a source that is not arXiv. Where an arXiv paper is also cited with a
  DOI, OpenAlex supplies the license and that card carries it.
- **OpenStreetMap is ODbL**, which is not a Creative Commons license and has no
  glyph in this sprite. "map data ODbL — share alike, credit the mappers" says
  more than any mark could.

Also worth knowing: `possible-copyright-status` on archive.org looked promising
and is not usable. In a 400-item sample it was **absent 399 times**, and the one
value present was free prose ("In copyright. Digitized with the permission of
the rights holder."), not a code. It is set by some collections (Gutenberg items
carry `NOT_IN_COPYRIGHT`) and by almost nothing else.

### Cost, measured 2026-08-06

**+1 WDQS request per cold page, 0 warm.** `needsRightsQuery` gates on
met/aic/iiif — properties only an object has — so the query asks about the
subject QID and almost nothing else: on American Gothic, The Great Gatsby,
Monarch butterfly, Franz Kafka and Barbara McClintock it asked about **exactly
one QID** each, and the lede and page-wide calls built the same URL, so the
second was a cache hit. Failure semantic is mappability's: a failed query costs
the page its rights marks and never a card.

The query uses **UNION, not stacked OPTIONALs**. Every property here is
multi-valued and the qualifiers multiply again, so OPTIONALs would return their
cross product — one work with four jurisdictions and two licenses as eight rows
saying nothing the four and the two did not. Branches answering alone keep the
row count additive. No transitive walk is asked of items (see the mappability
note above for what that cost when it was).

## Partner lookups (2026-08-03)

Beyond IA/OpenLibrary, two lookup families (both budgeted per section):

- **Scholarly** (`src/scholarly.js`) — citation anchors carrying a DOI or PMID
  batch through **OpenAlex** (no key; `mailto` carries the operator contact);
  a card exists only when the work is genuinely open. **arXiv** citations are
  open by construction and become cards with zero requests. Subject-level:
  ORCID (P496) → the subject's top-cited scholarship, the papers' twin of the
  OpenLibrary author lookup.
  **Query, then pick applies here too** (2026-08-14, `preferOpen` in
  `src/dedup.js`). The section used to claim its three cited papers on
  DOCUMENT ORDER in the units loop and only then ask OpenAlex what was
  readable, so a closed paper spent a slot and rendered nothing — the exact
  anchors bug of 2026-08-05, in the other citation family. The whole page's
  distinct identifiers go to the lookup now, and `scholarPickedPromise` picks
  afterwards: only papers with an open copy compete, ones whose copy states a
  license lead, and the article's own citation order breaks ties. Measured:
  Monarch butterfly 41 claimed anchors → 26 cards became 30 → **30**, and
  Drosophila melanogaster 54 → 36 became 44 → **44** — every claimed slot now
  becomes a card, which is the whole of the fix. Cards that can name a license
  rose from 12 of 36 to 29 of 44 on Drosophila. Cost is one batch of 40 more
  or less: Monarch is unchanged at 2 OpenAlex requests, Drosophila goes 2 → 4.
  **Ranking is on the stated license, never on `open_access.oa_status`**
  (measured 2026-08-14, and the reasoning is on `openRank`). OpenAlex's
  `diamond` reads as "fully open journal with no article fee recorded", and
  OpenAlex holds no fee figure for **17,904 of the 23,235 DOAJ journals** it
  knows — so "charges authors nothing" and "nobody told us what it charges"
  arrive as the same word, which is an inference and not a statement. It is
  also the weaker signal on reuse: of 200 diamond works sampled **99 state no
  license at all**, against 27 of 200 gold, so promoting diamond would push a
  CC BY paper off a three-card shelf in favour of one that may reserve every
  right. The status is carried on the entry as `oa.status` and **printed
  nowhere**: an inference drawn from missing data is exactly what "a mark is
  never a guess" refuses, and this project has no slot for a claim it cannot
  stand behind. Wikidata's diamond class was measured the same day as the
  alternative — better asserted (ZooKeys correctly not-diamond, Zootaxa
  marked hybrid), but 1,572 journals, 7% referenced, and **zero recall**
  against the 113 venues two real articles cite. Full numbers and commands:
  `../docs/2026-08-14-oa-tier-data-quality.md`. Wikispecies was surveyed for
  its DOIs on the same day and declined — see Deliberately excluded below.
  **The visibility panel's paper count was wrong and is fixed by the same
  change.** "Of the N research papers among them, M are free to read" summed
  the per-band `papers` tally, which counted only the ≤3 per section that
  SURVIVED the blind pick; N is now every distinct paper the article cites,
  counted once in the band that cites it first, and M means readable rather
  than carded. Drosophila went from "54 papers, 36 free to read" to
  **"118 papers, 83 free to read"** — the same article, honestly counted.
  **The same-day audit found and fixed the books half of both bugs** (the
  full sweep is in the session notes; every other backend came back clean or
  already-documented):
  - *Counting*: "The original Wikipedia article cites N works" summed each
    band's full candidate list, and `resolveShortCites` dedupes per section —
    so a bibliography book cited from eight sections counted eight times.
    Apollo 11's panel claimed 216 works for 167 distinct ones, numerator
    inflated alike. Each unit now carries `counted` — its rail minus works an
    earlier band already counted (`claimCitations` with no cap IS the
    first-occurrence filter; `citationKey` in `src/citations.js` is the
    identity) — and `applyAccess` was split out of `citationCoverage` so
    access verdicts still land on EVERY band's own candidate objects for the
    footnote borrow links while the tally counts the subset.
  - *Blind pick*: books claimed three per section on document order and only
    then asked the Internet Archive which were scanned, so a scanless book
    spent a slot rendering nothing (Apollo 11: scans for 7 of 29 identified
    works, one lost to the cap). `pickIaCards` in `src/discover.js` is the
    books twin of `scholarPickedPromise` — only IA-held books compete, no
    license tiers (a scan is a scan), lede picks off its own batch so
    lede-first survives.
  - *Coherence*: `citationHeadline` counted only BOOK access in "M of them
    you can read", so Monarch butterfly read "We could not find a free copy
    of any of them" three sentences before "34 are free to read". The
    readable count now folds in the open papers; the papers clause stays as
    its breakdown.
  **The ORCID shelf got the same medicine** (`openAlexAuthorWorks`): it
  filtered openness AFTER a top-25-by-citations window, so an author whose
  most-cited work is paywalled showed an empty shelf while open papers sat
  past row 25. When the window yields fewer than `cap` open works and the
  catalog holds more than the window saw, one follow-up asks OpenAlex for the
  top-cited OPEN works directly (`openOnly` in `openAlexAuthorWorksUrl`); the
  printed denominator stays the unfiltered count, which is what the shelf's
  sentence promises.
  **A retracted cited paper shelves under its own head — "Retracted
  papers"** (2026-08-14). "The journal took this back" is the strongest
  claim any card on the page makes about a cited work and exactly what the
  Wikipedia article rarely shows, so it is named plainly rather than
  scattered through the ordinary citation strip: retracted papers do not
  compete for the section's `SCHOLARLY_PER_SECTION` slots and answer to no
  cap (a page has none or one, not a shelf-full — and losing Wakefield to a
  cap because a section also cites three sound open papers would drop the
  page's best finding). **A closed retracted paper is the one closed paper
  that IS a finding**: its card links the paper's own DOI, the credit says
  `Retracted`, and the why line says no free copy was found — while the
  visibility panel's "M are free to read" excludes it (`noFreeCopy`). The
  fold links the retraction notice itself, and the ORCID shelf's stamping
  in `discover.js` words the same fact for the subject's own papers.
  **The flag prints only corroborated** (`retractionNotices` /
  `noticeRetracts` in `src/scholarly.js`): the paper's own Crossref record
  must carry a Retraction Watch-curated `updated-by` retraction entry
  (`source: 'retraction-watch'` — publisher-deposited entries are refused),
  AND the named notice's `update-to` must point back at the paper. Both
  filters are measured, not cautious defaults: OpenAlex's most-cited
  `is_retracted:true` work, the 2020 Lancet Commission dementia report, is
  not retracted — a publisher-deposited entry ties it to another paper's
  notice, and the bad link is symmetric, so the back-link test alone passes
  it and the source filter is load-bearing; all four famous retractions
  sampled (Wakefield, Surgisphere, STAP, the NEJM Mediterranean diet) pass
  both. An expression of concern never prints as a retraction (Gautret's
  hydroxychloroquine paper is the live case). An uncorroborated claim is
  withheld — the scan rule's failure semantics. Cost: two cached
  `api.crossref.org` requests per work OpenAlex flags, usually zero per
  page. Acceptance fixture: the Lancet MMR vaccine-autism report article
  renders Wakefield's paper on the shelf, notice link and all, and warm
  re-renders stay byte-identical.
- **Statements** (`src/statements.js`) — WDQS, split into a CHEAP half asked of
  everything and an EXPENSIVE half asked of almost nothing (2026-08-05). The
  split is the load-bearing part; see Query, then pick under Key Decisions.
  There is no both-halves wrapper: `entityStatements` was kept for a day after
  the split and deleted 2026-08-05, never having had a caller or a test. Call
  `partnerStatements`, pick anchors, then `resolveMappability`.
  (1) `partnerStatements` — the cheap OPTIONAL query, one per 100 candidates,
  now asked of EVERY candidate anchor on the page rather than the two per
  section picked blind. Answers Met objects (P3634), Art Institute of Chicago (P4610),
  **Rijksmuseum objects (P13234, `src/rijks.js`, added 2026-08-06)**,
  **Cleveland Museum of Art objects (P11110, added 2026-08-17 — keyless, CC0,
  record-by-id, the cleanest of five probed surfaces)**, **J. Paul Getty
  Museum objects (P2582, `src/getty.js`, added 2026-08-17 — the record surface
  is the object page's embedded JSON-LD, because `data.getty.edu` answers real
  and bogus ids with the same 404)**,
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
  every partner lookup, its timeout cost the page Met/AIC/GBIF/iNat/IIIF/DPLA/
  Europeana too. Now failure of either follow-up costs only maps (they are gated
  on the place/defunct booleans), never the partner lookups. Result: P625 →
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
- **The subject's own artworks** (`src/artworks.js`, added 2026-08-06) — the
  third case of a pattern the project already had twice: `src/works.js` asks
  OpenLibrary for the books the subject wrote, the ORCID lookup asks OpenAlex
  for their papers, and this asks Wikidata for the artworks they made
  (`?work wdt:P170 ?subject`, UNION over P3634/P13234/P4610/P6108). One WDQS
  request; the picked works then ride their own partners' fetchers, so a
  painting reached this way renders identically to one reached through a
  wikilink. Passing `{property}` builds the RESTRICTED variant instead — one
  binding, no UNION — which is how a single-institution page gets the
  creator's other works at its own holder and nowhere else; the binding name
  is derived from the same `PARTNERS` list `artworkRows` reads, so it cannot
  drift, and an unknown property throws rather than building a valid query
  whose binding nothing reads.

  **It exists because the article's own links could not carry the question,
  and that is a structural fact rather than a ranking bug.** `proseLinks`
  strips `<table>` blocks, and on an artist article the links to individual
  paintings live in galleries and works-tables. Measured on enwiki's
  Rembrandt, 2026-08-06:

  | stage | anchors carrying a museum id |
  |---|---|
  | all links in the article | **35** (Met 11 · Rijks 14 · AIC 1 · IIIF 9) |
  | survive the `<table>` strip | 14 (Met 2 · Rijks 5 · AIC 1 · IIIF 6) |
  | reach the partner lookup | 3 |
  | rendered as cards | **2** |

  The strip is load-bearing — it is what keeps navboxes, infoboxes and
  succession boxes off every page — so the fix was to stop routing this
  question through links at all, **not** to loosen the strip. Asking the graph
  instead answers 553 works for Rembrandt, 218 Monet, 141 Hokusai, 96 Van
  Gogh, 35 Tissot, 12 Vermeer, and works on every artist article rather than
  only ones with tidy galleries. Rembrandt's museum cards went 2 → 11.

  **Diversity is the whole point and is enforced.** Rembrandt's 551 break down
  as 481 IIIF, 39 Met, 29 Rijksmuseum, 2 AIC, so any natural order gives six
  IIIF cards on the page whose argument is how many different friends hold
  this material; `pickDiverse` round-robins across partners first. It
  over-picks and walks the list until `cap` cards actually exist, because a
  403 from one manifest must cost its own card and not a SLOT — IIIF manifests
  really do 403, three did across Rembrandt and Vermeer.

  **Gated on the subject being a person** (`needsArtworksQuery`, P31 → Q5),
  the same shape of gate as `needsPlaceDefunctQuery`: without it the lookup
  spends one WDQS request per page asking what paintings a butterfly or a court
  case produced, and WDQS is on the lede's critical path. Verified after: Brown
  v. Board pays nothing, Rembrandt is unchanged. Deliberately narrow — a
  workshop or collective is not Q5 and gets no shelf, which is a trade against
  the transitive class walk that CLAUDE.md already records as costing 16–37s.

  Two correctness notes worth keeping: the row `LIMIT` is 1000 because the row
  count IS the shelf's disclosure ("6 of 551") and a silently truncated total
  would print a false claim (`truncated` is reported so the caller can say "at
  least"); and a work whose English label is missing is dropped, because WDQS's
  label service falls back to the bare QID and a card titled "Q123456" is not a
  card. These shelves carry the subject's creator-level status as well as the
  museum's own `copy` statement — permitted by the rule that a `subject-work`
  shelf is the subject's own output, and NOT the Kafka-anthology case, since a
  painting with P170 pointing at the subject is that subject's own work.
- **DPLA** (`src/dpla.js`, added 2026-08-03) — one subject-heading lookup per
  band on its most prominent labeled anchor; the anchor is a *cataloger's*
  LCSH subject heading, not a Wikidata statement, and the cards say so.
  Requires the `DPLA_API_KEY` env var (free by mail); absent the key the
  lookup silently skips, so clones run keyless.
  **This is the most expensive lookup on the page and the most productive** — 40
  of Angkor Wat's 56 cards — so it is tuned rather than trimmed.
  **The shelf is ranked here, not by DPLA** (`rankDplaEntries`, 2026-08-08,
  LUI-144). The query is a facet filter, and a facet has no relevance gradient:
  every item carries the heading equally, so the first rows are an arbitrary
  page of an unordered list. Measured on "Armstrong, Neil, 1930-2012" — 60
  items, about 50 genuinely Apollo 11, and the four DPLA returned first were the
  only junk in the set (a Ricci poster, a portrait, a balloonist, a Columbian
  exposition record), which is exactly what the page had been showing. So one
  request now reads a **50-row window** (`DPLA_FETCH_WINDOW`; same request
  count, bigger body) and the pick is scored locally: `2 x` distinct
  anchor/heading tokens in the title, `+1` for a thumbnail, ties broken by
  DPLA's own order.
  **The denominator is a promise; the sample is a judgment** (the LUI-144
  rule as revised 2026-08-08). `total` stays the heading's own count, always —
  that is why `q=` was rejected: `q="Neil Armstrong"` cuts the count 60 → 23,
  silently shrinking a denominator this project prints on every shelf, and
  still ranked "Bussed balloonist" fourth. But the sample itself is now
  FILTERED as well as ranked: records failing the corroboration test (next
  bullet) never reach the ranker, and "4 of 60" stays true because 60 never
  moves. Worst case, where no title shares a token, every score is 0 or 1 and
  the order is DPLA's own.
  **The subject field rides the same request** (2026-08-08): the fields
  projection wants the LEAF, `sourceResource.subject.name` — the bare
  `sourceResource.subject` is a `bad_request` that costs the whole shelf, and
  the flattened value is a bare string for single-subject records and an
  array otherwise. Verified live; see `dplaUrl`.
  **Dedup is part of the same fix, not a tidy-up.** Those 60 items hold only 42
  distinct title-prefixes (one group repeats **ten** times), so ranking alone
  would have filled the shelf with four copies of one ceremony photograph — a
  worse shelf than the arbitrary one. `uniqueEntries` (exact title per holder)
  was never enough; the fold is a normalized 40-char prefix, **across** holders,
  because the duplicates arrive from different contributors.
  **Known limit: the fold is per shelf, not per page.** Angkor Wat still renders
  "Ancient Angkor" three times, from three different headings' shelves. Page-wide
  dedup is a separate question with history — `dropSeenFiles` and the unit-to-unit
  `seen` chain were deleted with Commons on 2026-08-04, and the purity argument
  under Key Decisions is why they looked the way they did. Read that before
  reviving anything page-wide.
  Three earlier fixes landed 2026-08-05, and two of them were correctness, not
  speed:
  (1) `lcHeadingFromGraph` matched `@id.endsWith('/' + id)`, but LC ships the
  identifier **twice** — the authority record, which carries the heading, and
  `id.loc.gov/rwo/agents/<id>` for the real-world thing it names, which does
  not. `find` took whichever came first and **that order varies per record**, so
  n80014970 (Cambodia) resolved and n79006404 (France) returned null; 8 of 14
  sampled ids lost that coin flip, each *after* the fetch was paid for. It
  matches the whole authority URI now.
  (2) The heading arrives from a **HEAD** request (`getHeader` in `src/http.js`)
  reading `x-preflabel-encoded`, not from the 88–120 KB JSON-LD body. Use the
  *encoded* variant: HTTP headers are Latin-1 and LC writes UTF-8, so the plain
  `x-preflabel` gives "CÅdÃ¨s, George", which then goes to DPLA as a subject
  query matching nothing — a silent empty shelf indistinguishable from an anchor
  nobody holds anything under. `redirect: 'manual'` is required, because the
  header rides a 303 whose target LC's CDN refuses to non-browser clients.
  (3) `api.dp.la` runs 4 at a time; `id.loc.gov` stays at 1. See the partner
  limits section under Wikimedia compliance for why those two differ.
- **Corroboration** (`src/relevance.js`, 2026-08-08, out of LUI-145's Apollo
  11 review) — the second gate on every search-shape shelf, answering a
  question the breadth gate cannot: not "is this anchor a box?" but **"is
  this record about the article, or merely about one thing the article
  mentions?"** The strict subject match makes every card's claim TRUE — the
  record really is filed under that heading — and Apollo 11 proved truth is
  not relevance: a Fraggle Rock lunch box under "Smithsonian Institution",
  Trotsky under "Soviet Union", iPhone cartoons under "Adam (Biblical
  figure)". Every anchor genuinely in the article, every shelf genuinely
  about its anchor, none of it about Apollo 11.
  **Why `tooBroad` missed it, and always will**: its threshold is an absolute
  item count, and an absolute count is partner-relative. DPLA holds tens of
  thousands under "New York (N.Y.)" — folded to a sentence; DigitalNZ holds
  eleven — four junk cards sailed under the gate. And within DigitalNZ no
  threshold exists: the good shelves (Aldrin 9, Apollo 11 14) and the junk
  (Chicago 5, Tokyo 5, New York 11) have the same counts. The count proxies
  "anchor is a box" only when the partner's catalog is large and local to
  the article's geography; a distant partner breaks it in both directions.
  This is what "the DigitalNZ results on Apollo 11 are bad" turned out to
  mean, and the fix is deliberately NOT a geographic gate on the partner —
  per the generalization value, one mechanism for every search-shape source.
  **The rule**: a record earns its card only if its own subject field touches
  the article at least once BEYOND the anchor that fetched it. The topic
  space is every candidate anchor holding an LC authority, with its label
  (`topicSpace`, built from maps each band already holds — deterministic, so
  byte-reproducibility survives). Matching is normalized token containment
  (`subjectNamesAnchor`): loose enough to catch "Armstrong, Neil Alden,
  1930-2012" against the label "Neil Armstrong" — a form LC's record carries
  only as a fullerName — and honest because corroboration is an internal
  filter, never a printed claim; the card still prints only the verified
  heading. The Turnbull moon-landing photos pass on "Moon", "Space flight",
  "Astronauts"; the lunch box touches the article exactly once and dies.
  **Places don't corroborate** — measured into the rule the same day: every
  junk record that survived the first version had corroborated through a
  place ("White House", "Japan", "United States"). A place subject says
  where, not what. `place` is "has an Earth coordinate" via the same
  `parseEarthPoint` the map cards use — so the Moon, whose P625 is lunar,
  remains the best corroborator on the Apollo page. Two exemptions: the
  article's own subject corroborates even as a place (a record touching
  Angkor Wat on the Angkor Wat page IS about the article), and subject-anchor
  shelves skip the test entirely, same as `tooBroad`.
  **A shelf with no corroborated records is skipped whole** — no cards, no
  sample line. "0 of 48" would dress an absence as a disclosure.
  **What it costs, measured 2026-08-08**: the labels request widens to every
  LC-bearing candidate (~1 extra batched wbgetentities per page; both label
  promises already waited on the partners map, so nothing waits longer), and
  DigitalNZ reads a 20-row window (`DIGITALNZ_FETCH_WINDOW`) instead of 4 —
  same request count. What it trades, deliberately: pages get sparser, and
  shelves must now be about the article, not about something it mentions.
  Angkor Wat's DPLA went 40 → 22 cards and the survivors read curated
  (Vishnu, Brahma, Theravāda, Khmer language, graywacke); Yeates kept his
  Turnbull hero and lost the tangential Massey/Taranaki shelves; Prandtl
  lost the Auckland "Kick Hitler" WWII pennants. What still passes, known
  and accepted at the LUI-144 trade level: records tangential to the
  article but genuinely connected through a non-place anchor — NZ Obama
  cartoons ride the anniversary section's Obama link, a Tokyo bus thesis
  rides "fuel cell". Europeana does not read the context yet: its records
  arrive entity-linked rather than heading-searched, so its relevance
  failure mode is different, and opting it in is a field mapping plus
  `_subjects` — **plus a wider fetch window** (2026-08-14 audit): Europeana
  fetches `rows=4` against a display cap of 4, the pre-fix DPLA shape, so
  today a ranker or corroborator would have nothing to choose among. Widen
  `EUROPEANA_PER_ANCHOR`'s fetch side in the same change or the gate is a
  no-op.
- **Europeana** (`src/europeana.js`, added 2026-08-03) — anchors are looked up
  only through their stated Europeana entity (P7704); the search asks for items
  enriched with exactly that entity URI, `reusability=open` only, and each
  card names its item's license. Gated on `EUROPEANA_API_KEY`, same keyless-
  skip rule. The
  subject's own statements enrich the lede. Map images are single OSM tiles
  fetched server-side and inlined as data URIs — **never**
  `maps.wikimedia.org` (Wikimedia-projects-only; refuses outside referrers)
  and never browser-hotlinked (OSMF tile policy). Every partner here is
  outside Wikimedia by design — that breadth IS the demo.
- **DigitalNZ** (`src/digitalnz.js`, added 2026-08-08, LUI-145; live-verified
  and made strict the same day) — the demo's first non-US/EU partner: 150+
  New Zealand libraries, archives and museums (Turnbull/NLNZ, Massey, VUW,
  Auckland Museum, Ngā Taonga, Papers Past) behind one API. Same search shape
  as DPLA and keyed on the same property (P244): NLNZ is not an independent
  VIAF contributor and catalogs through LC/NACO (checked on VIAF's
  contributor list 2026-08-08), so LC's record of the authority carries the
  heading NZ catalogers use.
  **It carries it as a VARIANT, and that finding is the whole design** (all
  live-verified 2026-08-08, recorded on LUI-145). The first draft reused
  DPLA's `lcHeading` and quoted the authorized heading into DigitalNZ's
  `text=` search; that returned ZERO records for its own fixture, because
  `text=` is full text over titles/descriptions while DPLA queries a subject
  field, and because LC's authorized form ("Yeates, J. S. (John Stuart),
  1900-1986") is not the form NZ records state ("Yeates, John Stuart,
  1900-1986" — LC's variant). So `src/lc.js` GETs the full LC record for
  authorized + variant forms (the one place the HEAD trick is not enough —
  see the comment there for why DPLA's HEAD could be folded into this GET as
  a follow-up), the query is `or[subject][]=` across all forms, and a record
  becomes a card ONLY if its own `subject` field states one of them — so
  every card's "filed under this heading" claim is verifiably true of that
  record. **Strict by decision** (2026-08-08): the cost is that records with
  no person-level subject never surface, and on the Yeates fixture that is 7
  of 8 — including Massey's three openly licensed images, whose only subject
  is a collection name, and (usefully) the enwiki article itself, which
  DigitalNZ indexes with `content_partner: ["Wikipedia"]` and no subjects. A
  looser name-match would reach them but could no longer say "cataloged
  under"; per VALUES.md's generalization principle it is filed to be
  explored ACROSS sources or not at all — see the loose-match Linear issue —
  not hacked in for one partner.
  **Strict-about-the-anchor turned out not to mean relevant-to-the-article**
  (2026-08-08, the Apollo 11 review): every card was true and a third of
  them were junk. The corroboration gate under Partner lookups is the answer,
  and it is shared with DPLA, not DigitalNZ-specific. Same day, `src/lc.js`
  stopped hardcoding `/authorities/names/` — topical anchors (sh ids: Moon,
  Astronauts, Space flight) had been 404ing silently and getting fact-cached
  as null, so the lookup never fired on a topical heading; they now branch to
  `/authorities/subjects/` via `lcBranch`, and a pre-fix cache may hold
  stale nulls for sh ids (deleting `.cache/` is, as ever, the whole reset).
  **A key is optional, unlike DPLA/Europeana**: the v3 API answers keyless
  (verified), `DIGITALNZ_API_KEY` rides along when set (`keyOptional` in the
  spec), and `api_key=` with an empty or bogus value is a **403** — keyless
  means omitting the parameter. No published numeric rate limit, so
  `hostLimit()` stays at the default 1.
  **The API's metadata terms are NON-COMMERCIAL by default** (Developer API
  terms read 2026-08-08 — via the Wayback Machine, because the live page
  challenge-gates non-browser clients; capture 2026-05-05). A separate keyed
  commercial track exists ("get in touch", covers "only a selection of
  DigitalNZ metadata"), and the terms' carve-out for metadata with existing
  open licenses names Europeana (CC0), DPLA (CC0) and data.govt.nz (CC BY 3.0
  NZ) — i.e. sources this demo already reads directly — **not the NZ
  collections themselves**. The demo makes no money, so it can run inside
  the default terms — but the goal can't. Per VALUES.md (2026-08-08):
  adoption by Wikipedia or something Wikipedia-like requires that anyone may
  reuse the result, commercially included, so **an NC condition on the pipe
  is a blocker, never a box ticked** — "we are non-commercial so it's fine"
  is the wrong sentence anywhere in this repo. Flagged on the front page's
  challenges list as "Terms on the pipes, not just the items"; DigitalNZ's
  FRIENDS entry links the terms. If a DigitalNZ relationship ever forms, the
  thing to ask for is new terms or an agreement that opens this pipe.
  The rights mapping deliberately does not glyph DigitalNZ's own
  `Share`/`Modify`/`Use commercially` rollup — see the partner audit table
  above.

Deliberately excluded: Wikisource (prefer non-wiki partners in the demo),
OCLC/loc.gov (overlaps OpenLibrary), Wayback cards (no thumbnail API — a
card with no visual is just a link, and links are already inline).

**Wikispecies as a source of DOIs, measured and declined 2026-08-14.** The
aggregate is real — 31% of 150 random mainspace pages carry a `doi.org` link,
about 0.5 per page across 956,529 pages — but the per-article yield against
the Wikipedia article this site renders is roughly one. Across 15 flagship
species articles: enwiki 831 cited DOIs, Wikispecies 18, **14 of them
net-new**. Across 22 random taxa holding both pages: enwiki 36, Wikispecies
26, 19 net-new — the ratio flips for stubs and the volume does not. Three
things kill it as a partner: the DOI-dense pages are taxonomist bibliographies
(Fabien L. Condamine 13, Tamás Pócs 5), not taxa, so they never line up with
an article subject; only 22 of 300 random pages had both a DOI and an enwiki
article; and the densest prefix is `10.11646` — **Zootaxa, which is not open
at all** (`is_oa: false`, not in DOAJ, 33,014 closed works), with `10.3897`
Pensoft second at a $754 APC and `10.15468` third being GBIF *dataset* DOIs
rather than papers. A source whose densest offering is paywalled is the wrong
shape for this page.
What Wikispecies does hold a great deal of is **identifiers**, not DOIs —
per 300 random pages: Catalogue of Life 266, GBIF 245, DOIs 125, Tropicos 118,
IRMNG 113, iNaturalist 100, IPNI 100, EOL 94, **BHL 93**, POWO 92, NCBI 87,
WoRMS 66, ITIS 62 — roughly 10:1 over DOIs, and most of those are already
Wikidata properties this pipeline reads (P846, P815, P830, P850, P961, P3151).
The one lead that is genuinely not already in hand is **BHL**: open scans of
original descriptions, which is exactly what a species stub cannot show. That
is a partner question and belongs with the parked species-box work (LUI-141),
not with citations.

## Adding a data source

**Moved 2026-08-10 to `../docs/adding-a-source.md`, which is canonical.** Read it
before adding a partner; it carries the three shapes (direct-id / search /
hand-written), every file a new source touches, the pitfalls with the incidents
behind them, and a definition of done. Update it in the same commit as the
partner — that is why it lives in git rather than in a blog post.

Two rules from it are repeated here because skipping them has cost this project
a block risk and a shipped 404, and because an agent may not open a second file:

- **`hostLimit()` defaults to 1 and stays 1 without a published policy quoted
  beside the entry** — widened entries live in the partner manifest
  (`hostLimits` in `src/partners.js`). Read the host's own rate-limit or
  crawl-delay statement first. This is the step every partner audit here has
  found skipped when something went wrong.
- **Resolve a real identifier AND a deliberately bogus one before shipping.**
  The bogus one is the test: it proves the server distinguishes them. Guessing a
  URL shape put `/en/collection/object/<numericId>` on live Rijksmuseum cards,
  and bot mitigation makes four partners answer both ids identically.

## Pipeline (output-agnostic core → renderer)

`wikipedia` (sections, prose, wikilinks, QIDs, lead images, infobox links,
section wikitext) → `discover` (anchors, lookups, budgets) → `dedup` (article-
order anchor ownership AND candidate ranking, between the cheap partner query
and the expensive one — see Query, then pick) + `breadth` (is this anchor a
category?) + `citations` (per-section `<ref>` templates, and the coverage
tally/line — moved here from `discover.js` 2026-08-04) → `hero` (which find
leads the section) → `emit-html`.
`src/html.js` holds `escapeHtml`, the one rule every renderer shares.

On a single-institution page two more pure modules join the chain: `holder`
(is this article a museum-held work, and whose?) runs off the subject's claims
before any lookup and narrows what `discover` may dispatch, and `panel` merges
the Wikipedia infobox with the holder's record for `emit-html`. Both fetch
nothing; `holder-record` is where that half's network lives.

## Key Decisions

- **The page wears MediaWiki's design language, hand-written** (2026-08-07/08,
  the wiki-skin branch; the long argument is the comment block above `STYLE`
  in `src/emit-html.js`). The render's claim — "here is the article, and here
  is what the open ecosystem holds that it does not show" — lands only if the
  first half LOOKS like the article, so the skin imitates Vector: sans body,
  serif hairline-ruled headings, #36c links, thumb-framed cards, wrapping
  galleries instead of scrolling strips, wikitable panels. What is borrowed
  is the design language thousands of wikis wear; what is NOT borrowed is
  identity (no wordmark, no tabs, the masthead names the experiment first)
  or CSS (every rule is hand-written in `STYLE`; TemplateStyles are never
  passed through). Disclosure folds open under one shared LENS magnifier SVG
  (2026-08-08; replaced the circled i). A differentiation pass — small
  deliberate departures from Vector so the page cannot be mistaken for
  enwiki — is requested and pending.
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
  holding institution's record of the very work the article is about, on a
  single-institution page (2026-08-17 — the page's reason for existing) → the
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
  shelved, so nothing is both hoisted and carded. A `holder-work` hero is the
  one entry exempt from `FLOAT_MIN_PROSE`: the page exists to show the
  holder's record of the subject, so a stub leads with the work.
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
  `sanitizeFragment` in `src/wikipedia.js` and `extractInfobox` (below) are
  the only two things that let article HTML through; everything else is still
  escaped.
- **The lede rail falls back to the Wikipedia article's own infobox**
  (2026-08-08, wiki-skin branch;
  `../docs/design-plans/2026-08-08-infobox-retention.md`). A find ABOUT the
  subject (`heroRank ≤ 3`) keeps the rail; a weaker hero — a map, a picture
  of something merely linked — yields to the box and leads its shelf instead,
  and a lede with no find at all (John Stuart Yeates, the fixture) gets the
  box where it previously got nothing. `extractInfobox` in `src/wikipedia.js`
  sanitizes it (navbar, hidden rows, Kartographer, footnote markers, styles
  all dropped; `File:` links held absolute to en.wikipedia.org as the
  attribution trail); the box is **furniture, not a find** — no source tag,
  absent from `sourcesUsed`, the legend and the visibility panel, with an
  ⓘ-fold explaining the slot in the house voice ("no friend has one yet").
  Exempt from `FLOAT_MIN_PROSE`: a stub's short prose wrapping under its
  infobox is what a real stub looks like. Images hotlink in both renderers —
  Commons permits it — per the inline-only-what-breaks rule.
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
  subject lookups, so no new request**. THREE tiers, and the middle one is
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
  on the `title`. **Three heads can carry a badge, and the hero is one of them
  as of 2026-08-10**: the shelf head, a floated single's caption head, and now
  the hero's source bar. The hero was the biggest remaining hole, because
  `pickHero` removes its entry from the list *before* anything is grouped, so a
  one-entry shelf that got hoisted always orphaned its claim — on Apollo 11's
  "Apollo program" section the reader met "A sample: 1 of the 17 items DPLA's
  partners catalog under 'Apollo 15 (Spacecraft)'" as a grey slab below the
  prose, describing a card floating at the top right, with nothing tying the two
  together. The hero takes the badge only when the key is still unused: a hero
  hoisted off a shelf whose other cards *did* render must not make the claim
  twice, and the shelf's own head counts what the reader can actually see.
  **A claim whose shelf genuinely never rendered — capped away, or dropped —
  still falls back to the deck-level paragraph, because a disclosure that can
  silently vanish is not a disclosure.**
  **And the badge is the DOOR where one can be named** (2026-08-10,
  `sampleBadge`). "4 of 54" states that fifty items exist somewhere the reader
  cannot see, and the page had a browse link for exactly that and spent it only
  on the shelves it FOLDS — so a reader was handed the door precisely when
  there was nothing to look at first. The number itself is now the link, which
  adds no furniture to a 178px card, and it stays a manila slug rather than
  becoming blue and underlined: the claim is still the point, the ↗ and a
  hover fill are the affordance. `url` rides the sample record, set at the one
  push site in `bandPropertyLookup` from **`spec.browseUrl`, the same builder
  the broad note uses** — a second copy of that logic could drift so a folded
  shelf and a sampled one sent readers to different pages.
  **A badge links only where this project can name a page making the SAME
  claim as the number**, which is the `authorBrowseUrl` test and is why two
  sample kinds stay plain (both reasoned at their push sites in
  `discover.js`): OpenAlex's denominator counts papers under an ORCID while
  the shelf shows only the open ones, so a link showing all of them would sell
  the paywalled ones as part of the find; and the museum artwork counts are
  *Wikidata's* count of works the graph records a museum as holding, a
  question no museum publishes a browse for — the Rijksmuseum-404 rule (a href
  is verified, never constructed) applied to a count. DigitalNZ's link is the
  one loose case and knowingly so: its browse is a full-text phrase search, so
  it can over-show against a subject-filtered denominator — the trade
  `digitalnzBrowseUrl` already documents for the broad note.
  The broad note
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
- **Every lookup reads a Wikidata property at best rank, through `wdt:`.**
  `wdt:` serves best-rank values only, so no card rests on a deprecated
  identifier — the load-bearing fact behind this project's claim to be a reuser
  that reads ranks. The rule holds by convention, and breaking it is ordinary
  work: a statement's qualifiers and references are reachable only through
  `p:`/`ps:`, which return every rank, and species-box work (LUI-141) wants
  exactly that in order to read P141's IUCN sourcing. Such an edit raises no
  error. The site simply starts serving identifiers whose own catalogs retired
  them. The exposure is live — Wikidata holds 866 deprecated P3151 statements
  (2026-08-15), and the LUI-125 census of 2026-08-08 counted ~104k more stale
  enough to deserve deprecation. A lookup that needs the statement node must
  filter on `wikibase:rank`, and must say so where the binding is written. A
  test over `statements.js`'s three query builders guards the rule.
  **`rightsUrl` in `src/rights.js` is the single exception**, and it must stay
  single: a copyright status is readable only with its jurisdiction (P1001) and
  determination-method (P459) qualifiers, which hang off the statement node.
  It therefore refuses deprecated rank in the query itself —
  `FILTER(?rank != wikibase:DeprecatedRank)` — which every other branch gets
  free from `wdt:`. A deprecated P6216 is an editor's record that a copyright
  claim is **wrong**, not that it is old, and Wikidata holds 50 of them across
  47 items (2026-08-15). Without the filter the freest-answer-leads rule ranks
  a disproven claim beside a real one and the page contradicts itself: *Happy
  Birthday to You* reads "public domain in the United States … · still in
  copyright in the United States", the second clause being what a 2016 US
  settlement disproved, and *Steamboat Willie* does the same. On *Ghidra* the
  deprecated public-domain claim leads outright. The reach is the lede's rights
  line rather than a partner card, because the subject QID is queried
  unconditionally and none of the 47 items carries a Met/AIC/Rijksmuseum/IIIF
  identifier. Two tests hold this: one pins the exception to those four
  bindings, one asserts the filter.
  **`bestRankValues` in `src/holder.js` is the one path that reads ranks by
  hand**, and it obeys the same rule: holder detection reads raw
  `wbgetentities` claims, where `wdt:`'s filtering is not available, so it
  takes preferred values if any and normal otherwise — a deprecated museum id
  can never select a holder, and a test asserts that. It returns entity- and
  string-valued snaks only; a caller wanting a coordinate, date or quantity
  must read the datavalue itself.
- **The holder experiment changes nothing with the flag off.** With
  `HOLDER_PAGE` unset, `src/discover.js` returns no holder before any work is
  done and every render is byte-identical to one from before the experiment
  existed. The flag is also part of the page-cache build id, so the two flag
  states cannot serve each other's stored pages. Holder furniture — the zoom
  link, the required statement, the renamed source bar, the merged panel — is
  attached to the lede band and read back from `b.holder`, so it can never
  reach a band that has no holder context.
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
use the hand-rolled client in `src/http.js` (`getJson`), which rides the same
per-host queues.

- **`WIKIMEDIA_UA_CONTACT` must be set** or `userAgent()` throws at startup. There
  is no default on purpose: anyone can clone this, and a baked-in address would
  attribute their traffic to someone who never ran it. Set it to *your own*
  address.
- `maxlag=5` rides every Action API request (an m3api default param in
  `src/mw.js`) — nothing here is a human waiting on a response, so this batch
  traffic yields to interactive users. `withMaxlag()` remains for the
  hand-rolled client, where it no-ops on non-Wikimedia URLs.
- 503 honors `Retry-After` by waiting and retrying — maxlag's shape, "busy,
  come back shortly." 429 honors it by **not asking again**: it arms a per-host
  cool-off (`src/cooloff.js`, 2026-08-10) and every request to that host inside
  the interval fails at once instead of sleeping in a reader's request. Other
  4xx are **never** retried — a 404 is our bad identifier, not the server's
  bad day.
- Requests are **serial at every Wikimedia host** by construction: every request
  rides the per-host queue in `src/mw.js` (`enqueue`). Different hosts run
  concurrently — that is where the Tier-1 speedup lives — but never two
  in-flight requests to the same Wikimedia API. Batch with `titles=A|B|C` (and
  the batched lookups in `src/batch.js`) instead of adding parallelism.
  `hostLimit()` returns 1 for every `wikipedia|wikimedia|wikidata|…` host and
  that is not a tuning knob.
- The browser extension must use **`Api-User-Agent`** — browsers silently drop a
  script-set `User-Agent` — and takes its contact from extension storage, since
  the installer is the operator.

Policy: <https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy>
Etiquette: <https://www.mediawiki.org/wiki/API:Etiquette>

## Non-Wikimedia partners: what each one actually permits (2026-08-05)

Serial-per-host was applied uniformly to every host in the project, and by
2026-08-05 that generalization — not the Wikimedia half of it — was where most
of a cold page's wall clock lived. `hostLimit()` in `src/mw.js` is the one
place that says how wide a host may go — its widened entries derive from
`hostLimits` in the partner manifest (`src/partners.js`) — and **nothing goes
in without a published statement quoted beside the entry.** The default is 1. Staying at 1
costs only time; guessing wrong spends someone else's capacity.

- **`api.dp.la` → 4.** DPLA's developer policy is explicit: *"Consistent with
  its philosophical presumption of openness, in general, the DPLA will not
  restrict or rate-limit the use of its API."* The only reservation is against
  activity "denying or unduly degrading service to other API users". This was
  the second-longest chain on a cold page — 21 requests, 3.9s serial.
  (`pro.dp.la/developers/policies` answers 403 to non-browser clients; read it
  through the Wayback Machine.)
- **`id.loc.gov` → 1, permanently.** Its `robots.txt` sets `Crawl-delay: 3` for
  `User-agent: *` under a notice that irresponsible clients get blocked. It was
  the *longest* chain (27 requests, 5.1s), and the answer was to make each
  request cheap and then rare, never to open more sockets: `lcHeading` now reads
  the heading from a **HEAD** response header instead of downloading 88–120 KB
  of JSON-LD, and the durable cache means a heading is asked for about once ever
  — which is what LC's own `cache-control: max-age=2419200` (28 days) asks for.
  **Be honest about the residual gap:** serial-at-~130ms is still far faster
  than a literal 3-second crawl delay. The defensible reading is that a
  reader-initiated dereference of a specific identifier is not a crawl, and the
  request volume is falling toward zero as the cache fills — not that the
  published number is being honored.
- **`openlibrary.org` → 1** — it rate-limits back-to-back requests already (see
  the gotcha below).
- **`id.rijksmuseum.nl` → 1**, the default, because nobody has read their terms
  — but note it is the one partner that costs **three serial requests per
  object** (the Linked Art walk), so a shelf of four Rijksmuseum cards is
  twelve requests on one host. That is bounded by the artworks cap and by the
  cache, and it is the reason `subjectArtworks` fetches serially rather than
  fanning out.
- **`tile.openstreetmap.org` → 1** — the OSMF tile policy is explicit about
  heavy use, and it is four requests a page.
- **`api.crossref.org` → 1**, the default — far under its published limits
  (December 2025 policy: polite pool via `mailto`, 10 req/s for single-record
  requests). Reached only to corroborate a retraction claim: two cached
  requests per work OpenAlex flags, usually zero per page.
- **Everything else → 1**, because nobody has read their terms.

`peakConcurrency` in `src/mw.js` records the widest any host actually ran, so
the politeness claim is checkable after a run rather than merely asserted here.

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
- **The holder experiment keeps two checked-in populations and reads neither
  at request time**: the dated census (`../docs/data/<date>-holder-census.json`,
  regenerated by `tools/census-holder-articles.mjs` — the query is generated
  from `HOLDERS`, so a new holder joins it by joining the list) and the
  flagship warm list (`tools/holder-flagships.mjs`, one article per wired
  museum holder, completeness tested in `test/census.test.js`;
  `HOLDER_FLAGSHIPS=1 node warm.js <base>` walks it).
- **The partner-statements WDQS query gained `?cleveland` (P11110) and
  `?getty` (P2582) on 2026-08-17**, so every cached `partnerStatements`
  response predating that is keyed to the old URL and will be refetched once.
  Same request COUNT — the branches ride the query WDQS was already answering —
  and both shipped before any deploy, so the cache goes cold for that lookup
  exactly once, not twice. The works-by-creator query is deliberately NOT
  widened: its unrestricted URL is pinned by a test, and the two new holders
  reach it only through the holder-shelf restriction (`{ property: 'P11110' }`
  / `{ property: 'P2582' }`).
- **The AIC `fields` list was widened on 2026-08-16** (`medium_display,
  dimensions,main_reference_number,credit_line`), so every cached AIC response
  predating that is keyed to the old URL and will be refetched once. Same
  request COUNT — the fields ride the request AIC was already answering — but a
  warm cache goes cold for that lookup exactly once.
- **The DPLA query gained two fields on 2026-08-06** (`sourceResource.rights`,
  `rights`), so every cached DPLA response predating that is keyed to the old
  URL and will be refetched once. Same request COUNT — the fields ride the
  request DPLA was already answering — but a warm cache goes cold for that
  lookup exactly once.
- **And again on 2026-08-08**, when `page_size` went 4 → 50 for the ranking
  window: same request count, new URL, so every cached DPLA response is refetched
  exactly once. Apollo 11 cold-fetched 50 DPLA responses on the first render
  after the change and was warm again immediately.
- **Same for the archive.org search on 2026-08-06** (`licenseurl`) and the
  author-works lookup (`works.json` → `search.json`). Both are one-time cache
  misses at unchanged request counts, for the same reason: the field rides a
  request that was already being made.
- **`rightsUrl` gained its deprecated-rank filter on 2026-08-15**, so every
  cached WDQS rights response is refetched exactly once — same request count,
  the filter rides a query already being made, the same shape as the field
  additions below. Pages whose subject carries a deprecated P6216 render
  differently afterwards, which is the point; every other page is byte-identical.
- **The OpenAlex `select` gained `is_retracted` on 2026-08-14** (both the
  citation batches and the author-works query), so every cached OpenAlex
  response is refetched once — same request count, the field rides requests
  already being made, same shape as the DPLA field additions above.
- **The OpenAlex batches are re-keyed by the 2026-08-14 pick change**, and this
  one is NOT at an unchanged request count. The `select` is untouched —
  `open_access` was always requested, `oa_status` was simply being dropped on
  the floor — but the lookup is now handed the whole page's identifiers rather
  than the three-per-section survivors of a blind pick, so the chunk
  boundaries move and every cached OpenAlex response is refetched exactly
  once. A paper-heavy page settles at a slightly higher count afterwards
  (Drosophila melanogaster 2 → 4 requests; Monarch butterfly unchanged at 2),
  because the batch is 40 wide and this widens what fills it. Worth watching
  on the host that caused the 214–240s incident: the count rises by chunks of
  40, never per paper. (`per-page` also went to a flat 100 the same day —
  OpenAlex sometimes holds two work records for one DOI and a page sized to
  the request could truncate the last match — which re-keys those URLs once
  more; both re-keys ship in the same deploy, so the cache goes cold for this
  lookup exactly once.) **The books twin re-keys archive.org the same way**:
  the IA batches now carry every identifier rather than the blind pick's
  survivors, and — the part that is NOT flat — an OCLC/LCCN-only citation
  costs one archive.org request each, uncapped where the old cap bounded them
  at ≤3 per section. Measured: Apollo 11 unchanged, Rembrandt (an OCLC-heavy
  bibliography) 13 archive.org requests on its first cold render, serial on
  one host and cached forever after.
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
- `src/dedup.js` — anchor ownership AND anchor ranking; seven exports, all pure
  over article-ordered input (see Key Decisions for why purity is
  load-bearing). `claimAnchors` assigns each QID to the band of its first
  mention. `subjectAnchors` + `preferRelated` rank the LEDE's candidates by
  which property of the subject's item names them; `hookRank` +
  `preferYielding` rank ANY section's candidates by what its partner
  statements turn out to hold; `openRank` + `preferOpen` do the same job for a
  section's cited PAPERS, and `openRank` is also where the argument against
  ranking on OpenAlex's `diamond` is written down. `dropSeenFiles` left with
  Commons 2026-08-04.
- `src/hero.js` — `pickHero`/`heroRank`: which of a section's finds is hoisted
  into the floated rail, and when a section gets no float at all.
- `src/holder.js` — the detection and selection halves of the single-institution
  page: `WORK_CLASSES`, `HOLDERS`, `bestRankValues`, `workClass`,
  `selectHolder`, and `holderStatements`, the filter that decides which of an
  anchor's partner lookups may be dispatched at all. Pure over a claims object;
  fetches nothing. See the holder-experiment section for the reasoning.
- `src/holder-record.js` — the network half: one normalized record shape per
  museum (`metRecordFrom`, `aicRecordFrom`, `clevelandRecordFrom`,
  `gettyRecordFrom`, `rijksRecordFrom`, `iiifRecordFrom`), the URL builders the
  ordinary partner lookups in `statements.js` now share, `gateFailure` (the
  first failing leg, or null), and the `fetchHolderRecord` dispatcher. Missing
  fields are null; a normalizer never judges — the gate does. The institution
  name comes from `PARTNERS[partner].name`, never a hardcoded display string.
- `src/panel.js` — pure: the Wikipedia infobox and the holder's record merged
  into one attributed table, conflicts shown side by side. `FIELD_LABELS` is
  deliberately incomplete and unmapped labels pass through; holder-only fields
  (accession, credit line, rights label) append in that order, and other holder
  facts with no Wikipedia row are not shown.
- `src/getty.js` — the J. Paul Getty Museum (P2582). The record surface is the
  object page's embedded schema.org JSON-LD, not `data.getty.edu`, which
  answers real and bogus ids with the same 404 — the refusing-to-talk shape the
  probe control exists to catch. A bogus id serves a generic page with no
  JSON-LD block, which is what keeps the two apart. `size` is genuinely absent
  on some objects and carried as null; `creditText` is license boilerplate
  rather than an object credit and stays unread. Images come off the stated
  IIIF thumbnail with the size segment rewritten to `!800,800` — spec syntax,
  not a guessed URL shape.
- `src/breadth.js` — `tooBroad`/`broadNote`/`BROAD_ABOVE`: when a partner's
  holdings under an anchor are a category rather than a subject, so the shelf
  becomes a sentence and a browse link.
- `src/sweep.js` — the cache's ceiling: `chooseEvictions` (pure) picks
  least-recently-**read** files, `startSweeping` runs it after `listen()`.
  Needed only because the cache became durable; see Deployed demo.
- `src/works.js` — the subject's own books. Reads OpenLibrary **`search.json`**,
  not `/authors/<id>/works.json` (changed 2026-08-06). Same corpus — Kafka's
  OL33146A reports 1,852 either way, same request count — but search.json
  carries `ebook_access`, which is the whole reason: see the lending rule above.
  Two side effects worth knowing, because they change what the shelf looks like:
  the order is by relevance rather than catalog accident (Kafka now opens with
  Metamorphosis, Der Proceß and Das Schloß, where works.json led with
  "Gezar-ha-din" and a Russian edition of the diaries), and `first_publish_year`
  is populated where `first_publish_date` mostly was not.
- `src/smithsonian.js` — the Smithsonian (P195 + P217), added 2026-08-06. The
  only partner here found by a PAIR of properties rather than an external id,
  because the Smithsonian states none on its objects: Columbia (Q85753536), the
  Apollo 11 command module, carries no P3634/P4610/P13234/P6108. It carries
  which museum holds it and that museum's accession number, and Open Access
  indexes the accession number. `SI_COLLECTIONS` lists the 21 collection QIDs
  (41,202 items) — an explicit map rather than a SPARQL property path, because
  the path costs every page a graph walk to learn something that changes once a
  decade, and the map doubles as the credit line. The pair is collapsed to `si`
  in `partnerStatements` **from a single row**: read separately, one museum's
  collection could be crossed with another museum's inventory number, and the
  Rijksmuseum states P217 too.
  **The record id is verified, never constructed.** `edanmdm:nasm_A19700102000`
  looks like `<unitcode>_<inventory>` and building it is a trap — unit codes do
  not follow from the collection (Natural History alone has several, by
  department) and accession punctuation is normalized unpredictably. So this
  searches the number and accepts a row only when the row's own stated id ends
  with it. Coverage measured 2026-08-06, not assumed: SAAM 12/20, NASM 4/6 —
  the Enola Gay's `A19500100000` resolves to nothing, because the aircraft is
  not in Open Access even though exhibition records about it are.
  **The href is the ARK the museum states** (`n2t.net/ark:/65665/…`), which
  resolves to the object page and 404s for an ARK that does not exist. The
  prettier `3d.si.edu/object/3d/<slug>:<uuid>` form is deliberately NOT built:
  its slug cannot be derived from anything the API returns. That is the
  Rijksmuseum 404 rule (see `rijksPageUrl`).
  **Keyed** (`SMITHSONIAN_API_KEY`, free from api.data.gov), so silently absent
  for a clone, like DPLA and Europeana. This is the one partner that ships a
  rotatable 3D scan: `media3d` carries the Voyager package URL and the renderer
  embeds it, because 3d-api.si.edu sets neither X-Frame-Options nor a
  frame-ancestors CSP. An object with several scans takes the museum's first.
- `src/rijks.js` — the Rijksmuseum (P13234), added 2026-08-06. **No API key**:
  the keyed `api.rijksmuseum.nl` was shut down 2026-01-05 and 404s;
  `id.rijksmuseum.nl` (Linked Art) needs no auth, so unlike DPLA and Europeana
  a clone of this repo can use it. Three requests per object, because Linked
  Art models the object, its visual content and the file separately:
  HumanMadeObject (~30 KB, title/date/`shows`) → VisualItem (~2 KB, rights and
  `digitally_shown_by`) → DigitalObject (~0.6 KB, `access_point`), which is a
  plain IIIF Image API base. The VisualItem id is derivable from the object id
  (third digit `0`→`2`, held 6/6 on 2026-08-06 across both id lengths) but that
  is UNDOCUMENTED and is used only as a fallback when hop 1 omits `shows`.
  **The CC0 in this record is not about the picture** — `subject_to` carries
  `publicdomain/mark` over the visual content while `subject_of.subject_to`
  carries CC0 over the catalogue TEXT (AAT 300379475, "descriptions"). Printing
  the second as the card's licence would promise CC0 over an image the museum
  marked public-domain instead; `rijksRights` reads `subject_to` only. Titles
  come from the name the museum tags primary (AAT 300404670) in English (AAT
  300388277): a record carries the same work under a long curatorial sentence
  and a short display title, both English and both true.
  **The object's web page is keyed by ACCESSION NUMBER, not by the Linked Art
  id** (`rijksPageUrl`, fixed 2026-08-06 after a reported 404). The numeric id
  addresses the *data* — `id.rijksmuseum.nl/200107928` serves JSON — while the
  page is `/en/collection/SK-C-5`, with no `/object/` segment. The museum also
  states a canonical page URL of its own, and it is worse for linking: Dutch,
  with an underivable hash (`/nl/collectie/object/SK-C-5--3137deb45cd77…`); it
  is the locale-swapped fallback where no accession number is stated. The
  accession form was verified 9/9 across paintings (SK-*) and prints (RP-P-*).
  Note also that **P13234 is not always the numeric id**: 4 of 5,557 values are
  accession numbers or handles, which 400/404 and are dropped by the lookup's
  own error handling. That is correct — a bad identifier is our problem, not
  the museum's — and too rare to special-case.
- `src/artworks.js` — the subject's own artworks; see Partner lookups for the
  measured funnel that made it a query rather than an anchor lookup.
- `src/partners.js` — the partner manifest (2026-08-14): one descriptor per
  partner holding every partner fact that is data rather than logic — display
  name, icon URL, visibility-panel hosts, the front-page friend entry,
  the hotlink-unsafe flag, and any widened host limit with its policy quoted.
  `gap.js`, `emit-html.js`, `front-page.js`, `http.js` and `mw.js` derive
  their tables from it; `test/partners.test.js` asserts completeness (icon
  bytes committed, friend entry present), so an uncredited partner is a red
  test rather than a silent state. Imports nothing, ever — that is also
  tested. Verified byte-identical renders across the refactor.
- `src/rights.js` — pure except one fetch: license/status vocabularies, the
  WDQS rights query, and `rightsView`, which decides what a card says. See the
  copyright section above for the rules it encodes.
- `src/cc-icons.js` — **generated**, by `tools/build-cc-icons.mjs`. The Creative
  Commons element glyphs as ONE inline `<symbol>` sprite, sourced from Commons
  and normalized (ids namespaced per glyph, ink → `currentColor`, knock-outs →
  `--ccmark-hole`, namespaced editor attributes stripped). A sprite rather than
  data URIs — the opposite of the favicons, deliberately: a license glyph
  appears on nearly every card, three or four at a time, so data URIs would
  re-embed the same path data forty times per document. ~9 KB once per page.
  The generator refuses anything that is not SVG, for the same reason
  `build-icons.mjs` refuses non-images. Regenerate when the mark vocabulary in
  `src/rights.js` changes; a test asserts the two vocabularies have not drifted.
- `src/icons.js` — **generated**, by `tools/build-icons.mjs`. The partner
  favicons as committed bytes. Regenerate when the partner manifest gains a partner or an
  icon rots. The generator refuses anything that is not `data:image/…`:
  `openalex.org/favicon.ico` answers **200** with a 2.8 KB HTML error page,
  which cleared the old size-only check and shipped as OpenAlex's icon — a
  broken image on every page citing an open paper, for as long as nobody
  looked. `free.law` and a Commons-hosted Europeana logo replaced two other
  URLs that had quietly stopped serving images.
- `src/http.js` — the URL-keyed request cache, plus `getHeader` (a HEAD's
  response header, cached — see the DPLA lookup), `fromDataUri`, and
  `readFacts`/`writeFacts`,
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
