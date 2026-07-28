# Live discovery — where the spike stands, and what to do next

Date: 2026-07-28
Companion to `../design-plans/2026-07-25-live-discovery-pipeline.md`
Status: current working plan

The design plan lays out eight phases of architecture. `spike.js` has since done
enough of phases 1, 3 and 4 — in one 440-line file with no registry, no
scheduler and no streaming — to render all three fixtures end to end. That
changes what is worth planning: the open questions are no longer *what should
the architecture be* but *how much does each pivot actually yield, and what is
still missing from the page*. This document records the goals, the measurements,
and a short ordered list of next moves. It does not replace the design plan; it
decides which of its phases are worth building and in what order.

## The goals, restated

Unchanged from the design plan's Definition of Done. The three that drive the
work below:

1. **Any article, no per-article code.** Currently true for the three fixtures.
2. **Three structurally different fixtures work** — Apollo 11 (event,
   media-rich), Brown v. Board (legal, document-centric), Ludwig Prandtl
   (person, whose 1899 dissertation is scanned but carries no authority
   identifiers).
3. **No fabricated data; where a connection can't be made, say so** rather than
   substituting a weaker guess presented as equivalent.

## Measured state (2026-07-28)

Over *all* body sections, not the eight the spike renders:

| | Apollo 11 | Brown v. Board | Ludwig Prandtl |
| --- | --- | --- | --- |
| Body sections | 36 | 16 | 6 |
| Citation style | `{{sfn}}` + Sources | inline `{{cite}}` | inline `{{cite}}` |
| Bibliography works | 26 | 4 | 0 |
| `{{sfn}}` pointers | 303 (36 dangling) | 10 | 0 |
| Unique identifiers | 29 | 14 | 9 |
| → reach an IA copy | **7** | **5** | **3** |
| → no IA record at all | 21 | 9 | 6 |
| → dropped by title guard | 1 | 0 | 0 |

Three things follow, and they are the whole basis for the plan below.

**The `{{sfn}}` join works and is not the bottleneck.** 88% of Apollo 11's 303
pointers resolve to a bibliography entry. The citation-identifier route is now
extracting close to everything the articles state.

**Internet Archive coverage is the bottleneck.** 21 of Apollo 11's 29 cited
identifiers have *no* IA record — the query is correct and the answer is
genuinely nothing. Tightening or loosening the title-overlap guard cannot help;
it dropped exactly one true match across all three articles. More citation
extraction will not help either. Yield has to come from a different pivot.

**Prandtl is barely exercised.** Six body sections, no bibliography, and the
dissertation that motivated including him as a fixture is still not found. He is
the fixture that tests the honest-failure requirement, and right now the page
neither finds his thesis nor says that it can't.

## Plan

Ordered by what each move buys against the goals. Each is small enough to do in
one sitting and to measure the same way the table above was measured.

### 1. Render the whole article (small)

`MAX_SECTIONS=8` shows 8 of Apollo 11's 36 body sections — 22% of the article,
with the footer honestly reporting 28 dropped. The spine is cheap; only the
pivots cost anything. Raise or remove the section cap and keep the budget on
*pivots per section* instead, so the page is the article rather than its first
fifth. **Measure:** sections rendered, wall-clock, total requests.

### 2. Add OpenLibrary as a second citation pivot (medium)

The highest-yield move available. Of the 44 unique identifiers across the three
fixtures, 36 reach no IA record — but OpenLibrary catalogues far more than IA
scans, and `openLibraryAccess` in `citations.js` already turns a volume response
into borrow / read / catalogue-only with a cover. This is Phase 3's
`pivots/openlibrary.js`, and it converts "we found nothing" into "catalogued,
not scanned" for most of that 36. **Measure:** the same table, with an
OpenLibrary column. **Watch:** the 1 req/sec budget — 44 identifiers is 44
seconds if serialised naively.

### 3. Make failure visible (small, and it is a goal not a nicety)

Goal 3 says the page must state what it could not connect. It currently doesn't:
a section whose citations reach nothing simply shows fewer items, which reads as
a thinner section rather than a gap in the ecosystem. Give each section a line
in the same register as the existing anchor disclosure — *3 works cited, 1
reachable* — and it becomes the coverage argument instead of an absence.

### 4. The Prandtl collection pivot (larger — design plan Phase 6)

The one fixture-specific gap, and the only remaining piece the design plan
specifies in real detail (`P1026` described-object match, four corroborating
signals, normalised institution comparison, never corroborate against the
holding library). Worth doing *after* 1–3, because those three raise all three
fixtures while this raises one — but it is what proves the `corroborated`
evidence class exists at all.

### Explicitly not now

- **Phase 2's registry and scheduler.** Three pivots do not need an extension
  point. Build it when adding the fourth is what hurts, not before.
- **Phase 7 streaming.** A one-second spine matters for the live browser
  target; the pre-baked render doesn't care. It should follow a decision to go
  live in-browser, not precede it.
- **Phase 5 infobox anchors.** The design plan already flags this as unproven.
  Citation and wikilink anchors are not yet exhausted; this is the least
  certain yield per unit of work.

## Known small defects

- The title-overlap guard rejects `Deke! U.S. Manned Space: From Mercury to the
  Shuttle` against IA's `Deke!` at 0.17. One false negative in 52 lookups —
  real, not worth tuning against a sample this size, recorded so it isn't
  rediscovered.
- 36 of Apollo 11's `{{sfn}}` pointers dangle (12%). Some are genuine article
  flaws; some are bibliography entries with no identifier, which
  `bibliographyIdentifiers` deliberately drops. Worth separating those two if
  the number ever matters.
