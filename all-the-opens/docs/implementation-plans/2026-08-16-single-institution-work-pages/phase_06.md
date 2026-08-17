# Single-Institution Work Pages Implementation Plan — Phase 6

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Five new holders join — Cleveland Museum of Art, National Gallery
of Art, Getty, Paris Musées, Nationalmuseum Sweden — each through a
capability probe first, then the adding-a-source playbook.

**Architecture:** Per holder: probe (live verification of record-by-ID,
image, license, and rate policy) → partner manifest entry + icon → fetcher
module + `…RecordFrom` transform → a row in `HOLDERS` (`src/holder.js`) →
tests in the Phase 2 shape. A holder that fails its probe is dropped from
the round and the failure recorded in
`all-the-opens/docs/reaching-open-collections.md` (dated, with the command)
and on the phase's commit.

**Scope:** Phase 6 of 7. Depends on Phases 1–5. Each holder lands
independently; partial completion is a valid state.

**Codebase verified:** 2026-08-16. The canonical playbook is
`all-the-opens/docs/adding-a-source.md` — **read it before each holder; it
is the authority where this file is thinner.** Manifest completeness is
tested (`test/partners.test.js`: icon bytes committed via
`tools/build-icons.mjs`, friend entry present). `hostLimit()` stays 1
without a published policy quoted in `hostLimits`.

**The five, with verified Wikidata facts (2026-08-16):**

| Holder | Property | Museum QID | Known API surface (verify in probe) |
|---|---|---|---|
| Cleveland Museum of Art | P11110 | Q657415 | `openaccess-api.clevelandart.org/api/artworks/<id>`, keyless, CC0 |
| National Gallery of Art | P4683 | Q214867 | IIIF + bulk CSV (GitHub `NationalGalleryOfArt/opendata`); record-by-ID surface **unverified** |
| J. Paul Getty Museum | P2582 | Q731126 | Linked Art JSON-LD + IIIF (`data.getty.edu`), keyless |
| Paris Musées | P6246 | Q3365279 | GraphQL + IIIF (`apicollections.parismusees.paris.fr`); key/terms **unverified** |
| Nationalmuseum Sweden | P2538 | Q842858 | No known API; images largely via Commons — expect this probe may fail |

**Working directory:** `all-the-opens/tapestry-gen/`.

---

## Task pattern (one sequence per holder, in the table's order)

### Task N.1: Probe

**What the probe deliberately does NOT test:** artist search. Capability
(c) — holder-scoped anchor discovery — rides the Wikidata works-by-creator
query for every holder (design doc, Decisions 2026-08-16: capability (c)
rides the graph), so no museum search API is probed or needed; the
probe's job is capabilities (a) record-by-ID and (b) image + license.

No code. Produce a dated probe note appended to
`all-the-opens/docs/reaching-open-collections.md` (follow the two rules at
that file's head). The probe answers, with commands and outputs:

1. **Record by ID, real and bogus.** Take a real id from a Wikidata item
   (WDQS: `SELECT ?i ?v { ?i wdt:<property> ?v } LIMIT 5`, via the compliant
   fetch path) and a deliberately bogus one. `curl -s` both. The API
   qualifies only if the two answers DIFFER (the both-ids-answer-alike rule)
   and the real one returns the catalog fields the Phase 2 contract needs
   (title, creator, date, medium, dimensions, accession, credit, a
   per-object rights/public-domain flag, an image URL, the object's own page
   URL).
2. **Image reachability**: fetch the stated image URL server-side; note
   status and whether the host is hotlink-safe.
3. **License, from the partner's own words**: the open-access/terms page,
   quoted, with URL and read-date — the `friend.cite` line. NC anywhere →
   the holder is out (blocker, never a condition to note).
4. **Rate policy**: the published statement if any (for `hostLimits`);
   default stays 1.
5. **Key**: keyless, free key (name the env var), or blocked.

**Done when:** the note answers all five with evidence, and states IN or OUT.

### Task N.2: Manifest + icon (only if IN)

- Add the partner descriptor to `src/partners.js` (name, icon, hosts,
  friend with `gives`/`terms`/`cite` from the probe). Key order = legend
  display order; put new holders after `rijks`.
- Run `node tools/build-icons.mjs`; commit the regenerated `src/icons.js`.
- `npm test` — `test/partners.test.js` completeness must pass.

### Task N.3: Fetcher + record transform + holder row

- Create `src/<slug>.js` (the `src/rijks.js` shape) or extend
  `src/holder-record.js` for API-simple holders (the met/aic shape):
  `…RecordUrl(id)`, `…RecordFrom(response)` (pure, fixture-tested from the
  probe's real response, trimmed), `fetchHolderRecord` dispatch branch.
- Add the holder to `HOLDERS` in `src/holder.js` (property + museum QID from
  the table), after the existing museums and BEFORE the `iiif` row — a
  museum's own id always outranks the shared door. Note this changes the
  work-by-creator restriction and the Phase 7 census next time they run —
  both are generated from `HOLDERS`, which is the point.
- If the partner should also card as an ordinary anchor lookup (an anchor
  item carrying its property), extend `partnerStatements`' property list —
  read `src/statements.js`'s query builders and their guard test first;
  this widens a shared WDQS query and re-keys its cache once (note it in
  the commit, the documented shape for such changes).
- Tests: transform fixtures + URL literals, `holder.test.js` precedence row.

### Task N.4: Live verification + commit

```bash
HOLDER_PAGE=1 WIKIMEDIA_UA_CONTACT=luis@lu.is node spike.js "<a painting-article this museum holds>"
```

Pick the article from WDQS (an item with the holder's property + enwiki
sitelink). Verify: correct holder selected, record fetched, hero + panel +
two-party legend render, no foreign partner hosts. Flag-off byte-identical.
Commit per holder (explicit paths).

---

## Suggested flagship per holder (verify each still carries the property
before using it as the acceptance article; the graph, not this list, is
authoritative):

- Cleveland: *The Large Plane Trees* (Van Gogh) or any P11110 item with an
  enwiki article from the WDQS pick.
- NGA: *Ginevra de' Benci*.
- Getty: *Irises* (Van Gogh).
- Paris Musées / Nationalmuseum: pick from WDQS; coverage is thinner.

## Phase done when

- Every holder has a dated probe note with an IN/OUT verdict; every IN
  holder passes the N.2–N.4 sequence with green tests and a live render;
  every OUT holder's failure is recorded where the next investigator will
  look (`reaching-open-collections.md`).
- `npm test` green; flag-off renders byte-identical throughout.
