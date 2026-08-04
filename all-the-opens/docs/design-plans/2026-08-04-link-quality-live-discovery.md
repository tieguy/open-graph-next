# Link Quality for Live Discovery Design

## Summary

This design fixes a class of bug in the `tapestry-gen` live-discovery pipeline where cards render *truthful but misleading* content: a carousel that correctly answers "does this file depict the anchor?" while ignoring whether it has anything to do with the article's actual subject (e.g., a "gopuram" carousel pulling gopuras from Singapore onto an Angkor Wat page). The fix is a set of independent, mostly-composable levers applied to the same discovery core (`src/discover.js`, `src/statements.js`) shared by both the batch renderer (`spike.js`) and the streaming server (`serve.js`) — no renderer changes beyond wording. The levers span three kinds of intervention: **honesty** (Phase 1: report pivot failures as "unchecked" rather than silently asserting "none found"; Phase 6: an anchor too broad to specifically relate to the subject gets no carousel at all, with the omission disclosed rather than hidden), **correctness gates** (Phase 2: maps only render for real, extant, locatable places, via a Wikidata class check; Phase 3: each anchor is owned by exactly one band and each file can render once per page), and **quality/relevance ranking** (Phase 4: rank a larger candidate pool by Commons quality signals instead of taking the first N results; Phase 5: prefer files whose Wikidata P180 statements tie them to *both* the anchor and the article's subject, falling back to anchor-only when that intersection is thin). A sparse-page budget (Phase 7) only ships if thin articles still look padded after the ranking work; the Commons fix-list (G) — surfacing suspect upstream depicts-claims for human correction — is scoped out to its own design plan.

The implementation approach leans on patterns already established in the codebase — batching new signals onto existing single requests to avoid growing the request budget, using the existing disclosure-line channel to narrate omissions, and treating "refuse rather than render something wrong" as the house style already set by `mapEntry`'s non-Earth-globe refusal. Phases are sequenced so unconditional wins (honesty, map gate, dedup) land first, followed by the two ranking/affinity phases, with the specificity gate and later phases tuned against real re-renders of five fixture articles rather than designed speculatively.

## Definition of Done

Overnight review of the deployed demo (help-from-our-friends.fly.dev) against
"Dapples" and "Angkor Wat" found that most cards truthfully answer their
*anchor* but not the *article*. This design is done when:

- No carousel on a rendered page is an arbitrary, unranked sample of a large
  depicts pool. Files shown are ranked, and where the intersection exists they
  also connect to the article's subject (Angkor Wat's "gopuram" carousel shows
  gopuras *at Angkor*, not in Singapore).
- No anchor's carousel repeats across bands, and no file appears twice on a
  page (the Khmer Empire set rendered identically in three Angkor Wat
  sections; the University of Lausanne pair twice on Dapples).
- Map cards render only for locatable, extant places — never again "Map:
  Khmer" for a language item that happens to carry P625, and no modern OSM
  maps for dead polities (Khmer Empire, French Protectorate of Cambodia).
- A pivot failure can never harden into a false claim: when the OpenLibrary
  batch times out, coverage says the works could not be checked this run, not
  "no open copy".
- Verified by re-rendering the three fixtures (Apollo 11, Brown v. Board,
  Ludwig Prandtl) plus Dapples and Angkor Wat, with no regression in the
  cold-run request profile beyond what the design budgets explicitly.

Sequencing agreed 2026-08-04: H, E, D land unconditionally first (honesty,
map gate, dedup); then A + B (ranking, subject affinity); C is tuned against
the post-A/B renders; F (sparse-page budget) only if Dapples still feels
padded after C; G (Commons fix-list) is a large, high-value project in its
own right — this plan only leaves the data seam for it (Phase 8) and defers
its design to a dedicated plan.

## Glossary

