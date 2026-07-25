# Internet Archive — quality issues to report

Running notes from building the live discovery pipeline
(`docs/design-plans/2026-07-25-live-discovery-pipeline.md`). Each entry records
what we hit, how to reproduce it, and why it matters to a downstream consumer.

**Provenance:** `[ours]` = reproduced directly in this project.
`[research]` = reported by a research pass, not independently re-verified here.

---

## 1. Donation pallet manifests pollute `isbn:` field queries `[ours]`

`bwb_daily_pallets_2021-03-19` is `mediatype: data`, in collections
`bookdonationsfrombetterworldbooks` / `protodonationitems`, and carries **8,142
values in its `isbn` field**.

```
https://archive.org/advancedsearch.php?q=isbn:9780374531942&rows=1&output=json
→ top hit is the pallet manifest, not the book
```

These are *true* field matches, so they cannot be dismissed as full-text noise —
any ISBN on the pallet matches. A naive consumer taking the top hit gets
"Pallets from BWB for 2021-03-19" instead of the book.

**Workaround:** `AND mediatype:texts` in the query (takes the example above to
`numFound: 1`, correct book).

**Suggested fix:** exclude aggregate donation records from default relevance
ranking on bibliographic identifier fields, or stop populating a scalar-semantics
field (`isbn`) with pallet-wide lists.

---

## 2. `openlibrary_author` is not indexed `[ours]`

Item metadata carries `openlibrary_edition` and `openlibrary_work` but no author
field:

```
https://archive.org/metadata/carryingfireastr0000coll_m0h1
→ openlibrary_edition, openlibrary_work, isbn, lccn, creator, subject — no author key
https://archive.org/advancedsearch.php?q=openlibrary_author:OL18319A → numFound: 0
```

**Impact:** there is no authority-keyed path from a *person* into IA's book
collection. Discovery has to detour through openlibrary.org (rate-limited to
1 req/sec anonymous) purely to turn an author into work keys, which IA could
answer directly.

---

## 3. No Wikidata identifiers indexed `[research]`

`wikidata:Q43653` → 0; `external-identifier:"urn:wikidata:Q43653"` → 0. Likewise
no `urn:viaf:` external-identifiers were found.

**Impact:** Wikidata is the hub identifier for open-knowledge tooling. Its absence
means every pivot into IA must first be translated into a bibliographic identifier,
which only works for published books — never for people, places, events or objects.

---

## 4. Scanned theses carry no external identifiers `[ours]`

Items in `collection:leiden-university` (165,603 items) carry `creator`, `date`,
`institution`, `department`, `pub_type` — and no ISBN, OCLC, LCCN, handle, DOI or
Wikidata ID. Only an ARK.

```
https://archive.org/metadata/IA41548318_0126
→ Prandtl, Ludwig / 1899-11-14 / Ludwigs-Maximilians-Universität zu München
```

**Impact:** these can only be matched by fuzzy name+date+institution comparison,
which is strictly weaker evidence than an identifier and has to be presented to
users as such. Example: Ludwig Prandtl's dissertation is public here, Wikidata has
an item for that thesis (`Q72419729`) — and nothing joins them. Adding `P724` to
the Wikidata item, or an authority ID to the IA item, would close it.

---

## 5. Free-text `subject:` search returns unrelated items `[ours]`

```
https://archive.org/advancedsearch.php?q=subject:"Neil Armstrong" AND mediatype:texts
→ 34 hits; top results include USNS Neil Armstrong (a research vessel),
  a LEGO Saturn V instruction manual, and a 1974 Saturday Review issue
```

Name collision between a person and a vessel named after them, with no
disambiguation signal. Not a bug so much as a limit worth knowing, but it means
`subject:` cannot be used as a discovery fallback.

---

## 6. `oclc-id:` out of sync with `external-identifier:"urn:oclc:*"` `[research]`

Reported as not kept in sync; prefer the `external-identifier` form. Not
independently re-verified here.

---

## 7. Beta scrape endpoint path returns 404 `[research]`

`/services/search/beta/page_production/scrape.json` → 404. The working path is
`/services/search/v1/scrape`. Documentation or redirect issue.

---

## Working well (worth saying)

- `openlibrary_edition` / `openlibrary_work` are **returned** in search results, not
  just queryable — so one IA request yields the OL keys, no openlibrary.org call.
- `covers.openlibrary.org/b/olid/{id}-L.jpg` redirects into archive.org storage and
  serves with `Access-Control-Allow-Origin: *`. Book covers cost zero API budget.
- CORS is permissive and unconditional across `advancedsearch.php`, `/metadata/`
  and `/services/search/v1/` — no `origin=` parameter needed, unlike the MediaWiki
  Action API.
- Solr `QTime` is consistently 25–85 ms. The service is fast; latency is connection
  setup.
