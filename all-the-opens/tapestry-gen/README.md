# tapestry-gen

*"The article, enriched."* Give it any English Wikipedia article title and it
renders that article as a reading spine, with the open ecosystem's media and
the article's own cited sources placed by the article's own anchors — its
wikilinks and footnotes, resolved through Wikidata QIDs and authority
identifiers. No dataset, no per-article code.

The demo is live at **https://help-from-our-friends.fly.dev/**.

One dependency: [m3api](https://www.npmjs.com/package/m3api), the minimal
MediaWiki API client, which owns the User-Agent, maxlag and retry rules for
every Wikimedia request (see `src/mw.js`). Node 22+ (uses built-in `fetch` for
the non-MediaWiki sources).

```
WIKIMEDIA_UA_CONTACT=you@example.com npm run serve   # the website, localhost:8787/wiki/<Article>
WIKIMEDIA_UA_CONTACT=you@example.com npm run spike "Angkor Wat"   # one self-contained HTML file
npm test                                             # no network
```

`WIKIMEDIA_UA_CONTACT` has no default on purpose: anyone can clone this, and a
baked-in address would attribute their traffic to someone who never ran it.
Set it to your own. See `CLAUDE.md` for the full Wikimedia compliance rules —
they are not optional.

## The two entry points

**`serve.js`** is the website. One chunked HTML response per page: the article
spine renders in about a second, and each section's enrichment streams in
behind it as its own pivots answer. No client framework — the stream is the
page.

**`spike.js`** writes the same page as a single self-contained file, images
inlined, named for the article it actually resolved (`"Coral_Gables"` gives you
`demo/spike-coral-gables-florida.html`). It is also how the discovery pipeline
is tested: nothing unit-tests `discover()`, so a warm re-render is expected to
be byte-identical, and that is how a regression shows up. `demo/` is
gitignored.

## HTML render

A single scrolling page: a two-column reading spine (article left; the
ecosystem's media and cited sources in a right rail), media grouped into
per-source horizontal carousels labelled with each source's own favicon, and
the section's selected sources ranked by reachability — a borrowable or
readable book first, then an archived page, then a DOI, then a bare live link.
Cited books link to their Internet Archive copy; OpenLibrary covers are inlined
as data URIs (they redirect through archive.org, so a live link would break
whenever IA is down); map tiles are fetched server-side and inlined, never
hotlinked. Built by `src/emit-html.js`.

Every Wikidata-backed card carries a provenance fold stating the exact chain
that produced it and linking the statement it rests on — because Wikidata's
statement anchor is also its edit button.

Above the article, a panel says which of the partners on the page the article
itself can show, which get a link, and which are invisible — measured against
the article's own templates, pictures and external links, which ride along on
the parse request the spine already makes. `src/gap.js`; the argument is
LUI-122. **Wikimedia Commons is not one of the partners** (2026-08-04): it is
Wikipedia's own household rather than a friend, it was ~85% of every page's
cards, and shelving it beside the Met implied the two were peers when Commons
is in fact the single door an outside institution's work must pass through to
be seen at all. It now appears only in that panel, named as the door.

## Caching

Every response is cached under `.cache/` (gitignored), keyed by request URL.
Reruns are offline and byte-reproducible. Delete `.cache/` to refetch.

## History

This began as a renderer for a hand-curated Apollo 11 dataset, with a second
output in the Internet Archive Tapestry format. Live discovery answered that
question — it renders the same article denser, for every article — so on
2026-08-04 the generator, the dataset, the placement rules and the Tapestry
emitter were retired to
`../../attic/all-the-opens/tapestry-gen-curated/`, which keeps that README and
its narrative. Nothing here reads a dataset any more.
