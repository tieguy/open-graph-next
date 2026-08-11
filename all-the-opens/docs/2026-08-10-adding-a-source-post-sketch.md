# What it costs to add an open collection (2026): a playbook, with commentary

*Sketch only — outline and bullets, no prose yet. Companion issue: LUI-140
(LUI-147, the CVMA verification, resolved 2026-08-11 — see the corrected
pitfall below). The mechanical playbook itself
lives in git (`docs/adding-a-source.md`, canonical as of `ac00fa8`) and this
post deliberately does NOT restate it — the post is the commentary, the doc is
the checklist. First of the current queue; LUI-153 (collaborating on an
algorithm) follows it. Started 2026-08-10.*

## Frame (lead ¶ candidates)

- friendsof.wiki now draws on ~15 open collections — museums, libraries,
  aggregators, three continents. Every one was integrated by hand, and every
  integration taught us something nobody had written down.
- The pitch: here is the actual, unglamorous cost of connecting ONE new open
  collection to ONE small site in 2026 — and which parts of that cost are ours,
  which are the ecosystem's, and what would have to change for it to be an
  afternoon's work.
- Audience note to self: a reader who will never add a source here should still
  finish knowing what "open" costs in practice. The commentary is the product;
  the checklist is a link.

## Part 1 — the shape of the job (brief; link to the doc in git)

- One paragraph, not the checklist: pick one of three shapes (direct-id /
  search / hand-written), pre-flight the host's own published policies, then
  touch **10–13 files**, then render real articles and *read the cards*.
- The number is the argument, so give it its history in one breath:
  - 9 when first counted (Rijksmuseum, 2026-08-06)
  - that count was already POST-refactor — the 2026-08-07 registry work
    (`99116e8`) had collapsed the wiring; its audit: a registry removes
    duplication, not partner-specific *knowledge*
  - 10–13 today, and two of the additions are a relevance gate and a layering
    test — the count grows because the *judgment* grows, not the boilerplate
- Link: the playbook, maintained, updated in the same commit as each new
  partner. A blog post freezes; a repo doc travels with the code. (One line on
  why that split — this post will be wrong about the details within a month,
  and that is fine, because the details live elsewhere.)

## Part 2 — pitfalls, each with the incident (the middle of the post)

*Rule inherited from the issue: cite the evidence, never abstract into advice.
Order them as an escalation: URL → identity → data → law → layers.*

- **You will guess a URL shape, and you will be wrong.**
  - Rijksmuseum: shipped `/en/collection/object/<numericId>` — does not exist;
    real key is the accession number. A 404 on live cards.
  - The rule that came out of it: **resolve a real id AND a deliberately bogus
    one** — the bogus one is the test, it proves the server distinguishes them.
