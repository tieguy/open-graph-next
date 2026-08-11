# Reaching open collections — a running log of access problems

Openly licensed material that is hard to *reach*. Not licensing problems —
every collection below publishes freely — but bot mitigation, retired
endpoints, missing metadata and robots rules that together decide who may
actually fetch a public-domain page image.

Sibling to `internet-archive-issues.md`, which logs data-quality problems in one
partner's index. This file logs **reachability** across all of them.

**Provenance:** `[ours]` = reproduced directly in this project, with the command
shown. `[research]` = reported elsewhere and not independently re-verified here.

## Two rules for entries here

**Date everything, because these findings decay.** A WAF config changes, an
endpoint returns, an institution revises robots.txt. An undated "GBIF blocks us"
is worthless within months. Every claim below carries the date it was observed
and the command that produced it, so any of it can be re-run and falsified.

**Run the control before believing a failure.** Most of these were found by
fetching a real identifier *and* a deliberately bogus one of the same shape. If
the server answers both identically it is not telling you the link is broken —
it is refusing to talk to you, and those are completely different findings.
Without the control, a 403 reads as "dead link" and you will write the wrong
thing. Entry 2 in particular looks like 431 broken links and is not.

---

## 1. HathiTrust serves public-domain scans to Twitterbot, not to you `[ours]`

*Observed 2026-08-06.*

HathiTrust serves a page-1 thumbnail of a public-domain scan with no key:

```
https://catalog.hathitrust.org/api/volumes/brief/recordnumber/102759569.json
→ {"htid":"hvd.32044032244535","rightsCode":"pd","usRightsString":"Full view"}

https://babel.hathitrust.org/cgi/imgsrv/thumbnail?id=hvd.32044032244535;seq=1;width=250
→ 200, image/jpeg, 15 KB   (a real scan; three sampled htids gave three distinct images)
```

But `https://babel.hathitrust.org/robots.txt`:

```
User-agent: Twitterbot
Allow: /cgi/pt
Allow: /cgi/mb
Allow: /cgi/imgsrv      ← imgsrv, explicitly

User-agent: *
Crawl-delay: 1
Disallow: /cgi/         ← imgsrv is under /cgi/
```

**Impact:** 168 of the 229 thumbnail-less DPLA cards on this project's six
showcase pages are HathiTrust books. The images exist, are public domain, and
are served without authentication — and general clients are asked not to take
them, while a social-media link-preview crawler is named and permitted.

**Reading it charitably:** the Twitterbot allowance means HathiTrust *wants*
these scans seen in link previews. The blanket `/cgi/` disallow is almost
certainly aimed at the page-turner and search endpoints, with imgsrv caught by
path. This looks like a rule that has never been asked the question.

**Status:** not taken. A project arguing that institutions' publishing choices
deserve respect does not help itself to what a robots.txt refuses. The move is
to ask, not to route around. Not yet asked as of 2026-08-06.

---

## 2. DPLA is invisible to anything without a JavaScript engine `[ours]`

*Observed 2026-08-06.*

Every `dp.la` app route answers **HTTP 202 with an empty body**:

```
curl -sI https://dp.la/item/0196f198ccea72d4d91e747cdd1dba7c
→ HTTP/2 202 · content-length: 0 · x-amzn-waf-action: challenge · server: CloudFront

https://dp.la/                → 200, 95 KB   (the homepage is fine)
https://dp.la/search?q=rembrandt → 202, 0 B
https://api.dp.la/v2/items?q=… → 403 without a key
```

The control matters: a **deliberately impossible id** returns the identical
202/0 B, and so does a request with a full browser User-Agent and `Sec-Fetch-*`
headers (which earns a 2 KB challenge page instead of nothing). So no automated
check can distinguish a working DPLA link from a broken one.

**Impact:** 494 dp.la links across the six showcase pages — a third of every
link this project authors — cannot be verified by any script. `src/dpla.js`
deliberately prefers the `dp.la/item/` page over the contributor's own
`isShownAt` on the grounds that dp.la "always resolves", and that premise is now
unverifiable from outside a browser.

