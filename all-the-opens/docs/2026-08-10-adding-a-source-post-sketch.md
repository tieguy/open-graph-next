# friendsof.wiki: adding an open collection

One key goal of [Friends Of](https://friendsof.wiki) is for me to learn about (and show) the potential connections between open knowledge. One key mechanism for that so far has been the literal process of adding new sources -- sixteen so far.

## Part 1 — the shape of the job

If you want a step-by-step guide, full playbook lives [in the repo](https://github.com/tieguy/open-graph-next/blob/main/all-the-opens/docs/adding-a-source.md). TLDR:

1. **Investigate the partner before writing anything.** There are both technical gotchas (a host that answers a real record id and an invented one identically is refusing robots, not hosting broken links) and legal ones (non-commercial terms on an API block reuse even when they permit a demo).
2. **Pick which of three shapes the partner is.** There are (so far) three main types of partners: (1) **identifier:** Wikidata stores the partner's own id for a thing the article links, like the Met's id for an individual painting; (2) **search:** Wikidata stores something searchable, like the subject heading a library filed its items under; (3) **custom:** the partner fits neither, and forcing it into the first two shapes produces worse code than accepting the exception.
3. **Write some code files.** Adding a partner currently touches six to eight files. I'd like to shrink that, but the wiring has already been through two refactorings, and each new partner really does bring its own knowledge: how its records are keyed, what its rights fields mean, what its host permits.
4. **Render real articles and read the cards.** Every partner bug we have found was found by a person reading a rendered page; none was found by a passing test. So the last step is always rendering real articles and reading them.

## Part 2 — pitfalls

- **Bot mitigation makes healthy links look dead.** A link audit reported 431
  DPLA links dead. All 431 worked in a browser, because DPLA's firewall
  answered our client's real ids and impossible ids with the same page.
  Without the invented-id control, a consumer cannot distinguish a host that
  refuses robots from a link that rotted — which also means a naive
  link-checker audit of open collections would report mostly false rot.
- **The problem is often anchor supply, not the API.** When we measured the
  Rembrandt article (2026-08-06), 35 of its links carried a museum
  identifier, 14 of those 35 survived the step that strips HTML tables, 3 of
  the 14 reached the museum lookup, and 2 of the 3 rendered as cards. The
  Met's API answered correctly at every step, so blaming the API would have
  fixed nothing. The fix was also not to loosen the table-strip, which keeps
  navboxes off every page: we stopped routing the question through the
  article's links and instead ask Wikidata directly what the artist made,
  which raised Rembrandt's museum cards from 2 to 11. Diagnose the funnel
  before blaming the partner.
- **Modeling is complex (good), which makes every new integration complicated and error-prone (bad).** CVMA GB's catalog of 28,135 stained-glass photographs has matched zero Wikidata
  items, and the catalog does contain a real modeling error (it types entries
  as the material rather than as windows). Fixing that error would produce
  almost no matches, because the United Kingdom has 87 stained-glass-window
  items in Wikidata against those 28,135 photographs, and because the
  material vocabulary splinters: counting the material statements on window
  items worldwide, "clear glass" appears 2,555 times, "lead" 699, "plain
  glass" 693, and "stained glass" itself 84 — so even the correct property,
  queried with the obvious value, misses nearly everything. I had written the
  wrong diagnosis into the playbook, and it survived two months because the
  diagnosis was plausible and nobody counted the targets. The order that
  catches this in one pass: count the target items, then check the property,
  then check the value vocabulary.
- **Archiving is a real use case.** cvma.ac.uk is a cool site, and also now dead. The archive moved to ADS York under CC BY 4.0, all 28,135 catalogued URLs return 404
  (real ids and invented ids identically), no redirect points to the new
  home, and no Wikidata property exists to record the new ids. The
  collection became more open and less reachable in the same migration.
- **Ranking is hard — and a facet query doesn't do it for you.** DPLA
  returned 60 items for the heading "Armstrong, Neil, 1930-2012", and about
  50 of the 60 were genuinely about Apollo 11. Because a facet query has no
  relevance order, and because we initially displayed the first page it
  returned, the four cards we showed were the only junk in the set — a
  poster, a portrait, a balloonist, an exposition record, and no moon. We
  rank and deduplicate locally now.
- **Rights metadata often describes a different object than the one you
  show.** Three traps with one rule. A Rijksmuseum record states two Creative
  Commons URIs, and the CC0 one covers the catalog text rather than the
  picture, so printing it as the picture's
  license promises more than the museum granted. Open Library files a 1991
  scholarly catalog under Rembrandt, so a creator-level public-domain ruling
  about Rembrandt rendered a public-domain mark on a book with three living
  authors. DigitalNZ publishes capability words ("Share", "Modify") rather
  than a license, so a CC0 glyph there would assert a permission nobody
  granted. The rule that threads all three: a mark is never a guess.
- **Politeness is specific, published, and checkable.** Our per-host request
  limit defaults to 1 and rises only when the host publishes a policy, which
  we quote next to the limit. DPLA publishes "the DPLA will not restrict or
  rate-limit the use of its API," so DPLA runs at 4 concurrent requests. The
  Library of Congress publishes `Crawl-delay: 3`, so it stays at 1 and we made
  each request cheaper — a HEAD that reads one header instead of a GET that
  downloads a 100 KB record. HathiTrust serves public-domain scans keylessly
  and disallows `/cgi/` to every crawler except Twitterbot, which is why the
  playbook checks robots.txt before fetching any asset. Even favicons need
  verification: openalex.org answers its favicon URL with HTTP 200 and an
  HTML error page, and that page shipped as OpenAlex's icon because a
  size-only check passed it.

## Part 3 — the commentary

- **Roughly half the cost of consuming "open" is paid on the consumer side,
  for problems only publishers can fix.** Sort the pitfalls above into two
  piles. One pile is ordinary software cost — picking anchors, ranking a
  shelf, diagnosing my own funnel. I would pay that pile against any API, and
  what I fix there stays fixed in my repo. The other pile belongs to the
  ecosystem: a firewall that answers real and invented ids identically, a
  migration that breaks all 28,135 published URLs at once, rights fields that
  describe the catalog entry rather than the picture, thumbnails served from
  hosts that block hotlinking. My code can detect each of these, and can
  route around some of them, but it removes none of them — and the workaround
  I ship helps only this site, while every other consumer rediscovers the
  same pile by hand. A publisher who fixes one of these fixes it for every
  consumer at once. These collections are open by license; consuming them
  stays expensive for reasons the license does not control.
- **What would partners publish for this to be a 30-minute job?** A stated
  rate limit, even when the statement is "none" (DPLA already does this). A
  rights field in a standard vocabulary (IIIF already requires one). A
  documented id-addressed URL scheme that shows what a miss returns. A
  thumbnail URL on the partner's own host, because aggregator thumbnails
  point at hundreds of provider hosts that rot and block hotlinking. Praise
  the partners that already do each by name.
