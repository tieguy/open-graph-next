# Single-Institution Pages for Work-Articles (Paintings Round) Design

## Summary

This document lays out how to give certain Wikipedia articles a fundamentally
different rendering treatment than the site's normal mode. The current system
(tapestry-gen) enriches a Wikipedia article by pulling in cards from many
different open-data partners at once. This design carves out a special case:
when the article is specifically about a single painting or sculpture that
some museum actually holds, the page instead becomes a two-party
collaboration between Wikipedia and that one museum — its image, its catalog
data, and its related holdings — with every other partner switched off for
that page.

The mechanism is a four-stage pipeline added to the existing
article-rendering flow. First, the article's Wikidata subject is checked
against a class list to see if it is a painting or sculpture. Second, if it
is, the subject's own identifier claims are walked in a fixed precedence
order to find exactly one holding museum — deliberately using only explicit,
already-linked identifiers rather than any kind of fuzzy or inferred
matching. Third, that museum supplies the catalog record, the public-domain
image, and a search scoped to its own collection for the article's other
linked entities (like the artist). Fourth, the page renders with the
museum's record in the lead visual position, a merged fact panel that shows
Wikipedia's infobox data and the museum's data side by side (including
disagreements), and enrichment cards drawn only from that museum. Any
failure at any stage — not a work, no direct identifier, fetch failure,
non-public-domain rights — causes the page to fall back to today's ordinary
multi-partner rendering, and the whole treatment sits behind an experiment
flag so it can be compared against normal pages.

## Definition of Done

A visitor who requests an enwiki article that *is* a museum-held painting (e.g.
The Night Watch) receives a page where:

- the holding museum's own record of that painting leads the page: the
  museum's hi-res public-domain image, with a labeled link out to the museum's
  own deep-zoom viewer;
- a merged panel presents Wikipedia's infobox facts and the museum's catalog
  record together, each row visibly attributed to its source, with
  disagreements shown side by side rather than resolved;
- every enrichment on the page comes from that one museum (anchor cards
  included), and the legend reads as a two-party statement ("This page:
  Wikipedia + the Rijksmuseum");
- articles that are not works, carry no direct museum identifier, or whose
  fetch fails render exactly as they do today;
- the treatment is gated by an experiment flag so the same article can render
  in ordinary multi-partner mode for comparison;
- at least the three already-wired holders (Rijksmuseum, the Met, AIC) work
  end to end, and a QA inspection window of 20–50 census-sampled articles has
  been checked by hand for: the correct object fetched, rights flags honored,
  conflict rows rendering correctly, and clean degradation.

Music, books, and film are explicitly out of scope for this round (see
Decisions).

## Glossary

- **Wikidata**: the structured-data sister project to Wikipedia; each item
  (e.g., a specific painting) is a machine-readable record of facts
  ("statements") about that subject, usable independently of the Wikipedia
  prose.
- **QID**: the unique identifier Wikidata assigns to each item (e.g., a
  painting, a person, a museum), of the form `Q` plus a number.
- **Wikidata property (P-number) notation**: each fact type Wikidata
  records — "collection," "inventory number," "IIIF manifest," a museum's
  own object-ID scheme — has its own property, identified as `P` plus a
  number. A statement pairs a property with a value on a given QID (e.g.,
  "this painting's P195 [collection] is the Rijksmuseum"). Specific ones
  used here:
  - **P13234, P3634, P4610, P11110, P4683, P2582, P6246, P2538**: each is
    one museum's own object-identifier property (Rijksmuseum, the Met, the
    Art Institute of Chicago, Cleveland, the National Gallery of Art, the
    Getty, Paris Musées, and Nationalmuseum Sweden, respectively) — a
    direct link from the Wikidata item to that museum's own catalog record
    for the object.
  - **P195 (collection)**: which institution currently holds/owns the item.
  - **P217 (inventory number)**: the museum's accession/catalog number for
    the object, without necessarily linking to a structured record.
  - **P973 (described at URL)**: a link from the item to a web page (here,
    a museum collection page) that describes it.
  - **P6108**: a property holding a museum's own IIIF manifest URL for the
    object.
  - **P724**: an Internet Archive identifier, used here for film holdings.
  - **P9394, P13325, P8905**: object-identifier properties for the Louvre,
    the National Gallery (London), and the Prado, respectively — future
    candidate holders, not yet wired in.
  - **Q3305213, Q860861**: the Wikidata classes for "painting" and
    "sculpture," used to detect whether an article's subject is a work in
    scope.
- **Best rank**: Wikidata statements for one property can be marked
  preferred, normal, or deprecated; "best rank" means the highest-priority
  ones still in force — used here to break ties when a work has multiple
  museum identifiers.