**Confirmed working by hand in a real browser, 2026-08-06** — the WAF challenge
solves transparently for readers. The links are fine. *Only* the ability to
check them is gone.

---

## 3. Four partners are challenge-gated; real and bogus ids are indistinguishable `[ours]`

*Observed 2026-08-06. Browser User-Agent, no JS.*

| Host | Answer | Header |
|---|---|---|
| `www.inaturalist.org` | 403 | `cf-mitigated: challenge` |
| `www.europeana.eu` | 403 | `cf-mitigated: challenge` |
| `www.gbif.org` | 302 → challenge | `server: cloudflare` |
| `www.metmuseum.org` | 429 | `x-vercel-mitigated: challenge` |

In all four, a real identifier and an impossible one of the same shape return
byte-identical responses (within a few bytes of challenge-page noise).

**Impact:** 110 links across the six showcase pages that cannot be validated.
The failure mode this creates is worse than an outage — a broken URL *shape*
(see the Rijksmuseum 404 fixed in `5fd6c24`) is undetectable on these hosts,
because the server never reports the difference between a bad id and a bad bot.

**Partial workaround:** validate the *identifier* against the partner's API,
which is not gated, rather than the web page:

```
https://api.gbif.org/v1/species/5133088   → 200, real taxon
https://api.gbif.org/v1/species/999999999 → 404
https://api.inaturalist.org/v1/taxa/48662 → 200
```

That confirms the id is real. It does **not** confirm the page URL shape, which
is the thing that actually broke last time.

**Side note:** GBIF now redirects `/species/<key>` → `/taxon/<code>`
(`5133088` → `6CB8P`). The old form still resolves; worth watching.

---

## 4. CourtListener: a perfect permalink behind a gated everything-else `[ours]`

*Observed 2026-08-06.*

The citation permalink is exactly what a linked-data consumer wants — no lookup,
no key, resolves by construction:

```
https://www.courtlistener.com/c/U.S./347/483/
  → 302 → /opinion/105221/brown-v-board-of-education/
https://www.courtlistener.com/c/S.%20Ct./74/686/   → same opinion (parallel citation)
https://www.courtlistener.com/c/U.S./999999/1/     → 404   ← the control passes
```

This is the one host in this file that **distinguishes a bogus identifier**, and
the design deserves saying so out loud.

But the surrounding surfaces are closed:

```
https://www.courtlistener.com/api/rest/v4/opinions/105221/
→ {"detail":"Authentication credentials were not provided."}

https://www.courtlistener.com/opinion/105221/…  → 202, 2 KB challenge page
https://courtlistener.com/favicon.ico           → 403 to non-browser clients
```

**Impact:** there is no keyless path to an opinion's text, scan or metadata —
only to its existence. A keyed partner is one a clone of this repo cannot use.

---

## 5. DPLA has no thumbnail for over half its own items `[ours]`

*Observed 2026-08-06. Not a blocking problem — a metadata gap.*

Across the six showcase pages: **229 of 435 DPLA cards (53%) carry no `object`
thumbnail.** Confirmed against full records (not a `fields=` filter artifact —
the field is genuinely absent).

Where the imageless ones live:

```
168  catalog.hathitrust.org  (HathiTrust)      ← see entry 1
 39  catalog.gpo.gov         (GPO)
  6  digital.library.wisc.edu
  3  digital.tcl.sc.edu  +  3  cdm16817.contentdm.oclc.org
 10  a long tail across 6 more hosts
```

**What does not fill the gap:**

- *Open Library covers by OCLC* — 0 of 7 sampled. These are 1914 municipal
  reports and congressional documents, not trade books; the cover services are
  built for the commercial long tail, not the archival one.
  (`https://covers.openlibrary.org/b/oclc/<n>-M.jpg?default=false` → 404 ×7)
- *HathiTrust* — 73% of the gap, robots-refused. Entry 1.
- *govinfo* (GPO, 17%) — serves the PDFs keylessly and its robots.txt permits
  images, but publishes no thumbnail endpoint, so it would require rasterizing
  page 1.

