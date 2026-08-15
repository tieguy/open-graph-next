# friendsof.wiki: adding an open collection

Since the goal of [Friends Of](https://friendsof.wiki) is to learn about (and
show) the potential connections between open knowledge, an obvious place for me
to learn is the process of adding open collections. The site reads from sixteen
sources so far. This post shares the process and what adding those sixteen
taught me.

## Part 1 — the shape of the job

The full playbook lives [in the
repo](https://github.com/tieguy/open-graph-next/blob/main/all-the-opens/docs/adding-a-source.md),
and every commit that adds a source updates the playbook in the same commit. I
keep the playbook in git rather than in this post because a blog post freezes
on publish day while the process keeps changing — this post has already been
wrong about the file count once, and the repo doc corrected itself the same
day. Here I only summarize the shape:

1. **Investigate the partner before writing anything.** Six questions, and two
   of them can end the project: resolve one real record id by hand and one
   invented id, because a host that answers both identically is refusing to
   talk to you rather than reporting a broken link; and read the API's terms,
   because a non-commercial condition on the metadata blocks the goal even
   when it permits the demo. The other four: what rate limit the host
   publishes, what rights data the API exposes, whether a key is required, and
   what robots.txt allows.
2. **Pick which of three shapes the partner is.** If one Wikidata property
   names the partner's own record of a thing the article links, the partner is
   *direct-id* (the Met). If a property names something searchable and the
   result is a sample of a larger holding, the partner is *search* (DPLA). If
   neither, the partner gets hand-written code (the Smithsonian), and forcing
   it into the other two shapes produces worse code than accepting the
   exception.
3. **Write six code files, regenerate one, update two docs.** One of the six
   is a manifest entry that declares the partner's name, icon, hosts, and
   front-page credit in one place; a test fails if any of it is missing.
4. **Render real articles and read the cards.** Every partner bug in the
   playbook was found by a person reading a rendered page. No partner bug was
   found by a passing test.

## Part 2 — pitfalls, each with the incident that taught it

*Rule inherited from the issue: cite the evidence, never abstract into advice.
Ordered as an escalation: URL → identity → data → law → layers.*

- **You will guess a URL shape, and you will be wrong.** We shipped Rijksmuseum
  cards that linked `/en/collection/object/<numericId>`. That page does not
  exist for any object, because the museum keys its pages on accession numbers
  (`/en/collection/SK-C-5`). Readers got a 404 from a live card. The rule this
  produced: resolve one real id and one deliberately invented id before
  shipping, because only the invented id proves the server distinguishes a hit
  from a miss.
- **Your test will agree with your bug.** The original Rijksmuseum test
  asserted the broken URL, because the person who wrote the test held the same
  wrong assumption as the person who wrote the code — they were the same
  person. (Short section; it sets up the next post's testing theme.)
- **Bot mitigation makes healthy links look dead.** A link audit reported 431
  DPLA links dead. All 431 worked in a browser, because DPLA's firewall
  answered our client's real ids and impossible ids with the same page.
  Without the invented-id control, a consumer cannot distinguish a host that
  refuses robots from a link that rotted — which also means a naive
  link-checker audit of open collections would report mostly false rot.
- **The problem is often anchor supply, not the API.** On the Rembrandt
  article, 35 links carry a museum identifier, 14 of those 35 survive the step
  that strips HTML tables, 3 of the 14 reach the museum lookup, and 2 of the 3
  render as cards. The Met's API answered correctly at every step, so blaming
  the API would have fixed nothing. Diagnose the funnel before blaming the
  partner. *(Re-measure these four numbers on current code before publishing;
  the pipeline has changed since 2026-08-06.)*
- **The visible modeling error is not always the binding constraint.** CVMA
  GB's catalog of 28,135 stained-glass photographs has matched zero Wikidata
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
  - For the ecosystem pile: cvma.ac.uk is now a tombstone page. The archive
    moved to ADS York under CC BY 4.0, all 28,135 catalogued URLs return 404
    (real ids and invented ids identically), no redirect points to the new
    home, and no Wikidata property exists to record the new ids. The
    collection became more open and less reachable in the same migration.
- **An index with no ranking hands you its first page.** DPLA returned 60
  items for the heading "Armstrong, Neil, 1930-2012"; about 50 of the 60 were
  genuinely about Apollo 11; the 4 items we displayed were the only junk in
  the set, because a facet query has no relevance order and we took the first
  page. One line here and a link forward — the next post grows this incident
  into its own argument. *(Boundary decision still open: the DigitalNZ
  Trotsky/lunch-box incident currently lives in that post, not this one.)*
- **The pipeline works long before the page credits anyone.** DigitalNZ's
  first commit fetched records and rendered cards while the front page did not
  name DigitalNZ and no icon existed, because the credit lived in three files
  the commit deferred and no test checked them. The partner did the work and
  received none of the credit, and nothing failed. A manifest completeness
  test now fails when a partner lacks its name, icon, hosts, or front-page
  entry.
- **Rights metadata will try to make you lie.** Three traps with one rule. A
  Rijksmuseum record states two Creative Commons URIs, and the CC0 one covers
  the catalog text rather than the picture, so printing it as the picture's
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
- **Your own layers will drift.** Our page renderer's source table was
  imported by pipeline code once; then, in one week, a shelf-ranking function
  shared by two partners lived in one partner's module, and our shared Library
  of Congress code imported a function back out of the DPLA module. The
  instinct behind all three mistakes was correct — a learning should
  generalize across sources — but the code landed in a file named after one
  partner. A test now rejects imports in both directions: no partner module
  may import another partner, and no shared module may import a partner.

## Part 3 — the commentary (the point)

- **Ours vs. the ecosystem's.** Sort every Part 2 pitfall into two piles.
  Ours, fixable by better code: guessed URLs, tests that pin bugs, layer
  drift, missing ranking, missing credit. The ecosystem's, which no code of
  ours fixes: bot mitigation indistinguishable from rot, migrations that
  orphan every published URL, rights metadata that answers a different
  question than the one a reuser asks, keyed APIs that retire. The split is
  the argument: roughly half the cost of consuming "open" is paid on the
  consumer side for problems only publishers can fix.
- **The plugin question, answered twice — and the second answer contradicted
  the first.** The honest version of "why is there no plugin system": we
  refactored toward one twice, and the two refactors answered different
  questions. The first (2026-08-07) removed duplicated wiring by generating
  the lookup jobs from a registry, and its audit concluded that what remained
  was partner-specific knowledge, so a written note said a second refactor
  would not shrink the file count. The second (2026-08-14) shrank the count
  from thirteen files to six, because the audit had answered "can this be
  config?" while five of the thirteen files were slug-keyed tables holding
  one line of partner data each — a question the first audit never asked.
  The parallel with the CVMA bullet is exact: a plausible conclusion survived
  because nobody re-counted it, until a reader looked at "13 files" and said
  that screams drift. What remains per-partner now is logic — the fetcher,
  the rights mapping, the lookup registration — and I invite disagreement
  about whether any plugin boundary can absorb rights vocabulary and host
  policy, which are judgments about a partner rather than wiring.
- **"Resolve a real one and an invented one" deserves to be a norm.** Every
  linked-data consumer needs the control; I have not found it written down as
  practice. It costs two requests, and it catches two distinct failure
  classes: URL shapes the consumer guessed wrong, and firewalls that answer
  every id identically. Possible ecosystem ask: a documented always-misses id
  per API, the way payment APIs document test card numbers.
- **What would partners publish for this to be a 30-minute job?** A stated
  rate limit, even when the statement is "none" (DPLA already does this). A
  rights field in a standard vocabulary (IIIF already requires one). A
  documented id-addressed URL scheme that shows what a miss returns. A
  thumbnail URL on the partner's own host, because aggregator thumbnails
  point at hundreds of provider hosts that rot and block hotlinking. Praise
  the partners that already do each by name.
- **Close by handing off.** The playbook keeps living in git, where the next
  partner corrects it. The next post starts where this one ends: once the
  plumbing works, the judgment calls begin — which four of sixty items earn
  a shelf — and today there is nowhere on-wiki to argue about that judgment.

## Before writing final prose

- [ ] Decide the DigitalNZ Trotsky incident's home (here vs. the ranking
  post) — one place only
- [ ] Re-render the Met/Rembrandt funnel on current code before quoting the
  35 → 14 → 3 → 2 numbers
- [ ] Tone check against the two published posts: measurement, not
  grievance — "doesn't", never "can't"
