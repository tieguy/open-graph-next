# Values

Last verified: 2026-08-07

Why this file exists: more than once, a session in this repo inferred a
principle from an absence — "partners needing API keys are skipped on
principle" (false: DPLA, Europeana and the Smithsonian all run keyed in
production), "the container cache is ephemeral by design" (false: nobody had
checked what idling did, and a Fly volume fixed it 2026-08-05), "Wikidata
deliberately rejects strong typing" (false: the mandatory constraint tier is
unenforced, which is not a rejection). This file is the list of what the
project actually believes, so nobody has to guess.

## The rule that governs the rest

**An absence is not a decision.** Something missing from the code is one of:

1. **not yet built** — the common case;
2. **tried and blocked** — recorded in `all-the-opens/docs/reaching-open-collections.md`;
3. **deliberately declined** — a value, but only when written down with its
   reason: here, in a CLAUDE.md *Key Decisions* / *Deliberately excluded*
   entry, or in a Linear issue.

If you cannot find it written, say "not implemented" or "no evidence found" —
never "the project chose not to." Keep three categories apart and label which
one a claim is in: (a) what a source states outright, (b) how something is
currently implemented, (c) what someone intended. Never promote (b) to (c).

## Project values — what this is for

Each dated or sourced; the place the full argument lives is named.

- **Open knowledge should stay human-centric.** The repo's stated mission
  (`README.md`): LLMs helping make open knowledge "more rigorous, more
  exhaustive, more interconnected, and more accessible — without losing the
  human collaboration that makes it a genuine monument to what humans can
  achieve."
- **Our own work is public domain.** Newly created code here is dedicated
  CC0 (`README.md` § License).
- **Only openly licensed material becomes a card, and every card names its
  terms.** Europeana is queried `reusability=open` only; OpenAlex cards exist
  only for works with an open copy — "closed ones are counted, not carded";
  the iNaturalist hero prefers a Wikipedia-compatible license over NC/ND
  (2026-08-07). Sources: `src/front-page.js` FRIENDS list,
  `tapestry-gen/CLAUDE.md` partner sections. **Known tension, undecided:**
  the front page's "open" includes CC BY-NC, and 85–94% of the records behind
  GBIF map tiles are NC — whether NC counts as open here is LUI-142, and this
  bullet should be updated to whatever that decides.
- **The goal is adoption by Wikipedia or something Wikipedia-like, so
  non-commercial is not an acceptable condition** (Luis, 2026-08-08, during
  the DigitalNZ API-terms review). The demo itself is non-commercial and can
  operate inside NC terms; the thing it argues for cannot — everything
  Wikipedia ships must be free for anyone to reuse, commercial use included.
  So an NC condition anywhere in the chain — on a pipe (DigitalNZ's default
  API terms, the first case) or on items — is framed as a **blocker to be
  cleared**, never as a condition comfortably met; "we are non-commercial so
  it's fine" is the wrong sentence in any copy here. Stated on the front
  page's challenges list ("Terms on the pipes, not just the items"). This
  sharpens but does not close LUI-142 (whether NC items count as "open" on
  the front page). Each
  friend's license line links the partner's own statement of terms, "checkable
  rather than merely asserted" — and per the same file, "an unlinked license
  line means nobody has verified one yet, NOT that the claim is false"
  (`src/front-page.js`). At card level: a mark is never a guess — unrecognized
  license values render as nothing, and "free to read is not a license"
  (2026-08-06 rights rules, `tapestry-gen/CLAUDE.md`).
- **Credit travels with the content.** The demo's central claim is that no
  established route on Wikipedia keeps content *and* credit together — so
  this project's pages must: every card names its holder, iNaturalist photos
  credit the observer, OSM tiles credit the mappers, and institutions appear
  *as themselves* rather than dissolved through Commons (LUI-122;
  `tapestry-gen/CLAUDE.md`).
- **Accuracy beats impressiveness; when in doubt, understate.** Claims are
  dated and show the command that produced them ("an undated 'partner X
  blocks us' is worthless within months" — `all-the-opens/CLAUDE.md`); a
  count sits on the thing it counts; no invented denominators; a rejection
  gate "only withholds, so a false one understates a card rather than
  misstating it" (2026-08-04/07, `tapestry-gen/CLAUDE.md`).
- **Claims are correctable by the reader.** Every Wikidata-backed card
  carries a `why`/`trace`/`fix` fold linking the statement it rests on —
  "Wikidata's statement anchor is also its edit button"
  (`tapestry-gen/README.md`).
- **Fix the graph, not just the page, when both are possible** (2026-08-03,
  the Prandtl P724 closure, `tapestry-gen/CLAUDE.md` Evidence classes). A fix
  recorded in Wikidata is inherited by every reuser; a fix here helps only
  this repo.
- **Wikipedia is a friend, not a target.** The gap is *measured*, never
  requested (a request walks into WP:ELBURDEN; a report does not — LUI-122),
  and the constraint is never overstated: not "there is no route" but "no
  established route keeps content and credit together"; not "Wikipedia can't
  show" but "doesn't" (2026-08-04 copy rules, `tapestry-gen/CLAUDE.md`).

## Working values — how the work is done

- **Run for anyone who clones it; degrade, don't gate** (2026-08-03, code
  headers in `tapestry-gen/src/dpla.js` and `europeana.js`). A free API key is
  an ordinary build step: used when set, silently absent when not. Keyless
  operation is a courtesy to cloners, never a policy against keys.
- **Be a guest on other people's infrastructure** (throughout; compliance
  sections of `tapestry-gen/CLAUDE.md`). The User-Agent names the operator,
  per-host queues stay serial by default, and a host's concurrency rises only
  with its own published policy quoted at the call site. Warming our own cache
  earns no exemption.
- **Production corresponds to a commit, and Luis is the sole reviewer**
  (2026-08-03/05). Commit before deploying; pause before partner-facing copy
  so *he* can read it — there is no other reviewer and no PR ceremony to
  perform.
- **A learning generalizes across sources, or it waits** (2026-08-08, stated
  during PR #11's review). It is too early to be doing hacks for specific
  data providers, especially small ones: a mechanism is implemented when it
  can be stated once across multiple partners (the strict subject-heading
  rule is one statement across DPLA and DigitalNZ; `bandPropertyPivot` is one
  loop across three), and a single-partner improvement is filed as a
  question instead — LUI-146, the loose-match exploration, is the standing
  example. The "Neither shape" escape hatch in *Adding a data source* is the
  deliberate exception for partners whose APIs genuinely are exceptional,
  which is different from special-casing one partner's quirks inside a
  shared mechanism.

## Explicitly not values

Each of these was asserted by a session and corrected; do not resurrect them.

- ~~"Keyed partners are avoided on principle"~~ — corrected 2026-08-07; three
  keyed partners run in production.
- ~~"The cache being wiped was the accepted trade for scale-to-zero"~~ —
  corrected 2026-08-05; it was an argument about deploys that had never
  checked idling.
- ~~"Rot removal is uncontroversial" / "Wikidata deliberately rejects strong
  typing"~~ — corrected 2026-08-04 during LUI-123 research; both were tidy
  summaries of genuinely unsettled community questions.
