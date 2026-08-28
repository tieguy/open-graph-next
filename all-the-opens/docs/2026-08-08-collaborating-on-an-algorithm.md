# Collaborating on an algorithm, not a placement: a developer diary

Friends of Wiki doesn't place anything. Every card on every page is the output of a function over the article's own links and identifiers, which means there is no such thing as "the editor who put that photo there." Today I found three obviously junk cards on the Apollo 11 page, and my first instinct was the Wikipedian one: get rid of *those three*. That instinct is unavailable here, and chasing why it's unavailable turned out to be more interesting than the bug. If this kind of page ever has collaborators, they will not be arguing about placements. They will be arguing about a scoring function — and I don't think anyone has a good venue for that argument yet.

## Entry 1 (2026-08-08): the bug, and why it isn't three bugs

- Reported by eye, from a screenshot of §"Other key personnel". The DPLA shelf
  for **Neil Armstrong** — badged "3 of 60" — showed: *Kristina McNeill*,
  *Bussed balloonist*, *The World's Columbian exposition*. Nothing to do with
  Apollo 11.
- First hypothesis (mine, in the issue): the subject heading is noisy — a
  different Armstrong, or bad subject metadata at the contributing institution.
  **Wrong.** Pulled all 60 items and read them:

  | | |
  |---|---|
  | items under the heading | 60 |
  | genuinely about Apollo 11 / Armstrong | ~50 |
  | title names Armstrong | 19 |
  | has a thumbnail | 55 |
  | junk | items 1–4, and essentially only those |

  The heading is *clean*. It holds the flag and footprints on the Moon, "Here
  men from the planet Earth first set foot upon the Moon", the P30 maneuver card
  carried on the mission, the Colorado flag flown on Apollo 11. We were reading
  the first page of an unordered list and calling it a selection.
- **The query had no ordering at all.** `sourceResource.subject.name="<heading>"`
  with `page_size=4`. A facet filter has no relevance gradient — every item
  carries the heading equally — so "first four" means "whatever the index yields."
- The obvious fix doesn't work. Measured:

  | variant | count | result |
  |---|---|---|
  | facet only (what shipped) | 60 | top 4 all junk |
  | `+ q="Neil Armstrong"` | **23** | filters as well as ranks; still ranks *Bussed balloonist* 4th |
  | `+ q=Neil Armstrong` | 60 | reorders almost nothing |

  The phrase form is the trap: it silently cuts the denominator 60 → 23. This
  project prints "N of M" on every shelf as a disclosure, so a fix that quietly
  shrinks M breaks a promise in order to look better. Rejected on those grounds,
  not on relevance grounds.
- **Second defect, which the first fix would have walked straight into**: the 60
  items hold only **42 distinct title-prefixes**. One group repeats *ten* times
  ("Ceremony for Apollo 11 astronauts Armstrong, Aldrin, and Coll…"), another
  five, another three. Rank without dedup and the shelf becomes four copies of
  one ceremony photograph — worse than the arbitrary shelf it replaced.
