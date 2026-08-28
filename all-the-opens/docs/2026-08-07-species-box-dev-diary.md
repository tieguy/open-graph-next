# A species box from open data: a developer diary

*Draft — lab-journal notes to expand later. Lead paragraph is final-ish; everything else is bullets. Companion issue: LUI-141. Started 2026-08-07.*

While writing up my last blog post on Friends of Wiki, I took a hard look at
the various templates, including infoboxes, on Monarch and Collared Pratincole.
There was a lot of good stuff there that was missing from the Friends of Wiki
page. This post is a running developer diary of experiments and learnings from
attempting to build an open-data-powered infobox replacement for any article
with a species taxon — hopefully one that, when implemented, will help all
species on Friends of Wiki, not just those two. I'll also try to learn about
any gaps that we genuinely can't get in a systematic way from open data.

## Entry 1 (2026-08-07): we don't have an infobox, just cards

- Current state: cards only. Each card = one partner, one record, placed by
  the article's own links/IDs. Pipeline never merges sources, so never has to
  adjudicate between them.
- An infobox is the opposite: one panel, fixed set of questions (kingdom,
  family, who named it, how threatened), each answer sourced from somewhere.
- Why {{Speciesbox}} feels neutral: the choosing happened upstream — editors,
  field by field, WP:NPOV as referee. We're a pipeline + one developer; every
  field = choosing which database to believe, in code, for ~400k articles at
  once. Not NPOV. Say the choices out loud:
  - Taxonomy → GBIF (their "Backbone Taxonomy": a machine-assembled
    synthesis built on Catalogue of Life plus other checklists — hereafter
    just "GBIF"). Not "the" taxonomy — opinions and known errors. CC BY →
    credit line. (Angle: credit line as admission of whose worldview you
    adopted.)
  - Conservation status → IUCN's conclusion, but read from Wikidata P141
    (CC0) + P627, NOT the IUCN API (keyed, non-commercial, no
    redistribution). The open graph as carrier of a closed database's
    conclusions — but NOT the CopyClear pattern (correction, LV
    2026-08-07): CopyClear *derives* (code + open facts → P7763 conclusion,
    re-derivable and auditable by anyone); P141 is *transcription* (expert
    verdicts over closed data, copied point by point — nothing to re-derive,
    only trust + date). Transcription has failure modes derivation doesn't:
    heterogeneous staleness (each row goes stale on its own schedule) and
    no independent audit without licensing the closed source. Taxonomy of
    how facts enter the open graph: derived / transcribed / natively
    asserted — probably post material.
  - Photos → iNat research-grade, open licenses. "Verified by the iNat
    community" is also a trust choice.
- Learning #1: an infobox is an editorial act. Honest pipeline version =
  box that shows receipts; every field links to the specific record it chose
  to believe.

## Test set (2026-08-07)

Monarch + pratincole were convenience picks — both animals, both extant, both
charismatic. Broader set, one per stress dimension. Gate/box identifiers
checked on Wikidata (batched wbgetentities, cached in session scratchpad):

| Article | QID | Why it's here | P846 | P141 |
|---|---|---|---|---|
| Monarch butterfly | Q212398 | original example, insect | y | y |
| Collared pratincole | Q330310 | original example, bird (+ P2426 sound) | y | y |
| Sequoia sempervirens | Q150129 | plant (enwiki title is the binomial; "Coast redwood" is a redirect) | y | y |
| Amanita muscaria | Q131227 | fungus | y | n |
| Great white shark | Q129026 | fish, heavily-edited article | y | y |
| Komodo dragon | Q4504 | reptile | y | y |
| Common octopus | Q651361 | marine invertebrate | y | y |
| Wood frog | Q4666317 | amphibian | y | y |
| Escherichia coli | Q25419 | bacterium | y | n |
| Tyrannosaurus | Q14332 | fossil taxon | y | n |
| Dog | Q144 | domesticated — **fails the gate** | n | n |
| SARS-CoV-2 | Q82069695 | virus — expected failure | n | n |

Findings from just building the list:

- **Dog doesn't gate as a taxon — and neither does Cat.** These articles are
  about the concept more than the species, and Wikidata models that
  explicitly: Q144/Q146 are P31 "organisms known by a particular common
  name," with zero taxon properties (166 props on Q144, none of them
  P225/P846). The taxon lives on a separate item (*Canis familiaris*
  Q20717272, which has P846 + P3151), reachable one hop away via **P13176
  "taxon known by this common name."** enwiki still gives both articles a
  full Speciesbox, so: either follow P13176 (one extra claim already in
  hand, zero requests) or accept the hole. Good test case either way —
  it's the concept-vs-species split made visible.
- **SARS-CoV-2 has P225 but no P846** → gate on P846 (not P225 alone) and the
  virus correctly falls out: GBIF's taxonomy has no viruses, so there'd be
  nothing to build the box from anyway.
- **Tyrannosaurus HAS a GBIF id** (GBIF ingests the Paleobiology Database) —
  fossils gate IN. Did not expect that. What does the "recorded occurrences"
  map of a T. rex look like? Fossil dig sites?
- **No P141 on the fungus, the bacterium, or the fossil** (IUCN doesn't
  assess them) → status row must be omitted cleanly, not rendered empty.
  A. muscaria is the extant-but-unassessed case specifically.

## Entry 2 (2026-08-07): experiment 1 — classification from the GBIF record we already fetch

Method: P846 keys were already in the claims we fetch every render; pulled
`/v1/species/{key}` for the 11 gated taxa (lab UA `tapestry-gen-lab/0.1`;
in production this is 0 new requests — same response the map card uses) and
each enwiki article's rendered taxobox via `action=parse`, then diffed.
Raw data in session scratchpad (`gbif/`, `enwiki/`).

**Coverage — strong:**

- All 11 records carry kingdom→genus + `canonicalName` + `authorship`.
  Fillable rows: Kingdom, Phylum, Class, Order, Family, Genus, binomial,
  authority. That's the spine of every Speciesbox in the test set.
- Authority strings match enwiki **character for character** on all species
  where enwiki shows one — including the fussy botanical forms
  ("(L.) Lam.", "(D.Don) Endl.") and the bacteriological mouthful
  ("(Migula, 1895) Castellani & Chalmers, 1919"). Did not expect 11/11.
- 6/11 match enwiki's displayed ranks exactly (monarch, pratincole, octopus,
  wood frog, dog-after-hop, amanita modulo label — next bullet).

**Convention, not disagreement:**

- enwiki says **Division**, not Phylum, for plants and fungi (Basidiomycota,
  Pinophyta). Same concept, kingdom-specific label. A faithful box should
  follow the convention — cheap, value already in hand.

**Disagreements — the "whose taxonomy did you adopt" evidence, now concrete:**

- **Great white shark**: GBIF class=Elasmobranchii; enwiki Class=
  Chondrichthyes > Subclass Elasmobranchii > Division Selachii. GBIF
  flattens the chondrichthyan tree.
