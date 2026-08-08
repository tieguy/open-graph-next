# Adding a data source

Split out of `tapestry-gen/CLAUDE.md` on 2026-08-08 (LUI-140), because it had
grown from "which registry row do I edit" into the kind of step-by-step a new
contributor — or a future agent with no memory of this project — should be
able to open directly, without first reading the rest of that file.

**Two audiences, one document**, per LUI-140's own framing:

1. **Us.** Every file a new source touches and every check that has to pass
   before it ships. That checklist below is not theoretical — it is the
   difference between what the pivot-registration mechanics alone tell you to
   edit and what actually shipped broken on a real partner: the Met's,
   Europeana's and Free Law's favicons all 403/404/429 to a non-browser fetch
   despite loading fine in a tab, and OpenAlex's `favicon.ico` used to answer
   200 with an HTML error page — which passed the old size-only check and put
   a 4 KB error blob on every page that cited an open paper. None of that is a
   pivot bug; both are a "did you actually check the file this touches"
   bug, and this document exists so that check has somewhere to live.
2. **Everyone else.** The margin notes — set off like this one — are for a
   reader who has not read the rest of this codebase and is asking "why does
   a project do it this way." **Publishing this externally is a separate,
   not-yet-taken step**; this file is the internal half of LUI-140, written so
   that step costs an edit pass rather than a rewrite.

> **Why a playbook and not a config schema.** The obvious alternative —
> describe each partner as data, generate the wiring — was tried in spirit and
> rejected: every partner still needs its own fetcher and its own rights
> mapping, because every partner's API is shaped differently and its rights
> vocabulary reads differently. A registry can remove *duplication* in how a
> partner registers itself; it cannot remove the knowledge of what that
> partner actually returns. What this document optimizes instead is knowing
> what to hand-edit and where.

## Picking a shape

There are three shapes a new partner's pivot can take. Picking the wrong one
produces code that fights the pipeline rather than fitting it — read this
before writing a fetcher, not after.

1. **Direct-id shape** — the object is named by ONE Wikidata property, bound
   straight to a WDQS var. `MUSEUM_PIVOTS` in `tapestry-gen/src/statements.js`
   is the registry: Met, AIC, Rijksmuseum, iNaturalist, GBIF, IIIF are its six
   rows. Adding a partner here means four edits, in this order: an `OPTIONAL`
   clause and var in `wdqsUrl` (`statements.js:25-52`), a row in `PROP_NAME`
   (`statements.js:723-739`, the ⓘ-fold explanation), a fetcher module (see
   `metEntry`/`aicEntry` for the plain case, `rijks.js`/`iiif.js` for ones
   that need more than one request), and one entry in `MUSEUM_PIVOTS`. Do
   NOT hand-edit `statementEntries`'s job list directly — that list is now
   generated from the registry, and a new job spliced in beside it would run
   outside the registry's bookkeeping.

   > **Why a registry and not a switch statement.** The job list used to be
   > hand-written per partner, which meant the code that FETCHES an object and
   > the code that DECIDES which objects exist could drift — a partner present
   > in one list and not the other either fetches nothing or throws on a
   > `undefined` id. Generating the job list from the same array that defines
   > the WDQS var and the fetcher makes that drift structurally impossible
   > instead of merely reviewed-against.

