# Live discovery pipeline — any article, no curated dataset

Date: 2026-07-25
Status: designed, not implemented
Supersedes the dataset-bound half of `2026-07-23-article-tapestry.md`

## Summary

`tapestry-gen` currently renders one article because it reads one hand-curated
dataset. `web-demo/data/apollo-11/connections.json` is 35 items and their edges,
written by hand, and `place.js` needs the whole graph in memory before it can
decide anything. Point the generator at another article and it has nothing to
place.

This design removes the curated dataset. Items and edges are **discovered at read
time** by pivoting from the article's own anchors through the identifier graph,
and an edge's `linkedVia` stops being an assertion and becomes the record of
which query found the item. The same code runs under Node 22 for a pre-baked
render and in the browser for a live one.

The target runtime is a static page with no backend — a ProtoWiki prototype — so
every pivot must be keyless, CORS-permissive, and fast enough to stream into a
page that has already rendered. That constraint is load-bearing: it is what rules
Smithsonian, Overpass and Nominatim out of the live path, and what makes the
absence of those sources a thing the design must *show* rather than hide.

## Definition of Done

*(Drafted from the design conversation — confirm before implementation.)*

1. The pipeline takes an arbitrary English Wikipedia article title and produces a
   rendered enriched page with no per-article configuration, no curated dataset,
   and no hand-written connections file.
2. It works on three structurally different fixtures: **Apollo 11** (event,
   media-rich), **Brown v. Board of Education** (legal case, document-centric),
   and **Ludwig Prandtl** (person; his 1899 dissertation is scanned in
   `archive.org/details/leiden-university` and carries no authority identifiers).
3. The article spine renders in roughly one second; enrichment streams in
   afterwards without blocking reading.
4. Every rendered edge carries its evidence, and edges of different evidence
   strength are visibly distinguishable.
5. No fabricated data. Where a connection cannot be made, the page says so rather
   than substituting a weaker guess presented as equivalent.
6. No API key ships in client code; no source is queried in violation of its
   published rate policy.

## Glossary

- **Anchor** — anything the article surfaces that carries an identifier and knows
  its section: a body wikilink, a citation, or an infobox row.
- **Pivot** — one query from an anchor into one source, keyed on an identifier the
  anchor holds. Declares its own evidence strength.
- **Discovery** — a pivot's result: an item, the edge that found it, and the
  section it inherits from its anchor.
- **Evidence strength** — `identifier` (shared authority ID), `statement` (a
  Wikidata claim), or `corroborated` (name match inside a curated collection,
  supported by dates or institution). Rendered differently in each case.
- **Speculative tile** — a placeholder shown where a source demonstrably holds
  material but cannot be queried from a static page. Gated on a real claim, never
  on an invented count.
- **`haswbstatement:`** — CirrusSearch syntax on Wikidata and Commons that finds
  items by property-value. Avoids SPARQL, which is unusable from a browser.
- **Parsoid HTML** — the REST API's article rendering, whose
  `<section data-mw-section-id>` wrappers give per-section wikilink attribution.
- **Work / edition split** — Wikidata models a book as a work item linked by
  `P747` to edition items. ISBNs and Internet Archive IDs live on the *edition*.

## Architecture

### Discovery is placement

The current `place.js` runs a global graph analysis: tier 1 by wikilink, tier 2 by
one hop through `connections.json`, place-only items extracted before tier 2 so
they aren't absorbed. That ordering only works with the full graph in hand, which
a streaming pipeline never has.

Anchored discovery removes the problem. Every item is found by pivoting from a
specific anchor, and that anchor already knows its section. So placement is one
rule: **an item sits in the section of the anchor that found it.** No traversal,
no ordering dependency, no global state. Each arriving item places itself.

What this deletes: `isPlaceOnly`, prologue, coda, and tier 2. The prologue existed
because OSM place items had nothing to anchor to; they now anchor to the subject
via the lede, like anything else.