- **Komodo dragon**: GBIF class=**Squamata**, order empty — GBIF has
  abolished Reptilia and promoted Squamata to class. enwiki: Class Reptilia,
  Order Squamata, Suborder Anguimorpha. Our box would visibly disagree with
  the article it sits beside. (Post material: this is what "adopting GBIF's
  worldview" costs.)
  - **Why (checked, not an error):** GBIF carries Reptilia as a CLASS with
    status `PROPARTE_SYNONYM`, split four ways — accepted = Testudines,
    Crocodylia, Squamata, Sphenodontia, each promoted to class. A deliberate
    cladistic position (Reptilia is paraphyletic — excludes birds). **And it
    is GBIF's own position, not Catalogue of Life's**: COL's latest release
    has class Reptilia `accepted` (taxon `RP`, checked via ChecklistBank
    2026-08-07). enwiki and COL agree here; GBIF alone dissents. Squamata's
    parents in GBIF are literally Animalia > Chordata > (class).
  - **COL is itself a candidate source, not just GBIF's upstream.** COL26.7
    is CC BY (per its ChecklistBank metadata) and the ChecklistBank API is
    keyless. Wikidata has P10585 (COL ID) on 10 of our 11 gated taxa —
    everything but *Tyrannosaurus* — already free in the claims fetch. Cost:
    ~1 request/article vs. GBIF's 0 (record already in hand for the map
    card). Trade: COL keeps Reptilia (agrees with enwiki more often?) but
    loses the fossil. Either way the choice is ours to disclose — entry-1
    point again.