**What does work,** and is robots-clean — CONTENTdm, a very common contributor
platform:

```
https://cdm16817.contentdm.oclc.org/digital/api/singleitem/collection/p16817coll21/id/5376/thumbnail
→ 200, image/jpeg    (robots.txt disallows only /digital/search/)
```

Worth ~2% of the gap here, likely more on collections with a different provider
mix. Not implemented as of 2026-08-06.

---

## 6. Wikidata has almost no images of court decisions `[ours]`

*Observed 2026-08-06.*

```sparql
SELECT (COUNT(?c) AS ?total) (COUNT(?i) AS ?withImage) WHERE {
  ?c wdt:P31/wdt:P279* wd:Q19692072 . OPTIONAL { ?c wdt:P18 ?i }
}
→ total 8864, withImage 24
```

Brown v. Board (Q875738) has no P18 at all.

**Impact:** for articles whose subject is a document, the graph offers no
illustration path. This is a genuine content gap rather than an access one, and
it is the reason this project renders a typographic plate instead (`5a86407`).

---

## 7. One museum, six objects, four different reasons you cannot see them `[ours]`

*Observed 2026-08-06. The most useful entry here, because nothing in it is a
blocked request — every failure is a gap in a chain, and each one is fixed by a
different party.*

The Smithsonian pivot (`tapestry-gen/src/smithsonian.js`) finds an object when
three things all hold: Wikipedia links it, Wikidata records its accession
number, and the Smithsonian publishes it in Open Access. **Wikidata knows only
six National Air and Space Museum objects by accession number in total**, so the
whole population is small enough to check by hand:

```sparql
SELECT ?item ?itemLabel ?inv WHERE {
  ?item wdt:P195 wd:Q752669 ; wdt:P217 ?inv .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" } }
```

| Object | In Wikidata | enwiki article | In Open Access | Result |
|---|---|---|---|---|
| Columbia (Apollo 11 CM) | ✅ A19700102000 | ✅ | ✅ + 2 CC0 3D scans | **renders** |
| Flyer I | ✅ A19610048000 | ✅ | ✅ + 1 CC0 3D scan | **renders** |
| Apollo 11 sample container | ✅ A19710814000 | ❌ none | ✅ 1 row | invisible |
| Concorde 205 | ✅ A20030139000 | ❌ none | ❌ 0 rows | invisible |
| Enola Gay | ✅ A19500100000 | ✅ | ❌ 0 rows¹ | invisible |
| Apollo 11 crew hatch, Armstrong's suit, the V-2 | ❌ no P217 | — | ✅ (3D scans exist) | invisible |

¹ Searching `"Enola Gay"` returns 76 rows — exhibition records, comment cards,
archival finding aids — but not the aircraft. Records *about* the object, not
the object.

**Four distinct failure modes, and the fix for each sits with someone else:**

1. **No accession number in Wikidata** (crew hatch, space suit, V-2). These were
   on this project's Apollo 11 page when it was hand-curated, because a person
   went to si.edu and copied what they saw. The 3D scans exist and are CC0. The
   only thing missing is a `P217` statement. **Fix: three Wikidata edits**, and
   the objects reappear on every article that links them, for every consumer —
   not just here.
2. **No English Wikipedia article** (sample container, Concorde 205). The pivot
   runs on the article's own links, so an object no article names can never be
   an anchor no matter how well the museum publishes it. **Fix: a Wikipedia
   article**, which is a much larger ask than an edit and may simply not be
   warranted.
3. **Not in the museum's Open Access** (Enola Gay, Concorde 205). The museum
   holds it, Wikipedia covers it, Wikidata has the number — and the API returns
   nothing, because the object record has not been released. **Fix: the
   Smithsonian.**
4. **Everything present** (Columbia, Flyer I) — which is what it takes.

**Why this entry matters more than the blocked-request ones.** Entries 1–4 are
about servers refusing to answer. This is about a chain of three independent
institutions each holding one link, where any single missing link makes an
openly licensed, CC0, already-3D-scanned object invisible. Nobody refused
anything. The Apollo 11 crew hatch is fully open, fully digitised, and
unreachable for want of one statement.