- Shipped: read a 50-row window in the *same* request, score locally
  (`2 ×` distinct anchor/heading tokens in the title, `+1` for a thumbnail, ties
  broken by DPLA's own order), fold near-duplicates on a normalized 40-character
  prefix across holders, take four. **Reorders and dedupes; never filters**, so
  every "N of M" stays true.
- Result on the live page: the Armstrong shelf is now four real Apollo 11 items
  and still says "of 60". A Jim Lovell shelf in the same section went clean too,
  and Angkor Wat lost a duplicate ("Inventaire descriptif des monuments du
  Cambodge", twice, from two different providers) that nobody had reported.

## Entry 2 (2026-08-08): the thing I actually want to write about

The gap between how that bug was *found* and how it was *fixed* is the whole
post.

- It was found the way Wikipedia finds things: a human looked at one page and
  said "that's wrong." Perfect. That is the single most reliable quality
  mechanism in the encyclopedia and it works here unchanged.
- It could not be *fixed* the way Wikipedia fixes things. There is no revision
  in which someone removed three bad images. The three bad images were a
  correct rendering of a defective rule.
- Fixing the rule changed roughly fifty shelves at once, including several
  nobody had ever looked at. That is the upside and the whole risk in one
  sentence.

**So what is the editable surface?** On Wikipedia, collaboration happens over
instances — this image, this sentence, this citation — with a talk page attached
to each article. Here, there are only two things anyone could usefully edit:

1. **The upstream data.** Already collaborative, and already the best part of
   this design. Every Wikidata-backed card carries a provenance fold that links
   the exact statement it rests on, because Wikidata's statement anchor *is* the
   edit button. If a card is here for a bad reason, the fix is a real edit in a
   real shared database that every reuser inherits. This half works.
2. **The algorithm.** Not collaborative in any sense. It is a scoring function in
   a private repo, and today I picked its constants by looking at three headings.

**The constants are editorial judgments wearing arithmetic.** `2 × token + 1 ×
thumbnail` is not a technical fact; it is an opinion about what a reader wants,
applied to every article at once. It has a cost I can name precisely: the US
Government Publishing Office's text-only records rank below illustrated ones,
and several of them ("Here men from the planet Earth first set foot upon the
Moon") are the best items under that heading. I traded them away for pictures.
That is exactly the kind of call a Wikipedia talk page is *good* at — and there
is nowhere to have it.

Same shape as the species-box finding from yesterday ("an infobox is an
editorial act"), one level up: there, the editorial act was choosing which
database to believe per field; here it's choosing what "relevant" weighs.

**What would collaborating on this even look like?** Speculative, in rough order
of how much I believe in each:

- **Test cases as the unit of discussion.** "Here is a heading where your ranker
  does badly" is simultaneously a bug report, an argument, and a regression test.
  This is the one I'd bet on: it's concrete, it accumulates, and it doesn't
  require anyone to agree about principles in the abstract. Today's fix already
  shipped with three headings as fixtures; that set should be public and
  appendable.
- **The parameters as a wiki page.** Wikipedia already governs
  template parameters and bot task approvals this way. The precedent is closer
  than it looks: BRFA is a community reviewing an algorithm's behavior before it
  runs at scale.
- **The scoring function as an on-wiki Lua module.** Which loops right back to
  where this session started — the "what if the cards were real templates"
  question. Scribunto can't fetch, so discovery can never live on-wiki, but a
  *ranking function over data already fetched* is exactly the shape of thing a
  Lua module is for: pure, testable, and with a talk page and a page history.
  That reframes the MediaWiki experiment: the interesting port isn't the card
  rendering, it's the judgment. **But see the open question below — this one has
  a prerequisite, and measuring it deflated my enthusiasm considerably.**
- **A watchlist for outputs.** The thing Wikipedia has that this has nothing
  like. There is no recent-changes feed for "this shelf started returning junk",
  no diff when an upstream index reorders itself under you. This bug shipped
  for an unknown number of days and was caught by one person happening to look
  at one section. I don't know what the mechanism should be. It might be the
  most important open question here.

**Where the analogy breaks, and I should stop stretching it:** verifiability
transfers cleanly — "4 of 60" is checkable, the provenance fold is followable,
anyone can re-run the API call in this post and get the same 60 records. NPOV
does not transfer at all. There is no neutral ranking. "Which four of sixty" has
no correct answer, only defensible ones, and the honest move is to publish the
rule and its cost rather than to pretend the four selected themselves.

## Entry 3 (2026-08-08, same day): the second bug was the first one wearing a different flag

- Hours after the DPLA fix shipped, the same report, new partner: "the
  DigitalNZ results on Apollo 11 are bad." They were. Alongside four perfect
  Turnbull photos of the moon landing: Trotsky addressing Soviet troops, a
  Fraggle Rock lunch box, two cartoons about the iPhone. And again the
  Wikipedian instinct — remove *those* — was unavailable, and again the junk
  was a correct rendering of the rules. Every one of those records genuinely
  is filed under a heading ("Soviet Union", "Smithsonian Institution", "Adam
  (Biblical figure)") that genuinely is an anchor in the Apollo 11 article.
  **Every card was true. A third of the page was junk. Truth about the anchor
  and relevance to the article are different properties**, and until today
  the pipeline only tested the first.
- Why didn't DPLA look this bad? Because of a *threshold* — shelves whose
  heading holds more than 300 items fold into a sentence — and the threshold
  is in absolute items, which turns out to mean it is calibrated to the
  partner's size and geography. DPLA holds tens of thousands of items under
  "New York (N.Y.)": folded, invisible, safe. DigitalNZ holds eleven: sailed
  right under. And no per-partner threshold can exist, because within
  DigitalNZ the good shelves and the junk shelves have the same counts
  (Aldrin 9, Chicago 5). The constant wasn't wrong; the *quantity* was a
  proxy that silently assumed the partner lives where the article does.
  First non-US/EU partner, first day out, the assumption surfaced.
- The fix that shipped: a record earns its card only if its own subject
  field touches the article somewhere *beyond* the anchor that fetched it.
  The Turnbull moon photos pass — their subjects also say "Moon", "Space
  flight", "Astronauts", all anchors of this article. The lunch box touches
  the article exactly once, and dies. No new requests: the partners were
  already sending the subject fields; nobody was reading them.
- It took a second judgment within the hour: the first version let anything
  corroborate, and every junk record that survived had corroborated through
  a *place* — a cartoon about Hamas touched "White House", a Tokyo bus
  thesis touched "Japan". A place subject on an archival record says where,
  not what. So: **places don't corroborate**, except the article's own
  subject. That sentence is an editorial judgment of exactly the kind Entry
  2 is about, and I can name what it trades: NASA can no longer corroborate
  anything (its Wikidata item has headquarters coordinates), and the Moon
  still can (its coordinates are on the wrong globe for the parser, which
  for once is the right behavior falling out of an old decision).
- The regression test, again, was "render four articles and read them."
  Apollo 11 went from 41 DigitalNZ cards (8 good) to 12 (8 good, 4
  defensible). Angkor Wat's DPLA shelf went 40 → 22 and the survivors read
  like someone chose them — Vishnu, Brahma, the Khmer language, graywacke,
  which is the sandstone the temple is built from. Nobody chose them. The
  page just stopped showing records that couldn't show a second connection.
- And the cost, named: pages are sparser, and a page whose subject IS the
  partner's home turf pays most. The Yeates article — the page DigitalNZ
  integration was built for — kept its hero portrait and lost its two
  tangential shelves (96 Massey items, 51 Taranaki items, none of them
  *about Yeates*). I think that's right. I decided it alone, in an
  afternoon, and every article on the site changed. That is Entry 2's
  argument compressed into one line of a filter function.
- One refinement for the principles list: "reorder, never filter" from Entry
  1 was too blunt, and today's change is why. The real rule is **the
  denominator is a promise; the sample is a judgment.** "4 of 60" must stay
  true — 60 is the reader's number, and no fix may quietly shrink it. But
  *which* four is the algorithm's job, filtering included, as long as every
  card's own claim stays checkable.

## Open questions

- Is "reorder, never filter" a general principle worth writing into VALUES.md?
  It's the rule that killed the `q=` fix, and it generalizes: *a change that
  makes the page look better by making its disclosures less true is not an
  improvement.* Needs a better name. **Entry 3 proposes one: the denominator
  is a promise; the sample is a judgment.**
- Cross-shelf duplicates remain — Angkor Wat still shows "Ancient Angkor" three
  times, from three different headings. Page-wide dedup was deliberately deleted
  when Commons left (`dropSeenFiles`, 2026-08-04) for reasons about purity and
  determinism that still hold. Unresolved.
- The 40-character fold is fitted to two articles. Where does it wrongly merge
  two genuinely different items? Nobody has looked yet.
- If the ranking were a Lua module and someone changed a weight, what breaks?
  Every page's shelves change at once, with no diff anyone can read. Does an
  algorithm's page history need to show *outputs* rather than source?

## Open question: is on-wiki Lua actually collaborable? (LV, 2026-08-08)

The "put the scoring function in a Lua module" idea above assumes Scribunto is a
*collaborative* medium. LV's sense is that it isn't yet — that doing it reliably,
especially regression-testing it, takes real expertise, so very few Wikipedians
do, and the ones who do get called template "magicians." Which would make moving
the judgment on-wiki a transfer from one small priesthood (me, in a private repo)
to another, rather than an opening-up.

Checked against enwiki, 2026-08-08, because this project has been wrong about
enwiki template facts before. **The infrastructure exists. The participation
doesn't.**

- The testing frameworks are real and live: `Module:UnitTests` and
  `Module:ScribuntoUnit` both exist, as does the `Module:Foo/sandbox` +
  `Module:Foo/testcases` convention.
- **413** pages in the Module namespace have "testcases" in the title, against
  roughly **3,400** modules that look like real Lua — estimated as 6,433 ns-828
  pages containing `local`, minus 2,639 sandbox-titled and 413 testcases-titled
  pages, so treat it as an order of magnitude, not a census. Call it **one module
  in eight** carrying tests. (Search-based counts;
  `list=search&srsearch=insource:"local"&srnamespace=828` and friends.)
- Editing high-use templates and modules is **gated behind a user right**, and
  enwiki has **207** template editors — against 252,454 active editors. That is
  not a proxy for competence, it's a proxy for *permission*, and it says the
  community already treats this as specialist work requiring a grant.
- The safety net is post-hoc: `Category:Pages with script errors` holds **553**
  pages right now. That catches modules that *threw*, after they shipped, on
  real articles. It cannot catch the failure mode that matters here — a change
  that runs perfectly and silently makes every output worse. Exactly the shape
  of today's DPLA bug.

So the honest version of the Lua idea has a prerequisite. What's missing isn't a
place to put the code, it's the thing every other engineering discipline calls
CI: run the changed module against its real transclusions and *show me the output
diff*. Nothing on-wiki does that. A template editor changing a weight today gets
a sandbox, a testcases page they wrote themselves, and hope.

Sub-questions I don't have answers to:

- Is the 1-in-8 testcases rate a tooling problem or a culture problem? If writing
  `Module:Foo/testcases` required no Lua — say, a table of inputs and expected
  outputs — would the rate move?
- Could "show me the output diff across transclusions" exist as a tool rather
  than a MediaWiki feature? It's mechanically just: render N pages before, render
  N after, diff. Someone must have tried this.
- Does the template editor right create the magician class or merely mark it?
- **Uncomfortable one for this project**: I changed a ranking function today that
  affects every article on the site, and my regression test was "render three
  articles and read them." I have no standing to be smug about the 1-in-8. The
  difference is that my outputs aren't anyone else's to inherit — yet.

## Idea, not a plan: a template-authoring harness (LV, 2026-08-08)

Sketched, deliberately not built. If the diagnosis above is right — the
frameworks exist, the discipline doesn't, and there's no output-diff CI — then
the intervention isn't another testing framework. It's a **harness that makes the
discipline the path of least resistance**, plus CI that shows you what your
change did to real pages.

Shape: an [opencode](https://opencode.ai)-style agent harness running
**open-weight models** (Qwen, Kimi) rather than a proprietary API, that will not
let you write `Module:Foo` until `Module:Foo/testcases` has a failing case.

**The open-weights choice is load-bearing, not incidental.** A tool that helps
Wikipedians maintain the encyclopedia's shared infrastructure, but which itself
depends on one company's API remaining available and affordable, reproduces at
the tooling layer exactly the dependency this whole project is about at the
content layer. It also has to be self-hostable to be reviewable, and reviewable
to be trusted with template-protected pages.

**The CI half is much closer than I assumed.** I expected this to need a local
MediaWiki container, or testwiki, and a lot of plumbing. It doesn't:
`action=parse` accepts `templatesandboxtitle` + `templatesandboxtext` +
`templatesandboxcontentmodel`, which means **you can ask the live API to render
any real article as if a module had different content**. Verified against enwiki
2026-08-08 — supplied Lua for `Module:Sandbox/luis-ci-probe`, a page that does
not exist, and the API executed it and returned the string. So:

1. `prop=transcludedin` → the module's real transclusions.
2. Sample N. Parse each **twice**: once live, once with `templatesandboxtext` set
   to the proposed version.
3. Diff the HTML. That is the review artifact nobody currently has.

The same response carries the NewPP limit report, so the CPU cost against the
10-second parse budget falls out of the same call for free. No local install, no
testwiki, no new MediaWiki feature. **The primitive has been sitting there; what's
missing is someone wiring it to a diff view.** (Special:TemplateSandbox is the
human-facing version of this and does one page at a time — the gap is N pages and
a diff, not the capability.)

Disciplines the harness could enforce beyond red-green, mostly stolen from this
repo's own habits:

- **Name the cost.** No heuristic merges without a sentence saying what it trades
  away. Today's ranker cost the GPO text records; that line is in the source.
- **No silent change to a disclosure.** The rule that killed `q=`: a change that
  alters a denominator the page prints has to say so. Mechanically checkable —
  diff the numbers, not just the prose.
- **Date every empirical claim**, because they decay.
- **Output diff reviewed, not just tests green.** Tests pass on the cases you
  thought of; the diff shows the ones you didn't.

**The obvious objection, which I think is serious**: a harness that makes it easy
for non-experts to author modules could make the magician problem *worse*, by
increasing the volume of on-wiki Lua that only a few people can review — and 207
template editors is already the bottleneck. An LLM that writes a module you can't
debug hasn't democratized anything; it's added a dependency with no support
contract. The red-green requirement is a partial answer (you at least ship
executable statements of intent), and the output diff is a better one (a reviewer
can evaluate *what changed on real pages* without reading the Lua). But "does
this raise or lower the review burden per change?" is the question that decides
whether the idea is good, and I don't know the answer.