- **E. coli**: GBIF phylum=Proteobacteria; enwiki Pseudomonadota (the 2021
  prokaryote renaming), plus Domain and Kingdom=Pseudomonadati rows GBIF has
  no concept of. AND: `taxonomicStatus=DOUBTFUL`, remarks "Possible variant
  of Escherichia coli E" — the most-studied organism on Earth is *doubtful*
  in GBIF. Anecdote of the post, possibly.
  - **Why (checked): staleness, not opposition.** Exact-match against
    GBIF: `Pseudomonadota` → `matchType: NONE` — the ICSP-validated
    2021 name doesn't exist in GBIF's taxonomy *in any form*, not even as a
    synonym; `Proteobacteria` is still the ACCEPTED phylum. GBIF is
    occurrence-driven and bacteria barely have occurrences, so its
    prokaryote branch just doesn't get refreshed. Different failure mode
    from the reptiles: Komodo is GBIF *having* an opinion, E. coli is GBIF
    *not keeping up*. Both go in the post — "adopting a source's worldview"
    includes adopting its maintenance priorities.
  - **Same skew on iNaturalist, confirmed with numbers** (2026-08-07, live
    API): *E. coli* has **141** observations; the monarch alone has
    **508,327**; the *entire kingdom Bacteria* has **103,328**. One
    butterfly species outweighs every bacterium on the platform ~5:1.
    Observation-driven platforms structurally can't see microbes —
    experiment 4's photos will inherit this.
  - (These checks were live api.gbif.org today — Wikidata only supplied the
    taxon key, so Wikidata staleness is not in play here. Also: the iNat
    and ChecklistBank APIs turned out reachable from this sandbox after
    all — the queue's term_value_id caveat can be resolved in-session.)
- **Sequoia sempervirens**: GBIF order=Pinales vs enwiki Cupressales;
  phylum Tracheophyta vs Division Pinophyta. Conifer classification moved;
  GBIF hasn't.
- **Dog**: even after the P13176 hop, GBIF marks *Canis familiaris*
  `SYNONYM`, accepted = *Canis lupus familiaris* (key 6164210). enwiki
  treats C. familiaris as valid. Box has to choose: display a name that
  contradicts the article's title, or silently prefer the article's usage.
  No neutral option — literally the entry-1 point, in one record.

**Structural findings:**

- **Tyrannosaurus is rank=GENUS.** "Species articles" include genus
  articles; the box must handle rank≠SPECIES (enwiki shows no binomial box
  there either). GBIF leaves class/order empty for dinosaurs; enwiki uses
  † daggers and clade rows GBIF can't produce. Extinct-marking is
  its own problem.
- (Carried from test-set notes, for the observations file: what does the
  GBIF occurrence map of *Tyrannosaurus* look like — dig sites? museums
  with the wrong coordinates? → check when experiment 6 runs.)
- Rows enwiki shows that this response can't fill: Domain, Subclass,
  Suborder, Superfamily, Tribe, Clade rows, † markers, "Type species,"
  subspecies counts. Some may come from other endpoints; most are the
  editorial tail we probably don't chase.

**Verdict:** experiment 1 works. Seven rows + authority from data already
fetched and discarded, for every gated taxon in the set. The disagreements
are not a bug for the post — they're the evidence. Display decision needed:
show GBIF's own `taxonomicStatus` on the box (receipts principle) so
DOUBTFUL/SYNONYM cases disclose themselves.

**Experiment 1 concluded 2026-08-07.** All three measures answered
(coverage, disagreement, gaps), plus two unplanned findings (the GBIF-vs-COL
Reptilia split is GBIF's own; the occurrence-skew explains both GBIF's stale
prokaryotes and iNat's 141 E. coli observations). Rendering the rows is
deliberately NOT part of the experiment — that's the box build, and the box
needs a design decision first (GBIF vs. COL as the classification source,
now a live question).

## Entry 3 (2026-08-07): experiment 2 — conservation status from the claims we already fetch

Method: everything from cached claims + cached enwiki taxobox HTML; one WDQS
count query; two link probes. 0 production requests as designed.

**(c) Agreement — perfect where comparable:**

- 7/7 exact match with enwiki's displayed IUCN status at species scope:
  monarch LC, pratincole LC, shark VU, komodo EN, octopus LC, wood frog LC,
  redwood EN. Zero transcription errors in the sample.
- But enwiki's boxes carry *more scopes*: monarch shows LC "(entire
  species)" AND VU (the migratory subspecies); shark shows global VU AND a
  regional Critically Endangered. Our species-item copy is the species
  scope only — correct but narrower. Scope, not accuracy, is the delta.

**(a) Absence — the rules partly survived contact:**

- Locally: 7/12 have P141+P627; 5 have neither; **zero** P627-without-P141.
- *Amanita muscaria* broke "both absent = structurally not applicable":
  IUCN just hasn't assessed it, and enwiki's box shows **NatureServe
  "Secure"** instead — editors fall back down a hierarchy of systems
  (IUCN → NatureServe → …). The fallback order is itself hand-crafted
  editorial judgment (requirements-spec theme again).
- **Dog's enwiki status is "Domesticated"** — a status outside every
  system, hand-written. Wonderful. No open data source will ever emit it.
- E. coli, Tyrannosaurus: no status section on enwiki either — matches.

**(b) Scale (WDQS, 2026-08-07):**

- 3,988,443 taxon items; 152,815 with P141; 152,765 with P627; 152,700
  with both → **only 65 items worldwide have the ID but no verdict.**
  Transcription is effectively complete where IUCN has assessed
  (bot-maintained). The "assessed but never copied" worklist basically
  doesn't exist — better than feared.
- Flip side: ~153k statuses vs. ~400k enwiki species articles → the row
  will be *absent* for most articles. Absence display isn't an edge case;
  it's the majority case.

**(d) Auditability — datable, not verifiable:**

- No qualifiers on any P141 (no point-in-time). But every reference
  carries: stated-in = a specific *edition* ("The IUCN Red List of
  Threatened Species 2022.2"; pratincole 2021.3), the taxon ID, and a
  P813 retrieval date (2023-01; pratincole 2021-12).
- So the copy is **datable to an edition** — we can honestly say "per Red
  List 2022.2" — but not *verifiable*: with the API keyed, we cannot ask
  IUCN whether 2022.2 is still current for this taxon. Transcription's
  weakness, precisely bounded: we know how old our copy is, not whether
  it's stale.

**(e) Links — the receipt is the Wikidata statement:**

- References carry taxonId only; Red List deep links need
  /species/{taxonId}/{assessmentId}. The old keyless workaround
  (apiv3 taxonredirect) is dead — 525, apiv3 retired with the v4 API.
- iucnredlist.org is a Cloudflare-fronted SPA: /search → 404 to curl,
  /species → 403. Per the real-id/bogus-id house rule, that proves nothing
  about browsers — but it does mean we can't *verify* outbound links
  programmatically. Honest receipt: link the Wikidata statement
  (`Q…#P141`, the actual source of our copy, edition cited), plus an
  untested Red List search URL; hand-check in a browser at build time.
- **Amendment (same day, found while reading the taxobox system):** the
  assessment ID we couldn't build from Wikidata is sitting in enwiki's
  hand-crafted refs. Monarch's `{{cite iucn}}` carries
  `article-number=e.T159971A806727` (taxonId **and** assessmentId → the
  working /species/159971/806727 deep link) plus DOI
  `10.2305/IUCN.UK.2022-1.RLTS.T159971A806727.en`. The hand-crafted corpus
  has *better receipts than the graph* on this field. Options: parse
  {{cite iucn}} from article wikitext (we already fetch the article), or
  treat it as a Wikidata gap worth reporting. Either way the deep-link
  conclusion above is now "not from claims alone — but openly available."

**(f) Other systems (gap list → partner roadmap):**

- CITES: Wikidata P7603 present on exactly the two articles that display
  it (shark = "Appendix II of CITES", komodo = "Appendix I of CITES",
  labels confirmed) → renderable now. CITES = the 1975 trade treaty
  (~184 parties); appendices are *treaty annexes* — public law, the
  opposite licensing physics from IUCN's proprietary assessments in the
  same enwiki status section. (If we ever fetch beyond Wikidata: the
  machine-readable source is Species+/UNEP-WCMC, which has its own ToU —
  read before touching.)
- NatureServe: IDs (P10243) on 6 of our taxa, but the status *value*
  (P3648) only on redwood → can link the receipt, mostly can't carry the
  verdict. NatureServe status transcription is where IUCN's was years ago.
- Not carried anywhere open: enwiki's regional-scope rows, "Domesticated."

**Addendum (same day, LV question: "are we really using bots to copy from
the -NC database?"):**

- **Yes — bots.** Checked revision history: SuccuBot set the P141
  references on our test taxa (Jan 2023). And live right now:
  Property talk:P141 has a thread (Feb–Jun 2026) where a volunteer is
  building a NEW sync bot explicitly against the keyed IUCN API.
- **The licensing question is entirely undiscussed.** Property talk:P141
  contains zero licensing/terms conversation — searched. Neither the
  volunteers nor IUCN raise it. The -NC/no-redistribution API terms vs.
  bulk transcription into CC0 is exactly LV's professional turf; the
  open-carrier pattern's cargo manifest, unexamined. Post paragraph.
  (Our downstream read of CC0 Wikidata is clean either way; the tension
  lives at ingestion.)
  **Superseded same day by actually reading the ToU** — see "IUCN terms,
  actually read" below: §3 explicitly places *no restrictions* on the
  Categories-per-taxon, which is what the bots copy. The tension is far
  smaller than this bullet assumed; the closed core is spatial/attribute
  Data, not the verdicts.
- **IUCN's institutional posture** (their emailed reply, quoted in the
  thread, June 2026): no rights assertion, no feed offered — "we have no
  control over the information displayed on Wikipedia… report the issue
  directly to them," and iNat "should be sourcing their Red List data
  directly from us." A per-site correction model, no channel in either
  direction with the graph.
- **The thread's example is our thesis, live**: streambank froglet,
  assessed Endangered by IUCN in 2020, still "Least Concern" on Wikipedia
  in 2026 — and the staleness propagates Wikipedia → iNaturalist → Google
  → "AI services" (their words). Kicker: the new sync bot WON'T fix it,
  because {{Speciesbox}} **hardcodes the status in article wikitext** — it
  doesn't read Wikidata. The bot author is now asking people to lobby
  Template talk:Speciesbox to "align with it and not hardcode old values."
  400,000 hand-maintained boxes as the stale endpoint: the systemic-fix
  argument, stated by a Wikidatan, discovered while checking a licensing
  question.
- **Caveat now attached to our 7/7 agreement result**: agreement between
  two copies is not freshness — the froglet shows Wikipedia itself can be
  the stale one, and with the API closed, neither we nor enwiki readers
  can tell from open data alone which copy is current.

**Experiment 2 concluded 2026-08-07.** Verdict: the transcribed copy is
better than the transcription-skeptic feared — complete (65-item gap
worldwide), accurate (7/7), datable to an edition — and worse than the
enthusiast hoped: scope-narrow (species only), unverifiable against the
closed source, and absent for the majority of articles, where enwiki
editors deploy a hand-crafted fallback hierarchy no single property
captures. Box design follows: status pip + edition + "per Wikidata" receipt
link; CITES where P7603 exists; absence rendered as nothing (not as "no
data" — the Dog taught us absence can mean "Domesticated").

## Entry 4 (2026-08-07): experiment 3 — the original description, GBIF → BHL

Method: prevalence from the 11 cached GBIF records (0 requests); live: BHL
robots.txt, one challenge-gated HTML attempt, pagethumb real+bogus control,
two pageimage probes (~6 requests, serial, hostLimit 1, lab UA).

**Prevalence — it's a garnish, not a feature (from `publishedIn` alone):**

- 1/11 has a BHL URL (monarch). 1/11 has a non-scan URL (octopus →
  MolluscaBase source page). 6 text-only citations, 3 empty.
- `publishedIn` doesn't reliably mean *protologue*: the redwood's cites
  Farjon's 2010 conifer handbook — the checklist's source, not the 1847
  original description. Field semantics are per-source-checklist, another
  small "whose worldview" instance.
- The text-only citations are often BHL-held works (T. rex: AMNH Bulletin
  21, 1905; Komodo: Ouwens 1912) — resolvable, but only via the keyed API.

**Correctness — the one link we had was wrong in an instructive way:**

- Page 726886 renders as the **title page** of *Systema Naturae* t.1
  (verified visually; item mobot31753000798865, sequence 0003). GBIF links
  the *work*, not the naming page. A card saying "first described on this
  page" would have been confidently wrong. Copy rule: work-level claims
  only ("named in…"), never page-level, unless a resolution step proves
  the page.
- Then we went and found the real page: BHL page IDs are sequential
  within an item, so title(+3) → probe landed on printed 455 → +16 →
  **pageid 727382 = printed page 471**, verified visually: margin
  "Plexip- pus. 80.", "*Habitat in* America *septentrionali*" — the
  monarch's actual 1758 naming, on screen. The enwiki box prints
  "(Linnaeus, 1758)"; this card can show the thing itself. (ID arithmetic
  is a lab trick, not production — front-matter offsets vary per item.)

**Access + rights (full log: reaching-open-collections.md entry 8):**

- Page *viewer* HTML: 403 Cloudflare JS challenge, non-negotiable for
  non-browsers. Page *images*: keyless 302 → an S3 bucket literally named
  `bhl-open-data`; real/bogus control distinguishes cleanly.
- robots.txt: `Allow: /` for `*`, Cloudflare "content signals"
  (ai-train=no), nine AI crawlers name-blocked. The maximally-open PD
  library ships the drawbridge template. Post material.
- **No keyless rights signal**: page metadata/OCR/rights all need the
  (free) API key. **Correction (LV):** that is NOT a blocker — DPLA,
  Europeana, and the Smithsonian are all keyed partners the live install
  uses; the house pattern is "use the key when configured, silently absent
  keyless" ("the demo must run for anyone who clones it, keyless" —
  dpla.js). I first wrote "skipped on principle"; wrong. Keyless
  degradation option for clones: parse the year from the citation,
  pre-1930 → PD. Crude but honest.

**Terms, read 2026-08-07** (the about. subdomain is not challenge-gated;
main-site pages below are browser-only):

- **Metadata: CC0 1.0**, explicit, commercial included — "reuse, modify,
  repurpose, and distribute … for all purposes including commercial and
  non-commercial, with no need to ask for permission."
  <https://about.biodiversitylibrary.org/tools-and-services/developer-and-data-tools/>
  (§ Data Licensing).
- **Scans: per-item**, not blanket. Copyright-status vocabulary and the
  US 95-year rule at
  <https://about.biodiversitylibrary.org/help/copyright-and-reuse/>:
  "NOT_IN_COPYRIGHT"/"Not specified"/blank → public domain, reuse yes;
  "No known copyright restrictions" → yes with caution; in-copyright
  items carry CC licenses (incl. NC variants). Item-level `Copyright
  Status` + `Holding Institution` fields are the gate — via API.
- **API**: key required (getapikey.aspx), v3 preferred
  (/docs/api3.html — challenge-gated to curl, fine in a browser).
  **No published rate-limit statement found** on the about pages →
  hostLimit stays 1 (house rule), revisit if the v3 docs state one.
- **Two discoveries that upgrade the card:**
  1. **BHL runs an OpenURL Resolver** (openurlhelp.aspx) — "a popular
     tool used by biodiversity databases for linking into citations and
     exact pages." Their own docs' example is *citing the original
     description of Zea mays*. This is the citation→page resolution path
     for our 6 text-only `publishedIn` values — the protologue use case
     is what BHL built this for. **And it's KEYLESS — tested 2026-08-07:**
     `openurl?genre=book&title=Systema naturae…&date=1758&spage=471&format=json`
     → 200, JSON, `"Url":"…/page/727382"` — the exact page we found by
     ID arithmetic and verified visually. Independent confirmation of the
     probe AND a production-viable resolution route with no key. The
     keyed API is now needed *only* for per-item rights fields and OCR.
  2. **Monthly CC0 data exports on Figshare** include "the millions of
     scientific names that have been identified throughout the BHL
     corpus **and the pages on which those names occur**" — a bulk
     name→pages mapping, no API, no key, CC0. Potentially resolves
     original-description pages offline for every species at once. The
     400k-at-once move, as a downloadable file.

**Experiment 3 concluded 2026-08-07.** The chain is real but weaker than
hoped: 1/11 prevalence, work-level not page-level, rights unreadable
keylessly. The honest automated card today: "Named in *Systema Naturae*
(1758)" + title-page thumb + BHL link, only where `publishedIn` carries the
URL. Every upgrade path (citation resolution, page-level precision, rights
check) runs through the free-key API — which, per the correction above, is
the ordinary keyed-partner build step (`BHL_API_KEY` as a Fly secret,
silently absent keyless), not a policy question. Remaining build questions:
read BHL's API terms and quote them at the call site (hostLimit rule), and
decide standing for a work-level document card (hero.js tier 0 is "subject
IS this document"; a protologue is a document *about the naming of* the
subject).

## Entry 5 (2026-08-07): experiment 4 — labeled photo pairs from iNat annotations

Method: `/v1/controlled_terms` (1 req); 49-cell coverage grid at
`per_page=1` (counts are free); 3 top-photo spot checks, viewed. All
keyless, serial, 0.7s spacing, lab UA. Filters throughout:
`quality_grade=research`, `photo_license=cc0,cc-by,cc-by-sa`.

**Vocabulary resolved** (LUI-141's unverified IDs, now verified): Sex =
term 9 (Female 10, Male 11); Life Stage = term 1 (Adult 2, Juvenile 8,
Larva 6, Pupa 4, Egg 7); bonus: Flowers/Fruits = term 12 (13/14) — the
plant-shaped pair.

**Coverage grid** (research-grade, Wikipedia-free licenses only):

| taxon | F | M | Ad | Juv | notes |
|---|---|---|---|---|---|
| Monarch | 1,523 | 2,149 | 26,748 | 0 | strip: Egg 788 / Larva 9,666 / Pupa 1,131 |
| Pratincole | 0 | 0 | 17 | 8 | A/J pair only, thin |
| Amanita | 0 | 0 | 0 | 0 | no applicable terms |
| GW shark | 3 | 2 | 4 | 5 | present but tiny |
| Komodo | 0 | 3 | 118 | 16 | A/J only |
| Octopus | 0 | 0 | 22 | 3 | |
| E. coli | 0 | 0 | 0 | 0 | |
| T. rex | 0 | 0 | 0 | 0 | (obviously) |
| Wood frog | 51 | 79 | 707 | 68 | everything works |
| Redwood | 0 | 1 | 0 | 0 | Flowers 0 / Fruits 0 too |
| Dog | 55 | 70 | 364 | 44 | works |

**Findings:**

- **Annotation follows *identifiability*, not just charisma.** The
  pratincole — a bird with 4,600+ iNat observations — has ZERO sexed
  photos, because pratincoles aren't sexually dimorphic: you cannot sex
  one from a photo, so annotators don't. The M/F pair is only possible
  where the difference is visible — which is also exactly when the pair
  is worth showing. The skew is self-correcting in the right direction.
- **The vocabulary is clade-branched, and the pair type must be too.**
  Insects have Juv=0 (their branch is larva/pupa/egg); birds get
  juvenile; fungi have no applicable terms at all; "Flowers and Fruits"
  is angiosperm-shaped so the conifer falls through (redwood all-zero).
  Pair rule by clade: M/F where dimorphic, Ad/Juv for birds/herps, the
  full life-stage strip for holometabolous insects, flowers/fruits for
  angiosperms, nothing for fungi/microbes/fossils. Another inherited
  worldview: iNat's annotation schema is vertebrate/angiosperm-shaped.
- **Spot check (viewed):** "Male" monarch consistent (hindwing patches,
  though soft — top-by-votes ≠ most illustrative); "Juvenile" pratincole
  textbook-correct (scaled buff plumage, no necklace) — **and an A/J pair
  would beat enwiki's single-adult pratincole box**. Top "Female" monarch
  by votes: a 7MB animated GIF. Production needs a media-type guard and
  probably different ordering; votes surface viral, not illustrative.
- **"Ask, then render":** counts cost one request per cell, so the box
  can probe and render only cells clearing a threshold (17/8 pratincole
  is renderable; 3/2 shark is not). Data-driven layout, per article.
- Monarch's enwiki hand-pair (Male/Female, hand-captioned) is fully
  reproducible automatically — plus the egg→caterpillar→chrysalis→adult
  strip enwiki's box doesn't attempt.
- Caption honesty: "Male — as annotated by iNaturalist observers," each
  photo receipts-linked to its observation, per-photo attribution
  (all spot-check photos CC BY).
- Rate guidance page (`inaturalist.org/pages/api+recommended+practices`)
  is challenge-gated to curl — browser-read before any hostLimit change;
  stays 1. Production cost: 2–4 count probes + photo fetches per taxon
  article, host already in every render.

**Experiment 4 concluded 2026-08-07.** Verdict: real upgrade, honestly
scoped — pairs/strips exist for the identifiable and the beloved (monarch,
wood frog, dog, pratincole-A/J), probe-cheap to discover per article, and
absent exactly where no photo could show the distinction anyway. The
annotation skew is the occurrence skew's better-behaved sibling.

## Entry 6 (2026-08-07): experiment 6 — the range map, where the honest gap lives

Method: spec from cached taxobox HTML (0 req); capabilities probe; ~10
tile fetches with real/bogus-style controls on failures; tiles read
visually. (Experiment 5 / xeno-canto skipped for now — needs the free key.)

**The spec (what enwiki actually shows):**

- 6/11 sample boxes carry range maps (monarch, shark, komodo, octopus,
  wood frog, redwood); pratincole's lives in the article *body*, not the
  box. None for Dog/E. coli/T. rex/Amanita.
- Provenance is in the filenames: "…IUCN_range…" (shark),
  "GlareolaPratincolaIUCNver**2018_2**.png" — hand-traced from closed
  IUCN spatial data, *version-stamped 2018*. The enwiki map layer is the
  froglet problem in cartographic form: stale copies of a closed
  database, eight years old, with no update mechanism but an editor's
  hand.

**Zoom-to-extent: solved, one request.** `v2/map/occurrence/density/
capabilities.json?taxonKey=X` → per-taxon bbox + record total + year
range. Caveat: the bbox includes vagrants (pratincole minLng=-82 — a
bird blown to the Americas widens the window across the Atlantic); naive
fit-to-extent over-zooms out. Trim heuristic needed, or accept it.

**Seasonal tiles: half-demonstrated, and the reliability finding matters
more.** The ad-hoc endpoint (`month=` filter) 503'd on every `@2x`
request and every hex-bin request, worked intermittently at `@1x`
(May tile obtained: dots correctly confined to the European/Central
Asian sector; winter tile never obtained — stopped retrying per
etiquette). The density endpoint (current card) is rock-solid but takes
no `month=`. So the honest substitute's *fancy* version depends on
GBIF's fragile endpoint: production needs caching, graceful absence,
and — noted — **GBIF serves its errors as PNG tiles** (a literal red
"503" image), so a hotlinked ad-hoc tile that fails renders "503" art
into the page. Check status codes server-side; never hotlink ad-hoc.

**T. rex, as promised (viewed):** a tight dot cluster on the northern
Great Plains — the Hell Creek Formation and its neighbors — plus a
couple of stray noise points. The "recorded occurrences" map of an
extinct genus is a map of *excavation history*, and it makes the copy
rule vivid beyond argument: these maps show records, never range.
Post exhibit, definitely.

**Rendering fact:** GBIF tiles are transparent overlays — no basemap.
The pratincole's all-year point cloud is recognizably Iberia + Sahel +
East Africa even floating on white, but a real map card wants an OSM
base layer underneath (OpenStreetMap is already a partner) with the
GBIF overlay CSS-stacked.

**The gap, precisely bounded (the post's "genuinely can't" list):**

1. Expert interpolation — the polygon *between* records (extent of
   occurrence) is IUCN judgment over closed data; points cannot honestly
   become shapes.
2. Seasonal *boundaries* — breeding/wintering/passage as drawn regions;
   our best open approximation is month-filtered points from an endpoint
   that 503s.
3. Historic/former range — the map of where something *was* (the
   monarch's map shows migration corridors; extinct ranges need sources
   records don't provide).
4. And the meta-gap: enwiki's maps are themselves stale hand-copies of
   the closed source (2018 version stamps). Open data gives records and
   honesty; closed data gives shapes and staleness. Nobody currently
   renders "the range" as a living fact.

**Experiment 6 concluded 2026-08-07.** Verdict: the card upgrades
meaningfully (extent-zoomed via capabilities, OSM-composited, seasonal
when the endpoint cooperates) and the copy rule holds absolutely. The
gap is real but smaller and stranger than assumed: what's truly closed
isn't "the map" — it's the *expert shape-drawing*, and Wikipedia's own
maps turn out to be old photocopies of it.

## Entry 7 (2026-08-07): experiment 7 — synonyms, one request each

Method: `/v1/species/{key}/synonyms` for all 11 gated taxa (serial, 0.7s,
lab UA); enwiki synonym lists counted from cached taxobox HTML.

**Counts (GBIF vs ~enwiki italicized names):** Monarch 18 vs 4 · Amanita
58 vs 13 · Shark 23 vs 14 · Octopus 29 vs 3 · Wood frog 13 vs 1 · Redwood
23 vs none · T. rex 5 vs 25 · E. coli 0 vs 3 · Dog 0 vs 58 · Pratincole
1 vs 1 · Komodo 0 vs none.

**Findings:**

- **GBIF gives more names but less judgment.** For most extant taxa GBIF
  out-counts enwiki 3–10×, but the lists are unvetted nomenclatural dumps:
  "Hirundo spec Linnaeus, 1766" (a truncated/dirty record), an ichnotaxon
  (*Tyrannosauripus* — a footprint genus) under T. rex, and a
  *Chamaecyparis lawsoniana* cultivar listed as a redwood synonym (almost
  certainly a backbone error). enwiki's short lists are an editor's
  *selection* of the synonyms that matter, with refs. The secondary-source
  theme materialized as a list field: exhaustive-and-noisy vs
  curated-and-thin.
- **Synonyms attach to the accepted name.** Dog: 0 from GBIF — because
  *C. familiaris* is itself a SYNONYM there; its 58 enwiki names hang off
  *C. lupus familiaris*. The exp-1 SYNONYM finding propagates into every
  list-shaped field. T. rex under-counts for the rank-mismatch version of
  the same reason (genus-level synonyms only; enwiki lists synonymized
  *species*).
- **E. coli 0 again** — the prokaryote branch, as everywhere.
- **Display decision:** given the noise, the honest render is probably a
  count + receipt ("18 synonyms recorded in GBIF →"), not the raw list.
  Rendering the dump would put a cedar cultivar in the redwood's box.

**Experiment 7 concluded 2026-08-07.** One request, real content, but the
first field where MORE data is clearly WORSE display — the first field
whose honest form is a link, not a list.

## Entry 8 (2026-08-07, late): experiments A, B, C and audit E, in one overnight pass

**A. Parameter census — the inventory becomes priorities.** Sampled 200 of
1,000 {{Speciesbox}} transclusions (every 5th of the first 1,000 by page
id — old-article bias likely, prominent species overrepresented; note
when quoting). Non-empty param frequency:

- authority **100%** · image 96% · genus/species 84% · status 73% ·
  synonyms 63% · **range_map 59%** · image_caption 59% · name 36% ·
  status2 20% · **fossil_range 20%** · image2 20% · subdivision 19% ·
  parent_authority 14% · **audio 8%** · extinct 1%.
- Reading: our experiments covered the entire top tier (authority through
  range_map). fossil_range at 20% promotes experiment D (PBDB). And
  **`audio` is an undocumented param** — absent from TemplateData's 45,
  used by 8% of sampled boxes — corpus-level justification for the
  xeno-canto card, and proof TemplateData under-documents the real spec.

**B. OpenURL hit rate — original-description coverage 1/11 → 6/11.** The
six text-only `publishedIn` citations through the keyless resolver:
**4/6 hit** (pratincole → page/42946541; Amanita → 33342384; Komodo →
3873564; T. rex → 64991340). Misses: E. coli (1980 journal,
in-copyright) and Farjon 2010 (in-copyright, and not a protologue —
the field-semantics problem, not a resolver failure). **Komodo verified
visually**: resolved from *article title alone* to the actual first page
— "ON A LARGE VARANUS SPECIES FROM THE ISLAND OF KOMODO. BY P. A.
OUWENS." The card is a feature, not a garnish (amends entry 4's
verdict). Remaining gap: the 3 taxa with *empty* publishedIn need a
citation from elsewhere before they can resolve.

**C. The subspecies layer — and the first live staleness catch.**

- GBIF `/children`: monarch has 10 named subspecies (accepted, with
  authorities — the `subdivision` field fills for ~1 request);
  pratincole 2. Data noise: each list ends in an
  `undefined [UNRANKED]` artifact to filter.
- One WDQS hop (`?i wdt:P171 wd:Q212398`) finds *D. p. plexippus* =
  Q21354783 with P141 — the famous migratory-monarch status IS
  systematically reachable. **But it says ENDANGERED, and enwiki's box
  says VU.** The reference dates the copy: "Red List 2022.2, retrieved
  2023-01-04" — a 2022 verdict that survived IUCN's 2023 downlisting to
  Vulnerable. After 7/7 agreement at species level, the first live
  disagreement in all our comparisons — on the most famous conservation
  datapoint we've touched, datable to the edition exactly as entry 3
  predicted, and unverifiable against the closed source exactly as
  entry 3 warned. The post's staleness section writes itself now.

**E. {{Automatic taxobox}} audit.** 49 params. Not in Speciesbox:
`type_species`/`type_genus` (+authorities), **`diversity`**
(+link/ref — the "~N species" line; open candidate: GBIF children
*count*, one request), `oldest_fossil`/`youngest_fossil` (structured —
strengthens PBDB/experiment D), and text-override params. Speciesbox-only:
status2 tier, type_strain, the genus/species split.

## Entry 9 (2026-08-07, later still): D, F, G

**D. PBDB fossil_range — works, CC BY, and it re-teaches the map lesson
in time.**

- License: PBDB's GBIF dataset records say **CC BY 4.0**
  (machine-readable, both records). PBDB's own site is a JS app — terms
  page browser-read at build time; hostLimit 1.
- `taxa/single.json?name=X&show=app`: T. rex → firstapp 83.6 Ma, lastapp
  66 Ma, Campanian–Maastrichtian, extant=0. enwiki's box: "Late
  Cretaceous (late Maastrichtian), **69–66 Ma**." PBDB reports oldest
  *attributed record*; enwiki editors chose the accepted range. The
  vagrant-pratincole problem, temporal edition: **"fossils attributed
  from X to Y Ma," never "lived X–Y Ma."** Same copy rule, new axis.
- Beat-the-box find: *Sequoia sempervirens* has a PBDB record
  (23–3.6 Ma, extant=1) — a fossil-range line for an extant species
  that enwiki's redwood box doesn't show. Monarch: no record, graceful
  absence.

**F. The stale subspecies status — report drafted (outward-facing, so
prepared, not posted; LV to fire):**

- The fact pattern, fully receipted: Q21354783 (*D. p. plexippus*)
  P141 = Q96377276 (Endangered), ref = Red List **2022.2**, P627
  194052138, retrieved 2023-01-04. IUCN downlisted the migratory
  monarch to **Vulnerable** in 2023; enwiki already shows VU (ref:
  "Migratory Monarch Butterfly," Red List, taxon 194052138).
- Draft Wikidata edit: on Q21354783, set P141 → Q278113 (vulnerable)
  with reference {stated in: current Red List edition item; P627:
  194052138; retrieved: <date of edit>}; demote the EN statement per
  P141 conventions rather than deleting it.
- Draft note for the Property talk:P141 "Syncing" thread: a concrete,
  fully-dated example for their bot case — EN-referenced-to-2022.2
  surviving a 2023 downlisting, catchable mechanically because the
  stated-in edition dates every copy. Offers the worked example the
  thread's froglet anecdote lacks (theirs shows Wikipedia stale; ours
  shows Wikidata stale — the staleness is symmetric, which is the real
  argument for the sync bot).

**G. `audio` archaeology — enwiki's sound row already runs on
xeno-canto.**

- Handled by Taxobox/core, not Speciesbox: a whole param family
  (`audio`, `audio_ref`, `audio_caption`, `audio_width`,
  `audio_upright`, `audio_alt`) absent from Speciesbox's TemplateData.
  The documented spec undercounts the real one — again.
- 18/200 sampled articles use it. Values split two ways: animal sounds
  (birds, bison, guinea pig) and **word pronunciations** (Aardvark's is
  a Lingua Libre recording; Eggplant's is Arabic pronunciation) — the
  param has no semantics, editors pour in whatever "audio" means to
  them. A card system can't inherit this field blind.
- The gem: Whinchat's file is "Saxicola rubetra - Whinchat
  **XC486281**.mp3" — a xeno-canto recording, hand-uploaded to Commons,
  ID preserved in the filename. enwiki's audio row is already partially
  xeno-canto *laundered through the single door*. Our card would take
  the recording from the source, credited, skipping the door — the
  demo's thesis in one filename.

## Proposed next experiments (2026-08-07 review of everything above)

Reviewed the day's notes; aside from xeno-canto (queued, needs key), in
rough value order:

- ~~**A. Parameter-usage census across the corpus.**~~ **Run, see entry 8.**
- ~~**B. BHL OpenURL hit rate.**~~ **Run, see entry 8** (4/6; coverage
  6/11; Komodo verified visually).
- ~~**C. One hop down: the subspecies layer.**~~ **Run, see entry 8**
  (subdivision fills; migratory-monarch status reachable — and STALE:
  Wikidata EN vs enwiki VU, copy dated 2022.2).
- ~~**D. PBDB fossil_range.**~~ **Run, see entry 9** (CC BY; "attributed
  from X to Y Ma," never "lived"; redwood beat-the-box find).
- ~~**E. {{Automatic taxobox}} inventory**~~ **Run, see entry 8**
  (49 params; new open-candidate: `diversity` ≈ GBIF children count).

New follow-ups surfaced by the overnight pass:

- ~~**F. Report the stale subspecies status**~~ — **drafted, see entry
  9**; posting is LV's move (Wikidata edit + thread note both written).
- ~~**G. `audio` param archaeology**~~ — **run, see entry 9** (Taxobox/
  core family, no semantics, and Whinchat's file is xeno-canto
  XC486281 through the Commons door).

## Field inventory (2026-08-07): the raw {{Speciesbox}}, all 45 parameters

Until now we worked from *rendered* boxes on 12 sample articles. Fetched the
template's TemplateData: 45 parameters. Semantic fields × open-source
candidates (display plumbing — upright/alt/italic_title/color_as — omitted,
though `image_alt` is a reminder our cards need alt text too):

| Field | Status | Open source |
|---|---|---|
| name (common name) | in hand | P1843 (18–39 langs) / iNat preferred_common_name |
| taxon/genus/species/parent chain | **exp 1 ✓** | GBIF (or COL — the open fork) |
| authority | **exp 1 ✓** | GBIF authorship, 11/11 char-exact |
| parent/grandparent/… _authority | partial | GBIF higher-rank records (1 req/rank) or COL |
| status, status_system, status_ref | **exp 2 ✓** | Wikidata P141/P627; CITES P7603 |
| status2 (second system) | **exp 2 ✓** | CITES yes; NatureServe ID-only (P10243) |
| image/image2 + captions | **exp 4 ✓** | iNat annotation pairs |
| range_map ×2 + captions | exp 6 pending | GBIF tiles ("recorded," never "range") |
| synonyms + ref | **not yet run** | GBIF `/species/{key}/synonyms` — was in LUI-141's original list, never made the diary queue. → queue item 7 |
| subdivision + ranks + ref (e.g. subspecies) | **new** | GBIF `/species/{key}/children` (names + authorship); COL |
| classification_status (Accepted/Disputed) | **in hand, unnoticed** | GBIF `taxonomicStatus` — E. coli's DOUBTFUL *is* this field |
| fossil_range (geologic span) | **new** | Paleobiology Database (PBDB — GBIF already ingests it; API open, terms unread) → candidate exp |
| extinct (date declared) | **new, source unknown** | Wikidata property TBD; don't guess |
| type_strain (bacteria) | **new** | LPSN/BacDive — registration terms unread; bacteria-only |

Notes:
- Three fields we treated as exotic are already sitting in fetched data
  (classification_status; common names; and synonyms is one request away).
- **{{Speciesbox}} is species-only.** Genus articles (Tyrannosaurus!) use
  {{Automatic taxobox}} with its own parameters (`type_species` etc.) —
  a second inventory for the build. The "400k species articles" corpus
  spans both templates.
- This table IS the requirements-spec theme executed: the template's
  parameter list is the field-by-field spec the box build works against.

## IUCN terms, actually read (2026-08-07)

Until now "keyed, non-commercial, no redistribution" was carried from a
prior session, unread. The ToU page answers curl directly (unlike the
species pages — path-dependent gating). Read: **Terms and Conditions of
Use v3.1, June 2024**, <https://www.iucnredlist.org/terms/terms-of-use>.
What it actually says:

- **The carve-out that changes our framing (§3, verbatim):** "However,
  IUCN warrants that you are free to view and query The IUCN Red List,
  and **places no restrictions on use of the IUCN Red List Categories
  associated with each named taxonomic entity.**" The category-per-taxon
  — exactly what P141 transcribes, exactly what our status row shows —
  is explicitly unrestricted. §15's definitions define Reposting/
  Redistribution/Commercial Use/Derivatives but NOT "Categories," so the
  carve-out stands on ordinary meaning: the LC/EN/VU verdict per taxon.
- **What IS restricted ("IUCN Red List Data," §1: "all tabular, and all
  spatial and associated attribute data"):** no commercial use (§3,
  defined broadly: even *informing* a for-profit's activities); no
  reposting/redistribution incl. "through web services such as APIs" and
  "interactive web maps that grant users download access" (§4, §15);
  Derivative Works need a written Waiver (tightened in v3, 2017, which
  *deleted* the old section allowing derivatives without consent).
  Spatial data → range maps: confirmed closed, as assumed for exp 6.
- **Usage license (§5):** use/download/print "solely for conservation or
  education purposes, scientific analyses, and research" — plus the
  charming obligation to send IUCN two paper copies (or one electronic)
  of anything published using the Data.
- **Citation (§6):** acknowledgement must include the *version* of the
  Red List used — which is exactly what Wikidata's references carry
  ("2022.2") and our receipts would surface. §7: don't use superseded
  versions — the ToU itself argues against stale copies.
- **Consequences for our earlier notes:** (a) the status row is cleaner
  than the "open carrier of a closed database" framing suggested — for
  *Categories*, Wikidata is carrying something IUCN does not restrict;
  the sync-bot thread's category-copying looks like the carve-out,
  though whether bulk category transcription is "use" vs "Redistribution
  of Data" is a genuinely lawyerly line — LV's call, quoted not
  concluded here. (b) The closed core is the *rest*: spatial, population
  trends, habitat attributes, bulk tabular Data. (c) enwiki's per-article
  {{cite iucn}} with DOI is exemplary §6 citation practice — the
  hand-crafted corpus got the compliance right, too.

## Background note (2026-08-07): the automated taxobox system, from primary evidence

What enwiki's "automated taxobox system" actually is (checked, not
remembered — fetched the project page, a taxonomy template, and the
Monarch's infobox invocation):

- Since ~2016, taxobox classification is NOT written in articles. Each
  taxon has one page `Template:Taxonomy/<Name>` holding: rank, display
  link, **parent** (pointer to another Taxonomy template), extinct flag,
  refs. The complete record for the monarch's genus, verbatim:
  `rank=genus | link=Danaus (butterfly)|Danaus | parent=Danaina`. A linked
  list, maintained as wiki pages.
- `{{Speciesbox}}` takes `|taxon=Danaus plexippus` and walks the parent
  chain to the root, rendering principal ranks + `always_display` ones.
  Fix one template's parent → every article under that lineage re-renders.
- So enwiki already runs a miniature of our pipeline: classification
  centralized into a data structure maintained by a small group
  (WikiProject Tree of Life), per-article autonomy traded away. It is
  also effectively a **third taxonomy** in our comparison — hand-maintained,
  distinct from GBIF's and COL's (and it kept Reptilia).
- **What is NOT centralized** — visible in one screen of the Monarch's
  invocation: `status=LC` / `status2=VU` (+ hand-built refs), images,
  captions, hand-typed wikilinked authority. Half the box migrated to a
  data system; half is still hand-carved, in the same template call. The
  sync-bot thread's complaint (entry 3 addendum) is exactly about the
  hand-carved half.
- Exhibit quality: the Monarch `{{Speciesbox}}` call shows the whole
  hand-crafted → data-driven transition frozen midway. Post material.

## Recurring themes for the post (collect as they surface)

- **An infobox is an editorial act** (entry 1) — every field is choosing
  which database to believe; disclose, show receipts.
- **Editor autonomy in a data-driven model** (2026-08-07, from the GBIF-vs-
  COL choice): if the box is assembled by a pipeline from third-party
  sources, what does editor autonomy and engagement look like?
  - The editorial surface moves *up*: not "fix this article's kingdom row"
    but "which taxonomy does the site follow," "what does the box disclose,"
    "which mismatches get flagged." Fewer, bigger levers, held by whoever
    runs the pipeline. That's us — worth saying uncomfortably plainly.
    Double edge (LV): fixes become broad and immediate (good!), but the
    fights over control of those levers will be fierce — the stakes of
    every dispute scale with the lever.
  - enwiki already ran this experiment in miniature: {{Speciesbox}} pulls
    classification from the centralized `Template:Taxonomy/...` hierarchy,
    maintained by a small group of specialists — per-article autonomy
    already traded away for consistency, inside Wikipedia itself. The
    pipeline version just moves the same lever outside the wiki. (Known
    mechanism; grab a cite when drafting.)
  - Engagement could become *arbitration*: the Komodo mismatch, surfaced as
    a visible diff ("GBIF disagrees with this article"), is a worklist —
    is the article stale, or is GBIF? Fixes flow upstream (Wikidata, GBIF,
    COL feedback channels) instead of into the box. Same shape as the
    visibility panel: we measure and report, never overwrite.
    Load-bearing caveat (LV): this only works **where partners can accept
    fixes at the rate Wikipedians can create them** — upstream intake
    capacity is the bottleneck, and most partners have nothing like a wiki's
    edit throughput. (Empirical question per partner: what IS GBIF's / COL's
    correction channel and turnaround?)
    First empirical data point, and it's worse than the caveat: IUCN's
    posture (June 2026 email, entry 3 addendum) is per-site correction in
    both directions — no intake channel, no outflow channel, "report it to
    Wikipedia editors." The arbitration loop needs partners who have a
    door; some partners have a mail slot.
  - Open question, honestly open: is that *more* editor agency (your fix
    lands everywhere at once, 400k articles) or *less* (you can't just fix
    the page in front of you)? Both, probably; the post shouldn't pretend
    otherwise.
- ~~The degradation ladder as deployment-time source choice~~ — **scoped
  out, precisely** (LV, 2026-08-07): assume key availability is *uniform*
  across installs — either every install can get the key or none can. So
  each keyed partner is a binary decision (in, with terms read and quoted
  at the call site; or out entirely), and the heterogeneous case
  ("install 1 has a key, install 2 doesn't" → two honest deployments
  rendering different boxes) is out of scope. Terms-reading and the
  in/out decision stay fully live. What survives the scoping:
  **per-render receipts** ("this page consulted these sources") is still
  the right disclosure shape, and enwiki's hand-crafted layering (Amanita
  IUCN→NatureServe, Dog "Domesticated", entry 3) is still post material
  under the requirements-spec theme.
- **The hand-crafted corpus is the requirements spec** (LV, 2026-08-07,
  from experiment 2's gap-list measure): 400k hand-maintained infoboxes are
  themselves a dataset — the union of what editors chose to display tells
  you which data partners a data-driven box needs next (NatureServe, CITES,
  national lists…). "Systematic audit of articles for new datasets" may be
  a standing activity of any hand-crafted → data-driven migration, not a
  one-time gap list: the old boxes are the spec the new pipeline is audited
  against. Sharpened 2026-08-07: the spec covers *reference structures*
  too, not just data — enwiki's {{cite iucn}} refs carry the assessment ID
  and DOI that Wikidata's P141 references lack (entry 3 amendment). (Note the symmetry: experiment 1 audited *our* sources against
  enwiki's box; this flips the same diff into a partner-acquisition
  roadmap.)
  - Candidate line for the post (LV): **"the hand-crafted work+content
    doesn't become obsolete, it evolves"** — the editors' accumulated
    judgment becomes the test suite, the requirements spec, and the
    arbitration record of the data-driven version. Possibly the answer to
    the editor-autonomy theme too: the two themes may be one theme.

- **The data shift displaces secondary sources toward primary-ish ones**
  (LV, 2026-08-07 — "almost a whole post in and of itself"; maybe more
  for the book case than the species case). Wikipedia's epistemology is
  built on secondary sources (WP:PSTS); a database-fed box quietly swaps
  that chain for primary-ish records: iNat photos are primary
  observations, GBIF occurrences are aggregated primary records, the BHL
  card is literally *the* primary document, where the hand-written
  article cites field guides and monographs. Notes toward the spin-off
  post:
  - The gradient isn't binary: IUCN categories are expert *assessments*
    (secondary-ish), GBIF's backbone is a tertiary synthesis, raw
    occurrences are primary. The derived/transcribed/native taxonomy
    (entry 1 correction) crosses this at an angle — two axes, maybe a
    2×2.
  - enwiki already tolerates the exception in this corner: the taxobox
    is database-fed in practice (taxonomy templates, IUCN cites) while
    the prose stays secondary-sourced. The box was always the most
    primary-ish part of the article.
  - Book case is sharper: catalog/authority records vs. the review and
    scholarship literature — what's lost when the record replaces the
    reading. Park for that post.

## Experiment queue (cheapest first; append entries as run)

1. ~~Classification + binomial + authority~~ — **run, see entry 2.**
   Remaining: render it (needs the box scaffold). CC BY → credit line
   required.
2. ~~Conservation status~~ — **run, see entry 3.** Was: tests whether a
   *transcribed* copy of a closed database is good enough — and whether we
   can even tell. Measures:
   (a) coverage, local — 8/12 test articles have P141. NOT just "omit the
       row elsewhere" (LV pushback): absence has kinds, and the claims may
       let us tell them apart by rule. Candidates: **P627 present + P141
       absent** = IUCN knows the taxon, verdict never transcribed → a
       Wikidata gap, in principle a worklist; **both absent** + rule-out
       signal (fossil, kingdom IUCN doesn't assess) = structurally not
       applicable; and NE / DD are IUCN *categories*, not absences — a
       taxon can be positively "Not Evaluated." Test: do these rules
       partition our 4 no-status taxa correctly? (House rule applies:
       absence of evidence ≠ a principle.);
   (b) coverage, systemic — WDQS count of taxon items with P141 = the
       scale claim vs. 400k articles;
   (c) agreement — Wikidata's status vs. what enwiki's box displays;
       status rows are in the taxobox HTML already cached. Monarch is the
       hard case: "Endangered monarch" headlines = the *migratory
       subspecies* assessment; species-level = LC. What does each box
       show?
   (d) auditability — when copies disagree, IUCN's API can't referee
       (closed). What do P141 references carry (assessment date?
       point-in-time? assessment ID?) — can we at least *date* our copy?
       This is transcription's structural weakness (see entry 1
       correction);
   (e) link construction — Red List deep links are
       /species/{taxonId}/{assessmentId}; P627 has only taxonId. Working
       receipt link from claims alone, or search-URL fallback?
   (f) gap list — status systems enwiki shows that P141 doesn't:
       NatureServe, CITES, national lists (from cached HTML). Bigger than
       a limitation list (LV): see themes — the hand-crafted corpus as
       requirements spec.
3. ~~Original description as document~~ — **run, see entry 4.** (GBIF links
   the work not the page; images keyless; rights/resolution need the free
   API key = ordinary keyed-partner pattern, BHL_API_KEY as Fly secret.)
4. ~~Male/female + adult/juvenile photo pairs~~ — **run, see entry 5.**
   (Vocabulary verified; pair type must be clade-branched; "ask, then
   render" with count probes; media-type guard needed.)
5. Sound (bird only) — xeno-canto via P2426 slug already on the Wikidata
   item. v3 API needs a free key → ordinary keyed-partner pattern (used
   when configured, silently absent keyless), like DPLA/Europeana.
6. ~~Range map~~ — **run, see entry 6.** (Gap bounded: expert
   shape-drawing is the closed part, and enwiki's maps are stale
   hand-copies of it; capabilities endpoint solves zoom-to-extent;
   ad-hoc/seasonal endpoint unreliable; never hotlink it.)
7. ~~Synonyms~~ — **run, see entry 7.** (More data, worse display: dumps
   are noisy, synonyms attach to the accepted name; honest render = count
   + receipt link. Proposed follow-ups A–E after entry 7.)
