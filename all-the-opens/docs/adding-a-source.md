# Adding a data source

[friendsof.wiki](https://friendsof.wiki) renders any English Wikipedia article
"enriched": the article as a spine, with media and sources from the open
ecosystem — museums, libraries, archives, aggregators — placed alongside it,
found live by following the article's own links and identifiers outward. Each of
those collections is a **data source** (on the site itself, a "friend"): the
Met, DPLA, Open Library, DigitalNZ, a dozen more.

This document is the complete path for connecting the next one — every file the
work touches, every check that has to pass before it ships, and the real
incident behind each rule. It is written for whoever does the work, which is
usually a coding agent and sometimes a person; either way it assumes the code is
open beside it. A reader who will never add a source here can still get an
honest picture of what integrating an open collection costs in 2026 by reading
only the indented incident lines.

**How to read it:** every step is an instruction; the indented line under it is
the incident that put it there. Skip the indented lines if you only need the
path. All code paths are relative to [`../tapestry-gen/`](../tapestry-gen/),
and name **symbols**, not line numbers, because line numbers drift.

**Four words this document uses constantly:** an **anchor** is something the
article names that carries a usable identifier — a wikilink resolved to its
Wikidata item, a citation's ISBN or DOI. A **lookup** asks one partner what it
holds for an anchor. What comes back renders as **cards**, grouped into
per-partner **shelves**. And the **visibility panel** is each page's measurement
of how much of what was found the Wikipedia article itself shows.

**Adding one source touches 10–13 files, depending on its shape — and that is
the count AFTER the wiring was refactored once.** The 2026-08-07 registry
refactor (`99116e8`) already collapsed the hand-edited job list into
`MUSEUM_LOOKUPS` and the duplicated per-partner blocks into
`bandPropertyLookup()` + specs; its audit concluded a registry removes wiring
duplication but not partner-specific knowledge — rights vocabulary, icon
sourcing, host policy, the friend blurb — so what this document walks through is
the part that resisted. Do not re-attempt that refactor expecting the count to
drop; a missed step here is a partner that fetches correctly and is never
credited, which is why §4 is a checklist and not a formality. Keep the number
accurate rather than tidy: it was nine when first counted, from the Rijksmuseum
integration (2026-08-06).

*Housekeeping: last verified 2026-08-11. This file is canonical —
`tapestry-gen/CLAUDE.md` (the repo's agent-facing context file) keeps a pointer
plus the two rules that cost the most when skipped. A PR that adds a source
updates this file in the same commit; that is why it lives in git rather than in
a blog post.*

---

## 0. Pick the shape first

Not config-driven, and a full audit concluded it shouldn't try to be: every
partner needs its own fetcher and its own rights mapping, so a registry removes
wiring duplication but not partner-specific knowledge. What it can remove is
what to hand-edit and where.

There are three shapes. **Picking the wrong one produces code that fights the
pipeline rather than fitting it**, so answer this before writing anything:

> Does ONE Wikidata property name the partner's own record of the object?
>
> - **Yes** → *direct-id shape* (§2a). Met, AIC, Rijksmuseum, iNaturalist, GBIF, IIIF.
> - **No, but a property names something searchable** (a subject heading, an
>   entity id) and what comes back is a SAMPLE of a larger holding → *search
>   shape* (§2b). DPLA, Europeana, DigitalNZ.
> - **Neither** → *hand-written* (§2c). Read the precedents; do not force it.

---

## 1. Before you write any fetch code

In this order.

1. **Read the host's published rate-limit or crawl-delay policy, then set
   `hostLimit()` in `src/mw.js`.** The default is 1 and stays 1 without a
   citation: nothing goes in that function without a published statement quoted
   at the call site.
   > This is the step every partner audit here has found skipped when something
   > went wrong. `id.loc.gov` publishes `Crawl-delay: 3`; `api.dp.la` publishes
   > that it does not rate-limit. One of those earned a 4, the other a permanent 1.

2. **Resolve a real identifier AND a deliberately bogus one, by hand, before
   shipping.** The bogus one is the actual test — it proves the server
   distinguishes them.
   > Two separate incidents. The Rijksmuseum cards shipped
   > `/en/collection/object/<numericId>`, a URL shape that does not exist; the
   > real key is the accession number (`/en/collection/SK-C-5`). And four
   > partners answer a real id and an impossible one *identically* because of bot
   > mitigation — without the control, 431 healthy DPLA links read as dead. See
   > `reaching-open-collections.md`, which states this rule at its head.

3. **Check what the API exposes for rights**, against the vocabulary
   `ccFromUri` / `ccFromSlug` / `ccFromLabel` already read in `src/rights.js`.
   Extend the Partner audit table in CLAUDE.md; add a row whether or not the
   partner turns out to have a mark.
   > A mark is never a guess. DigitalNZ states plain-English capability words
   > (`usage`), not a URI or a slug, so its affirmative combination gets words and
   > no glyph — a CC0 mark there would assert a permission nobody granted.

4. **Decide keyed vs keyless.** Prefer keyless; the site must run for anyone who
   clones the repo. If a key is required, the lookup skips silently without one
   (`envKey`), and that degradation gets stated.
   > Keyless-skip is graceful degradation, never a policy against free keys —
   > DPLA, Europeana, Smithsonian and DigitalNZ all run keyed in production. Set
   > `keyOptional: true` only if the API *verifiably* answers keyless.

5. **Check `robots.txt` before fetching any asset.**
   > HathiTrust serves public-domain scans keylessly and disallows `/cgi/` to
   > everyone but Twitterbot.

---

## 2. The touchpoints

### Always, whatever the shape

| # | File | What to add |
|---|---|---|
| 1 | `src/<partner>.js` | The provider module: fetch, parse, entry shape |
| 2 | `src/mw.js` | `hostLimit()` entry, with the policy quoted (see §1.1) |
| 3 | `src/rights.js` | Only if the partner's rights vocabulary isn't already parsed |
| 4 | `src/gap.js` | The partner's hosts in `PARTNER_HOSTS`, for the visibility panel |
| 5 | `src/emit-html.js` | The `SOURCE` entry — display name + icon |
| 6 | `src/icons.js` | **Regenerate**, don't hand-edit: `node tools/build-icons.mjs` |
| 7 | `src/front-page.js` | The `FRIENDS` entry and its licence link |
| 8 | `src/http.js` | `hotlinkUnsafe()` — see below; aggregators only |
| 9 | `test/<partner>.test.js` | Pure tests over fixture responses |
| 10 | `CLAUDE.md` | The rationale, so the next person inherits the reasoning |
| 11 | `test/layering.test.js` | Your module's name in `PARTNERS` |
| 12 | **this file** | Anything you learned that contradicts it |

**On #6, icons:** the generator refuses anything that is not `data:image/…`.
> `openalex.org/favicon.ico` answers **200** with a 2.8 KB HTML error page, which
> cleared an older size-only check and shipped as OpenAlex's icon — a broken
> image on every page citing an open paper, for as long as nobody looked. Each
> partner's favicon fails in its own way: the Met 429s, CourtListener 403s,
> Europeana's 404s and its live one sits behind a content-hashed path.

**On #8, `hotlinkUnsafe()`:** return true for *aggregators* whose thumbnails
point at many provider hosts. The predicate decides for both renderers at once.
> DPLA's and DigitalNZ's thumbnails resolve to hundreds of provider hosts —
> ContentDM instances, Calisphere, NLNZ delivery — that rot and hotlink-block.
> Found 2026-08-09: Museum of Flight served a reader's browser nothing, and every
> DPLA letter card rendered as text. A museum's own CDN (the Met, `ids.si.edu`,
> archive.org) serves its images fine and hotlinking stays the cheap path.

### 2a. Direct-id shape — four more edits, in this order

1. An `OPTIONAL` clause and a var in `wdqsUrl` (`src/statements.js`) — the one
   query to WDQS, the Wikidata Query Service, that asks every partner-identifier
   question at once — and the var name in `VARS`.
2. A row in `PROP_NAME` (`src/statements.js`) — the text behind each card's ⓘ
   fold, which tells a reader which Wikidata property put the card on the page.
3. The fetcher module. See `metEntry` / `aicEntry` for the plain case,
   `rijks.js` / `iiif.js` for partners needing more than one request.
4. One entry in `MUSEUM_LOOKUPS` (`src/statements.js`).

Then, if the partner is item-keyed, add it to `ITEM_LEVEL` in `src/dedup.js`,
and to `needsRightsQuery` if it is an object-level property.

**Do NOT hand-edit `statementEntries`'s job list.** It is generated from
`MUSEUM_LOOKUPS`; a job spliced in beside it runs outside the registry's
bookkeeping.

### 2b. Search shape — one spec object

Write one spec and pass it to `bandPropertyLookup()` in `src/discover.js`,
alongside `DPLA_LOOKUP`, `EUROPEANA_LOOKUP` and `DIGITALNZ_LOOKUP`.

Fields: `envKey` / `field` / `property` / `fetch` / `browseUrl` / `trace` /
`sample`, plus `keyOptional: true` if the API verifiably answers keyless, and
`broadExtra` only if a `broadNote` needs a field beyond `label` / `total` / `url`
(DPLA's does, for the heading).

**Do NOT copy an existing block and modify it.**
> That is exactly the duplication DPLA and Europeana carried from 2026-08-03 to
> 2026-08-07 — two near-identical blocks in `discover.js`, collapsed into one
> loop plus two specs.

**If your partner keys on an LC authority, `src/lc.js` is the whole story — and
it offers two lookups whose difference is cost, not duplication.** Pick
deliberately:

- `lcHeading(id)` — the **authorized** form only, read from the
  `x-preflabel-encoded` header of a HEAD request. Cheap; what DPLA uses.
- `lcLabels(id)` — the authorized form **and its variants**, which ride only in
  the 88–120 KB record body. Pays a GET; what DigitalNZ needs.

> The cheap one exists because LC is the single longest serial chain on a cold
> page (27 requests on Angkor Wat) and `id.loc.gov` publishes `Crawl-delay: 3` —
> the request had to get cheaper, not more concurrent. The expensive one exists
> because NZ institutions catalog under NACO forms LC stores as *variants*: on
> `no2008188470` the variant "Yeates, John Stuart, 1900-1986" is exactly what
> Turnbull's records state, while the authorized "Yeates, J. S. (John Stuart),
> 1900-1986" matches nothing in DigitalNZ at all.

**Reuse the anchor resolution rather than reimplementing it.** `DIGITALNZ_LOOKUP`
shares DPLA's `field: 'lc'` / P244 (the anchor's Library of Congress authority
ID) instead of adding a fourth WDQS var, because New Zealand's national library
catalogs through LC/NACO.
> This is VALUES.md's *"a learning generalizes across sources, or it waits"* in
> practice: the strict subject-heading rule is one statement across two partners.

**`browseUrl` pays twice** (2026-08-10): it is the "Browse them at X ↗" of a
folded shelf AND the href behind a sampled shelf's count badge, so it must land
on a page reporting the same total the badge prints. Check that before writing
one.

**Take the shared mechanism from `src/relevance.js` — never from another
partner's module.** You are about to reuse two things the first partner of this
shape already worked out, and the cheap way to get them is to import from your
neighbour. Don't: a mechanism two partners share belongs in a module named after
the job, not after whichever partner needed it first.

`test/layering.test.js` enforces this in both directions — no partner module may
import another, and no shared module may import a partner — so you do not have to
remember it. If you add a module that fetches one partner's records, add its name
to `PARTNERS` there. That is the eleventh touchpoint, and the only one whose whole
purpose is to make a later mistake impossible.

> Both directions are needed because both happened. `digitalnz.js` imported the
> ranker from `dpla.js`; `lc.js` — shared, and DigitalNZ's own dependency —
> imported `lcBranch` back out of `dpla.js`. The second is the worse one: shared
> code that depends on one partner quietly makes every other partner depend on it
> too. Both fixed 2026-08-10.

> The rule exists because the instinct behind the mistake is correct. VALUES.md
> asks that a learning generalize across sources rather than being re-solved per
> partner, so reaching for the neighbour's code is right; only the destination is
> wrong. Shared homes: `relevance.js` for shelf composition, `rights.js` for
> licence vocabulary, `http.js` for transport, `lc.js` for authority headings.

**Ranking and corroboration are shared, and both are mandatory for a
subject-heading partner:**

- **Rank and fold the shelf** — `rankShelfEntries` in `src/relevance.js`. A
  facet filter has no relevance gradient, so the first rows are an arbitrary
  page of an unordered list.
  > Measured on "Armstrong, Neil, 1930-2012": 60 items, ~50 genuinely Apollo 11,
  > and the four returned first were the only junk in the set. Separately, those
  > 60 held just 42 distinct title-prefixes — one group of ten — so ranking
  > without folding fills a shelf with four copies of one photograph.
- **Corroborate** — `corroborated()` in `src/relevance.js`. A record earns its
  card only if its own subject field touches the article somewhere *beyond* the
  anchor that fetched it. Places don't corroborate, except the article's subject.
  > DigitalNZ's first day: Trotsky, a Fraggle Rock lunch box and two iPhone
  > cartoons on Apollo 11. **Every card was true about its anchor.** Truth about
  > the anchor and relevance to the article are different properties, and the
  > pipeline only tested the first. The breadth threshold hid this for DPLA
  > because an absolute item count silently assumes the partner lives where the
  > article does — DPLA holds tens of thousands under "New York (N.Y.)" and folds;
  > DigitalNZ holds eleven and sails through.

### 2c. Neither shape — read the precedent, don't force it

Real exceptions stay hand-written:

- The **Smithsonian** is found by a PAIR of properties read from one row, never
  two (`smithsonian.js`; see the `OPTIONAL` comment in `statements.js` on why
  splitting it is wrong).
- The **Rijksmuseum** needs three serial requests per object, because Linked Art
  models the object, its visual content and its file as three resources
  (`rijks.js`).
- The **subject's own artworks** are reached by asking the graph what the subject
  made, not by lookuping off a wikilink at all (`artworks.js`).

If a partner needs multiple properties, multiple hops, or a question the
article's own links cannot phrase, it likely belongs here. **A fourth shape
forced through 1 or 2 for the sake of uniformity is a worse outcome than one
more hand-written case.**

---

## 3. Rules that apply to the cards themselves

- **Give every Wikidata-backed card a `why` / `trace` / `fix` triple**, so a
  reader can check or correct the statement it rests on. A card with no trace is
  legitimate only for citation-derived cards, where nothing is editable on
  Wikidata.
- **`rights.copy` is the host's licence for this copy; `rights.work` is the
  work's status.** They can disagree, and the disagreement is the point. Never
  print one as the other.
  > The Rijksmuseum record states two CC URIs: `subject_to` covers the picture
  > (public-domain mark), `subject_of.subject_to` covers the catalogue *text*
  > (CC0). Printing the second promises CC0 over an image the museum only marked
  > public domain.
- **A creator-level ruling covers a work only if the creator is its sole
  author.**
  > *Rembrandt, the Master & His Workshop* (1991) is filed under Rembrandt
  > alongside three living authors and rendered a public-domain mark.
- **Don't blame the API before diagnosing the funnel.**
  > The Met rendered one card on Rembrandt with a perfectly healthy API:
  > `proseLinks` strips `<table>`, and artist articles link their paintings from
  > gallery tables. 35 museum-bearing anchors → 14 survived the strip → 3 reached
  > the lookup → 2 rendered.
- **The modeling error you can see is not always the constraint that binds —
  count the targets before diagnosing.** Verified 2026-08-11 (LUI-147), and the
  verification overturned the diagnosis this bullet used to carry.
  > CVMA GB — 28,135 medieval stained-glass photographs in Mix'n'Match, zero
  > matches ever — LOOKS like a modeling bug, and one exists: the catalog types
  > every entry as stained glass the MATERIAL (Q1473346) where the settled
  > pattern is window (P31=Q21061279) + material (P186), and 523 Wikidata items
  > make the same P31 mistake. But fixing it would produce almost nothing,
  > because the targets do not exist: the UK has **87** stained-glass-window
  > items against those 28,135 photographs (France: 3,300). And the vocabulary
  > is a third layer — windows state P186 as clear glass (2,555), lead (699),
  > plain glass (693); "stained glass" itself appears just 84 times, so even the
  > correct property queried with the obvious value misses nearly everything.
  > Diagnosis order that would have caught this in one pass: count the target
  > items first, then check the property, then the value vocabulary.
- **Layer discipline: pipeline modules must not import the renderer's types.**
  > Reaching into `emit-html.js`'s `SOURCE` map from `discover.js` broke this and
  > had to be moved to `MUSEUM_NAME` in `artworks.js`.

---

## 4. Definition of done

The pipeline works long before the page credits anyone, so "cards render" is not
done.

- [ ] `hostLimit()` set, with the published policy quoted at the call site
- [ ] A real id and a bogus id resolved by hand, and the results differ
- [ ] Rights mapped, or explicitly given words and no glyph
- [ ] `SOURCE` entry, icon regenerated, **`FRIENDS` entry on the front page**
- [ ] `PARTNER_HOSTS` entry, so the visibility panel counts the partner
- [ ] Search shape: ranked, folded, and corroborated
- [ ] Tests over fixture responses; `npm test` green
- [ ] Rendered — see §5 — not reasoned about
- [ ] CLAUDE.md rationale, and this file updated

> DigitalNZ's first commit deliberately deferred the friends entry and the icon,
> and both are reader-facing: the partner was doing the work and getting none of
> the credit. That is why the last four boxes exist.

---

## 5. Verify by rendering, not by reasoning about the diff

**`spike.js` is the only real test of the discovery path** — no test imports
`discover()`, so byte-reproducibility off a warm cache is how a regression
surfaces.

```
cd tapestry-gen
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Apollo 11"
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Brown v. Board of Education"
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Ludwig Prandtl"
```

(`WIKIMEDIA_UA_CONTACT` must be *your* address — it identifies whoever is
actually running the code to the Wikimedia Foundation, and there is deliberately
no default.)

Render all three before and after, **and add a fourth fixture that actually
exercises the new partner** if none of the three does. Then read the cards.

> Every partner bug in this document was found by a person looking at a rendered
> page, and none was found by a passing test.
