# Adding a data source

*What it actually costs to wire an open collection into a working site, written
from the incidents rather than from the intentions. Last verified 2026-08-08.*

Split out of `tapestry-gen/CLAUDE.md` on 2026-08-08 (LUI-140), because it had
grown from "which registry row do I edit" into something a new contributor —
or a future agent with no memory of this project — should be able to open
directly.

**Two audiences, one document.**

1. **Us.** Every file a new source touches and every check that has to pass
   before it ships. Part 1 and Part 2.
2. **Everyone else.** Part 2's pitfalls are written with the real incident
   attached, and Part 3 is commentary: what was hard, what should not have
   been, and what the ecosystem could fix. A reader who never adds a source to
   this project should still come away understanding what integrating an open
   collection costs in 2026.

> **Provenance, borrowed from `reaching-open-collections.md`.** `[ours]` means
> reproduced directly in this project, with the commit or command shown.
> `[research]` means reported elsewhere and not independently re-verified here.
> Everything decays — an undated "partner X blocks us" is worthless within
> months — so every claim below carries a date.
>
> **Every pitfall in Part 2 is currently `[ours]`**, and that is deliberate: a
> document whose whole argument is "check it before you ship it" cannot itself
> run on claims nobody reproduced. Unverified leads go to an issue and come
> back here once someone has run them. The convention stays because a future
> entry may legitimately be `[research]` — it just has to say so.

**Not config-driven, and an audit concluded it shouldn't try to be.** Every
partner needs its own fetcher and its own rights mapping, because every
partner's API is shaped differently and states its terms differently. A
registry removes duplication in how a partner *registers*; it cannot remove
the knowledge of what that partner *returns*. What this document optimizes is
knowing what to hand-edit and where — and Part 3 asks what a real plugin
boundary would have to look like, since "nine files to add one source" is
itself a finding.

---

## Part 0 — pick a shape first

Three shapes, and picking the wrong one produces code that fights the pipeline
rather than fitting it. Decide this before writing a fetcher.

1. **Direct-id shape** — the object is named by ONE Wikidata property, bound
   straight to a WDQS var. `MUSEUM_PIVOTS` in `tapestry-gen/src/statements.js`
   is the registry: Met (P3634), AIC (P4610), Rijksmuseum (P13234), iNaturalist
   (P3151), GBIF (P846), IIIF (P6108). Do NOT hand-edit `statementEntries`'s
   job list — it is generated from the registry, and a job spliced in beside it
   runs outside the registry's bookkeeping.

   > **Why a registry and not a switch statement.** The job list used to be
   > hand-written, which let the code that FETCHES an object drift from the
   > code that decides which objects exist. Generating one from the other makes
   > that drift structurally impossible rather than merely reviewed-against.

2. **Search shape** — no direct object id, but a property names something
   *searchable* (a subject heading, an entity id), and what comes back is a
   SAMPLE of a larger holding rather than the partner's own record of the
   anchor. `DPLA_PIVOT`, `EUROPEANA_PIVOT` and `DIGITALNZ_PIVOT` in
   `tapestry-gen/src/discover.js` are the three live cases, all through the
   shared `bandPropertyPivot()` loop. A new one is a single spec object with
   `envKey`/`field`/`property`/`fetch`/`browseUrl`/`trace`/`sample`. Do NOT
   copy an existing block and modify it — that is exactly the duplication DPLA
   and Europeana carried from 2026-08-03 until a refactor collapsed it.

   > **Why `sample` is a required field, not a nicety.** This shape answers
   > "what does the partner hold under this heading", not "what is the
   > partner's record of this thing". Four items drawn from a holding of
   > thousands would read as complete unless the page says otherwise, so every
   > entry carries the total, and `src/breadth.js` refuses to sample at all
   > once a heading is broad enough that four items stop meaning anything
   > (`tooBroad`, threshold 300, fitted to twelve observations).

   `DIGITALNZ_PIVOT` reuses DPLA's `field: 'lc'` rather than adding a fourth
   WDQS var, because New Zealand's national library catalogs through LC/NACO
   rather than running its own VIAF contribution — so the same Library of
   Congress authorized heading serves both.