- **enwiki**: the English-language Wikipedia, as distinct from Wikidata or
  other language editions.
- **WDQS**: the Wikidata Query Service, a public endpoint for structured
  queries over all of Wikidata — used here to measure how many
  articles/items carry which identifiers.
- **IIIF**: the International Image Interoperability Framework, a standard
  many museums use to serve high-resolution images with deep-zoom viewers
  and a machine-readable "manifest" describing the image and its metadata.
- **Deep-zoom viewer**: an image viewer (often IIIF-based) that lets a user
  zoom into fine detail on a high-resolution image; this design links out
  to the museum's own such viewer rather than embedding one.
- **Holder**: this document's term for the single museum or institution
  that physically holds the work the article is about, selected as the
  page's sole enrichment source.
- **Anchor / anchor card**: an "anchor" is another entity linked from the
  article (such as the artist) that enrichment cards can attach to; an
  "anchor card" is one such enrichment rendered under that anchor.
- **Hero**: the lead, most visually prominent position on a rendered page —
  this design gives the holder's record of the article's subject a new top
  tier in that position.
- **Rights statement / public-domain flag**: per-object metadata a museum
  publishes itself (e.g., an "Is Public Domain" field) indicating whether
  the specific work's image can be reused; the featured treatment is gated
  on that flag rather than on assumptions.
- **NC (noncommercial) terms**: a licensing restriction excluding
  commercial reuse; no source with NC terms anywhere in its rights chain
  qualifies as a holder.
- **IMSLP**: International Music Score Library Project, an online public
  library of public-domain sheet music, mentioned as a possible future
  "reference library" partner for musical works.
- **Gutenberg / Open Library**: Project Gutenberg and the Internet
  Archive's Open Library, digital-text repositories mentioned as possible
  future partners for literary works.

## Architecture

The experiment: when an article is literally about one museum-held painting,
the page becomes a two-party collaboration — Wikipedia plus the one
institution that holds the work — instead of the usual multi-partner
assembly. The renderer demonstrates a single-minded partnership: the work
itself, the museum's record of it, and the museum's related holdings, with
every other partner sitting out.

Four stages, all inside the existing tapestry-gen pipeline
(`all-the-opens/tapestry-gen/`):

1. **Work-article detection.** The pipeline already resolves the article
   title to its Wikidata QID (`src/wikipedia.js` `fetchQids()`) and fetches
   the subject's claims (`src/discover.js`). Detection adds one class check
   on the subject: is it an instance of painting (Q3305213) or sculpture
   (Q860861)? The check uses the same class-ancestry machinery and
   `fact-class-<QID>` disk cache that place/defunct detection uses in
   `src/statements.js`.

2. **Holder selection.** For a detected work-article, walk the subject's own
   identifier claims in precedence order and pick one holding institution.
   Round-one keys, all direct object-ID properties: Rijksmuseum P13234, Met
   P3634, AIC P4610, then the new holders (Phase 6): Cleveland P11110, NGA
   P4683, Getty P2582, Paris Musées P6246, Nationalmuseum Sweden P2538. A
   museum's own IIIF manifest URL (P6108) also qualifies. When several IDs
   are present, prefer the one whose museum matches the item's best-rank
   P195 (collection) statement; ties break by partner capability tier.
   **No fuzzy matching** — see Decisions.

