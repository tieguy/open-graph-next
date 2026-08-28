# Queries — runnable forms

All numbers in `findings.md` trace to one of these. Dated 2026-08-18. Replace
nothing except your own User-Agent contact: every HTTP request must carry a
[WMF-compliant User-Agent](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)
identifying the operator (here, requests were made via a `wm-fetch` wrapper
carrying `luis@lu.is`). Keep requests serial.

## 1. Module and template source (enwiki Action API)

Revisions used are pinned by revid, so these are exactly reproducible:

```
# Module:WikidataIB, rev 1329681003
https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content|ids&rvslots=main&revids=1329681003&format=json&formatversion=2
# Module:Wd rev 1301986908; Module:Wikidata rev 1142750825
# Commons Module:Wikidata Infobox rev 1207373352; Commons Module:WikidataIB rev 1207375011
# ca Module:Wikidades rev 36825375; eu Modulu:Wikidata rev 9989864 (same API pattern per host)
# ru Модуль:Wikidata rev 153491506
```

Templates (current text as of 2026-08-18, not revid-pinned; batch ≤50 titles):

```
https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=Template:Infobox%20person/Wikidata|Template:Infobox%20company|...&format=json&formatversion=2
```

## 2. Consumer enumeration

Modules touching Wikibase (330 total hits):

```
https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=insource:%22mw.wikibase%22&srnamespace=828&srlimit=500&srinfo=totalhits&format=json&formatversion=2
```

Templates embedding a module (paged; 884 for WikidataIB, 2,271 for Wd, 262
for Wikidata):

```
https://en.wikipedia.org/w/api.php?action=query&list=embeddedin&eititle=Module:WikidataIB&einamespace=10&eilimit=500&format=json&formatversion=2
```

## 3. Volume counts

Cirrus totalhits (search index; article namespace). Works for templates and
modules; used for the channel table and the module-reach intersections:

```
https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=hastemplate:%22Module:WikidataIB%22&srnamespace=0&srlimit=1&srinfo=totalhits&format=json&formatversion=2
# intersection variant:
srsearch=hastemplate:"Module:WikidataIB" hastemplate:"Marriage"
```

Exact transclusion counts and the usage-aspect table (Toolforge, enwiki
replica — `mysql --defaults-file=~/replica.my.cnf -h
enwiki.analytics.db.svc.wikimedia.cloud enwiki_p`):

```sql
-- wbc_entity_usage aspect breakdown (findings §2.1)
SELECT SUBSTRING_INDEX(eu_aspect, '.', 1) AS aspect,
       COUNT(*) AS rows_cnt, COUNT(DISTINCT eu_page_id) AS pages
FROM wbc_entity_usage GROUP BY 1;

-- article-namespace pages consuming statement aspects (5,055,321)
SELECT COUNT(DISTINCT eu_page_id)
FROM wbc_entity_usage JOIN page ON page_id = eu_page_id
WHERE page_namespace = 0 AND eu_aspect LIKE 'C%';

-- top consumed properties (findings §2.1)
SELECT eu_aspect, COUNT(DISTINCT eu_page_id) pages
FROM wbc_entity_usage WHERE eu_aspect LIKE 'C.%'
GROUP BY eu_aspect ORDER BY pages DESC LIMIT 40;

-- exact ns-0 transclusion counts (findings §2.3, §4)
SELECT lt_title, COUNT(*) cnt
FROM templatelinks
JOIN linktarget ON tl_target_id = lt_id
JOIN page ON tl_from = page_id
WHERE page_namespace = 0 AND lt_namespace = 10
  AND lt_title IN ('Infobox_person/Wikidata','Infobox_company','Marriage', ...)
GROUP BY lt_title ORDER BY cnt DESC;

-- top ns-0 template carriers among templates that transclude the module
SELECT lt2.lt_title, COUNT(*) cnt
FROM templatelinks tl2 JOIN linktarget lt2 ON tl2.tl_target_id = lt2.lt_id
JOIN page p2 ON tl2.tl_from = p2.page_id
WHERE p2.page_namespace = 0 AND lt2.lt_namespace = 10
  AND lt2.lt_title IN (
    SELECT p3.page_title FROM templatelinks tl3
    JOIN linktarget lt3 ON tl3.tl_target_id = lt3.lt_id
    JOIN page p3 ON tl3.tl_from = p3.page_id
    WHERE lt3.lt_namespace = 828 AND lt3.lt_title = 'WikidataIB'
      AND p3.page_namespace = 10)
GROUP BY lt2.lt_title ORDER BY cnt DESC LIMIT 40;
```