3. **Neither shape — read the precedent, don't force it.** The Smithsonian is
   found by a PAIR of properties read from ONE row (P195 collection + P217
   inventory number), never two, because a bare accession number belongs to
   whichever museum assigned it. The Rijksmuseum needs three serial requests
   because Linked Art models the object, its visual content and its file as
   three resources. The subject's own artworks are reached by asking the graph
   `?work wdt:P170 ?subject`, not by pivoting off a wikilink at all. A fourth
   shape forced through 1 or 2 for uniformity's sake is a worse outcome than
   one more hand-written case.

---

## Part 1 — the mechanical path

The Rijksmuseum integration (`fe20306`, 2026-08-06) is the worked example. It
touched **nine places**, which is itself the finding Part 3 picks up:

| # | File | What goes in it | Skippable? |
|---|---|---|---|
| 1 | `src/<partner>.js` | fetch, parse, entry shape, rights read | never |
| 2 | `src/statements.js` | property in `VARS` / `wdqsUrl` / `PROP_NAME` / `MUSEUM_PIVOTS`; `needsRightsQuery` if the partner's objects are works | direct-id shape only |
| 3 | `src/discover.js` | the pivot spec (search shape) or nothing (direct-id) | search shape only |
| 4 | `src/dedup.js` | `ITEM_LEVEL` if the partner is item-keyed, else `SOME_HOOK` | see below |
| 5 | `src/gap.js` | `PARTNER_HOSTS` — the partner's domains, for the visibility panel | never |
| 6 | `src/emit-html.js` | the `SOURCE` entry: display name + icon URL | never |
| 7 | `src/icons.js` | **regenerated**, not hand-edited | never |
| 8 | `test/<partner>.test.js` | pure entry-mapping and rights functions, no network | never |
| 9 | `CLAUDE.md` | the rationale, so the next person inherits the reasoning | never |
| + | `src/front-page.js` | the `FRIENDS` entry and its license link | after verification |

**On #4:** DigitalNZ (`e48cd8e`, 2026-08-08) needed no `dedup.js` edit, because
it reuses DPLA's existing `lc` field and `SOME_HOOK` already covered it. That
is luck, not a rule. A partner introducing a new WDQS var must decide its tier:
`ITEM_LEVEL` means "whatever comes back IS the thing the article linked, by
construction" — a Met object, a taxon, a IIIF manifest. A subject heading or an
entity id is not that, and belongs in tier 1.

**On #7 — the one that bit us, this week `[ours]`.** `src/icons.js` is
GENERATED by `tools/build-icons.mjs` and committed as data URIs. The renderer
has **no live fallback for favicons**: `favicon()` in `emit-html.js` emits an
icon only if that exact URL is already in the committed map, and otherwise
renders a named entry with no picture. So adding a `SOURCE` entry without
regenerating produces a partner that is silently iconless — no error, no broken
image, nothing to notice.

That is exactly what the DigitalNZ commit shipped: `SOURCE` gained a
`digitalnz` row, `build-icons.mjs` was never run (that session had no outbound
network access), and DigitalNZ cards will render correctly and iconlessly until
someone reruns it:

```
WIKIMEDIA_UA_CONTACT=you@example.com node tools/build-icons.mjs
```

The script is deliberately not part of the build — a deploy must never depend
on seventeen third-party hosts being up (that is the current count of
`iconUrls()`, 2026-08-08) — which is precisely why it is easy to forget. It is
step 7 of nine and the only one with no failing test behind it.

### Before writing any fetch code

In this order:

- **Read the host's published rate-limit or crawl-delay policy**, then set
  `hostLimit()` in `src/mw.js`. The default is 1 and stays 1 without a
  citation: "nothing goes in it without a published statement quoted at the
  call site." Every partner audit here has found this step skipped when
  something went wrong.
- **Check what the API exposes for rights**, against what
  `ccFromUri`/`ccFromSlug`/`ccFromLabel` already read (`src/rights.js`). Extend
  the partner audit table in `tapestry-gen/CLAUDE.md`; add a row whether or not
  the partner turns out to have a mark, because "it publishes nothing" is
  itself the finding.
