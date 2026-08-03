# tapestry-gen

Last verified: 2026-08-02

## Purpose

A second rendering of the shared Apollo 11 dataset as *"the article, enriched"* —
the Wikipedia article as a linear spine, the open ecosystem's media on one side,
its cited sources on the other. It is **generated, not authored**: the article's
own wikilinks, resolved through Wikidata QIDs, decide where each item lands, so
the placement *is* the argument and generalises to any article. Primary output is
a self-contained HTML page; a `.tapestry` (Internet Archive Tapestry format) is
also emitted but secondary (see Key Decisions). Fuller narrative in `README.md`.

## Contracts

- **Reads** `../web-demo/data/apollo-11/` — the single source of truth shared with
  the D3 demo. Read-only, except deliberate dataset re-curation.
- **Writes** `demo/apollo-11.html` (the committed demo) and
  `../tapestry/apollo-11.tapestry` (gitignored).
- **Network** all goes through `.cache/` (gitignored), keyed by request URL —
  reruns are offline and byte-reproducible. Delete `.cache/` to refetch.

## Two entry points

- **`generate.js`** — the original, dataset-bound: renders Apollo 11 from the
  curated `web-demo/data/apollo-11/`. Unchanged in intent.
- **`spike.js`** — the **live discovery** path and where current work happens:
  `node spike.js "Any Article Title"` builds an enriched page for an arbitrary
  English Wikipedia article with no dataset and no per-article code. Items are
  discovered at read time by pivoting from the article's own anchors. Writes
  `demo/spike-<slug>.html`. Design: `../docs/design-plans/2026-07-25-live-discovery-pipeline.md`;
  current state and plan: `../docs/implementation-plans/2026-07-28-live-discovery-next-steps.md`.

Fixtures are Apollo 11 (event, `{{sfn}}` citation style), Brown v. Board (legal,
inline `{{cite}}`), Ludwig Prandtl (person, thesis reachable only by description).

## Evidence classes (spike)

An edge is one of three things, and the render distinguishes them because
conflating them would overstate what the page knows:

- **identifier** — a shared authority ID (ISBN/OCLC/LCCN → Internet Archive).
- **statement** — a Wikidata claim (`P180 depicts` → Commons).
- **corroborated** — no shared identifier at all; the candidate satisfies an
  object Wikidata *describes* (`P1026` → author + year + institution). Rendered
  with a dashed card that prints the agreeing values, plus a legend entry that
  appears only on pages that use it. `src/corroborate.js` decides these; all
  three signals are required, because the same collection holds theses by Ludwig,
  Hans and Antonius Prandtl.

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
- **Reachability-ranked citations.** A section's shown sources prefer what a
  reader can open: borrowable/readable book > archived page > DOI > catalog-only
  book > bare live link. Cited books link to their Internet Archive copy via
  OpenLibrary.
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
block lands on whoever ran the code. `src/wmf.js` is the **single** definition
for the whole repo — never write a User-Agent string anywhere else.

- **`WIKIMEDIA_UA_CONTACT` must be set** or `userAgent()` throws at startup. There
  is no default on purpose: anyone can clone this, and a baked-in address would
  attribute their traffic to someone who never ran it. Set it to *your own*
  address.
- `withMaxlag()` adds `maxlag=5` to Action API URLs only — nothing here is a human
  waiting on a response, so this batch traffic yields to interactive users.
- 429/503 honour `Retry-After` (capped at 60s); other 4xx are **never** retried —
  a 404 is our bad identifier, not the server's bad day.
- Requests are serial by construction. Never introduce `Promise.all` against a
  Wikimedia host; batch with `titles=A|B|C` instead.
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
  generator can reach a host.
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
