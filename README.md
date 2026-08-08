# open-graph-next

Luis's personal experiments in post-LLM open, human-centric, human-curated knowledge.

## Motivation

LLMs are going to reshape how open knowledge is created, maintained, connected, and read. 

For open software projects, [adapting will be time-consuming but doable](https://bsky.app/profile/lu.is/post/3meyjdbdox22j). For Wikipedia and the broader open knowledge graph, it's going to be [a lot harder](https://lu.is/2026/04/web-collaboration-five-graphs/).

This repo is a working space for exploring what that adaptation might look like. How can we make open knowledge more rigorous, more exhaustive, more interconnected, and more accessible — without losing the human collaboration that makes it a genuine monument to what humans can achieve.

## Sub-projects

- **all-the-opens/tapestry-gen/** — the active project: **[Help From Our Friends](https://friendsof.wiki/)**, a live site that renders any English Wikipedia article *enriched* — the open ecosystem's media and cited sources placed beside the prose, every item found by an identifier the article itself states. Each page also measures how much of what it found the original Wikipedia article actually surfaces: shown and credited, a link only, or invisible. LLMs are used to help write this code, but not at any point in the data-processing pipeline.
- **attic/** — retired experiments, kept for the record: the accords orientation documents, the D3.js Rabbit Hole Browser (web-demo), a Firefox extension, the Netlify site build, tapestry-gen's original hand-curated dataset and generator, and early legal-graph notes. See `attic/README.md`.

wikidata-SIFT — LLM-assisted Wikidata patrol/enrichment — now lives in its own repo (`../wikidata-SIFT`); its history through 2026-08-03 is preserved here.

## Values

[`VALUES.md`](VALUES.md) records the project's deliberate principles — what it stands for (open licensing, accuracy over impressiveness, credit traveling with content, claims a reader can check and correct) and how the work is done — along with the rule behind the file: an absence is not a decision.

## License

To the extent Luis has any rights in the code, all newly-created code in this repository is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Sub-projects may contain third-party data and assets with their own licenses; see individual sub-project READMEs for details.