- **Give every Wikidata-backed card a `why`/`trace`/`fix` triple**, so a reader
  can check or correct the statement the card rests on. A card with no trace is
  legitimate only for citation-derived cards, where nothing is editable.
- **Resolve a real identifier AND a deliberately bogus one** before shipping
  any URL you construct. See Pitfall 1 — this is the rule that matters most and
  the one this project learned the hard way.
- **Verify with `spike.js`, not by reasoning about the diff.** Render Apollo 11,
  Brown v. Board of Education and Ludwig Prandtl before and after, and add a
  fixture that actually exercises the new partner if none of the three does.

  > **A caveat that will recur.** This step needs outbound network access to
  > the partner's live API. An implementation done without it — a sandboxed
  > session, a locked-down CI runner — can follow every other step faithfully
  > and still ship a fetcher whose field names are educated guesses. That is a
  > distinct state from "verified" and should say so in the commit rather than
  > claim confidence the work does not have. DigitalNZ shipped exactly this
  > way; its note in CLAUDE.md's Partner pivots section says so.

---

## Part 2 — the pitfalls, each with the incident behind it

Every one of these happened here. The evidence is cited so it can be checked
and falsified, not abstracted into advice.

### 1. Guessing a URL shape ships a 404 to readers `[ours]`

*Rijksmuseum, `5fd6c24`, 2026-08-06. Reported as a 404 on a live card.*

The href was built as `/en/collection/object/<numericId>` — **a URL shape that
does not exist**. From the fix's own commit message: "I invented it when adding
the partner and never checked that one resolved."

The numeric id addresses the DATA (`id.rijksmuseum.nl/200107928` serves JSON).
The web page is keyed by accession number: `/en/collection/SK-C-5`, no
`/object/` segment. The museum states a canonical URL of its own and it is
*worse* for linking — Dutch, and carrying a hash that cannot be derived
(`/nl/collectie/object/SK-C-5--3137deb45cd7765f9a76084a16c99544`) — so it is
kept only as a locale-swapped fallback.

**The rule: resolve a real id AND a deliberately bogus one of the same shape.**
The bogus one is the whole test. It proves the server distinguishes them, which
is the only thing that makes a 200 on the real one mean anything.

The fix verified 9/9 by resolving every href the code produces, across
paintings (SK-C-5, SK-A-3066, SK-A-2391, SK-A-3340, SK-A-3934) and prints
(RP-P-1912-2395, RP-P-1906-695, RP-P-2004-957, RP-P-OB-60.797) — deliberately
across departments, so the pattern was not fitted to one numbering scheme.

> **Margin note.** Nothing about this was hard. It required one `curl` before
> committing. The reason it shipped is that the numeric id *looked* like an
> object id, the URL *looked* like a museum URL, and nothing in the pipeline
> distinguishes a plausible URL from a resolving one. Constructing URLs from
> identifiers is the single most common thing a linked-data consumer does, and
> it is unvalidated by default everywhere.

### 2. A test written from the same assumption as the code pins the bug `[ours]`

*Same commit.* `rijks.test.js` asserted:

```js
assert.match(e.href, /rijksmuseum\.nl\/en\/collection\/object\/200107947/)
```

The test passed. The URL 404'd. A test written from the same wrong assumption
as the code confirms the bug rather than catching it, and its green tick is
worse than no test at all, because it is evidence of a check that never
happened.

The replacement asserts an exact string against a fixture carrying a real
accession number, and names the incident in a comment: `// The reported bug:
/en/collection/object/200107928 is not a URL that exists.`

> **Margin note.** The generalizable form: a unit test can prove your code does
> what you meant. It can never prove what you meant is true of the world. Any
> value crossing the boundary to a third party — a URL shape, a field name, a
> vocabulary term — needs a check against that third party at least once, and a
> fixture captured *from a real response* rather than typed from the docs.

### 3. Blaming the API when the problem is anchor supply `[ours]`

*Met on Rembrandt, `fe20306`, 2026-08-06.* The Met rendered **one card** on the
single best article for it, with a perfectly healthy API. It was starved of
anchors.