- **Anchor**: A wikilink or citation target within the article's own text (e.g., "gopuram" linked from the Angkor Wat article) that the pipeline resolves to a Wikidata QID and uses as a pivot point to fetch related media/sources.
- **Band**: A section of the rendered page (roughly corresponding to an article section) that groups the carousels/cards discovered for the anchors mentioned there.
- **Carousel**: The row of media cards (typically Commons images) shown for a given anchor within a band.
- **Pivot**: The act of following an anchor's QID out to an external source (Commons, OpenLibrary, WDQS, OSM, etc.) to discover related content; "pivot failure" means that external call didn't succeed.
- **QID**: A Wikidata item identifier (e.g., Q9205), the stable ID used to resolve anchors and subjects across sources.
- **P180 / P625 / P373 / P402 (etc.)**: Wikidata property IDs. P180 = "depicts" (links a Commons file to the Wikidata items it shows); P625 = "coordinate location"; P373 = "Commons category"; P402/P10689/P11693 = OpenStreetMap identifiers. The design uses presence/absence of these properties to decide what a card is allowed to claim.
- **`haswbstatement`**: A Commons/MediaWiki search syntax for querying files by the Wikidata statements attached to them (e.g., `haswbstatement:P180=Q123` finds files depicting Q123); used here to search for files whose P180 matches both the anchor and the subject at once.
- **WDQS**: Wikidata Query Service — the SPARQL endpoint used to check an item's class membership (e.g., whether it's a "locatable, extant place") before allowing a map card.
- **`wdt:P31/wdt:P279*`**: SPARQL property-path shorthand for "instance of, or a subclass (transitively) of" — the standard Wikidata pattern for testing whether an item belongs to a class hierarchy (e.g., is a kind of "human settlement").
- **Global usage**: A MediaWiki API property (`prop=globalusage`) reporting how many wikis actually use a given Commons file — used here as a quality/trust ranking signal.
- **Commons assessment categories (Featured/Quality/Valued images)**: Community-awarded quality tiers on Wikimedia Commons, used as a ranking signal for which files to prefer.
- **`gsrlimit`**: The MediaWiki Generator Search Results limit parameter — how many candidate search results to fetch before ranking/trimming to the display count.
- **Disclosure line / `band.disclosure`**: User-facing text on the rendered page that explains pool sizes, omissions, or uncertainty (e.g., "N could not be checked this run") rather than silently showing an unexplained result.
- **`coverageText` / citation coverage**: The generator's summary of how well an article's cited works were checked against open-access sources (open / linked / unreached / the new "unchecked" state).
- **Trace / `entry.trace`, `entry.fix`**: Provenance metadata attached to a rendered card that explains *why* it's there (which statement justified it) and links to the editable source statement, so a human can correct bad data upstream.
- **Byte-reproducibility**: The project invariant that the batch renderer produces identical output bytes for identical cached input — meaning all new ranking/dedup logic must be a deterministic, pure function of fetched data.
- **Tier-1 request profile**: The baseline cold-run request count/timing (39 requests, 9.0s for the Prandtl fixture) treated as a budget that new phases must not silently blow past.
- **Corroborated evidence class**: A previously-retired evidence class (see `tapestry-gen/CLAUDE.md`) whose closure established the "fix the graph upstream" precedent this design's refusal-over-wrongness stance follows.
- **Fixture**: A saved, offline test article (Apollo 11, Brown v. Board, Ludwig Prandtl, plus Dapples and Angkor Wat as new evidence cases) used to re-render and check for regressions without live API calls.

## Architecture

All changes live in the shared discovery core (`tapestry-gen/src/`), used
identically by batch (`spike.js`) and streaming (`serve.js`). No renderer
changes except provenance/coverage wording. The pipeline's shape is
unchanged; what changes is *which* cards each pivot admits and *what the page
claims* when a pivot fails.

Five levers, in landing order:

1. **Honesty on failure (H)** — `openLibraryVolumes` failures currently
   degrade to "volume unknown", which `coverageText` then reports as "no open
   copy". Failed ISBN groups must instead flow through coverage as
   *unchecked*, a fourth state alongside open/linked/unreached.
2. **Map gate (E)** — `statements.js` renders a map card whenever an item
   carries P625 or an OSM identifier. The WDQS query gains the item's class
   (`wdt:P31/wdt:P279*` membership test against a small set of locatable,
   extant place classes) and `mapEntry` refuses items that fail it.
3. **Pivot once per page (D)** — anchors are collected per band today; a
   page-level owner registry assigns each anchor QID to exactly one band
   *before* pivots run (deterministically: the band where the anchor's first
   or most prominent mention falls — not completion order, which streaming
   makes racy). A page-level seen-file set additionally drops any card whose
   file already rendered under another anchor.
4. **Rank, don't sample (A)** — `commonsDepicting` raises `gsrlimit` from
   `COMMONS_PER_ANCHOR` to a candidate pool (~20) and ranks locally before
   taking the display count. Ranking signals ride the same single request
   (`prop=imageinfo|globalusage|categories`): global usage count, Commons
   assessment categories (Featured/Quality/Valued images), image dimensions,
   P180 statement presence already implied by the search. Deterministic
   tiebreak so batch renders stay byte-reproducible.
5. **Subject affinity (B)** — `commonsDepicting(anchorQid, subjectQid)`
   first searches `haswbstatement:P180=<anchor> haswbstatement:P180=<subject>`
   (search terms AND by default); if it returns ≥2 files the carousel uses
   them and the trace strengthens to "depicts both this section's link and
   the subject"; otherwise fall back to the anchor-only search. Cost: up to
   one extra Commons search per anchor, on the serial commons queue — see
   Additional Considerations for the budget.

Then, tuned against evidence:

6. **Specificity gate (C)** — the existing `BROAD_ANCHOR` threshold
   (`discover.js:55`, currently disclosure-only via `band.broad`) becomes a
   demotion: an anchor whose `totalhits` exceeds the threshold *and* whose
   subject intersection came back empty gets no carousel at all. The
   disclosure line already explains pool sizes; it starts explaining
   omissions the same way.
7. **Sparse-page budget (F, conditional)** — if Dapples still reads as
   padding after C: when the subject's own media (P373 category + lede
   extras) is below a floor, each band caps at one non-subject carousel.
8. **Commons fix-list (G, own project)** — suspect depicts claims become a
   work list pointing at the same file-page anchors the ⓘ fold already
   links, so the graph gets fixed and every reuser inherits it — the
   P724/Prandtl move. Agreed to be a large project in its own right
   (heuristics with false-accusation stakes, a reporting surface, possibly
   supervised editing); this plan only preserves the fetched P180/caption
   data on entries (Phase 8) and defers everything else to a dedicated
   design plan.

## Existing Patterns

- **One request, more props** is the established Tier-1 pattern
  (`fetchArticle` gets sections+HTML+wikitext in one parse call; pivots batch
  via `src/batch.js`). A follows it: ranking signals ride the existing
  `commonsDepicting` request rather than adding one.
- **Refusal over wrongness** is established in `mapEntry`'s non-Earth-globe
  refusal ("Tranquility Base gets no map of the Atlantic",
  `src/statements.js`) and in the corroborated-class retirement. E and C
  extend the same stance.
- **Disclosure lines** (`band.disclosure`, `coverageText` in
  `src/discover.js`) already narrate pool sizes and arbitrariness; H and C
  reuse that channel rather than inventing a new one.
- **Byte-reproducibility off cache** is a batch invariant
  (`tapestry-gen/CLAUDE.md`); A's ranking must be a pure function of fetched
  data with deterministic tiebreaks.
- **Provenance folds** (`entry.trace` / `entry.fix`) already point at the
  editable statement; B strengthens trace text, G aggregates what the folds
  already know.
- Tests live flat in `test/` (`pivots.test.js`, `citations.test.js`,
  `stream.test.js`) and run offline against fixture JSON; each phase's tests
  follow that pattern.

## Implementation Phases

### Phase 1: Timeouts degrade to "not checked" (H)
**Goal:** A failed pivot can never assert a negative.

**Components:**
- `src/discover.js` — `openLibraryVolumes` returns which ISBN groups failed
  alongside the volumes map (retry the failed group once with backoff before
  giving up; `getJson` in `src/http.js` already retries transport-level, this
  is one batch-level retry on top).
- `src/discover.js` — `citationCoverage` / `coverageText` gain an
  `unchecked` count; wording: "N could not be checked this run".

**Dependencies:** none.

**Done when:** a simulated OpenLibrary timeout produces a coverage line
saying the works went unchecked, never "no open copy"; `citations.test.js`
covers the failed-batch path; full suite passes.

### Phase 2: Maps only for real places (E)
**Goal:** No map cards for languages, peoples, or dead polities.

**Components:**
- `src/statements.js` — the WDQS statement query gains a boolean per item:
  membership of `wdt:P31/wdt:P279*` in a small allowset of locatable, extant
  geographic classes (geographic feature, human settlement, administrative
  territorial entity, building/structure, organization-with-headquarters).
  Same single query per page.
- `src/statements.js` — `mapEntry` call sites gate on it. An OSM identifier
  (P402/P10689/P11693) plus allowset membership maps; bare P625 on a
  non-member never does.

**Dependencies:** none.

**Done when:** Angkor Wat page: no "Map: Khmer", no Khmer Empire / French
Protectorate maps; Angkor Wat, Genoa, EFEO maps survive; `pivots.test.js`
covers member/non-member items; fixtures unchanged where correct.

### Phase 3: Pivot once per page (D)
**Goal:** No repeated carousels, no repeated files.

**Components:**
- `src/discover.js` — anchor-owner registry built at anchor-collection time
  (before any pivot runs): each anchor QID belongs to the band of its most
  prominent mention; other bands drop it. Deterministic under streaming's
  completion-order emission.
- `src/discover.js` — page-level seen-file set applied as each band's
  entries settle, covering Commons depicts, category files, and partner
  cards alike.

**Dependencies:** none (interacts with 4–5 only in that dedup runs before
ranking trims).

**Done when:** Angkor Wat renders the Khmer Empire set once; Dapples renders
the Lausanne pair once; no `File:` appears twice on any fixture page;
`stream.test.js` confirms band payloads stay deterministic.

### Phase 4: Rank within the pool (A)
**Goal:** The four files shown are the best four we fetched, not the first
four the search returned.

**Components:**
- `src/discover.js` — `commonsDepicting` fetches a ~20-candidate pool with
  `prop=imageinfo|globalusage|categories` on the same request; a pure
  `rankDepicting(files)` orders by assessment category, global usage,
  resolution, with filename tiebreak; display count unchanged.

