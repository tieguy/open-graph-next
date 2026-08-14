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
under a rule states the reason behind the rule. If a `Why:` stops being
true, we should correct the rule. All code paths are relative to
[`../tapestry-gen/`](../tapestry-gen/). They name **symbols**, not line
numbers, because line numbers drift.

**Four words this document uses constantly:** an **anchor** is something the
article names that carries a usable identifier — a wikilink resolved to its
Wikidata item, or a citation's ISBN or DOI. A **lookup** asks one partner what
it holds for an anchor. The results render as **cards**, grouped into
per-partner **shelves**. The **visibility panel** measures how much of what
the page found the Wikipedia article itself shows.

**Adding one source touches six code files, one generated file, and two
docs.** We recommend partnering with an LLM on the work.

*Housekeeping: last verified 2026-08-14. This file is canonical.
`tapestry-gen/CLAUDE.md` keeps a pointer plus the two rules that cost the most
when they are skipped. A PR that adds a source updates this file in the same
commit.*

---

## 0. Pick the shape first

There are three "shapes" of partner. **The wrong shape produces code that fights the
pipeline.** Answer this question before you write anything:

> Take a thing the article links — a painting, a species, a book. Does ONE
> Wikidata property name the partner's own record of that thing?
>
> - **Yes** → *direct-id shape* (§2a). The Met, the Art Institute of Chicago,
>   the Rijksmuseum, iNaturalist, GBIF, and IIIF (institutions publishing
>   image manifests under that shared standard).
> - **No, but a property names something searchable** (a library subject
>   heading, the partner's own entity id) and what comes back is a SAMPLE of
>   a larger holding → *search shape* (§2b). DPLA, Europeana, DigitalNZ.
> - **Neither** → *hand-written* (§2c). Read the precedents. Do not force it.

---

## 1. Investigate the partner before you write any code

Answer these six questions first. Nothing is written yet — each answer lands
in a specific place in §2, most of them in the partner's **descriptor**, its
entry in `src/partners.js`. Some answers change the shape of the work or stop
it.

1. **Can you resolve one of the partner's records by hand, and does the
   server refuse an invented one?** An identifier here is the key the
   partner uses for one record: a value of the Wikidata property from §0,
   or a record id copied from a page on the partner's own site. Resolve a
   real one by hand. Then change a few digits so that it names no record,
   and resolve that too. The invented one is the actual test. A host that
   answers both identically is refusing to talk to you, not reporting a
   broken link — record that in `reaching-open-collections.md` (this rule is
   stated at its head) and stop.
   > Why: shipped cards once used a URL shape that does not exist, and four
   > partners answer a real id and a bogus one identically under bot
   > mitigation — without the control, 431 healthy DPLA links read as dead.

2. **What terms cover the API and its metadata?** Read them. A
   non-commercial condition on the API or its metadata is a blocker to name,
   never a condition to accept — it goes on the challenges list on the site's
   front page and shapes the friend entry's `terms` line (§2).
   > Why: the goal is adoption by Wikipedia or something Wikipedia-like, so
   > anyone must be able to reuse the result, commercially included
   > (VALUES.md). For demo purposes, we accept that DigitalNZ's API metadata is NC by default, but we call it out and want to wrestle with that going forward.

3. **What does the host publish about rate limits or crawl delay?** The
   answer becomes the descriptor's `hostLimits` entry, with the policy
   quoted (the worked descriptor in §2 shows the shape). No published
   statement means the default of 1.
   > Why: every audit of a misbehaving partner found this question skipped.
   > `id.loc.gov` publishes `Crawl-delay: 3` and `api.dp.la` publishes that it
   > does not rate-limit — one earned a 4, the other a permanent 1.

4. **What does the API expose for rights?** Compare it against the
   vocabulary `ccFromUri` / `ccFromSlug` / `ccFromLabel` already read in
   `src/rights.js`. The answer decides whether a card can carry a license
   **mark** — the CC0 / public-domain / © glyph — or plain words only, and it
   adds a row to the Partner audit table in CLAUDE.md either way.
   > Why: a mark is never a guess. DigitalNZ publishes capability words, not a
   > license — a CC0 glyph there would assert a permission nobody granted.

5. **Keyed or keyless?** Prefer keyless: the site must run for anyone who
   clones the repo. For a search-shape partner the answer becomes `envKey`
   (and `keyOptional: true` only if the API *verifiably* answers keyless) in
   the §2b spec; other shapes read `process.env` where the fetch is made. If
   a key is required, the lookup skips silently without one — say so in
   CLAUDE.md's notes on the partner.
   > Why: keyless-skip is graceful degradation, never a policy against free
   > keys — DPLA, Europeana, Smithsonian and DigitalNZ all run keyed in
   > production.

6. **What does `robots.txt` allow?** Check it before planning to fetch any
   asset.
   > Why: an open license does not mean an open crawl — HathiTrust serves
   > public-domain scans keylessly and disallows `/cgi/` to everyone but
   > Twitterbot.

---

## 2. The touchpoints

The first thing written is the descriptor: choose the slug, create the
`src/partners.js` entry, and fill it from what §1 found.

### Always, whatever the shape

| # | File | What to add |
|---|---|---|
| 1 | `src/<partner>.js` | The provider module: fetch, parse, entry shape |
| 2 | `src/partners.js` | The descriptor — the worked example below |
| 3 | `src/front-page.js` | Your slug in one `FRIEND_GROUPS` list (which group is editorial) |
| 4 | `src/rights.js` | Only if `rights.js` does not already parse the partner's rights vocabulary |
| 5 | `test/<partner>.test.js` | Pure tests over fixture responses |
| 6 | `test/layering.test.js` | Your module's name in `PARTNERS` |
| 7 | `src/icons.js` | **Regenerate**, do not hand-edit: `node tools/build-icons.mjs` |
| 8 | `CLAUDE.md` | The rationale, so the next person inherits the reasoning |
| 9 | **this file** | Anything you learned that contradicts it |

**On #2, the descriptor:** `gap.js` (visibility hosts), `emit-html.js`
(name + icon), `front-page.js` (the friends list), `http.js` (hotlink
safety) and `mw.js` (host limits) all derive from it. `test/partners.test.js`
asserts every descriptor is complete, its icon bytes are committed, and the
front page credits it.
> Why the test exists: DigitalNZ's first commit deferred the friends entry
> and the icon — the partner did the work and got none of the credit, and
> nothing failed.

An **entry** is the object your module returns for one record; the renderer
turns entries into cards. The key you choose is the partner's **slug**. Every entry your fetcher
returns must set `source` to this exact string — that is how the renderer
finds the name and icon, the visibility panel tallies the partner, and the
hotlink predicate recognizes it. Lowercase, underscores (`free_law`,
`internet_archive`).

A complete descriptor, with both conditional flags:

```js
example_org: {
  name: 'Example Collections', // the legend, credit bars, share cards
  icon: 'https://example.org/favicon.ico', // then regenerate src/icons.js
  hosts: ['example.org'], // the visibility panel; subdomains match
  friend: {
    gives: 'What it contributes to a page, and through which anchor.',
    terms: 'Its openness, in our words.',
    cite: 'https://example.org/terms', // its own statement; omit if unread
  },
  // Conditional — aggregators whose thumbnails point at many provider
  // hosts. One predicate (`hotlinkUnsafe` in src/http.js) decides for both
  // renderers.
  hotlinkUnsafe: true,
  // Conditional — only with the published policy quoted here. Example.org's
  // API docs (example.org/api#limits): "clients may make up to four
  // concurrent requests." No quote, no entry: the default is 1.
  hostLimits: { 'api.example.org': 4 },
},
```

**The two host fields answer different questions and match differently.**
`hostLimits` keys are the exact hostname your fetcher's request URLs carry —
the per-host queue is keyed by `new URL(url).host`, matched exactly, so
`api.example.org` and `example.org` are separate queues. `hosts` matches
subdomains, because it asks whether the article links the partner anywhere.

> Why `hotlinkUnsafe` exists: aggregator thumbnails resolve to hundreds of
> provider hosts, which rot and hotlink-block (2026-08-09: every DPLA card
> on a page rendered as text). A museum's own CDN is stable — hotlink those.

**On #7, icons:** the icon generator (`tools/build-icons.mjs`) refuses
anything that is not `data:image/…`.
> Why: favicon endpoints lie. `openalex.org/favicon.ico` answers 200 with an
> HTML error page, which shipped as a broken icon on every page that cites an
> open paper. Other partners 429, 403 or 404 on their favicons.

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

Then two conditional edits, both keyed on the variable name from step 1:

- If the property names one item (a painting, a taxon — not a class of
  things), add the variable to `ITEM_LEVEL` in `src/dedup.js`, so anchor
  ranking treats it as the strongest kind of hook.
- If the item is an object whose copyright status is worth asking, add the
  variable to `needsRightsQuery` in `src/statements.js`, so the page asks
  Wikidata for that object's status.

**Do NOT splice a job directly into `statementEntries`.** It builds its job
list from `MUSEUM_LOOKUPS`; a hand-added job runs outside that bookkeeping.

### 2b. Search shape — one spec object

Write one spec and pass it to `bandPropertyLookup()` in `src/discover.js`,
alongside `DPLA_LOOKUP`, `EUROPEANA_LOOKUP` and `DIGITALNZ_LOOKUP` — the
three existing specs document every field.

The spec's fields: `envKey`, `field`, `property`, `fetch`, `browseUrl`,
`trace`, `sample`. Two fields are conditional:

- `keyOptional: true` — only if the API verifiably answers keyless.
- `broadExtra` — only if a `broadNote` needs a field beyond `label` / `total`
  / `url` (DPLA's does, for the heading).

**If your partner keys on a Library of Congress authority — the anchor's
P244 value, "LC" from here on — use `src/lc.js`.** An LC record states one
**authorized** form of a heading plus **variant** forms. The two lookups
differ in cost. Pick deliberately:

- `lcHeading(id)` — the **authorized** form only, read from a header of a
  HEAD request. Cheap. Use it when the authorized form is what the partner's
  catalog states (DPLA).
- `lcLabels(id)` — the authorized form **and its variants**, which ride only
  in the 88–120 KB record body. Pays a GET. Use it when the partner's
  catalogers write a form LC stores as a variant (DigitalNZ: Turnbull
  records state the variant "Yeates, John Stuart, 1900-1986", and the
  authorized form matches nothing).

> Why the split exists: LC is the longest serial chain on a cold page (27
> requests on Angkor Wat) under `Crawl-delay: 3`, so the common case had to be
> a HEAD, not a GET.

**Reuse how an existing spec turns the anchor into a search key before you
add a new way.** `DIGITALNZ_LOOKUP` shares DPLA's `field: 'lc'` / P244,
because New Zealand's national library catalogs through LC.
> Why: a learning generalizes across sources, or it waits (VALUES.md).

**`browseUrl` is used in two places.** When a shelf folds to one sentence
because a heading holds too many items, it is the "Browse them at X ↗" link.
When a shelf shows a sample, it is the link behind the "4 of 54" count badge.
Both times it must land on a page that reports the same total the badge
prints. Check that before you write one.

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
  *beyond* the anchor that fetched it. A place subject does not count as a
  touch — a place says where, not what — unless the place is the article's
  own subject.
  > Why: truth about the anchor and relevance to the article are different
  > properties — a Fraggle Rock lunch box, correctly cataloged under one of
  > Apollo 11's anchors, rendered on Apollo 11 (2026-08-08). An absolute item-count
  > threshold cannot substitute: it assumes the partner lives where the
  > article does.

### 2c. Neither shape — read the precedent, do not force it

Real exceptions stay hand-written:

- The **Smithsonian** requires a PAIR of properties read from one WDQS
  result row, never two (`smithsonian.js` — the `OPTIONAL` comment in
  `statements.js` says why splitting it is wrong).
- The **Rijksmuseum** needs three serial requests per object, because Linked
  Art models the object, its visual content and its file as three resources
  (`rijks.js`).
- The **subject's own artworks** come from asking Wikidata what the subject
  made, not from any wikilink lookup (`artworks.js`).

If a partner needs multiple properties, multiple hops, or a question the
article's own links cannot phrase, it likely belongs here. **One more
hand-written case beats a fourth shape forced through §2a or §2b.**

---

## 3. Rules that apply to the cards themselves

- **Give every Wikidata-backed card a `why` / `trace` / `fix` triple** — the
  sentence saying why the card is here, the chain of statements behind it,
  and the wikidata.org link where a reader can check or correct the statement
  it rests on. Only citation-derived cards may omit the triple, because
  nothing there is editable on Wikidata.
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
  > modeling error (P31, instance-of) looks like the cause. It does not bind — the UK has
  > only 87 stained-glass-window items, and only 84 windows anywhere state
  > "stained glass" as their material. Verified 2026-08-11 (LUI-147).
- **Layer discipline: pipeline modules must not import the renderer's
  types.**
  > Why: `discover.js` once imported `emit-html.js`'s `SOURCE` map. The fix
  > moved the names to `MUSEUM_NAME` in `artworks.js`.

---

## 4. Definition of done

The pipeline works long before the page credits anyone, so "cards render" is
not done.

- [ ] Any widened host limit stated in the descriptor, with the policy quoted
- [ ] A real id and a bogus id resolved by hand, and the results differ
- [ ] Rights mapped, or explicitly given words and no glyph
- [ ] Descriptor complete and icon regenerated — `test/partners.test.js` green
- [ ] Search shape: ranked, folded, and corroborated
- [ ] Tests over fixture responses, and `npm test` green
- [ ] Rendered — see §5 — not reasoned about
- [ ] CLAUDE.md rationale, and this file updated

> Why the credit box is a test: DigitalNZ's first commit deferred the
> friends entry and the icon — the partner did the work and got none of the
> credit, and nothing failed. `test/partners.test.js` fails on exactly that.

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
