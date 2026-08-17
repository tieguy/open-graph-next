# Single-Institution Work Pages Implementation Plan — Phase 5

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Flag-on holder pages draw every enrichment from the holder: all
other partners sit out, and the article's anchors surface the holder's
related holdings via the graph (the artist's other works at that museum).

**Architecture:** A `holder` context threaded through discovery gates each
non-holder lookup at its dispatch site (no request is made, not merely no
card rendered — politeness is part of the point). Holder-scoped anchor
discovery reuses the `src/artworks.js` works-by-creator WDQS query,
restricted to the holder's property — explicit graph links only, consistent
with the no-fuzzy decision; no museum search API is introduced.

**Scope:** Phase 5 of 7. Depends on Phases 1–3 (Phase 4 independent).

**Codebase verified:** 2026-08-16. Lookup dispatch sites live in
`src/discover.js` (DPLA/DigitalNZ/Europeana per band; scholarly + works +
artworks + smithsonian at subject level; statements via `partnerStatements`;
maps gated on mappability). `src/artworks.js` already runs
`?work wdt:P170 <subject>` with a UNION over P3634/P13234/P4610/P6108 and
feeds picked works through their own partners' fetchers; `pickDiverse`
round-robins across partners. `subjectArtworks` is gated on the subject
being a person (`needsArtworksQuery`, P31→Q5) — a painting subject never
fires it today. Suppression precedent: keyless DPLA/Europeana already
"silently skip", so band code tolerates absent lookups.

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## Task 1: Suppress non-holder lookups at their dispatch sites

**Files:**
- Modify: `src/discover.js`, `src/holder.js` (the dispatch filter),
  `src/citations.js` (the searched fact), `src/statements.js` (an export
  for the completeness test), `src/emit-html.js` and `test/infobox.test.js`
  (the second layer of the lede-only rule: bandParts refuses holder
  furniture on any non-lede band), their tests, and this plan file

**Step 1:** Thread the resolved holder into the discovery flow (it already
exists as `holderPromise`; band lookups that must consult it await it — it
resolves fast, one cached record fetch after subject claims, and the lede
already waits on subject claims).

**Step 2:** At each dispatch site, gate on "no holder, or this lookup IS the
holder's": DPLA, DigitalNZ, Europeana, the scholarly lookups (OpenAlex
batches, arXiv cards, ORCID shelf), the OpenLibrary works shelf, the
citation-access lookups (Internet Archive scan/borrow enrichment on
footnotes — the footnotes themselves are article content and always render;
only the partner enrichment riding them sits out), Smithsonian, Free Law,
and map cards. `partnerStatements` (one cheap query for the whole page)
still runs. For a MUSEUM holder its results are FILTERED to the holder's
property — every P13234 value is the Rijksmuseum's, so anchor items
carrying the holder's id still card and everything else does not. For a
MANIFEST holder (`iiif`) even the holder's own property must be
suppressed: an anchor's P6108 points at whatever institution holds THAT
object, so admitting it would put third institutions' cards on a
two-party page. An iiif-held page renders no anchor statement cards at
all (design doc, Decisions).
Each gate is one early-return consulting the holder context; follow the
existing keyless-skip shape so a gated lookup is indistinguishable from an
absent key downstream.

**The iiif acceptance could not be run (2026-08-17):** no manifest-held
article passing the Phase 2 gate was found among the candidates tried —
Laocoön and His Sons fails `no-institution`, Christ as the Suffering
Redeemer fails `no-object-page`, The Little Mermaid resolves no holder —
consistent with the Phase 2 inspection window's 0/30 pass rate. The pure
dispatch filter (holderStatements: iiif keeps nothing) and its integration
(statementEntries over an empty map builds no jobs) are tested; the live
request-tally acceptance transfers to the Phase 7 QA window and rides the
operator's pending decision on the iiif lane.

**The iiif holder's scope rule:** on a manifest-held page the holder's
"collection" is not enumerable from the graph the way a museum's is — a
P6108-restricted works-by-creator query returns works held by MANY
institutions, and presenting them as one holder's shelf would be false. So
an iiif-held page renders hero + panel + suppression and NO works-by-creator
shelf in this round; the noted extension (not built now) is keeping only
works whose own manifests state the same provider — an exact match on the
institutions' own statements, at one manifest fetch per candidate.
Suppression acceptance for these pages: the request tally shows only
Wikimedia/WDQS hosts plus the manifest's own host(s).