It also cuts against the reflex to blame the ranking. The curated page showed
five Smithsonian items; live discovery shows two. That reads like a regression
until you look — and then four of the five turn out to be unreachable for
reasons no amount of tuning would touch. **Check which link is missing before
concluding the algorithm dropped something.**

---

## 8. BHL: the reading room is challenge-gated, the scans themselves are an open S3 bucket `[ours]`

*Observed 2026-08-07.*

The Biodiversity Heritage Library's page viewer refuses non-browser clients
outright — a Cloudflare JS challenge, not a WAF rule you can satisfy:

```
curl -H "User-Agent: tapestry-gen-lab/0.1 (https://friendsof.wiki; luis@lu.is)" \
  https://www.biodiversitylibrary.org/page/726886
→ 403, "Just a moment...", challenges.cloudflare.com
```

But the image endpoints answer the same client happily, and the real/bogus
control distinguishes cleanly — this endpoint is *talking*:

```
/pagethumb/726886   → 302 → https://bhl-open-data.s3.us-east-2.amazonaws.com/
                              web/mobot31753000798865/mobot31753000798865_0003_thumb.webp
/pagethumb/999999999 → 302 → /images/image_not_found_thumb.jpg
/pageimage/727382   → 302 → (full 1650×2383 webp of the same item, page _0499)
```

The bucket is literally named `bhl-open-data`. So: page *images* — including
the 1758 *Systema Naturae* page where the monarch butterfly was named — are
keyless, redirect-stable, and served from an S3 bucket labeled open, while
the HTML page a human would cite is behind a challenge. Page-level *metadata*
(rights, OCR, printed-page mapping) is API-only, and the API wants a key —
so a keyless client can fetch the scan but cannot ask what it is allowed to
do with it.

robots.txt (same date) is Cloudflare's managed "content signals" template:
`User-agent: * / Allow: /` with `Content-Signal: search=yes, ai-train=no,
use=reference`, plus blanket disallows for nine named AI crawlers
(GPTBot, ClaudeBot, CCBot, …). The maximally-open public-domain library now
ships the drawbridge template — aimed at trainers, but the JS challenge above
lands on everyone without a browser.

**Impact:** a species-box "original description" card can render (thumbnail +
link out) entirely from the keyless image path — and citation→page
resolution is keyless too, via the OpenURL resolver on the same otherwise
challenge-gated host (observed 2026-08-07):

```
/openurl?genre=book&title=Systema naturae…&date=1758&spage=471&format=json
→ 200, {"citations":[{"Url":"https://www.biodiversitylibrary.org/page/727382", …}]}
```

(that page ID independently matches a visual probe of the scan — it is the
1758 *Systema Naturae* p. 471, where the monarch butterfly is named). Only
per-item rights fields and OCR require the keyed API. Same host, three
postures: HTML challenge-gated, images and OpenURL open, metadata keyed.

---

## 9. The thumbnails DPLA does hold ride hostnames its providers retire `[ours]`

*Observed 2026-08-09.* Companion to entry 5: that one counts the items DPLA
has no thumbnail for; this one is about the thumbnails it HAS, whose `object`
URLs point at the provider's own host — and stay pointed there after the
provider moves. Found when tapestry-gen started fetching these server-side
(they hotlink-block or rot in readers' browsers; `hotlinkUnsafe` in
`tapestry-gen/src/http.js`): on one Apollo 11 render, 54 of ~66 aggregator
thumbnails fetched clean and three hosts failed three different ways, all
commands run with our UA (`tapestry-gen/0.1 (…; luis@lu.is)`):