- **Your test will agree with your bug.** The original rijks test asserted the
  broken URL — written from the same wrong assumption as the code. (Small
  section; sets up the LUI-153 post's testing theme.)
- **Bot mitigation makes healthy links look dead.** 431 DPLA links "dead" —
  all fine; the WAF answers real and impossible ids identically. Without the
  bogus-id control you cannot tell refusal from rot. (This is also why a
  link-checker audit of open collections would be mostly wrong.)
- **The problem is often anchor supply, not the API.** The Met funnel on
  Rembrandt: 35 museum-bearing anchors → 14 survive the table-strip → 3 reach
  the lookup → 2 render. Diagnose the funnel before blaming the partner.
- **The visible modeling error is not always the binding constraint.** CVMA GB:
  28,135 photos, 0 matches. The P31/P186 mix-up is real — and fixing it yields
  ~nothing, because the UK has 87 window items against 28,135 photographs, and
  the material vocabulary splinters (clear glass 2,555 / lead 699 / "stained
  glass" itself 84). Verified 2026-08-11; the pre-verification draft of this
  bullet had the diagnosis wrong, which is itself post material: the plausible
  explanation survived two months because it was never counted.
  - Bonus, for the ecosystem pile: cvma.ac.uk is now a tombstone — the archive
    moved to ADS York under CC BY 4.0, all 28,135 catalogued URLs 404 (real and
    bogus ids identically), no redirect, no Wikidata property to record new
    ids in. MORE open than before and LESS reachable: orphaned by its own
    migration. (reaching-open-collections.md entry 10.)
- **An index with no ranking hands you its first page.** DPLA/Armstrong: 60
  items, ~50 right, the 4 shown were the only junk. One line + link forward to
  LUI-153, which is this incident grown into its own post. *(Boundary decision:
  the DigitalNZ Trotsky/lunch-box incident — keep it there or move it here?
  Currently there.)*
- **Rights metadata will try to make you lie.** The two-CC-URIs trap
  (Rijksmuseum: CC0 covers the catalogue TEXT, not the picture); the
  creator-level ruling on a multi-author book; DigitalNZ's capability words
  that must NOT become a CC glyph. One rule threads them: **a mark is never a
  guess.**
- **Politeness is homework, not vibes.** hostLimit defaults to 1 and moves only
  on the host's own published statement — DPLA's "we don't rate-limit" earned
  4; LC's Crawl-delay:3 earned a permanent 1 plus a cheaper request (HEAD
  header, not 100KB body). robots.txt before assets (HathiTrust). Favicons each
  fail their own way (the 200-that-is-an-HTML-error shipping as an icon).
- **Your own layers will drift.** The renderer-import incident; then this
  week's pair — the shelf ranker living in one partner's module, LC lookup
  importing back OUT of a partner. Both directions now enforced by a test.
  Punchline: the instinct behind the mistake was right (generalize a learning
  across sources); only the destination was wrong.

## Part 3 — the commentary (the point)

- **Ours vs. the ecosystem's** — sort every Part 2 pitfall into two piles:
  - *ours* (fixable by better code): guessed URLs, tests that pin bugs, layer
    drift, no ranking
  - *the ecosystem's* (no code of ours fixes them): bot mitigation
    indistinguishable from rot, keyed APIs that die (Rijksmuseum's keyed API
    retired; the keyless replacement was BETTER), rights metadata that answers
    a different question than asked, no thumbnails, WAFs
  - the split is the argument: roughly half the cost of "open" is paid on the
    consumer side for problems only publishers can fix
- **The plugin-boundary question, honestly reframed.** Not "why is there no
  plugin system" — someone built the registrable half (`99116e8`) and the audit
  says why it stopped: what remains is knowledge, not wiring. The 10–13 files
  are a measurement of that residue. Invite disagreement: what would a real
  boundary need to absorb rights vocabulary and host policy? Is that even
  absorbable?
- **"Resolve a real one and a bogus one" deserves to be a norm.** Every
  linked-data consumer needs it; nobody writes it down. Cheap to state, cheap
  to run, catches two distinct failure classes (guessed URLs, WAFs). Possible
  ecosystem ask: a well-known bogus-id convention per API?
- **What would partners publish for this to be a 30-minute job?** Draft list:
  a stated rate limit (even "none"), a rights field in a standard vocabulary,
  a stable id-addressed URL scheme documented WITH a miss example, a thumbnail
  URL that is the partner's own host. Note which partners already do each —
  praise by name (DPLA's policy, LC's x-preflabel-encoded, IIIF's required
  rights statement).
- Close by handing off: the checklist keeps living in git; the next post
  (LUI-153) starts where this one ends — once the plumbing works, the judgment
  begins, and there is nowhere to argue about the judgment.

## Before writing prose

- [x] LUI-147: verified 2026-08-11 — diagnosis corrected, see Part 2 bullet
- [ ] Decide the DigitalNZ incident's home (here vs. LUI-153) — one place only
- [ ] Pull exact dates/commits for each incident from CLAUDE.md + git log
- [ ] Re-render the funnel numbers (Met/Rembrandt) on current code before
      quoting — pre-fix measurements may not be comparable post-section-dedup
- [ ] Tone check against the two published posts: measurement, not grievance —
      "doesn't", never "can't"