**Step 3: Verify operationally** (this is the phase's main acceptance):

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
P=demo/spike-the-night-watch.html
# The search-family partners, by the link shapes their CARDS actually emit
# (measured on flag-off renders where each partner cards) — an article's own
# footnotes may cite these institutions' websites (the Milkmaid cites a
# Europeana whitepaper), and article content always renders. OpenAlex leaves
# no greppable host in a render; the cold-cache request tally below is its
# only acceptance.
grep -o 'dp\.la/item/\|dp\.la/search?subject=\|digitalnz\.org/records\|api\.europeana\.eu\|openlibrary\.org/books\|courtlistener\.com/opinion\|openstreetmap\.org/node/' $P | wc -l   # expect 0
# The statement-family partners need their CARD link shapes, which article
# prose never contains — expect 0 for every shape but the holder's own:
grep -o 'metmuseum\.org/art/collection/search/\|artic\.edu/artworks/\|n2t\.net/ark:/65665/\|inaturalist\.org/taxa/\|gbif\.org/occurrence' $P | wc -l
# archive.org (and any host the article itself cites, e.g. a museum's own
# exhibition pages in footnotes) is compared as a URL SET against a flag-off
# render — article content is identical in both; partner cards are not:
WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"   # flag OFF
grep -o 'archive\.org[^"]*' demo/spike-the-night-watch.html | sort > /tmp/off.urls
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
grep -o 'archive\.org[^"]*' demo/spike-the-night-watch.html | sort > /tmp/on.urls
diff /tmp/off.urls /tmp/on.urls
# On The Night Watch, which cites no IA-held book, the diff is empty. In
# general flag-on must be a SUBSET of flag-off, and every URL present only in
# flag-off must be a suppressed IA card link (details/ or services/img/) —
# the gate working, not a failure.
```

And the request side: `spike.js` prints the per-host tally — flag-on, no
request may go to any partner host but the holder's (Wikimedia hosts and
WDQS excepted). **Run this against a COLD cache** (point the run at a
fresh cache directory or delete `.cache/` in a scratch copy first): the
tally counts network requests and prints "fully from cache" on a warm
rerun, which would pass vacuously. Flag-off remains byte-identical to
baseline.

**Step 4:** `npm test` green (suppression is behind the flag; no existing
test exercises it — the spike greps above are the acceptance, per repo
convention). Also verify the highest-risk regression directly: a flag-on
render of a NON-work article (Ludwig Prandtl) is byte-identical to its
flag-off render — the gates must be inert when there is no holder.
**Commit** (explicit paths: `src/discover.js`, `src/holder.js`, `src/citations.js`, `src/statements.js`, `src/emit-html.js`, their tests including `test/infobox.test.js`, and this plan file — the dispatch filter, the honest tally, and the renderer-side lede-only guard live beside the gates).

## Task 2: Holder-scoped works-by-creator shelf

**Files:**
- Modify: `src/artworks.js` (accept a property restriction), `src/discover.js`
- Test: extend the file covering `src/artworks.js`'s pure parts (locate via
  `grep -rl artworks test/`); the query builder gets a URL test in the
  DigitalNZ style.

**Step 1: Failing test** for the query builder — the actual export is
`subjectArtworksUrl(qid, limit)` (`src/artworks.js:119`); extend its
signature with an options argument. Restricted to one property, the UNION
collapses to that property's triple and nothing else —
`subjectArtworksUrl(qid, limit, { property: 'P13234' })` contains `P13234`
and none of `P3634|P4610|P6108`; the unrestricted output is byte-unchanged
(existing cached responses stay keyed).

**Step 2: Implement** the optional restriction parameter in
`src/artworks.js` (default: today's UNION — no cache re-key for ordinary
pages). **Known seam, do not trip on it:** this module's internal partner
table keys P4610 as `aic` while the manifest key and the entries' `source`
are `artic` (`src/artworks.js:57-82`), and Phase 1's `HOLDERS` uses `artic`
— map the holder's partner key to this module's internal key explicitly at
the call boundary, with a test pinning the AIC case.

**Step 3: Wire in `src/discover.js`:** on a holder page, read the subject's
creator (`bestRankValues(subject.claims, 'P170')`, first value) and run the
restricted query for that creator; the picked works ride the holder
partner's existing fetcher (no `pickDiverse` needed — one partner by
construction; cap with the existing `WORKS_BY_SUBJECT`-style budget, and
exclude the subject's own QID from the shelf). **Placement (the design's
Done-when says "at the Rembrandt anchor"):** the shelf lands on the band
that OWNS the creator's anchor — `claimAnchors` already assigns each QID to
the band of its first mention, so look the creator's QID up in that
assignment; when the article never links its creator in prose, the shelf
falls back to the lede. State the placement in the shelf's provenance
trace. Shelf head in the house
voice, with the honest denominator the artworks lookup already reports:
*"N of the M works Wikidata records the Rijksmuseum as holding by
Rembrandt"* — the count is Wikidata's, and per the badge rule it links
nowhere (the museum-count rule already recorded for artwork shelves).
Entries carry `standing: 'subject-work'`? No — these are works BY the
article's creator, not by the article's subject (the subject is the
painting): use no subject standing, ordinary shelf entries with provenance
folds naming P170 + the holder property. The ordinary `needsArtworksQuery`
person-gate stays untouched for non-holder pages.

**Step 4: Verify:**

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "The Night Watch"
grep -c 'rijksmuseum' demo/spike-the-night-watch.html   # > 1: the hero AND the shelf
```

Open the render: the Rembrandt shelf shows only Rijksmuseum works. Flag-off
byte-identical; a second flag-on run byte-identical (warm cache).

**Step 5:** `npm test` green. **Commit** (`git add` exactly
`all-the-opens/tapestry-gen/src/artworks.js`,
`all-the-opens/tapestry-gen/src/discover.js`, and the artworks test file).

## Phase done when

- Flag-on Night Watch page contains no non-holder partner host in its HTML
  and its request tally, and shows the Rijksmuseum works-by-Rembrandt shelf
  on the band owning the Rembrandt anchor.
- The restricted query builder is tested (including the `aic`/`artic` key
  seam); the unrestricted URL is byte-unchanged (no cache re-key for
  ordinary pages).
- Flag-off renders byte-identical; flag-on render of a non-work article
  byte-identical to its flag-off render; `npm test` green.
