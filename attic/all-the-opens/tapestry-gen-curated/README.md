# tapestry-gen

Renders the Apollo 11 dataset in `data/apollo-11/` as *"the article,
enriched."* Two outputs from one run: `demo/apollo-11.html` (self-contained
render) and `../tapestry/apollo-11.tapestry` (the Internet Archive Tapestry
format — retained but secondary). All render output is gitignored — the public
demo is the **live streaming server** (`npm run serve`, deployed at
help-from-our-friends.fly.dev); nothing pre-generated is committed.
Design: `docs/design-plans/2026-07-23-article-tapestry.md`. Intent and contracts:
`CLAUDE.md`.

One dependency: [m3api](https://www.npmjs.com/package/m3api), the minimal
MediaWiki API client, which owns the User-Agent, maxlag and retry rules for
every Wikimedia request (see `src/mw.js`). Node 22+ (uses `zlib.crc32` and
built-in `fetch` for the non-MediaWiki sources).

```
npm run generate    # writes demo/apollo-11.html and ../tapestry/apollo-11.tapestry
npm test            # no network
```

Then just open `demo/apollo-11.html` in a browser — it is self-contained (and
local only; `demo/` is gitignored). (To
view the `.tapestry` instead: `python -m http.server 8000 -d ../tapestry` and open
`viewer/?source=../apollo-11.tapestry`.)

## HTML render

The primary output. A single scrolling page: a two-column reading spine (article
left; the ecosystem's media and cited sources in a right rail), media grouped into
per-source horizontal carousels labelled with each source's own favicon, and the
section's **selected sources** ranked by reachability — a borrowable/readable book
first, then an archived page, then a DOI, then a bare live link. Cited books link
to their Internet Archive copy; OpenLibrary covers are inlined as data URIs (they
redirect through archive.org, so a live link would break when IA is down); OSM
place items get keyless `maps.wikimedia.org` map thumbnails. Built by
`src/emit-html.js` over the same model the Tapestry emitter uses.

## Status: phases 1–3 (spine + media + citations); rendered to HTML

The sections below narrate how the Tapestry render was built phase by phase; the
pipeline they describe is unchanged and feeds the HTML render too.

The spine carries the article's full prose, and every dataset item renders as a figure —
picture plus a caption stating why it landed where it did. Making the placement rule
auditable at a glance is the point of the spine.

Phase 2 adds resolved media. **Internet Archive footage and audio play in place** (native IA
players via a `webpage` item with `webpageType: iaVideo`/`iaAudio` — the viewer builds the
player from the details URL, so no file-picking or CORS bundling). Commons images and every
article lead image now carry **licence and author**, pulled from `imageinfo`'s `extmetadata`
in the same call that sizes them. OpenLibrary and Smithsonian items resolve to **real covers
and object photographs**.

Phase 3 fills the **left gutter with each section's evidence**. A section's citations live
inline in its wikitext as `{{cite …}}` templates inside `<ref>` tags, so they carry their own
section attribution — no cross-referencing the footnote list. They are capped (three per band)
and ranked so the gutter stays legible: books first (an OpenLibrary cover is the most legible
thing a 320px box can hold), then archived sources. A book with a real cover shows it; every
other source is a quiet card — kind, title, publisher — with its link (the Wayback copy where
one exists, which is most of them) in the item's notes. Remaining phases: rels and legend;
prologue and coda.

**Re-curation (the real cost of phase 2).** Resolving the media exposed that the dataset's
external identifiers were fabricated wholesale: the Internet Archive, OpenLibrary and
Smithsonian landing URLs were plausible but pointed at nothing — or, for OpenLibrary, at
unrelated works (a work titled "Carrying the Fire" that is actually a French treaty on
Sudanese–Egyptian integration). The D3 demo never noticed because it only renders thumbnails
and never dereferences a landing page. **Wikipedia and Commons items are genuine**; the
fabrication is confined to the three sources nobody dereferenced. Each fabricated IA/OL/
Smithsonian item has been replaced with a verified real one (see the dataset's git history).
All five Smithsonian items resolve to real pictures. The command module, suit and V-2 use NASM
object photos (`ids.si.edu`); the crew hatch and the Command Module 3D scan use the poster
derivatives named in each Voyager `scene.svx.json` manifest on `3d-api.si.edu`. The main
`3d.si.edu` site blocks scripted fetches, but the asset host serves those images with
`Access-Control-Allow-Origin: *`, so they draw directly.

## How placement works

Nothing is positioned by hand. An item lands in a section because the article's own
wikilinks put it there.

| tier | rule |
| --- | --- |
| seed | the article's subject is pinned to the lede — an article never wikilinks itself |
| 1 | the item's Wikidata QID matches a QID that section wikilinks, **body sections before the lede** |
| 2 | the item is connected in `connections.json` to a tier-1 item |
| prologue | every edge is backed *only* by geographic authorities, and every edge is a `location` edge — a pure place |
| coda | place-only, but takes part in `subject` edges — a topic that merely sits at those coordinates |
| unreached | no wikilink and no path to anything wikilinked |

Two subtleties worth keeping:

- **Place-only items are set aside *before* tier 2 runs.** Otherwise the OSM entries get
  absorbed into whichever section happens to mention the launch site, and the prologue
  disappears.
- **Body sections are matched before the lede.** The lede summarises the article, so it
  wikilinks nearly every entity the body discusses. Matching it first dragged most of the
  dataset into the opening band and left the rest of the spine empty — the lede went from
  roughly half the canvas to 6% of it.
- **Place-only is decided by authority tokens, not edge `type`.** The Sea of Tranquility is
  joined to the moon landing by a `location` edge, but that edge is also backed by Wikidata
  — a claim about what it is, not merely where. Testing `type` alone would exile the landing
  site to the coda.
- **The lede's link set includes the infobox.** The infobox is structurally section 0, and
  many articles link a key fact — a launch pad, a landing site — only there, because the
  prose leaves it to the box. `infoboxLinks` folds those wikilinks into the lede so they can
  place items, with no per-article special-casing. (On Apollo 11 this adds nothing visible:
  the infobox names *Tranquility Base*, which the body already links; but it is where such
  links live on other articles.)

**A deliberately literal limit.** Matching is on the item's *exact* QID, so an item is placed
only where the article links *its* entity. When the article discusses a closely related but
distinct one, the item falls back to a weaker signal rather than being force-matched — e.g.
the dataset's Sea of Tranquility (`Q37699`, the mare) is never wikilinked; the article links
*Tranquility Base* (`Q732758`, the landing site within it) throughout, including §19 Landing.
So that item lands in the lede via a tier-2 connection rather than in the Landing section.
Widening matches to Wikidata neighbourhoods (`part of`, `located in`) would place such items
more precisely but risks false anchors, so matching is kept literal and general.

## Current coverage

From the last run over 36 items:

```
tier 1 (direct wikilink)        9  25%
tier 2 (via connection)        15  42%
prologue (pure place)           2   6%
coda (subject at that place)    3   8%
unreached                       7  19%
```

**Two thirds of the dataset is placed by the identifier graph alone**, which is the
assumption the whole design rested on.

The 19% unreached is a dataset property, not a generator bug. Five of the seven
(`ia-apollo11-audio`, `ia-nasa-apollo11-press-kit`, `smithsonian-3d-collection`,
`smithsonian-crew-hatch`, `smithsonian-v2`) appear nowhere in `connections.json` at all —
neither as source nor target — so no graph rule can reach them. The other two
(`wiki-wernher-von-braun`, `wiki-v2-rocket`) form a small cluster connected to each other
but not to anything the article's top-level sections wikilink. They render in an "Out of
reach" band rather than being dropped: where the identifier graph runs out is part of what
this demo is arguing about.

Only 16 of 36 items have a Wikidata QID, and that is expected — QIDs are derived from an
item's Wikipedia URL, so only Wikipedia-sourced items have one. Everything else reaches a
section through tier 2.

## Pictures, and why the dataset's thumbnails are dead

Phase 1 shows real images by reusing the dataset's thumbnails — but most of those URLs no
longer work (verified 2026-07-23):

| source | count | state |
| --- | --- | --- |
| Wikimedia | 20 | **were dead** at the stored width — recovered via the API |
| Smithsonian | 5 | **were fabricated** — re-curated; all 5 show real object photos or 3D-scan posters |
| Internet Archive | 4 | 3 were fabricated; re-curated, and now render as players, not stills |
| OpenLibrary | 3 | **were fabricated** (unrelated works, one cover shared by two) — re-curated |

Wikimedia now restricts thumbnail rendering to an allowlist of widths, answering anything
else with `400 Use thumbnail sizes listed on https://w.wiki/GHai`. Every `200px-` and
`220px-` URL in the dataset is therefore broken — **including in the D3 demo, which renders
the same URLs.** Fixing the dataset (now `data/apollo-11/`; the D3 demo read the
same files before it moved to the attic) would fix both.

**Pictures come from each article's own lead image** (`prop=pageimages`) rather than the
dataset's thumbnail, because the dataset's are not reliably distinct — several items point
at different crops of the same iconic photograph, so Apollo 11, the Moon landing and Buzz
Aldrin all rendered as the same visor portrait. Non-Wikipedia items fall back to the
dataset thumbnail resolved through the Commons API.

**Images from hosts without CORS are bundled into the zip.** The viewer draws images as
WebGL textures, which browsers refuse for cross-origin images served without
`Access-Control-Allow-Origin`. Wikimedia and OpenLibrary send `*`; `archive.org` sends
nothing, so its four images are downloaded and written into the `.tapestry` as
`img/…` entries referenced by `file:/`, which the import service resolves to same-origin
blob URLs. This is what the `file:/` prefix is for.

The lesson is to never construct a thumbnail URL. `fetchImageInfo` asks the API for
`iiurlwidth=1280` and uses the `thumburl` it returns, which is valid by construction and
carries true dimensions in the same response — so portraits get portrait boxes instead of
being squeezed into a landscape guess. Every usable picture now renders — 32 of 32 after
re-curation, with no caption-only items left.

Smithsonian object photos come from `ids.si.edu`, which sends `Access-Control-Allow-Origin:
*`, so they draw directly with no bundling. A Tapestry image is drawn to fill its box, so a
box whose aspect does not match the picture stretches it. Wikimedia gives dimensions through
the API; for OpenLibrary covers and Smithsonian photos, which do not, `imagesize.js` reads
the true dimensions from the JPEG/PNG header (from the same fetch that rejects OpenLibrary's
placeholder covers). Nothing is guessed, so nothing is squashed — a portrait cover gets a
portrait box.

## Layout

Three lanes: citations at `x=-520` (empty until phase 3), the article spine at `x=0`
(860px wide), and media at `x=980`. Bands stack top to bottom with the first entry as a
1000px hero and the rest 480px two-up, each flowing into whichever column is shorter.

**Total width is a legibility budget, not a free choice.** The viewer scales `startView` to
fit the viewport, so every pixel of canvas width shrinks the prose: at 2900px wide the 26px
body text rendered at about 12px on a 1400px laptop. The opening view now frames only what
the first band actually drew — skipping the empty citations lane, which alone wasted 600px
— and grows in height, never width, to reach a landscape aspect. That puts the body text at
roughly 17px on a 1400px screen and 21px at 1680px, which a test guards.

**The spine carries the article's full prose**, not a summary sentence, at 26px — a single
line cannot hold its own beside a 1240px photograph.

**Bands follow subsections, not just top-level sections.** Taking only top-level sections
made "Mission" a single 29,888px band holding 39% of the canvas, which no presentation step
can usefully frame. Following the article's own subdivisions gives 36 bands with a median
height of ~1,800px. A parent section's prose is trimmed to its intro, since the API returns
a parent's subsections inside its own fetch and the text would otherwise appear twice.

Each band is a Tapestry `group` with a matching `presentation` step. **Arrow keys only work
once something is selected** — `usePresentationShortcuts` reads
`interactiveElement.modelId ?? selectedGroupId` and does nothing when both are empty. Click
any card first, then arrows walk the bands. The format has no "initially selected" field,
so this cannot be preset.

## Files

| path | role |
| --- | --- |
| `generate.js` | pipeline entry point and the coverage report |
| `src/dataset.js` | loads the shared dataset; undirected adjacency; hop distances |
| `src/wikipedia.js` | sections, prose, wikilinks, QIDs, lead images, infobox links, section wikitext — all disk-cached |
| `src/resolve.js` | phase-2 media resolvers (Internet Archive players) |
| `src/citations.js` | phase-3 citation extraction from wikitext, ranking, and link/cover resolution |
| `src/imagesize.js` | reads true image dimensions from JPEG/PNG headers, so boxes are not guessed |
| `src/bundle.js` | downloads CORS-less images into the zip |
| `src/place.js` | the placement rules |
| `src/layout.js` | all geometry |
| `src/emit.js` | v7 document construction and card HTML |
| `src/zip.js` | minimal deterministic ZIP writer |
| `vendor/parse-root.mjs` | bundled upstream `parseRootJson`, used to validate output before writing |

`vendor/parse-root.mjs` is built from the upstream monorepo — see `tapestry/README.md` for
provenance. It exists so the generator validates against the real parser rather than
against our reading of the schemas; `generate.js` refuses to write a file that fails it.

## Caching

Every Wikipedia API response is cached under `.cache/` (gitignored), keyed by request URL.
Reruns are offline and byte-reproducible, matching the project's existing "pre-cached data
over live APIs" decision. Delete `.cache/` to refetch.

`createdAt`/`updatedAt` are pinned to a constant and the ZIP uses a fixed timestamp, so the
same inputs always produce the same bytes.