`proseLinks` strips `<table>` blocks, and on an artist article that is exactly
where paintings are linked. Measured on enwiki's Rembrandt:

| stage | anchors carrying a museum id |
|---|---|
| all links in the article | **35** (Met 11 · Rijks 14 · AIC 1 · IIIF 9) |
| survive the `<table>` strip | 14 |
| reach the partner pivot | 3 |
| rendered as cards | **2** |

Anchor *selection* was working — 4 of 6 tier-0 slots picked, both misses
duplicates already claimed upstream. The strip is load-bearing: it is what
keeps navboxes, infoboxes and succession boxes off every page. So the fix was
not to loosen the strip but to stop routing the question through links at all:
`src/artworks.js` asks Wikidata what the subject made. Rembrandt's museum cards
went 2 → 11.

> **Margin note.** Diagnose the funnel before concluding the partner is broken.
> Four stages, each losing material for a different and defensible reason, and
> the visible symptom at the end was "the Met's API must be bad." The same
> shape recurs in `reaching-open-collections.md` §7, where a curated page showed
> five Smithsonian items and live discovery showed two — and four of the five
> turned out to be unreachable for reasons no ranking change would touch.

### 4. Wrong modeling assumption, not missing data `[ours]`

The graph usually has it — under a property, or in a direction, you did not
check. Two verified cases here, and they fail in different ways.

**The Smithsonian states no object-id property at all.** Columbia, the Apollo
11 command module, carries none of P3634/P4610/P13234/P6108 — the four
properties every other museum partner here is found by. A pivot built on the
assumption "a museum states an id for its objects" finds nothing and concludes
the Smithsonian has not published. It has: the object carries **P195**
(collection) and **P217** (inventory number), and the Open Access API indexes
the accession number. The pair has to be read from ONE `OPTIONAL` block, too,
or an object in a Smithsonian collection could be paired with another museum's
inventory number — the Rijksmuseum states P217 on its objects as well
(`src/smithsonian.js`, and the comment at `statements.js:44-51`).

**A property has a direction, and it may not be yours.** `src/artworks.js`
asks `?work wdt:P170 ?subject` — what did this person make. An article *about*
a painting therefore gets nothing from it: The Night Watch fires the pivot
**zero** times, because P170 points from the painting to Rembrandt and not the
other way. That is not a bug and not missing data; it is one direction of one
statement, and the pivot that wants the other direction is a different query.

The deliberate cousin is `needsArtworksQuery` keying on `P31 → Q5`: a
workshop, a studio or an artists' collective is not Q5 and so gets no shelf.
Documented as a trade against the transitive class walk that cost 16–37s and
blew the WDQS timeout when mappability tried it — an accepted narrowness
rather than an oversight, which is a third distinct thing from the two above.

> **Margin note.** "The graph doesn't have it" is very often "the graph has it
> under a property, or in a direction, I didn't check." Before concluding a
> dataset is absent, query the entity by any route and read what it actually
> states. The cost of the wrong conclusion is high and silent: you write off a
> collection, and nothing anywhere reports an error.
>
> An unresolved case of exactly this shape is tracked in **LUI-147** (the
> Corpus Vitrearum's medieval stained glass, reportedly ~28k entries returning
> no matches because the material is stated through `P31` rather than `P186`).
> It is *not* written up as a pitfall here, because nobody has reproduced it in
> this repo — and a playbook that cites an unverified incident is doing the
> thing it warns against in Pitfall 2.

### 5. `rights.copy` versus `rights.work` — printing the wrong one promises a license nobody granted `[ours]`

*Rijksmuseum, `fe20306`.* The record states **two Creative Commons URIs and
they mean different things**: `subject_to` on the VisualItem is the picture
(public-domain mark), while `subject_of.subject_to` is the **catalogue text**
(CC0). Reading the wrong one would have promised CC0 over an image the museum
marked otherwise.

This is why the two are separate fields all the way to the renderer:

- **`rights.copy`** — the license the HOST serves this copy under. A promise
  somebody made about these bytes.
- **`rights.work`** — the copyright status of the WORK, from Wikidata `P6216`,
  qualified by jurisdiction. A fact about the work, with a different answer in
  different countries.