## 4. Sampling frames (Toolforge, seeded — produces `samples.tsv`)

```sql
-- full frame for the fork template; seeded samples for the rest
SELECT 'personwd', page_title, pp_value
FROM templatelinks JOIN linktarget ON tl_target_id = lt_id
JOIN page ON tl_from = page_id
JOIN page_props ON pp_page = page_id AND pp_propname = 'wikibase_item'
WHERE page_namespace = 0 AND lt_namespace = 10
  AND lt_title = 'Infobox_person/Wikidata';

SELECT 'company', page_title, pp_value
FROM (SELECT tl_from FROM templatelinks
      JOIN linktarget ON tl_target_id = lt_id
      WHERE lt_namespace = 10 AND lt_title = 'Infobox_company') t
JOIN page ON tl_from = page_id
JOIN page_props ON pp_page = page_id AND pp_propname = 'wikibase_item'
WHERE page_namespace = 0 ORDER BY RAND(42) LIMIT 400;
-- videogame LIMIT 300, marriage LIMIT 300, person LIMIT 400: same pattern,
-- all ORDER BY RAND(42)
```

The 400-item sub-sample of the personwd frame uses Python
`random.Random(42).sample(rows, 400)` over the frame in the order emitted
above (`measure.py`).

Gate wiring per field (which properties each template gates) was extracted
from the template wikitext by brace-matched parsing of `{{#invoke:WikidataIB
|...}}` blocks; the parser and its full output are `measure.py`'s sibling
script in the session archive, and the resulting scopes are listed in
findings §4.

## 5. Entity classification (`measure.py`)

- `wbgetentities` on `www.wikidata.org`, `props=claims`, 50 ids per request,
  serial; then `props=labels&languages=en` for every item QID appearing in a
  reference snak.
- A claim passes the WikidataIB gate iff any reference's rendered snak values
  (en labels for item values; raw strings/URLs/ids; time and quantity values,
  which cannot contain "Wiki") lack the case-sensitive substring `Wiki`.
- Rank filter: `normal` and `preferred` only.
- Local-parameter occupancy (company): current article wikitext via the
  enwiki API, top-level parameter split of the `{{Infobox company ...}}`
  block, field→property map as in findings §4.

Outputs: `results.json` (per-property, per-item, statement classes),
`company_yield.json` and `company_local_params.json` (§6),
`person_remediation_split.json` (§6 second table).

## 6. Discussion pages read (enwiki, current text 2026-08-18)

- `Wikipedia:Templates for discussion/Log/2017 January 24`
- `Wikipedia:Templates for discussion/Log/2017 May 11`
- `Wikipedia:Wikidata/2018 Infobox RfC`
- `Wikipedia:Wikidata/2018 State of affairs`
- `Wikipedia:Perennial proposals`
- `Wikipedia:Bots/Requests for approval/KiranBOT 11`
- `Template:Infobox person/Wikidata/doc`

For findings §10 (data-model mismatch, added later the same day):

- `Wikipedia talk:WikiProject Tree of Life/Archive 50` (section "The
  automatic taxonomy system")
- `User:Peter coxhead/Wikidata issues`
- Search used to establish the P141 absence: `srsearch="conservation
  status" Wikidata speciesbox OR taxobox`, ns 5|11 (59 hits, none a
  proposal or decision on status autofill)
