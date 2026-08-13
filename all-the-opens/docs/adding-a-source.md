# Adding a data source

[friendsof.wiki](https://friendsof.wiki) renders any English Wikipedia article
"enriched". The article is the spine. Media and sources from the open
ecosystem — museums, libraries, archives, aggregators — appear alongside it.
The site finds them live, by following the article's own links and identifiers
outward. Each of those collections is a **data source** (on the site itself, a
"friend"): the Met, DPLA, Open Library, DigitalNZ, a dozen more.

This document is the complete path for connecting the next one. It lists every
file the work touches, every check that must pass before the change ships, and
the real incident behind each rule. It is written for whoever does the work —
usually a coding agent, sometimes a person. Either way, it assumes the code is
open beside it. A reader who will never add a source can still get an honest
picture of what connecting an open collection costs in 2026: read only the
indented incident lines.

**How to read it:** every step is an instruction. The indented line under it is
the incident that put it there. Skip the indented lines if you only need the
path. All code paths are relative to [`../tapestry-gen/`](../tapestry-gen/).
They name **symbols**, not line numbers, because line numbers drift.

**Four words this document uses constantly:** an **anchor** is something the
article names that carries a usable identifier — a wikilink resolved to its
Wikidata item, or a citation's ISBN or DOI. A **lookup** asks one partner what
it holds for an anchor. The results render as **cards**, grouped into
per-partner **shelves**. The **visibility panel** measures how much of what the
page found the Wikipedia article itself shows.

**Adding one source touches 10–13 files, depending on its shape. That count
already survived one refactor.** The 2026-08-07 registry refactor (`99116e8`)
collapsed the hand-edited job list into `MUSEUM_LOOKUPS`, and collapsed the
duplicated per-partner blocks into `bandPropertyLookup()` plus specs. Its audit
concluded that a registry removes wiring duplication, not partner-specific
knowledge — rights vocabulary, icon sourcing, host policy, the friend blurb.
This document covers the part that resisted. Do not repeat that refactor in the
hope that the count will drop. A missed step here is a partner that fetches
correctly while the page never credits it. That is why §4 is a checklist and
not a formality. Keep the number accurate, not tidy: it was nine when first
counted, from the Rijksmuseum integration (2026-08-06).

*Housekeeping: last verified 2026-08-13. This file is canonical.
`tapestry-gen/CLAUDE.md` (the repo's agent-facing context file) keeps a pointer
plus the two rules that cost the most when they are skipped. A PR that adds a
source updates this file in the same commit. That is why it lives in git rather
than in a blog post.*

---

## 0. Pick the shape first

The pipeline is not config-driven, and a full audit concluded it should not try
to be. Every partner needs its own fetcher and its own rights mapping, so a
registry removes wiring duplication, not partner-specific knowledge. What a
registry can remove is the question of what to hand-edit and where.

There are three shapes. **The wrong shape produces code that fights the
pipeline instead of fitting it.** Answer this question before you write
anything:

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
   citation. Nothing goes into that function without a published statement
   quoted at the call site.
   > Every partner audit here found this step skipped when something went
   > wrong. `id.loc.gov` publishes `Crawl-delay: 3`. `api.dp.la` publishes that
   > it does not rate-limit. One of those earned a 4, the other a permanent 1.

2. **Resolve a real identifier AND a deliberately bogus one, by hand, before
   you ship.** The bogus one is the actual test: it proves the server
   distinguishes them.
   > Two separate incidents. The Rijksmuseum cards shipped
   > `/en/collection/object/<numericId>`, a URL shape that does not exist. The
   > real key is the accession number (`/en/collection/SK-C-5`). And four
   > partners answer a real id and an impossible one *identically*, because of
   > bot mitigation. Without the control, 431 healthy DPLA links read as dead.
   > See `reaching-open-collections.md`, which states this rule at its head.

3. **Check what the API exposes for rights.** Compare it against the vocabulary
   that `ccFromUri` / `ccFromSlug` / `ccFromLabel` already read in
   `src/rights.js`. Extend the Partner audit table in CLAUDE.md. Add a row
   whether or not the partner has a mark.
   > A mark is never a guess. DigitalNZ states plain-English capability words
   > (`usage`), not a URI or a slug. Its affirmative combination therefore gets
   > words and no glyph — a CC0 mark there would assert a permission nobody
   > granted.

4. **Decide keyed vs keyless.** Prefer keyless: the site must run for anyone
   who clones the repo. If the API requires a key, the lookup skips silently
   without one (`envKey`). State that degradation.
   > Keyless-skip is graceful degradation, never a policy against free keys.
   > DPLA, Europeana, Smithsonian and DigitalNZ all run keyed in production.
   > Set `keyOptional: true` only if the API *verifiably* answers keyless.

5. **Check `robots.txt` before you fetch any asset.**
   > HathiTrust serves public-domain scans keylessly, and it disallows `/cgi/`
   > to everyone but Twitterbot.

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
> `openalex.org/favicon.ico` answers **200** with a 2.8 KB HTML error page.
> That page cleared an older size-only check and shipped as OpenAlex's icon — a
> broken image on every page that cites an open paper, for as long as nobody
> looked. Each partner's favicon fails in its own way: the Met 429s,
> CourtListener 403s, Europeana 404s, and Europeana's live icon sits behind a
> content-hashed path.

**On #8, `hotlinkUnsafe()`:** return true for *aggregators* whose thumbnails
point at many provider hosts. The predicate decides for both renderers at once.
> DPLA's and DigitalNZ's thumbnails resolve to hundreds of provider hosts —
> ContentDM instances, Calisphere, NLNZ delivery — and those hosts rot and
> hotlink-block. On 2026-08-09, Museum of Flight served a reader's browser
> nothing, and every DPLA letter card rendered as text. A museum's own CDN (the
> Met, `ids.si.edu`, archive.org) serves its images fine, so hotlinking stays
> the cheap path there.

### 2a. Direct-id shape — four more edits, in this order

1. Add an `OPTIONAL` clause and a variable in `wdqsUrl` (`src/statements.js`),
   and add the variable name to `VARS`. `wdqsUrl` is the one query to WDQS, the
   Wikidata Query Service. It asks every partner-identifier question at once.
2. Add a row to `PROP_NAME` (`src/statements.js`). That row is the text behind
   each card's ⓘ fold, which tells a reader which Wikidata property put the
   card on the page.
3. Write the fetcher module. See `metEntry` / `aicEntry` for the plain case.
   See `rijks.js` / `iiif.js` for partners that need more than one request.
4. Add one entry to `MUSEUM_LOOKUPS` (`src/statements.js`).

Then, if the partner is item-keyed, add it to `ITEM_LEVEL` in `src/dedup.js`.
Add it to `needsRightsQuery` if the identifier is an object-level property.

**Do NOT hand-edit `statementEntries`'s job list.** The registry generates that
list from `MUSEUM_LOOKUPS`. A job spliced in beside it runs outside the
registry's bookkeeping.

### 2b. Search shape — one spec object

Write one spec and pass it to `bandPropertyLookup()` in `src/discover.js`,
alongside `DPLA_LOOKUP`, `EUROPEANA_LOOKUP` and `DIGITALNZ_LOOKUP`.

The spec's fields: `envKey`, `field`, `property`, `fetch`, `browseUrl`,
`trace`, `sample`. Two fields are conditional:

- `keyOptional: true` — only if the API verifiably answers keyless.
- `broadExtra` — only if a `broadNote` needs a field beyond `label` / `total` /
  `url` (DPLA's does, for the heading).

**Do NOT copy and modify an existing block.**
> DPLA and Europeana carried exactly that duplication from 2026-08-03 to
> 2026-08-07: two near-identical blocks in `discover.js`, later collapsed into
> one loop plus two specs.

**If your partner keys on an LC authority, `src/lc.js` is the whole story. It
offers two lookups whose difference is cost, not duplication.** Pick
deliberately:

- `lcHeading(id)` — the **authorized** form only, read from the
  `x-preflabel-encoded` header of a HEAD request. Cheap. DPLA uses this one.
- `lcLabels(id)` — the authorized form **and its variants**. The variants ride
  only in the 88–120 KB record body, so this lookup pays a GET. DigitalNZ
  needs this one.

> The cheap one exists because LC is the single longest serial chain on a cold
> page (27 requests on Angkor Wat) and `id.loc.gov` publishes `Crawl-delay: 3`.
> The request had to get cheaper, not more concurrent. The expensive one exists
> because NZ institutions catalog under NACO forms that LC stores as
> *variants*. On `no2008188470`, the variant "Yeates, John Stuart, 1900-1986"
> is exactly what Turnbull's records state, while the authorized "Yeates, J. S.
> (John Stuart), 1900-1986" matches nothing in DigitalNZ at all.

**Reuse the anchor resolution. Do not reimplement it.** `DIGITALNZ_LOOKUP`
shares DPLA's `field: 'lc'` / P244 (the anchor's Library of Congress authority
ID) instead of adding a fourth WDQS variable, because New Zealand's national
library catalogs through LC/NACO.
> This is VALUES.md's *"a learning generalizes across sources, or it waits"* in
> practice: the strict subject-heading rule is one statement across two
> partners.

**`browseUrl` pays twice** (2026-08-10). It is the "Browse them at X ↗" link of
a folded shelf AND the href behind a sampled shelf's count badge. It must
therefore land on a page that reports the same total the badge prints. Check
that before you write one.

**Take shared mechanisms from `src/relevance.js` — never from another partner's
module.** You are about to reuse two things the first partner of this shape
already solved. The cheap way to get them is to import from your neighbour. Do
not. A mechanism two partners share belongs in a module named after the job,
not after whichever partner needed it first.

`test/layering.test.js` enforces this in both directions: no partner module may
import another, and no shared module may import a partner. You do not have to
remember it. If you add a module that fetches one partner's records, add its
name to `PARTNERS` there. That is the eleventh touchpoint, and the only one
whose whole purpose is to make a later mistake impossible.

> The test checks both directions because both mistakes happened.
> `digitalnz.js` imported the ranker from `dpla.js`. And `lc.js` — shared code,
> and DigitalNZ's own dependency — imported `lcBranch` back out of `dpla.js`.
> The second is the worse one: shared code that depends on one partner quietly
> makes every other partner depend on it too. Both fixes landed 2026-08-10.

> The rule exists because the instinct behind the mistake is correct. VALUES.md
> asks that a learning generalize across sources rather than be re-solved per
> partner. The instinct to reuse the neighbour's code is right. Only the
> destination is wrong. Shared homes: `relevance.js` for shelf composition,
> `rights.js` for licence vocabulary, `http.js` for transport, `lc.js` for
> authority headings.

**Ranking and corroboration are shared, and both are mandatory for a
subject-heading partner:**

- **Rank and fold the shelf** — `rankShelfEntries` in `src/relevance.js`. A
  facet filter has no relevance gradient, so the first rows are an arbitrary
  page of an unordered list.
  > Measured on "Armstrong, Neil, 1930-2012": 60 items, ~50 genuinely
  > Apollo 11, and the four returned first were the only junk in the set.
  > Separately, those 60 held just 42 distinct title-prefixes — one group of
  > ten. Ranking without folding therefore fills a shelf with four copies of
  > one photograph.
- **Corroborate** — `corroborated()` in `src/relevance.js`. A record earns its
  card only if its own subject field touches the article somewhere *beyond* the
  anchor that fetched it. Places do not corroborate, except the article's
  subject.
  > DigitalNZ's first day: Trotsky, a Fraggle Rock lunch box and two iPhone
  > cartoons on Apollo 11. **Every card was true about its anchor.** Truth
  > about the anchor and relevance to the article are different properties, and
  > the pipeline tested only the first. The breadth threshold hid this for
  > DPLA, because an absolute item count silently assumes the partner lives
  > where the article does. DPLA holds tens of thousands of items under "New
  > York (N.Y.)" and folds. DigitalNZ holds eleven and passes.

### 2c. Neither shape — read the precedent, do not force it

Real exceptions stay hand-written:

- The **Smithsonian** requires a PAIR of properties read from one row, never
  two (`smithsonian.js` — see the `OPTIONAL` comment in `statements.js` on why
  splitting it is wrong).
- The **Rijksmuseum** needs three serial requests per object, because Linked
  Art models the object, its visual content and its file as three resources
  (`rijks.js`).
- The **subject's own artworks** come from asking the graph what the subject
  made, not from any wikilink lookup (`artworks.js`).

If a partner needs multiple properties, multiple hops, or a question the
article's own links cannot phrase, it likely belongs here. **Do not force a
fourth shape through §2a or §2b for the sake of uniformity. One more
hand-written case is the better outcome.**

---

## 3. Rules that apply to the cards themselves

- **Give every Wikidata-backed card a `why` / `trace` / `fix` triple**, so a
  reader can check or correct the statement it rests on. A card with no trace
  is legitimate only for citation-derived cards, where nothing is editable on
  Wikidata.
- **`rights.copy` is the host's licence for this copy. `rights.work` is the
  work's status.** They can disagree, and the disagreement is the point. Never
  print one as the other.
  > The Rijksmuseum record states two CC URIs. `subject_to` covers the picture
  > (public-domain mark). `subject_of.subject_to` covers the catalogue *text*
  > (CC0). If you print the second, you promise CC0 over an image the museum
  > only marked public domain.
- **A creator-level ruling covers a work only if the creator is its sole
  author.**
  > *Rembrandt, the Master & His Workshop* (1991) is filed under Rembrandt
  > alongside three living authors, and it rendered with a public-domain mark.
- **Do not blame the API before you diagnose the funnel.**
  > The Met rendered one card on Rembrandt with a perfectly healthy API.
  > `proseLinks` strips `<table>`, and artist articles link their paintings
  > from gallery tables. Of 35 museum-bearing anchors, 14 survived the strip,
  > 3 reached the lookup, and 2 rendered.
- **The modeling error you can see is not always the constraint that binds.
  Count the targets before you diagnose.** Verified 2026-08-11 (LUI-147), and
  the verification overturned the diagnosis this bullet used to carry.
  > CVMA GB has 28,135 medieval stained-glass photographs in Mix'n'Match and
  > zero matches ever. That LOOKS like a modeling bug, and one exists: the
  > catalog types every entry as stained glass the MATERIAL (Q1473346). The
  > settled pattern is window (P31=Q21061279) plus material (P186), and 523
  > Wikidata items make the same P31 mistake. But a fix would produce almost
  > nothing, because the targets do not exist: the UK has **87**
  > stained-glass-window items against those 28,135 photographs (France:
  > 3,300). The vocabulary is a third layer. Windows state P186 as clear glass
  > (2,555), lead (699) or plain glass (693), and "stained glass" itself
  > appears just 84 times — so even the correct property, queried with the
  > obvious value, misses nearly everything. The diagnosis order that would
  > have caught this in one pass: count the target items first, then check the
  > property, then the value vocabulary.
- **Layer discipline: pipeline modules must not import the renderer's types.**
  > `discover.js` reached into `emit-html.js`'s `SOURCE` map. That broke the
  > layer, and the fix moved the names to `MUSEUM_NAME` in `artworks.js`.

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

> DigitalNZ's first commit deliberately deferred the friends entry and the
> icon, and both are reader-facing: the partner did the work and got none of
> the credit. That is why the last four boxes exist.

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

(`WIKIMEDIA_UA_CONTACT` must be *your* address. It identifies whoever actually
runs the code to the Wikimedia Foundation, and there is deliberately no
default.)

Render all three before and after. If none of the three exercises the new
partner, **add a fourth fixture that does**. Then read the cards.

> A person looking at a rendered page found every partner bug in this document.
> A passing test found none.