What survives: **body sections are ranked before the lede**, moved from placement
into anchor ranking. The reasoning is unchanged — the lede summarises the body, so
letting it match first drags the dataset into the opening band.

When two anchors discover the same item, the first placement wins and the second
**thickens the edge**. `linkedVia` accumulates from independent attestation rather
than being asserted, so line weight finally measures something.

### The anchor set

An anchor is **anything the article surfaces that carries an identifier and knows
its section**. Identifiers reach the pipeline by three routes, and Wikidata is only
one of them — the convenient one, not the primary one.

**Citations — the richest source, and article-native.** A `<ref>` containing a
`{{cite …}}` template carries identifiers directly: ISBN, OCLC, LCCN, ISSN, DOI,
bibcode, and archive.org URLs. It sits in a section by construction, so it needs no
placement logic at all. Measured on the Apollo 11 wikitext:

```
149 archive-url    24 oclc    22 isbn    9 issn    6 lccn    5 doi    5 bibcode
```

222 identifier-bearing parameters in one article, against **zero books** from the
Wikidata `P921` route. Internet Archive accepts `isbn:`, `lccn:` and
`external-identifier:"urn:oclc:record:…"`, so those 52 book identifiers are direct
authority-keyed routes into IA with no Wikidata involved.

This route is also *better evidence* than a Wikidata statement. An editor chose to
cite the work in that section — the article itself asserts both the relevance and
the placement, and supplies the identifier.

`citations.js` already extracts per-section `{{cite}}` templates, but only reads
`isbn`, `doi` and `archive-url`. Widening it to `oclc`, `lccn`, `issn` and
`bibcode` is most of the work.

**Wikilinks.** Parsoid HTML gives `<section data-mw-section-id="N">` wrappers
containing `<a rel="mw:WikiLink">`, so each link carries its section. A single
`generator=links&prop=pageprops&ppprop=wikibase_item` call resolves titles to QIDs
500 at a time; `wbgetentities` then yields each entity's external identifiers.
Wikidata is the identifier *carrier* here, not the graph — it is how a linked
entity tells you its VIAF or Open Library ID. Parsoid reports many more link
occurrences than unique targets; deduplicate within each section.

**Infobox rows.** Two kinds, both anchored to the lede. *Identifier rows* — an
ISBN on an infobox book, an ISSN, a catalogue number — are read directly, exactly
like a citation. *Subject statements* — coordinates, an inception date, a heritage
designation — are facts appearing in no prose sentence, taken from the subject's
own item, subject to two conditions:

- *Not present in the body* — a body wikilink to the same entity always wins.
- *High-relevance* — filtered by whether the infobox surfaces it. The infobox is
  Wikipedia editors' own per-article judgment about which of an item's statements
  matter, it is article-specific, and it is already in the stage-0 Parsoid fetch.

This preserves the existing `infoboxLinks` behaviour and extends it from links to
identifiers and statements.

### The pivot registry

The invariant that makes the pipeline page-agnostic: **the pivot set is a function
of the identifiers an anchor carries, regardless of where the article surfaced
them.** A pivot declares which identifier it consumes and is offered every anchor
holding one — it neither knows nor cares whether that ISBN came from a citation
template, an infobox row, or a `P212` claim on a linked entity. A legal case and a
lunar mission run the same code down different paths because their identifiers
differ, not because anything was configured.

This is why Wikidata is not the hub. It is one identifier carrier among three, and
on the evidence the weakest-yielding of them for source material.

All property IDs and query shapes below were verified live on 2026-07-25.