2. **Search shape** — no direct object id, but a Wikidata property names
   something searchable (a subject heading, an entity id), and what comes
   back is a SAMPLE of a larger holding, not the partner's own record of the
   anchor. `DPLA_PIVOT`, `EUROPEANA_PIVOT` and `DIGITALNZ_PIVOT`
   (`tapestry-gen/src/discover.js`, just above `discover()`) are the three
   live cases, all run through the shared `bandPropertyPivot()` loop —
   `DIGITALNZ_PIVOT` reuses DPLA's own `field: 'lc'`/P244 heading rather than
   adding a fourth WDQS var, because both partners answer to the same Library
   of Congress authorized heading (New Zealand's national library catalogs
   through LC/NACO rather than running its own VIAF contribution — see
   Partner pivots in `tapestry-gen/CLAUDE.md`). A new partner of this shape is
   one new spec object with `envKey`/`field`/`property`/`fetch`/`browseUrl`/
   `trace`/`sample` (and `broadExtra` only if a `broadNote` needs a field
   beyond `label`/`total`/`url` — DPLA's does, for the heading), passed to
   `bandPropertyPivot()` alongside the others. Do NOT copy the block and
   modify it — that is exactly the duplication DPLA and Europeana had between
   2026-08-03 and 2026-08-07, two near-identical blocks in `discover.js` that
   a refactor collapsed into one loop plus specs.

   > **Why "sample" is a first-class field, not an afterthought.** This shape
   > answers a different question than the direct-id one: "what does this
   > partner hold under this heading" rather than "what is this partner's
   > record of this exact thing." A shelf of four items sampled from a
   > holding of thousands would read as complete if the page did not say
   > otherwise, so every entry here carries the total alongside the sample,
   > and `src/breadth.js` refuses to sample at all once a heading is broad
   > enough that four items stop meaning anything (see `tooBroad`).

3. **Neither shape — read the precedent, don't force it.** Some partners are
   real exceptions and stay hand-written: the Smithsonian is found by a PAIR
   of properties read from one row, never two (`smithsonian.js`, and the
   `OPTIONAL` comment at `statements.js:44-51` on why splitting it is wrong);
   the Rijksmuseum needs three serial requests per object because Linked Art
   models the object, its visual content and its file as three resources
   (`rijks.js`); and the subject's own artworks are reached by asking the
   GRAPH what the subject made, not by pivoting off a wikilink at all
   (`artworks.js`, and the "Rembrandt" funnel table in `tapestry-gen/
   CLAUDE.md`'s Partner pivots section showing why prose links couldn't carry
   that question). If a new partner needs multiple properties, multiple hops,
   or a question the article's own links can't phrase, it likely belongs
   here — a fourth shape forced through 1 or 2 for the sake of uniformity is
   a worse outcome than one more hand-written case.

## Every file a source touches

The three shapes above answer "where does the pivot itself live." They do not
answer the rest of what a new partner needs, which is the same regardless of
shape and easy to under-scope because none of it lives near the pivot code:

1. **The pivot's own home** — a registry row, a spec object, or a
   hand-written module, per the shape chosen above.
2. **A fetcher module**, `tapestry-gen/src/<partner>.js` — the record-to-card
   mapping and the partner's own rights read (see step 6).
3. **`tapestry-gen/src/emit-html.js`'s `SOURCE` map** — display name and
   icon. **Check the icon actually serves to a non-browser fetch before
   committing it** — this is the step the Met, Europeana, Free Law and
   OpenAlex entries in that file each failed on first, and each comment there
   records what the real failure looked like (403, 404, a stale content-hashed
   path, a 200 that was secretly an HTML error page). A logo hosted on
   Wikimedia Commons at an allowlisted thumbnail width is the fallback every
   one of those cases landed on.
4. **`tapestry-gen/src/gap.js`'s `PARTNER_HOSTS`** — which domain(s) count as
   "the article already reaches this partner," for the visibility panel. This
   is the easiest step to skip because skipping it breaks nothing visibly —
   the panel just silently over- or under-states the gap that is the whole
   page's argument, with no error to notice.
5. **`tapestry-gen/src/mw.js`'s `hostLimit()`** — a citation for the partner's
   published rate limit, or the default of 1 stands. See "Before writing any
   fetch code" below.
6. **The rights read** — reuse `ccFromUri`/`ccFromSlug`/`ccFromLabel` in
   `tapestry-gen/src/rights.js` wherever the partner's vocabulary is
   compatible (a fixed literal URI, the way `metEntryFrom` reuses the CC0 URI
   for a boolean flag, costs nothing new); write a partner-specific reader
   only when the vocabulary genuinely doesn't map (see the DigitalNZ and GBIF
   rows in the partner audit table for a words-only precedent). Add a row to
   that table either way — whether or not the partner turns out to have a
   mark is itself the finding.
7. **A unit test file**, `tapestry-gen/test/<partner>.test.js` — the pure
   entry-mapping and rights functions against fixture records, no network.
   `test/iiif-dpla.test.js` is the shape to copy.
8. **`tapestry-gen/CLAUDE.md`'s Partner pivots section** — a short prose
   bullet once the shape is chosen and the rights are read, in the same
   register as the existing entries (what the partner is, how the anchor is
   found, what it costs).
9. **`tapestry-gen/src/front-page.js`'s `FRIENDS` list** — ONLY after a real
   `spike.js` render has been read. An unlinked or unverified line there
   claims a license nobody has checked against a live page, which is exactly
   the failure mode "a mark is never a guess" exists to prevent elsewhere in
   this codebase.

## Before writing any fetch code

In this order:

- **Read the host's own published rate-limit or crawl-delay policy**, and
  only then decide `hostLimit()`'s value for it in `tapestry-gen/src/mw.js`.
  The default is 1 and stays 1 without a citation — "nothing goes in it
  without a published statement quoted at the call site" (see the
  Non-Wikimedia partners section of `tapestry-gen/CLAUDE.md`). This is the
  step every partner audit here has found skipped when something went wrong.
- **Check what the API exposes for rights**, against the vocabulary
  `ccFromUri`/`ccFromSlug`/`ccFromLabel` already read (`rights.js`) — the
  Partner audit table in `tapestry-gen/CLAUDE.md` is the map of what's
  already handled per partner; extend it, don't restate it.
- **Give every Wikidata-backed card a `why`/`trace`/`fix` triple**, so a
  reader can check or correct the statement the card rests on (see the
  provenance note under Key Decisions in `tapestry-gen/CLAUDE.md`). A card
  with no trace is legitimate only for citation-derived cards, where nothing
  is editable on Wikidata.
- **Verify with `spike.js`, not with reasoning about the diff.** Byte-
  reproducibility off a warm cache is the project's only real test of the
  discovery path (see Two entry points in `tapestry-gen/CLAUDE.md`) — render
  Apollo 11, Brown v. Board of Education and Ludwig Prandtl before and after,
  and add a fourth fixture that actually exercises the new partner if none of
  the three does.

  > **A caveat worth stating plainly, because it will recur.** This step
  > requires outbound network access to the partner's live API. An
  > implementation done in an environment without it — a sandboxed session,
  > for instance — can follow every other step in this document faithfully
  > and still ship a fetcher whose field names are educated guesses rather
  > than checked facts. That is a real, distinct state from "verified," and
  > should say so in the commit and in `tapestry-gen/CLAUDE.md` rather than
  > claim confidence the work doesn't have. DigitalNZ (LUI-145, 2026-08-08)
  > shipped exactly this way; see its note in the Partner pivots section.

## A worked example

DigitalNZ (`tapestry-gen/src/digitalnz.js`, LUI-145, 2026-08-08) is the most
recent full walkthrough of the search shape end to end: one spec object
reusing an existing WDQS field, a fetcher module, a rights read that
deliberately declines to invent a glyph for a vocabulary that doesn't support
one, and every file in the checklist above touched in one change. Read its
commit alongside this document if the prose above is ambiguous anywhere —
the code is the part that has to actually be right.