They can disagree, and the disagreement is the point: an institution asserting
terms over a photograph of a public-domain painting is exactly the situation
the public-domain community built tooling to expose.

**The related failure, `7351c43`, 2026-08-06:** *Rembrandt, the Master & His
Workshop* (1991) wore a public-domain mark, because Open Library files it under
Rembrandt — alongside Holm Bevers, Peter Schatborn and Barbara Welzel, three
living scholars who actually wrote it. CopyClear's ruling was not wrong; it was
about what Rembrandt made, and a 1991 catalogue is not that. `ebook_access`
could not catch it: Open Library answers `no_ebook`, which is silence rather
than a statement, so nothing was being overridden — a creator-level ruling was
simply reaching somewhere it does not go. `soleAuthor` now withholds it from
any work with a co-author, translators included, since a translation is a new
work with its own living rights holder.

> **Margin note.** The governing rule here is **a mark is never a guess** —
> `ccFromUri`/`ccFromSlug`/`ccFromLabel` return null for anything unrecognized,
> and `other-oa` (OpenAlex knows a copy is free to read and does NOT know on
> what terms) gets nothing, because free to read is not a license. Silence is
> the correct output for an unknown, and it is genuinely hard to hold that line
> when a page looks better with marks on every card.
>
> DigitalNZ (2026-08-08) is the newest application: its `usage` array states
> plain-English capabilities (`Share`/`Modify`/`Use commercially`), which say
> what a reader may DO but not which license grants it or whether attribution
> is required. `All rights reserved` maps cleanly onto the existing
> rightsstatements InC branch; the affirmative combination deliberately gets no
> glyph and is said in words instead — the same stance GBIF and OpenStreetMap
> already get, for the same reason.

### 6. Bot mitigation is not a broken link `[ours]`

*Four partners, 2026-08-06. See `reaching-open-collections.md` §2 and §3.*

| Host | Answer | Header |
|---|---|---|
| `www.inaturalist.org` | 403 | `cf-mitigated: challenge` |
| `www.europeana.eu` | 403 | `cf-mitigated: challenge` |
| `www.gbif.org` | 302 → challenge | `server: cloudflare` |
| `www.metmuseum.org` | 429 | `x-vercel-mitigated: challenge` |
| `dp.la` (any app route) | 202, empty body | `x-amzn-waf-action: challenge` |

**In all of them, a real identifier and an impossible one of the same shape
return byte-identical responses.** Without the control experiment, 494 healthy
dp.la links across six showcase pages read as dead, and were confirmed fine by
hand in a browser.

**The partial workaround** is to validate the *identifier* against the
partner's API, which is generally not gated:

```
https://api.gbif.org/v1/species/5133088   → 200, real taxon
https://api.gbif.org/v1/species/999999999 → 404
```

That confirms the id is real. It does **not** confirm the page URL shape —
which is the thing that actually broke in Pitfall 1. The two checks are not
substitutes.

> **Margin note.** This is the sharpest ecosystem finding in the project.
> Challenge-gating an item page makes the *aggregator's own links unverifiable
> by anyone but a human with a browser* — including by the aggregator. The
> failure mode it creates is worse than an outage: a broken URL shape becomes
> undetectable, because the server never reports the difference between a bad
> identifier and a bad bot.

### 7. Read robots.txt before fetching assets `[ours]`

*HathiTrust, 2026-08-06.* It serves a page-1 thumbnail of a public-domain scan
with no key, 200 and 15 KB. But `babel.hathitrust.org/robots.txt`:

```
User-agent: Twitterbot
Allow: /cgi/imgsrv      ← imgsrv, explicitly

User-agent: *
Crawl-delay: 1
Disallow: /cgi/         ← imgsrv is under /cgi/
```

**168 of the 229 thumbnail-less DPLA cards** on the six showcase pages are
HathiTrust books. The images exist, are public domain, and are served without
authentication — and general clients are asked not to take them while a
link-preview crawler is named and permitted.