| Pivot | Input | Query | Strength |
| --- | --- | --- | --- |
| `ia-by-identifier` | ISBN / OCLC / LCCN / OL work key | `advancedsearch.php` | identifier |
| `ia-by-archive-url` | `archive-url` on a citation | direct item resolution | identifier |
| `ol-by-isbn` | ISBN | OL by bibliographic key | identifier |
| `commons-depicts` | QID | `haswbstatement:P180=<qid>` on Commons | identifier |
| `commons-category` | `P373` | category members | identifier |
| `wd-main-subject` | QID | `haswbstatement:P921=<qid>` on Wikidata, then `P747` → edition → `P724`/`P212` | statement |
| `ol-author-works` | `P648` on a person | OL `/authors/{key}/works.json` | identifier |
| `collection-creator` | creator name + dates | `collection:<c> AND creator:"…"` | corroborated |
| `unreachable` | `P7851`, `P9473`, `P625` | none — renders a tile | n/a |

The first three consume identifiers the article states outright, with no entity
resolution step in front of them. They are the highest-yield pivots and the
cheapest.

Verified property labels: `P921` main subject, `P212` ISBN-13, `P957` ISBN-10,
`P648` Open Library ID, `P724` Internet Archive ID, `P747` has edition or
translation, `P373` Commons category, `P625` coordinate location, `P7851`
Smithsonian resource ID, `P9473` Smithsonian ARK ID.

### Three evidence classes

The Leiden case forces this and it improves the whole design. Leiden thesis items
carry `creator`, `date`, `institution`, `pub_type` — and **no external identifiers
at all**. There is no authority-keyed route to a thesis. The only path is a name
match inside the collection.

Unscoped free-text search is not acceptable: `subject:"Neil Armstrong"` returns a
US Navy research vessel, a LEGO instruction manual, and a 1974 *Saturday Review*.
But the same technique **scoped to a curated 165,603-item collection**, matched on
the structured `creator` field and corroborated against the person's Wikidata dates
and institution, is a different proposition.

So pivots declare strength and the renderer shows it:

- **identifier** — a shared authority ID. Solid line.
- **statement** — someone asserted this in Wikidata. Solid, lighter.
- **corroborated** — name match within a bounded collection, plus supporting
  signals. Dotted, and labelled with what corroborated it.

An edge never launders itself upward. A corroborated match is never drawn as an
identifier match, and the reader can tell which they are looking at.

### Speculative tiles

Smithsonian requires an `api.data.gov` key with no keyless path; Overpass runs
15–20s with two slots per IP; Nominatim's policy caps traffic at 1 req/sec across
*all* users of a deployment and forbids interactive use. None can be queried live
from a static page.

The tile that stands in for them must not repeat the `potential` counts mistake —
fictional numbers presented as data. It doesn't need to. By the time the tile
would draw, the anchor's Wikidata entity truthfully says whether the material
exists: `P7851`/`P9473` mean a real Smithsonian resource, `P625` means a real
location. The tile appears only when the claim is present and states the actual
blocker, naming the real identifier. Zero extra requests, and true.

### Streaming

Four stages, rendering as they land.

- **Stage 0 — spine.** Parsoid HTML + `generator=links`, in parallel. ~2 requests.
  **The article renders here.** Everything after is enrichment arriving into a page
  that already reads.
- **Stage 1 — hub.** `wbgetentities` over ranked anchors, 50 per call,
  `props=claims|labels`. The only Wikidata entity fetch; yields every pivot
  identifier at once.
- **Stage 2 — fan-out.** Pivot jobs into per-source schedulers. Commons ~4
  concurrent, Internet Archive ~3, **Open Library 1/sec** (a browser cannot set
  `User-Agent`, so the 3/sec identified tier is unreachable).
- **Stage 3 — media.** Batched `imageinfo` for dimensions and licence.

Ranking sets queue *order*, not a cutoff: section prominence (body before lede),
wikilink count, presence of `P18`, entity class. The best material surfaces first
and the tail fills in while the reader reads.

### Contracts