```
# NXDOMAIN — the thumbnail hostname is retired while the site's apex lives.
# Same class as api.bl.uk. curl exit 6; apex resolves:
curl https://thumbnails.calisphere.org/clip/150x150/61cf6557e2905be88a68cf99301a4c33
getent hosts thumbnails.calisphere.org   → (nothing)
getent hosts calisphere.org              → 18.155.192.75

# Bot mitigation, per the control rule — real and bogus ids answer alike:
curl …digital.lib.uiowa.edu/_foxml/datastream/ui%3Atestposters4_176%2BTN%2BTN.0 → 403
curl …digital.lib.uiowa.edu/_foxml/datastream/ui%3Abogus0000_000%2BTN%2BTN.0    → 403

# Indistinguishable — real and bogus both 404 (an HTML error page), which the
# control rule says is a host refusing to say which links are broken:
curl …digitalcollections.museumofflight.org/files/thumbnails/ad23722d….jpg      → 404
curl …digitalcollections.museumofflight.org/files/thumbnails/00000000…dead.jpg  → 404
```

The consequence for a reuser: DPLA's index is durable but its images are only
as reachable as each provider's platform-of-the-decade, so any consumer that
hotlinks them inherits every migration. Server-side fetching converts the
failures from silently-broken images into an honest text card; it cannot
convert a retired hostname back into a picture.

---

## 10. CVMA GB: 28,135 catalogued URLs, every one dead — the archive moved and nothing points at the new home `[ours]` <!-- LUI-147 -->

*Observed 2026-08-11.*

The Corpus Vitrearum Medii Aevi (GB) picture archive — the international
project documenting medieval stained glass — is indexed in Mix'n'Match as
catalog 1020: 28,135 entries scraped from `cvma.ac.uk`, dormant since 2022,
zero matches ever.

```
https://mix-n-match.toolforge.org/api.php?query=get_catalog_info&catalog=1020
→ {"name":"CVMA GB","url":"http://www.cvma.ac.uk","wd_prop":null, ...}
```

Every scraped record URL is dead, and the control proves it is rot rather than
refusal — a real id and an impossible one answer identically:

```
http://www.cvma.ac.uk/jsp/record.do?photodataKey=005722&mode=CVMA_INV_NO&recordView=DETAIL  → 404
http://www.cvma.ac.uk/jsp/record.do?photodataKey=999999999&mode=CVMA_INV_NO&recordView=DETAIL → 404
```

`cvma.ac.uk` itself is a tombstone page announcing the move: the archive now
lives at the **Archaeology Data Service**, University of York, as the "Corpus
Vitrearum Medii Aevi Digital Archive" (collection 1006150,
`doi:10.5284/1132566`), under **CC BY 4.0** with data copyright © CVMA — stated
on the collection's own metadata page, 2026-08-11. So the material is more open
than before and *less* reachable: the old URLs do not redirect, the Mix'n'Match
catalog still points at the dead host, and the ADS pages are a `.cfm` website
with search, map and county browse but no visible API.

The double bind for anyone wanting to link it: no CVMA Wikidata property
exists (0 hits in the property namespace for "Corpus Vitrearum", checked
2026-08-11), so there is nowhere to record the new identifiers even if someone
re-scraped them. A DOI-registered, CC BY, 28,000-image national corpus is —
for machine purposes — orphaned by its own migration.

## Already recorded elsewhere in this repo

Same family, logged where they were found rather than duplicated here:

- **`api.bl.uk` is NXDOMAIN** while 271 Wikidata `P6108` statements point at it;
  `data.bl.uk` redirects away. The British Library has no reachable API.
- **The Rijksmuseum's keyed API was shut down 2026-01-05** (`api.rijksmuseum.nl`
  → `404 {"statusCode":404}`). The replacement is keyless and better, but is a
  three-hop Linked Art walk to reach one image — see the header of
  `tapestry-gen/src/rijks.js`.
- **Three partner favicons are unfetchable** by non-browser clients — the Met
  429s, CourtListener 403s, Europeana's 404s and its live one sits behind a
  content-hashed path that changes each redeploy. See the `SOURCE` map in
  `tapestry-gen/src/emit-html.js`, where each stand-in is justified inline.
- **Wikidata format-constraint violations on partner identifiers**, including a
  case where the *constraint* was wrong rather than the data — see
  `../../mixnmatch-rules/docs/06-open-questions.md`, question 11.