3. **Single-source page assembly.** The holder supplies (a) its catalog
   record for the object, (b) the work's public-domain image, and (c)
   holder-scoped anchor discovery (the article's anchors — above all the
   artist — searched only against that museum's collection). All other
   partners are suppressed on these pages, behind an experiment flag.

4. **Rendering.** The work leads the page in the hero position
   (`src/hero.js` gains a standing above today's `subject-document` tier):
   the cached hi-res primary image plus a labeled link out to the museum's
   own deep-zoom viewer. Below it, the merged panel (see Phase 4). Anchor
   cards render in the existing bands with counts on shelf heads; the legend
   becomes the two-party statement.

**Failure modes all degrade to today's behavior:** not a work, no direct ID,
holder fetch failed, or rights flag not public-domain → the ordinary
multi-partner page ships unchanged.

### Holder capability contract

A museum joins this round only if it clears all three, keylessly or with a
free key, with no NC terms anywhere:

| Capability | Contract |
|---|---|
| (a) Record by object ID | Catalog fields for the merged panel: title, date, medium, dimensions, accession number, credit line, rights statement |
| (b) Work image | Hi-res, public domain per the museum's own per-object rights flag (e.g. the Met's `Is Public Domain`, AIC's `is_public_domain`) |
| (c) Holder-scoped search | Given an artist (or related anchor), return that museum's holdings |

### Population (WDQS, measured 2026-08-16)

- 10,699 enwiki articles are instance-of painting; 3,917 sculpture.
- 1,415 paintings carry at least one of the nine direct object-ID/IIIF
  properties above (Met 462, AIC 65, plus the others).
- 8,346 carry an inventory number (P217). 6,933 have collection+inventory
  but none of the nine IDs — those are reachable only via the upstreaming
  lane (LUI-171), not this renderer.
- The big European holders have their own populated ID properties (Louvre
  P9394: 425, National Gallery London P13325: 313, Prado P8905: 283, …) —
  future holder candidates gated on per-museum API and image-licensing
  probes, not on Wikidata coverage.

## Existing Patterns

This design extends patterns found in the codebase (investigated
2026-08-16):

- **Partner manifest** (`src/partners.js`): one descriptor per partner;
  logic in partner-specific code. New holders enter via the adding-a-source
  playbook (`all-the-opens/docs/adding-a-source.md`) as identifier-shaped
  partners, the same shape as the existing `met`/`artic`/`rijks` entries.
- **Subject claims and class verdicts**: `src/discover.js` already fetches
  the subject's claims; `src/statements.js` already answers class-ancestry
  questions through the `fact-class-<QID>` cache. Detection reuses both.
- **Hero ranking** (`src/hero.js`): a `heroRank` tier list already
  prioritizes "partner's record of the subject, with a visual". This design
  adds a tier above it rather than replacing the mechanism.
- **Caching** (`src/http.js` request cache, `fact-img` image registry,
  `src/page-cache.js`): the holder's record JSON and primary image ride the
  existing URL-keyed request cache and image-registry proxy. No new cache
  layer.
- **Partner-relative credit and rights lines**: rights gating reads the
  museum's own per-object flag, consistent with the established practice of
  citing the partner's own words in licence lines.

**Divergence, deliberate:** the infobox-retention design
(`docs/design-plans/2026-08-08-infobox-retention.md`) treats the infobox as
passive furniture. Work-article pages revise that — see Decisions.

## Implementation Phases

### Phase 1: Detection, holder selection, experiment flag
**Goal:** A requested article is classified work/not-work; work-articles
select a holder from the three wired museums; a flag routes them to the
experimental treatment (initially: nothing visible changes when the flag is
off, and flag-on only logs the selection).

**Components:**
- Work-class check in `src/statements.js` (new class verdicts for Q3305213,
  Q860861 via the existing `fact-class` cache)
- Holder selection in `src/discover.js` (precedence walk over subject
  claims; P195 best-rank tiebreak)
- Experiment flag plumbing (env var, same pattern as existing feature
  gates), off by default

**Dependencies:** none.

**Done when:** unit tests pass for detection (work vs. person vs. place
articles), for holder precedence (multi-ID items, P195 tiebreak), and for
the flag being off leaving output unchanged. The Night Watch, a Met
painting, and an AIC painting select the right holders in a live run.

### Phase 2: Holder record + work image fetch
**Goal:** For a selected holder, fetch capability (a) and (b): the catalog
record and the public-domain primary image, through the existing request
cache and image registry.

**Components:**
- Record-by-ID fetchers for `rijks`, `met`, `artic` in their partner code
  (normalizing to one holder-record shape: title, date, medium, dimensions,
  accession, credit line, rights)
- Rights gate on the museum's own per-object public-domain flag
- Image registration through the existing `fact-img` registry

**Dependencies:** Phase 1.

**Done when:** tests pass for record normalization per holder and for the
rights gate (non-PD object → no featured treatment); fetch failure
demonstrably degrades to the ordinary page.

### Phase 3: The work leads the page
**Goal:** Flag-on work-articles render the hero treatment: primary image in
the lead position, museum credit, and a labeled link out to the museum's own
deep-zoom viewer; the legend reads as the two-party statement.

**Components:**
- New top standing in `src/hero.js` for the holder's record of the article's
  own subject
- Link-out affordance (per-holder viewer URL template in `src/partners.js`
  descriptors)
- Two-party legend variant

**Dependencies:** Phase 2.

**Done when:** rendered-page tests pass (work leads, link-out present,
legend correct); flag-off renders byte-identical to before.

### Phase 4: Merged infobox panel
**Goal:** Wikipedia's infobox facts and the holder's catalog record render
as one panel, each row attributed to its source; fields both sides state
with different values show both, labeled.

**Components:**
- Panel assembly combining the existing infobox-retention parsing with the
  Phase 2 holder-record shape
- Conflict display (dimensions are the canonical test case)

**Dependencies:** Phases 2–3.

**Done when:** tests pass for row attribution, merge of disjoint fields, and
side-by-side conflict rendering; a real conflicting article renders both
values.

### Phase 5: Single-source discipline + holder-scoped anchors
**Goal:** Flag-on pages draw every enrichment from the holder: other
partners suppressed; anchor discovery (capability (c)) searches only the
holder's collection.

**Components:**
- Partner suppression under the flag in `src/discover.js`
- Artist/anchor-scoped search for `rijks`, `met`, `artic` in their partner
  code, rendering into existing bands with shelf-head counts

**Dependencies:** Phase 3.

**Done when:** tests pass for suppression (no foreign partner cards
flag-on) and for holder-scoped card placement; The Night Watch page shows
only Rijksmuseum enrichments, with the museum's other Rembrandts at the
Rembrandt anchor.

### Phase 6: New holders
**Goal:** Cleveland (P11110), NGA (P4683), Getty (P2582), Paris Musées
(P6246), Nationalmuseum Sweden (P2538) join, each via the adding-a-source
playbook.

**Components:** per holder: a capability probe first (record-by-ID, image,
artist search, licence read from the partner's own terms — NGA's search
capability is unverified), then the manifest descriptor + partner code.
A holder that fails its probe is dropped from the round and the failure
recorded on the probe's Linear issue.

**Dependencies:** Phases 1–5 (each holder lands independently after them).

**Done when:** each landed holder passes the same test suite shape as
Phase 2/5 holders; per-holder coverage counts recorded against the census.

### Phase 7: Census file + QA window
**Goal:** The offline enumeration exists and the experiment is checked
against reality before any broad flag-on.

**Components:**
- Dated census data file (materialized WDQS union query: article → QID →
  identifiers → holder), checked in; never read at request time
- Cache warming for the flagship set from the census
- QA inspection window: 20–50 census-sampled articles across holders,
  checked by hand for the correct object (ID round-trip), rights flags
  honored, conflict rows rendering correctly, and clean degradation

**Dependencies:** Phases 1–5 (Phase 6 holders join the sample as they land).

**Done when:** census file committed with its query date; QA findings
written up (per-holder coverage vs. census denominator, dated); flag
default decided from the findings.

## Additional Considerations

**Decisions (2026-08-16, from the design session):**

- **No fuzzy matching, ever.** The renderer reads explicit links from the
  graph or reads nothing: direct object-ID properties (or a museum's own
  IIIF manifest URL) only. No accession-format guessing, no search-and-hope.
  Where the graph lacks the link, the page honestly gets no holder and the
  fix is the upstreaming lane (LUI-171: backfill museums' own object IDs
  onto Wikidata items — a separate tool/UI surface from this renderer).
  Boundary note: the existing Smithsonian partner's P195+P217 pair is an
  exact join of two graph statements and stays as-is, but holder selection
  does not extend that pattern.
- **Link out to the holder's viewer; don't embed deep zoom.** The page
  serves the cached primary image; zooming happens on the museum's own
  viewer (their traffic, their viewer, no tile proxying, works for holders
  without IIIF). IIIF embedding remains possible later as a per-partner
  opt-in — it is the standard's intended use — but round one links out
  everywhere.
- **Work-articles revise the infobox-as-furniture rule** (2026-08-08
  design): on these pages the infobox participates in a merged, per-row
  attributed panel, with conflicts shown side by side. Everywhere else the
  2026-08-08 rule stands unchanged.
- **Music, books, and film are deferred, not rejected.** A symphony or novel
  has no holding institution — only editions in reference libraries (IMSLP,
  Gutenberg/Open Library) — so the holder shape does not fit; a future
  round needs a "reference library partnership" shape. Film is closer
  (Internet Archive holds specific digitized prints; Nosferatu carries two
  P724 identifiers) but was held out to keep every round-one page's holder
  unambiguous. Populations, measured 2026-08-16: 46,248 enwiki musical-work
  articles (3,081 with IMSLP); 69,825 literary works (24,048 with Open
  Library, 1,528 with Gutenberg full text); 161,551 films (6,028 with an IA
  identifier).

**Future expansion (verified 2026-08-16, parked):** two additional
exact-join routes exist beyond direct ID properties — 3,833 painting
articles carry P973 (described at URL) pointing at collection pages (Tate
362, Rijksmuseum 126, Louvre 96, …), and museums increasingly assert the
join from their side (the Met's bulk dump has an `Object Wikidata URL`
column). Both are explicit statements, not fuzzy matches, and could widen
holder selection later.

**Error handling:** upstream failures use the existing cool-off machinery;
a degraded render during cool-off is not stored (existing rule). The
holder's viewer link renders even when the record fetch partially fails, as
long as the rights-gated image is available; anything less falls back to
the ordinary page.