```
Anchor = {
  section: number            // Parsoid data-mw-section-id
  origin: 'citation' | 'wikilink' | 'infobox'
  identifiers: Record<IdentifierKind, string[]>
                             // 'isbn' | 'oclc' | 'lccn' | 'issn' | 'doi'
                             // | 'bibcode' | 'archive-url' | 'qid' | 'viaf'
                             // | 'openlibrary' | 'commons-category' | …
                             // Populated directly for citation and infobox
                             // anchors; via wbgetentities for wikilink anchors.
  qid?: string               // only when the anchor resolved to an entity
  claims?: Record<PropertyId, Value[]>   // only for entity anchors
}

Pivot = {
  id: string                 // e.g. 'commons-depicts'
  source: SourceId
  strength: 'identifier' | 'statement' | 'corroborated'
  applies(anchor: Anchor): boolean       // gate on claims, never on article
  run(anchor: Anchor): AsyncIterable<Discovery>
}

Discovery = {
  item: Item                 // existing items/*.json node shape
  edge: {
    from: string             // anchor QID
    type: 'person' | 'subject' | 'location' | 'time' | 'creator'
    label: string            // Wikidata property label where available
    linkedVia: string[]      // identifiers that attested this edge
    corroboratedBy?: string[]   // 'creator' | 'date' | 'institution'
    strength: Pivot['strength']
  }
  section: number            // inherited from the anchor
}
```

Everything downstream — renderer, cache, pre-baked path — consumes a stream of
`Discovery`.

### Caching

IndexedDB in the browser, `.cache/` on disk under Node, both keyed by request URL.
Preserves the generator's existing byte-reproducibility, makes a second visit
near-instant, and is the difference between a well-behaved API client and a rude
one.

## Existing Patterns

Follows `tapestry-gen`'s established structure, per `tapestry-gen/CLAUDE.md`:

- **Output-agnostic core → renderer.** Pipeline modules never assume a format.
  Discovery emits `Discovery`; only `emit-html.js` knows about HTML.
- **URL-keyed cache, offline reruns.** Extends `.cache/` to the new pivots and
  mirrors it into IndexedDB for the browser.
- **Zero dependencies, Node 22.** Built-in `fetch` and `zlib.crc32`; the same
  modules run in both runtimes unchanged.
- **True image dimensions** via `imagesize.js` — unchanged and still required.
- **Generated, not authored.** The founding invariant. This design strengthens it:
  the last hand-authored input disappears.

Reused as-is: `wikipedia.js` (sections, prose, wikilinks, QIDs, lead images,
infobox links), `resolve.js`, `imagesize.js`, `citations.js`, `emit-html.js`.

Divergences:

- **`place.js` is replaced, not extended.** Tier 2, `isPlaceOnly`, prologue and
  coda all require global graph analysis that anchored placement makes unnecessary.
- **`dataset.js` and `connections.json` leave the input path.**
  `web-demo/data/apollo-11/` becomes a fixture for regression comparison rather
  than the source of truth. (It also currently sits under `web-demo/`, which is
  being retired — the move is cleanup, tracked separately.)

## Implementation Phases

### Phase 1: Anchor extraction

**Goal:** Article title → ranked anchors with sections and identifiers, no dataset
involved. Covers both article-native routes.

**Components:** `src/anchors.js` — Parsoid section parsing, wikilink extraction,
QID resolution via `generator=links`, per-section dedup, ranking. Extends
`src/wikipedia.js` rather than duplicating its fetch helpers. `src/citations.js` —
widened from `isbn`/`doi`/`archive-url` to also read `oclc`, `lccn`, `issn` and
`bibcode`, and to emit citations as anchors rather than only as gutter content.

**Dependencies:** none.

**Done when:** Apollo 11, Brown v. Board and the Leiden author each yield a ranked
anchor list with correct section attribution; Apollo 11's citation anchors surface
the measured identifier counts (22 ISBN, 24 OCLC, 6 LCCN, 149 archive-url); tests
cover lede/body precedence and the Parsoid duplicate-occurrence case.

### Phase 2: Pivot registry and scheduler

**Goal:** The extension point, with rate discipline.