**Dependencies:** Phase 3 (dedup consumes ranked lists).

**Done when:** ranking is unit-tested against fixture payloads (assessed >
widely-used > large > rest, stable order); re-rendered Dapples no longer
leads Vaud with the tracasset shot; request count per anchor unchanged.

### Phase 5: Subject-affinity intersection (B)
**Goal:** Broad anchors show the anchor *as it relates to the subject*.

**Components:**
- `src/discover.js` — `commonsDepicting(anchorQid, { subjectQid })` tries the
  two-clause `haswbstatement` search first, falls back when <2 hits; result
  marked so trace text reads "…states it depicts both X and this article's
  subject (P180 = both)".
- `src/discover.js` — disclosure line distinguishes intersection carousels
  from fallback ones.

**Dependencies:** Phase 4 (intersection results flow through the same
ranking).

**Done when:** Angkor Wat's gopuram/sandstone/Hinduism carousels show Angkor
files; traces name both QIDs; cold-run request delta measured against the
Prandtl profile and recorded in the implementation notes; tests cover
intersection-hit and fallback paths.

### Phase 6: Specificity gate, tuned on evidence (C)
**Goal:** Broad anchors that the intersection cannot save stop rendering.

**Components:**
- Evaluation first: re-render Apollo 11, Brown v. Board, Prandtl, Dapples,
  Angkor Wat with Phases 1–5; record per-band card censuses.
- `src/discover.js` — anchors with `totalhits > BROAD_ANCHOR` and an empty
  intersection get no carousel; the disclosure line states the omission and
  the pool size. Threshold stays env-tunable (`BROAD_ANCHOR`).

**Dependencies:** Phases 4–5.

**Done when:** no fallback carousel on the five test pages draws from a
pool over threshold; disclosure explains each omission; census diff reviewed
before/after.

### Phase 7: Sparse-page honesty budget (F — conditional)
**Goal:** A thin subject gets a short honest page, not padding.

**Decision point:** only proceed if the Phase 6 census still shows Dapples
dominated by peripheral carousels.

**Components (if built):**
- `src/discover.js` — when subject-owned media (P373 category + lede extras)
  is under a floor, cap each band at one non-subject carousel (highest-ranked
  survivor); coverage/disclosure says the page is deliberately spare.

**Dependencies:** Phase 6 census.

**Done when:** Dapples renders its three family files prominently with at
most one peripheral carousel per band, and the page says why it is short.

### Phase 8: Data-capture hooks for the fix-list project (G — seam only)
**Goal:** Leave this codebase ready for G without designing G here.

G — turning bad upstream P180 claims into a corrected graph — is its own
large project (agreed 2026-08-04): suspect-detection heuristics with real
false-accusation stakes, an emission/reporting surface, and possibly a
supervised editing workflow on Commons. That gets its own design plan and
is out of scope for this one.

**Components (this plan only builds the seam):**
- `src/discover.js` — the depicts loop preserves each candidate file's full
  P180 list and caption metadata on the entry (fields the ranking in Phase 4
  fetches anyway), so a future suspects pass has its inputs without
  re-fetching.

**Dependencies:** Phase 4 (same fetched props).

**Done when:** the retained fields are present on entries in fixture runs
and documented; a stub note in `docs/design-plans/` names the follow-up
project and its two known exemplars (the dried-fruit file claiming
P180 = Q43202, the US Civil War enlistment record claiming P180 = Q9205).

## Additional Considerations

**Request budget.** The Tier-1 profile (cold Prandtl: 39 requests, 9.0s) is
a guarded asset. Phase deltas: 1–4 add zero requests (props ride existing
calls; the WDQS class test rides the existing statements query). Phase 5
adds at most one Commons search per anchor with a non-empty fallback —
worst case roughly doubles the commons queue for anchor-heavy pages; the
phase records the measured delta and, if it exceeds ~30% cold-run wall
clock, drops to intersection-only-for-broad-anchors (`totalhits` known only
after the first query, so that variant reorders: anchor-only first, then
intersection retry only when `totalhits > BROAD_ANCHOR`, which costs the
extra search only where it pays).

**Byte reproducibility.** All ranking and dedup must be pure functions of
fetched data with stable tiebreaks; the batch invariant (same cache → same
bytes) is the regression test.

**Streaming determinism.** D's owner registry must be computed from article
order, not band completion order, or streamed pages would nondeterministically
reassign carousels between runs.

**Upstream fixes remain the preferred fix.** E, C and G all route around bad
or thin data; the provenance folds and the G list keep pointing at the
statements to repair. When Wikidata or Commons is corrected, this pipeline
inherits the fix with no code change — that asymmetry is the project's
thesis and the reason G emits rather than filters silently.
