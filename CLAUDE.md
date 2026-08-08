# open-graph-next

Using LLMs to improve the open, human-readable knowledge graph.

Last verified: 2026-08-07

## Values

`VALUES.md` lists the project's deliberate principles — dated, sourced — and
the rule behind them: **an absence is not a decision.** A capability the code
lacks is "not yet built" or "tried and blocked" unless a written decision
(VALUES.md, a CLAUDE.md *Key Decisions* / *Deliberately excluded* entry, or a
Linear issue) says it was declined. Never present an absence as a principle.

## Structure

The repo's one active project is **`all-the-opens/tapestry-gen/`** — *"the
article, enriched"*: rendering a Wikipedia article with the open ecosystem's
media and cited sources placed by the article's own anchors, and measuring how
little of that the Wikipedia article itself can show. It is a deployed website
(<https://help-from-our-friends.fly.dev/>) before it is a generator. See
`all-the-opens/CLAUDE.md` and `all-the-opens/tapestry-gen/CLAUDE.md`.

Anything touching a Wikimedia API must follow `tapestry-gen/CLAUDE.md`'s
compliance section — `WIKIMEDIA_UA_CONTACT` names the operator, and there is no
default.

- `attic/` - retired work (accords, the D3 web-demo, the Firefox extension, the
  Netlify site build, legal-graph, and — as of 2026-08-04 — tapestry-gen's
  curated-dataset half: `generate.js`, the Apollo 11 dataset and the Internet
  Archive Tapestry emitter). Kept browsable, not maintained; see
  `attic/README.md`.
- wikidata-SIFT split out to its own repo (`../wikidata-SIFT`) on 2026-08-03;
  its full prior history remains in this repo.