**Components:** `src/pivots/registry.js` — `Pivot` contract, identifier-gated
applicability (not claim-gated: a pivot is offered every anchor holding its
identifier kind, whatever the provenance). `src/schedule.js` — per-source
concurrency and rate limits, streaming results.

**Dependencies:** Phase 1.

**Done when:** A stub pivot streams results under a rate limit that tests can
observe; per-source limits are enforced independently; the same pivot fires for a
citation-derived and an entity-derived ISBN without special-casing.

### Phase 3: Citation-identifier pivots

**Goal:** The highest-yield route, and the one needing no entity resolution.

**Components:** `src/pivots/archive.js` — `isbn:`, `lccn:`,
`external-identifier:"urn:oclc:record:…"`, `openlibrary_work:`, plus direct
resolution of `archive-url` citations that already point at archive.org.
`src/pivots/openlibrary.js` — lookup by bibliographic key; covers via
`covers.openlibrary.org`.

**Dependencies:** Phase 2.

**Done when:** Apollo 11's cited books resolve to Internet Archive copies placed in
the sections that cite them; covers load with no additional API call; OL keys
harvested out of IA responses are used for display only.

### Phase 4: Entity pivots

**Goal:** What linked entities reach that citations don't — media, and works nobody
cited.

**Components:** `src/pivots/commons.js` (`P180` depicts, `P373` category);
`src/pivots/wikidata.js` (`P921` main subject → `P747` → edition → `P724`/`P212`);
`src/pivots/openlibrary.js` extended with author works for person anchors holding
`P648`, within the 1/sec budget.

**Dependencies:** Phase 3.

**Done when:** Apollo 11 yields Commons media and the `P921` film/TV items; the
work→edition→IA chain resolves on a book known to carry it; OL is called at most
once per person anchor.

### Phase 5: Infobox anchors

**Goal:** Identifiers and facts that appear only in the infobox.

**Components:** `src/infobox.js` — infobox extraction from Parsoid section 0.
Identifier rows read directly, like citations. Subject statements matched to
claims, with body-presence exclusion.

**Dependencies:** Phase 2 (identifier rows), Phase 4 (subject statements).

**Done when:** An infobox identifier row produces a discovery through the Phase 3
pivots unchanged; coordinates on an article whose body never links its location
produce a lede-anchored entry; an entity linked in the body is excluded.
**Contains a spike:** enwiki infoboxes are hand-filled wikitext, not Wikidata-fed,
so row→property matching is unproven. If it proves unreliable across the three
fixtures, fall back to identifier rows and coordinates only, and record the
finding.

### Phase 6: Corroborated collection pivot

**Goal:** The Leiden case, honestly marked. Fixture: **Ludwig Prandtl** (`Q76683`)
and his 1899 dissertation *Kipp-Erscheinungen*, scanned at
`archive.org/details/IA41548318_0126`.

**Components:** `src/pivots/collection.js` — two levels, preferring the first.

*Described-object match.* Where the person has `P1026` (academic thesis), the
thesis entity describes the target: `P50` author, `P577` publication date, `P4101`
thesis submitted to. Search the collection for an item whose `creator`, `date` and
`institution` all satisfy that description. On Prandtl every field agrees —
`Prandtl, Ludwig` / `1899-11-14` / `Ludwigs-Maximilians-Universität zu München`
against `Q76683` / `1899` / `Q55044`. Matching a described object is far higher
precision than matching a name.

*Person-level fallback.* Where `P1026` is absent, match `creator` against the
person's name and corroborate with `P569`/`P570` lifespan and `P69`.

Institution comparison must be normalised, not exact: the IA record says
*Ludwigs-Maximilians-Universität zu München*, Wikidata's label is
*Ludwig-Maximilians-Universität München*. Note also that the collection name is the
*holding* library — these are dissertations from many German universities that
Leiden scanned, so never corroborate the awarding institution against Leiden.

**Dependencies:** Phase 4 (needs entity claims for the described object).