**Status: not taken.** A project arguing that institutions' publishing choices
deserve respect does not help itself to what a robots.txt refuses. Read
charitably, the Twitterbot allowance means HathiTrust *wants* these scans seen
in previews, and the blanket `/cgi/` disallow is almost certainly aimed at the
page-turner and search endpoints with imgsrv caught by path. This looks like a
rule nobody has been asked about. **The move is to ask, not to route around.**

### 8. Favicons each fail in their own way `[ours]`

The Met 429s. CourtListener 403s. Europeana's 404s, and its live one sits
behind a content-hashed Nuxt path that changes on every redeploy of their site.
OpenAlex's `favicon.ico` answered **200 with a 2.8 KB HTML error page**, which
cleared a size-only check and shipped as OpenAlex's icon — a guaranteed broken
image on every page citing an open paper, for as long as nobody looked.

`tools/build-icons.mjs` now tests `/^data:image\//` on the result, because
size is not enough to know a picture arrived. Each stand-in in `SOURCE` is
justified inline; the usual fallback is the logo on Wikimedia Commons at an
allowlisted thumbnail width.

> **Margin note.** Every one of these loads fine in a browser tab, which is
> exactly why they ship broken. "I checked it" and "a non-browser client can
> fetch it" are different claims, and only the second one is the one your
> server makes.

### 9. Rate limits and Crawl-delay are published, and mostly unread `[ours]`

`id.loc.gov` publishes `Crawl-delay: 3` under a notice that irresponsible
clients get blocked — so the answer to it being the longest serial chain on a
cold page (27 requests, 5.1s on Angkor Wat) was to make each request *cheap*
(a HEAD reading `x-preflabel-encoded`) and then *rare* (a durable cache), never
to open more sockets. DPLA's developer policy explicitly declines to rate-limit
"consistent with its philosophical presumption of openness", which is why
`api.dp.la` is the one host widened to 4.

Wikimedia hosts have their own non-negotiable rules: `WIKIMEDIA_UA_CONTACT` has
no default and must name whoever is *running* the code. A block lands on the
operator, not the author.

DigitalNZ publishes no numeric limit at all — its docs describe a shared cap on
unauthenticated traffic and say keyed users can negotiate — so it gets no
`WIDENED` entry and stays at the default of 1.

### 10. Layer discipline: pipeline modules must not import the renderer `[ours]`

*`fe20306`.* The artworks pivot needed to name which museum holds a work,
inside a sentence the pivot itself writes — and reached into `emit-html.js`'s
`SOURCE` map from `discover.js` to get it. That inverts the pipeline's one
structural invariant: the output-agnostic core does not know about its
renderer.

Fixed by `MUSEUM_NAME` in `src/artworks.js` — the pivot's own knowledge of
which partner it asked. Note the subtlety in its comment: it is keyed by the
entry's `source`, not by the partner key, because the Art Institute answers to
`aic` in Wikidata and renders as `artic` on a card.

### 11. Keyed versus keyless, and prefer keyless `[ours]`

DPLA and Europeana require keys and **silently skip without one** — the demo
must run for anyone who clones it, so a missing key degrades to an absent
pivot, never an error. That is a policy about clones, not a policy against
free keys.

The Rijksmuseum's keyed API was **shut down 2026-01-05**
(`api.rijksmuseum.nl` → `404 {"statusCode":404}`); the keyless replacement is
better, at the cost of a three-hop Linked Art walk to reach one image. The
British Library's `api.bl.uk` is **NXDOMAIN** while 271 Wikidata `P6108`
statements still point at it.

DigitalNZ answered a keyless request on 2026-08-08 and is still gated on
`DIGITALNZ_API_KEY`, on the reasoning that a registered key can negotiate a
higher rate — a judgement call worth revisiting if the keyless path proves
stable.

> **Margin note.** An API key is a dependency on a relationship, and
> relationships lapse. Two of the partners here have had their keyed API
> retired or their host disappear inside eighteen months, and in both cases the
> keyless path outlived the keyed one.

---

## Part 3 — the commentary

The part that is publishable, and the part worth arguing with.

### Nine files to add one source is too many. What stops a plugin boundary?

Sort the nine into what is genuinely partner-specific and what is mechanical:

**Irreducibly per-partner** — someone has to know these, and no schema
supplies them:

- how to fetch (URL shape, auth, pagination, how many hops)
- how to turn a record into an entry (which field is the title, the thumbnail,
  the landing page)
- how its rights vocabulary maps, including when it maps to *nothing*
- its published rate limit

**Mechanically derivable from the above** — and currently hand-edited anyway:

- the WDQS var and `OPTIONAL` clause (derivable from the property)
- `PARTNER_HOSTS` (derivable from the host of the href the fetcher builds)
- the dedup tier (derivable from whether the property names one object)
- the stats key, the `PROP_NAME` row, the `SOURCE` entry
- the icon (derivable from a URL, given a fetch)

So a plugin boundary is imaginable: one module exporting a manifest —
`{ property, itemLevel, host, iconUrl, rateLimit, fetch, entryFrom, rights }` —
with the other six edits generated from it. Roughly five of the nine files
would stop being hand-edited.

**Three things stop it today, and only one is incidental.**

1. **The three shapes are genuinely different.** A manifest fits the direct-id
   shape well and the search shape passably. It does not fit the Smithsonian's
   pair-of-properties-from-one-row, the Rijksmuseum's three-hop walk, or the
   artworks pivot's "ask the graph what the subject made" — and those are a
   third of the partners.
2. **`icons.js` must be generated at build time, not runtime.** Fetching
   favicons at startup cost every cold visitor 6–8 seconds before the port was
   even open. So even a perfect plugin system still leaves one manual
   regeneration step — which, per Part 1 #7, is exactly the step that gets
   forgotten.
3. **Nobody has needed it yet.** Six direct-id partners and three search-shape
   ones is not enough repetition to pay for the abstraction, and the wrong
   abstraction would force shape 3 through shape 1 — which this document
   already warns against.

> The honest summary: the duplication is real but the *knowledge* is not
> duplicated, and a plugin system would mostly relocate the hard parts rather
> than remove them. The checklist is the cheaper fix, which is why this
> document exists instead of a plugin API.

### Which pitfalls are ours, and which are the ecosystem's?

The split is the argument.

