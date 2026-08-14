# Adding a data source

[friendsof.wiki](https://friendsof.wiki) renders any English Wikipedia article
"enriched". The article is the spine. Media and sources from the open
ecosystem — museums, libraries, archives, aggregators — appear alongside it,
found live by following the article's own links and identifiers outward. Each
of those collections is a **data source** (on the site itself, a "friend"):
the Met, DPLA, Open Library, DigitalNZ, and currently about a dozen more.

This document explains how to add a new data source. It is
written for whoever does the work — usually a coding agent, sometimes a
person — and it assumes the code is open beside it.

**How to read it:** every step is an instruction. An indented `Why:` line
under a rule states the reason behind the rule there. If a `Why:` stops being true, we should correct the rule — that has happened once already
(§3, the CVMA entry). All code paths are relative to
[`../tapestry-gen/`](../tapestry-gen/). They name **symbols**, not line
numbers, because line numbers drift.

**Four words this document uses constantly:** an **anchor** is something the
article names that carries a usable identifier — a wikilink resolved to its
Wikidata item, or a citation's ISBN or DOI. A **lookup** asks one partner what
it holds for an anchor. The results render as **cards**, grouped into
per-partner **shelves**. The **visibility panel** measures how much of what
the page found the Wikipedia article itself shows.

**Despite some refactoring, adding one source touches 10–13 files, depending on its shape.** A missed
step is a partner that fetches correctly while the page never credits it. That
is why §4 is a checklist and not a formality.

*Housekeeping: last verified 2026-08-13. This file is canonical.
`tapestry-gen/CLAUDE.md` keeps a pointer plus the two rules that cost the most
when they are skipped. A PR that adds a source updates this file in the same
commit.*

---

## 0. Pick the shape first

The pipeline is not config-driven, and an audit concluded it should not try to
be. Every partner needs its own fetcher and its own rights mapping.

There are three shapes. **The wrong shape produces code that fights the
pipeline.** Answer this question before you write anything:

> Does ONE Wikidata property name the partner's own record of the object?
>
> - **Yes** → *direct-id shape* (§2a). Met, AIC, Rijksmuseum, iNaturalist, GBIF, IIIF.
> - **No, but a property names something searchable** (a subject heading, an
>   entity id) and what comes back is a SAMPLE of a larger holding → *search
>   shape* (§2b). DPLA, Europeana, DigitalNZ.
> - **Neither** → *hand-written* (§2c). Read the precedents. Do not force it.

---

## 1. Before you write any fetch code

Do these five steps in this order.

1. **Read the host's published rate-limit or crawl-delay policy. Then set
   `hostLimit()` in `src/mw.js`.** The default is 1 and stays 1 without a
   published statement quoted at the call site.
   > Why: every audit of a misbehaving partner found this step skipped.
   > `id.loc.gov` publishes `Crawl-delay: 3` and `api.dp.la` publishes that it
   > does not rate-limit — one earned a 4, the other a permanent 1.

2. **Resolve a real identifier AND a deliberately bogus one, by hand, before
   you ship.** The bogus one is the actual test: it proves the server
   distinguishes them.
   > Why: shipped cards once used a URL shape that does not exist, and four
   > partners answer a real id and a bogus one identically under bot
   > mitigation — without the control, 431 healthy DPLA links read as dead
   > (`reaching-open-collections.md` states this rule at its head).

3. **Check what the API exposes for rights.** Compare it against the
   vocabulary `ccFromUri` / `ccFromSlug` / `ccFromLabel` already read in
   `src/rights.js`. Add a row to the Partner audit table in CLAUDE.md, mark or
   no mark.
   > Why: a mark is never a guess. DigitalNZ publishes capability words, not a
   > license — a CC0 glyph there would assert a permission nobody granted.

4. **Decide keyed vs keyless.** Prefer keyless: the site must run for anyone
   who clones the repo. If the API requires a key, the lookup skips silently
   without one (`envKey`). State that degradation. Set `keyOptional: true`
   only if the API *verifiably* answers keyless.
   > Why: keyless-skip is graceful degradation, never a policy against free
   > keys — DPLA, Europeana, Smithsonian and DigitalNZ all run keyed in
   > production.

5. **Check `robots.txt` before you fetch any asset.**
   > Why: an open license does not mean an open crawl — HathiTrust serves
   > public-domain scans keylessly and disallows `/cgi/` to everyone but
   > Twitterbot.

---

## 2. The touchpoints

### Always, whatever the shape

| # | File | What to add |
|---|---|---|
| 1 | `src/<partner>.js` | The provider module: fetch, parse, entry shape |
| 2 | `src/mw.js` | `hostLimit()` entry, with the policy quoted (see §1.1) |
| 3 | `src/rights.js` | Only if `rights.js` does not already parse the partner's rights vocabulary |
| 4 | `src/gap.js` | The partner's hosts in `PARTNER_HOSTS`, for the visibility panel |
| 5 | `src/emit-html.js` | The `SOURCE` entry — display name + icon |
| 6 | `src/icons.js` | **Regenerate**, do not hand-edit: `node tools/build-icons.mjs` |
| 7 | `src/front-page.js` | The `FRIENDS` entry and its licence link |
| 8 | `src/http.js` | `hotlinkUnsafe()` — see below. Aggregators only |
| 9 | `test/<partner>.test.js` | Pure tests over fixture responses |
| 10 | `CLAUDE.md` | The rationale, so the next person inherits the reasoning |
| 11 | `test/layering.test.js` | Your module's name in `PARTNERS` |
| 12 | **this file** | Anything you learned that contradicts it |

**On #6, icons:** the generator refuses anything that is not `data:image/…`.
> Why: favicon endpoints lie. `openalex.org/favicon.ico` answers 200 with an
> HTML error page, which shipped as a broken icon on every page that cites an
> open paper. Other partners 429, 403 or 404 on their favicons.

**On #8, `hotlinkUnsafe()`:** return true for *aggregators* whose thumbnails
point at many provider hosts. The predicate decides for both renderers at
once.
> Why: aggregator thumbnails resolve to hundreds of provider hosts, which rot
> and hotlink-block (2026-08-09: every DPLA card on a page rendered as text).
> A museum's own CDN is stable — hotlink those.

### 2a. Direct-id shape — four more edits, in this order

1. Add an `OPTIONAL` clause and a variable in `wdqsUrl` (`src/statements.js`),
   and add the variable name to `VARS`. `wdqsUrl` is the one query to WDQS,
   the Wikidata Query Service. It asks every partner-identifier question at
   once.
2. Add a row to `PROP_NAME` (`src/statements.js`). That row is the text behind
   each card's ⓘ fold, which names the Wikidata property that put the card on
   the page.
3. Write the fetcher module. See `metEntry` / `aicEntry` for the plain case.
   See `rijks.js` / `iiif.js` for partners that need more than one request.
4. Add one entry to `MUSEUM_LOOKUPS` (`src/statements.js`).

Then, if the partner is item-keyed, add it to `ITEM_LEVEL` in `src/dedup.js`.
Add it to `needsRightsQuery` if the identifier is an object-level property.

**Do NOT hand-edit `statementEntries`'s job list.** The registry generates it
from `MUSEUM_LOOKUPS`. A job spliced in beside it runs outside the registry's
bookkeeping.

### 2b. Search shape — one spec object

Write one spec and pass it to `bandPropertyLookup()` in `src/discover.js`,
alongside `DPLA_LOOKUP`, `EUROPEANA_LOOKUP` and `DIGITALNZ_LOOKUP`. Do NOT
copy and modify an existing spec.

The spec's fields: `envKey`, `field`, `property`, `fetch`, `browseUrl`,
`trace`, `sample`. Two fields are conditional:

- `keyOptional: true` — only if the API verifiably answers keyless.
- `broadExtra` — only if a `broadNote` needs a field beyond `label` / `total`
  / `url` (DPLA's does, for the heading).

**If your partner keys on an LC authority, use `src/lc.js`.** It offers two
lookups whose difference is cost. Pick deliberately:

- `lcHeading(id)` — the **authorized** form only, read from a header of a
  HEAD request. Cheap. Use it when the authorized form is what the partner's
  catalog states (DPLA).
- `lcLabels(id)` — the authorized form **and its variants**, which ride only
  in the 88–120 KB record body. Pays a GET. Use it when the partner's
  catalogers use a NACO form LC stores as a variant (DigitalNZ: Turnbull
  records state the variant "Yeates, John Stuart, 1900-1986", and the
  authorized form matches nothing).

> Why the split exists: LC is the longest serial chain on a cold page (27
> requests on Angkor Wat) under `Crawl-delay: 3`, so the common case had to be
> a HEAD, not a GET.

**Reuse the anchor resolution. Do not reimplement it.** `DIGITALNZ_LOOKUP`
shares DPLA's `field: 'lc'` / P244, because New Zealand's national library
catalogs through LC/NACO.
> Why: a learning generalizes across sources, or it waits (VALUES.md).

**`browseUrl` pays twice.** It is the "Browse them at X ↗" link of a folded
shelf AND the href behind a sampled shelf's count badge. It must land on a
page that reports the same total the badge prints. Check that before you write
one.

**Take shared mechanisms from `src/relevance.js` — never from another
partner's module.** A mechanism two partners share belongs in a module named
after the job, not after whichever partner needed it first. Shared homes:
`relevance.js` for shelf composition, `rights.js` for licence vocabulary,
`http.js` for transport, `lc.js` for authority headings.

`test/layering.test.js` enforces this in both directions: no partner module
may import another, and no shared module may import a partner. If you add a
module that fetches one partner's records, add its name to `PARTNERS` there.
> Why both directions: both mistakes happened (fixed 2026-08-10). The worse
> one was shared `lc.js` importing from `dpla.js` — shared code that depends
> on one partner quietly makes every partner depend on it.

**Ranking and corroboration are shared, and both are mandatory for a
subject-heading partner:**

- **Rank and fold the shelf** — `rankShelfEntries` in `src/relevance.js`. A
  facet filter has no relevance gradient, so the first rows are an arbitrary
  page of an unordered list.
  > Why: on "Armstrong, Neil, 1930-2012", the four items the API returned
  > first were the only junk among 60, and those 60 held just 42 distinct
  > title-prefixes — an unranked, unfolded shelf shows junk and duplicates.
- **Corroborate** — `corroborated()` in `src/relevance.js`. A record earns
  its card only if its own subject field touches the article somewhere
  *beyond* the anchor that fetched it. Places do not corroborate, except the
  article's subject.
  > Why: truth about the anchor and relevance to the article are different
  > properties. DigitalNZ's first day put a Fraggle Rock lunch box, correctly
  > cataloged under an Apollo 11 anchor, on Apollo 11. An absolute item-count
  > threshold cannot substitute: it assumes the partner lives where the
  > article does.

### 2c. Neither shape — read the precedent, do not force it

Real exceptions stay hand-written:

- The **Smithsonian** requires a PAIR of properties read from one row, never
  two (`smithsonian.js` — the `OPTIONAL` comment in `statements.js` says why
  splitting it is wrong).
- The **Rijksmuseum** needs three serial requests per object, because Linked
  Art models the object, its visual content and its file as three resources
  (`rijks.js`).
- The **subject's own artworks** come from asking the graph what the subject
  made, not from any wikilink lookup (`artworks.js`).

If a partner needs multiple properties, multiple hops, or a question the
article's own links cannot phrase, it likely belongs here. **One more
hand-written case beats a fourth shape forced through §2a or §2b.**

---

## 3. Rules that apply to the cards themselves

- **Give every Wikidata-backed card a `why` / `trace` / `fix` triple**, so a
  reader can check or correct the statement it rests on. Only citation-derived
  cards may omit the triple, because nothing there is editable on Wikidata.
- **`rights.copy` is the host's licence for this copy. `rights.work` is the
  work's status.** They can disagree, and the disagreement is the point. Never
  print one as the other.
  > Why: a Rijksmuseum record marks the picture public-domain and the
  > catalogue *text* CC0 — print the second and you promise CC0 over the
  > image.
- **A creator-level ruling covers a work only if the creator is its sole
  author.**
  > Why: *Rembrandt, the Master & His Workshop* (1991) is filed under
  > Rembrandt beside three living authors, and it rendered a public-domain
  > mark.
- **Do not blame the API before you diagnose the funnel.**
  > Why: the Met once rendered one card on Rembrandt with a healthy API — the
  > pipeline's own `proseLinks` step strips `<table>`, which is where artist
  > articles link their paintings.
- **Count the targets before you diagnose a modeling error.** The error you
  can see is not always the constraint that binds. Diagnosis order: count the
  target items first, then check the property, then the value vocabulary.
  > Why: CVMA GB's 28,135 photographs match zero Wikidata items, and a real
  > P31 modeling error looks like the cause. It does not bind — the UK has
  > only 87 stained-glass-window items, and only 84 windows anywhere state
  > "stained glass" as their material. Verified 2026-08-11 (LUI-147). The
  > verification overturned this bullet's previous diagnosis.
- **Layer discipline: pipeline modules must not import the renderer's
  types.**
  > Why: `discover.js` once imported `emit-html.js`'s `SOURCE` map. The fix
  > moved the names to `MUSEUM_NAME` in `artworks.js`.

---

## 4. Definition of done

The pipeline works long before the page credits anyone, so "cards render" is
not done.

- [ ] `hostLimit()` set, with the published policy quoted at the call site
- [ ] A real id and a bogus id resolved by hand, and the results differ
- [ ] Rights mapped, or explicitly given words and no glyph
- [ ] `SOURCE` entry, icon regenerated, **`FRIENDS` entry on the front page**
- [ ] `PARTNER_HOSTS` entry, so the visibility panel counts the partner
- [ ] Search shape: ranked, folded, and corroborated
- [ ] Tests over fixture responses, and `npm test` green
- [ ] Rendered — see §5 — not reasoned about
- [ ] CLAUDE.md rationale, and this file updated

> Why the last four boxes: DigitalNZ's first commit deferred the friends entry
> and the icon — the partner did the work and got none of the credit.

---

## 5. Verify by rendering, not by reasoning about the diff

**`spike.js` is the only real test of the discovery path.** No test imports
`discover()`, so byte-reproducibility off a warm cache is how a regression
surfaces.

```
cd tapestry-gen
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Apollo 11"
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Brown v. Board of Education"
WIKIMEDIA_UA_CONTACT=you@example.com node spike.js "Ludwig Prandtl"
```

(`WIKIMEDIA_UA_CONTACT` must be *your* address. It identifies whoever runs the
code to the Wikimedia Foundation, and there is deliberately no default.)

Render all three before and after. If none of the three exercises the new
partner, **add a fourth fixture that does**. Then read the cards.

> Why: a person reading a rendered page found every partner bug in this
> document. A passing test found none.