**Done when:** Prandtl's dissertation is found and its edge is marked
`corroborated` with all four agreeing signals listed in `corroboratedBy`; a
deliberate near-miss (same surname, wrong dates) is rejected; a person without
`P1026` still resolves through the fallback.

### Phase 7: Renderer — streaming and evidence

**Goal:** The page shows what it knows and how it knows it.

**Components:** `src/emit-html.js` — progressive insertion, evidence-strength
styling, speculative tiles, per-article coverage report.

**Dependencies:** Phases 4–6.

**Done when:** The spine renders before enrichment arrives; the three strengths are
visually distinct; a speculative tile appears only where the gating claim exists.

### Phase 8: Three-fixture validation

**Goal:** Prove page-agnosticism rather than assert it.

**Components:** `test/fixtures/` — cached responses for all three articles; a
coverage report per article in the style of the current tier table.

**Dependencies:** Phase 7.

**Done when:** All three render from cached fixtures with no per-article code, and
each coverage report is committed as the baseline.

## Additional Considerations

**Open Library keys are not canonical.** Wikidata holds `OL5332088W` for *Carrying
the Fire*; Internet Archive's record for the same book says `OL15882823W`. Open
Library has duplicate work records. Match across systems on ISBN or IA identifier;
treat OL keys as display-only. This produced a wrong conclusion during design and
will produce silent false misses in code.

**`P921` carries text-mining noise.** Among Apollo 11's main-subject hits is a
scholarly article on glomerular filtration rate. Wikidata's auto-imported statements
on scholarly articles are unreliable; either exclude `P31=Q13442814` from this pivot
or expect visible noise.

**The Prandtl edge can simply be added, and that is part of the demo.** Adding
`P724 = IA41548318_0126` to `Q72419729` is correct, useful to everyone, and one
statement. It does not scale to 165,603 items, but it does not need to — the point
is the before/after. The pipeline finds the thesis by corroboration and names the
missing statement; a human adds it; the edge redraws at identifier strength. That
is the prototype's argument performed rather than described.

Two consequences for the build. Once the statement exists, Prandtl resolves through
`P1026` → `P724` in the Phase 4 entity pivots and **no longer exercises Phase 6**,
so a second Leiden author lacking `P1026` is needed as the corroborated fixture.
And the before-state must be captured as a cached fixture, or the demo stops being
reproducible the moment the edit lands.

**Wikidata knows both halves and not the edge — repeatedly.** This is the recurring
shape, not a one-off. *Carrying the Fire* is in Wikidata and its IA scan is in
Wikidata, but no statement says the book is about Apollo 11. Prandtl's thesis is in
Wikidata with author, date and awarding university, and the scan is public on IA,
but no `P724` or full-work URL joins them. In both cases the article-native route —
a citation, or a corroborated collection match — reaches material the identifier
graph cannot. Design for Wikidata being *incomplete in the middle*, and render the
gap rather than hiding it; that gap is the prototype's argument.

**`P921` yield is article-dependent, and that is informative.** Apollo 11 returns
films, television and cultural depictions — and zero books, because nobody has
asserted that *Carrying the Fire* is about Apollo 11, though both the book and its
scanned copy are in Wikidata. Don't type-filter the results; a documentary is a
legitimate item. Where the graph is thin, showing the gap is more interesting than
papering over it — that gap is the prototype's argument.

**CORS is not uniform.** The Action API on Wikipedia, Commons and Wikidata needs
`&origin=*` or the browser drops the response. The REST API and Wikidata REST send
permissive headers unconditionally. SPARQL is avoided entirely: WDQS rejects
`User-Agent` in preflight (T362570), so a browser client cannot comply with the
User-Agent policy and query it.

**Rate policy is a correctness constraint.** Nominatim's 1 req/sec is counted across
all users of a deployment, not per user, so a deployed prototype violates it under
any real traffic. This is why those sources get tiles rather than a slower path.