**Ours — fixable by better code and process:** guessing a URL shape (1), tests
that pin the bug (2), misdiagnosing anchor supply as a broken API (3),
confusing `copy` with `work` (5), layer discipline (10), and forgetting to
regenerate the icons (Part 1 #7). Six of eleven. Every one is a discipline
problem with a cheap fix, and every one shipped anyway.

**The ecosystem's — we can only route around or ask:** challenge gates that
make links unverifiable (6), robots rules that catch an image server by path
(7), favicons that refuse non-browser clients (8), retired APIs and vanished
hosts (11), and DPLA having no thumbnail for over half its own items.

**Neither — and this is the interesting category:** the Smithsonian chain
(`reaching-open-collections.md` §7). An openly licensed, CC0, already-3D-scanned
Apollo 11 crew hatch is invisible for want of one `P217` statement in Wikidata.
Nobody refused anything. Three independent institutions each hold one link of a
chain, and any single missing link makes the object unreachable — the museum
published it, Wikipedia covers the mission, and the graph is one statement
short. Similarly, CVMA's 28,135 entries (4) are present and unusable because
the modeling and the query disagree.

> That third category is where the interesting work is. The blocked-request
> stories are the ones that feel like grievances, and they are the least
> actionable. The coordination gaps are unglamorous, fixable by anyone reading
> this, and each fix benefits every consumer of the graph rather than only this
> project. **Three Wikidata edits** would put three CC0 3D scans back on every
> article that links them.

### "Resolve a real one and a bogus one" deserves to be a reusable checker

Every linked-data consumer constructs URLs from identifiers, and nobody writes
down how to validate them. The rule this project arrived at has **three**
outcomes, not two, and that is the whole insight:

| real id | bogus id | verdict |
|---|---|---|
| 200 | 404 | **works** — the server distinguishes them |
| 404 | 404 | **broken** — the URL shape is wrong |
| 200 | 200 | **unverifiable** — the host is refusing to talk to you |
| 202/403/429, both identical | same | **unverifiable** — challenge-gated |

Ordinary link checkers have only *works* and *broken*, so they report the third
row as one of the first two — and on five of the partners here, that means
reporting several hundred healthy links as dead. The control request is what
separates "the link is bad" from "I am not allowed to ask."

A reusable version would take an id-to-URL template, a known-real id and a
generated-bogus one of the same shape, and return the three-state verdict. It
should also carry the caveat from Pitfall 6: validating the *identifier*
against an ungated API and validating the *page URL shape* are different
checks, and only the second one catches Pitfall 1.

Not built. It is a small, genuinely reusable thing, and this project has hit
the need for it three times.

### What would partners have to publish for this to be a 30-minute job?

Each of these is traceable to a specific incident above:

1. **A documented, stable web-page URL shape keyed by the identifier the graph
   states.** The Rijksmuseum's page key (accession number) and its Wikidata
   property (numeric data id) are different values; nothing said so. (1)
2. **A machine-readable rights statement per record**, in a standard vocabulary
   — a CC URI or rightsstatements.org — not prose, not a local capability
   rollup. DPLA contributors mostly state free text; DigitalNZ states plain
   words. Both cost a mark the page could otherwise show. (5)
3. **A thumbnail URL in the search response.** DPLA has none for over half its
   own items, which is why 229 cards render pictureless.
4. **An ungated, keyless read API with a published numeric rate limit.** Three
   partners publish no number at all, so they get the conservative default and
   a slower page than they would probably permit. (9, 11)
5. **A favicon fetchable by a non-browser client.** Four failed. (8)
6. **A robots.txt whose disallows are aimed at what they mean to aim at** — and
   ideally an explicit statement about thumbnails, since a link-preview crawler
   being named while everyone else is refused reads as an oversight. (7)

None of these is expensive. Most are a documentation change or a one-line
config. The gap between "this collection is open" and "this collection is
*usable*" is made almost entirely of small omissions, each individually
reasonable, and collectively the reason integrating an open collection in 2026
takes days instead of an afternoon.

---

## Where this pairs

- `reaching-open-collections.md` — the running log of reachability problems.
  Read the two rules at its head before adding an entry, especially the
  real-id/bogus-id control.
- `internet-archive-issues.md` — data-quality problems in one partner's index,
  in the same form.
- `tapestry-gen/CLAUDE.md` — the Partner audit table (what each partner exposes
  for rights), the Partner pivots section (what each one is and what it costs),
  and the copyright rules that Pitfall 5 summarizes.
- The blog diary is the natural home for a published version of Part 3.
  **Not yet published anywhere external as of 2026-08-08**; doing so is a
  deliberate step, not a side effect of this file existing.

## A worked example

DigitalNZ (`src/digitalnz.js`, `e48cd8e`, LUI-145, 2026-08-08) is the most
recent search-shape walkthrough: one spec object reusing an existing WDQS
field, a fetcher module, and a rights read that declines to invent a glyph.

Against the nine, it is a useful example precisely because it is not a clean
sweep — **six done, two not applicable, one missed, one deferred**:

| # | File | DigitalNZ |
|---|---|---|
| 1 | `src/digitalnz.js` | done |
| 2 | `src/statements.js` | n/a — search shape, no new WDQS var |
| 3 | `src/discover.js` | done — `DIGITALNZ_PIVOT` |
| 4 | `src/dedup.js` | n/a — reuses DPLA's `lc`, already in `SOME_HOOK` |
| 5 | `src/gap.js` | done |
| 6 | `src/emit-html.js` | done — `SOURCE` row added |
| 7 | `src/icons.js` | **missed** — no network in that session; icon absent until regenerated |
| 8 | `test/digitalnz.test.js` | done — 8 tests |
| 9 | `CLAUDE.md` | done |
| + | `src/front-page.js` | deferred, correctly — pending a live render |

Two of those are the checklist failing in exactly the ways Part 1 warns about:
#7 has no failing test behind it, and the whole thing shipped unverified
against a live response. Both are recorded in the commit and in CLAUDE.md
rather than quietly fixed later, which is the only part of it worth copying.
