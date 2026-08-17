# Holder-page QA window — 2026-08-17

The hand QA window Phase 7 requires before any broad flag-on: 45 articles
sampled from the checked-in census
(`docs/data/2026-08-17-holder-census.json`, queried 2026-08-17 — 1,424
items), every wired holder represented, weighted toward the biggest lanes.
Each was rendered flag-on with the batch renderer
(`HOLDER_PAGE=1 node spike.js "<title>"`), first cold and then warm, and
checked against the five criteria below. Sampling was deterministic:
census items attributed to a holder by the real `selectHolder` (the
census file's own rule), sorted by QID, evenly spaced per lane.
**The full sample — all 45 titles with lane and verdict — is checked in
beside the census as `docs/data/2026-08-17-holder-qa-sample.json`**, so
any row here can be re-rendered and re-checked, and the same 45 can be
re-run after the IIIF-lane decision to see what moved.

## Per-holder coverage

| lane | census items (2026-08-17) | sampled | holder pages | gate refusals |
|---|---|---|---|---|
| met | 493 | 10 | 8 | 2 non-pd-rights |
| iiif (door) | 680 | 14 | **0** | 8 no-record · 5 no-institution · 1 non-pd-rights |
| rijks | 124 | 6 | 6 | — |
| artic | 66 | 5 | 2 | 3 non-pd-rights |
| getty | 56 | 5 | 5 | — |
| cleveland | 5 | 5 (the whole lane) | 4 | 1 non-pd-rights |
| **museum lanes** | **744** | **31** | **25 (81%)** | **6 (19%), all non-pd-rights** |

The census also records `subclassControl: 35` — enwiki work-articles
whose subject is P31 of a *subclass* of painting/sculpture only, carrying
a holder property. That is the measured cost of the direct-P31 narrowing:
35 articles (~2.4% of the population the walk would reach) get no holder
page today. The flag recommendation below stands with or without them.

## The five checks

**1. Right object.** On all 25 holder pages the selection id printed by
the pipeline (`holder page: … (<property> <id>)`) equals the census row's
identifier, and on the met/artic/getty/cleveland lanes the hero's `href`
carries that same id. The Rijksmuseum lane is the designed exception —
its object page is keyed by accession number, not by the Linked Art id
the graph states (`rijksPageUrl`), so the round-trip there is the
selection-id match plus the museum-stated page URL, and all 6 held.

**2. Rights honored.** Every gate refusal in the museum lanes is a
modern work the museum does not flag public-domain: La Vie (painting),
by Picasso; Ariadne (Giorgio de Chirico); In the Magic Mirror, by
Klee; Untitled (Rückriem); Rearing Horse and Mounted Warrior; and A
Chemist Lifting with Extreme Precaution the Cuticle of a Grand Piano,
by Domínguez — bare parentheses are part of the census title. The iiif
lane's fourteen refusals are mostly record and institution failures,
tallied per leg in its own section below. Every one of the sample's
twenty refused articles rendered as an ordinary page: no hero image
from the museum, no two-party masthead, no panel (verified by markup
grep, `<table class="infobox holder-panel"` and `This page: Wikipedia +`
both absent). No featured image appears anywhere the museum's own flag
was not CC0/PD.

**3. Panel sane.** All 25 panels attribute rows (Wikipedia chip on
Wikipedia's rows, the institution's name on the museum's), and 19 of 25
show at least one visible side-by-side conflict pair (the warm renders
count 2–8 `infobox-conflict` cells each). Spot-read conflicts are
genuine two-party disagreements — e.g. Irises: Year "May 1889"
(Wikipedia) beside "1889" (Getty); Dimensions "71 cm × 93 cm…"
(Wikipedia) beside "Unframed: 74.3 × 94.3 cm…" (Getty). No row claims a
field neither side stated (Getty rows never claim a credit line — that
field is honestly absent from its record surface).

**4. Clean degradation.** Two articles were rendered with their holder
record forced to fail (the cached record response replaced by `{}`,
restored after): Northeaster (painting), a Met page, and Portrait of
Lady Manners, a Cleveland page. Both fell through the gate on the legs
the planted record earns (`non-pd-rights` and `no-record`) and
rendered as full ordinary pages — the partner fan-out visibly resumed
(id.loc.gov, api.dp.la, api.digitalnz.org, api.europeana.eu in the
tally) — with no holder furniture and exit 0. No error surfaced to the
page. After restoring the cache both select their holders again.

**4b. Stubs lead too.** Four short-lede articles in the sample (Fishing
for Souls at 142 prose characters, Radha and Krishna…, Portrait of
Talleyrand, The New Bonnet, all under 230) each carry the holder hero
float in the lede — `FLOAT_MIN_PROSE` does not suppress it, per the
Phase 3 exemption.

**5. Single-source discipline.** The plan's grep, run over all 25
holder renders: every partner host from the manifest (`src/partners.js`
`hosts`), excluding the page's own holder, matched against each
render's bytes. **42 URL occurrences, and all 42 sit inside the
article's own footnote bodies (`fn-text`) — zero in enrichment markup**
(cards, legend, hero, panel, decks; classified by nearest preceding
structural class, spot-checked by hand: archive.org and doi.org copies
Wikipedia's own citations link, a getty.edu monograph the Cleveland
Apollo article cites, and so on). Footnotes render Wikipedia's own
`reference-text` verbatim by design, so those URLs are the article's,
not the enrichment's. The legend agrees: every one of the 25 names
exactly two parties, Wikipedia and the holding institution — and the
legend is built from `sourcesUsed`, which counts band entries, so the
grep is the wider instrument and the legend the reader-facing one.
The request-level version was measured cold on one acceptance article
per new lane when it was wired (dated in the wiring commits): The
Night Watch touches en.wikipedia/wikidata/WDQS/id.rijksmuseum.nl only;
The Brierwood Pipe adds only openaccess-api.clevelandart.org; Irises
only www.getty.edu. The degradation renders above are the control: the
moment the gate fails, the foreign hosts return.

## The iiif lane, measured at sample scale

0 of 14 manifest-held articles cleared the gate. Per failure leg:

- **no-record 8** — the manifest URL the graph states no longer answers
  with a parseable manifest (hosts moved, endpoints retired; the
  both-ids-alike control from `reaching-open-collections.md` applies to
  several of these hosts).
- **no-institution 5** — the manifest parses but does not name exactly
  one institution (`provider`/`logo` absent or plural), and the design
  forbids a masthead reading "Wikipedia + IIIF collections".
- **non-pd-rights 1** — the manifest states no open rights.
- **several-institutions 0** — an observed zero: six manifests parsed
  and reached the institution leg (14 minus the 8 `no-record`), and
  none named a plural provider.
- **no-image 0 · no-object-page 0** — not reached in this sample. The
  gate stops at the first failing leg, and the one manifest that got
  past the institution leg stopped at rights, so neither leg was
  evaluated here — no evidence either way.

This confirms the Phase 2 inspection window (0 of 30) at a second,
independently drawn sample: the door is real but almost no manifest
publishes what a two-party page needs. The cost of leaving the lane
wired is one manifest fetch per iiif work-article before the page falls
back to ordinary; the fallback itself is the correct page. The
IIIF-lane decision (accept the 0%, relax a leg, or defer the lane) is
the operator's standing item and is not changed by this window.

## Defects found

None in the pipeline. Every article in the sample rendered either a
correct holder page or a correct ordinary page; no crashes, no wrong
objects, no rights violations, no foreign partners on holder pages.
(The QA driver itself had two bugs during the window — it initially
read the render path from the wrong stream and then matched the panel's
stylesheet rule instead of its markup — both fixed before any number
above was read; they never touched shipped code.)

## Recommendation

**Default on for work-articles.** The museum lanes behave correctly in
all 31 sampled cases — 25 holder pages that pass every check, 6 correct
refusals for modern works — and the iiif lane degrades to the ordinary
page at the cost of one fetch. The one open question that should be
decided *before* the default flips is the standing IIIF-lane item
(0/44 across both windows now: accept, relax, or defer); flipping the
default without deciding it is safe but bakes the extra manifest fetch
into half the population (680 of 1,424 census items are iiif-only).

Per the plan, no production default was changed in this phase — the
decision is the operator's, on this document.
