---
title: Advanced checks
---

These checks cover deeper Wikipedia policy that experienced editors enforce. They are less likely to apply to typical student edits but should be flagged when relevant. The checker runs these after the basic checks and reports them in a separate section.

## Extraordinary claims need extraordinary sources (WP:REDFLAG)

Certain types of claims trigger heightened sourcing requirements. A single source, no matter how reliable, may not be sufficient.

### Claims that require extra scrutiny

- Claims that are surprising or apparently important but not widely covered
- Claims that are politically or scientifically contentious
- Claims about living or recently deceased persons (overlaps with BLP)
- Claims that contradict well-established scholarly consensus
- Claims promoted primarily by the subject of the article

### What the checker looks for

- **High-impact claims with only one source.** If a claim would be noteworthy enough to appear in multiple reliable publications, but is sourced to only one, flag it.
- **Claims that seem too convenient.** If a claim perfectly supports the article's narrative but comes from a questionable or single source, flag it for closer scrutiny.

See: [Wikipedia:Red flags](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources#Exceptional_claims_require_exceptional_sources)

## Wikipedia cannot source Wikipedia (WP:CIRCULAR)

Wikipedia must not be used as a source for Wikipedia. This prohibition extends to:

- **Other Wikipedia articles.** If a claim is cited to another Wikipedia article, find the underlying source and cite it directly.
- **Wikipedia mirrors.** Websites that copy Wikipedia content are not independent sources.
- **Publications that relied on Wikipedia.** If a news article's information visibly originated from Wikipedia, it cannot be used to source Wikipedia.

### What the checker looks for

- **Citations to any wikipedia.org URL.**
- **Citations to known mirror sites** (everipedia, dbpedia, etc. when used as content sources rather than data references).
- **Suspiciously circular sourcing.** A source that restates Wikipedia content without independent reporting.

## Citation style consistency

Wikipedia does not mandate a single citation style, but articles should be internally consistent.

### The main citation styles

- **Citation templates** (most common): `{{cite web}}`, `{{cite book}}`, `{{cite journal}}`, etc., rendered in Citation Style 1 (CS1) by default.
- **Citation Style 2 (CS2)**: an alternative rendering using `{{citation}}` instead of `{{cite X}}`.
- **Manual formatting**: some articles use hand-formatted references without templates.

### What the checker looks for

- **Mixed styles within one article.** If the article uses `{{cite web}}` templates, new citations should match. Do not mix CS1 and CS2, or templates and manual formatting.
- **Student adding a different style than the article already uses.** Flag this gently — the student may not be aware of the existing convention. Suggest matching the article's existing style.

See: [Wikipedia:Citing sources](https://en.wikipedia.org/wiki/Wikipedia:Citing_sources#Citation_style)

## Citation template completeness

Well-formed citations maximize the chance that future readers can access and verify the source.

### Key parameters to check

| Parameter | When required | Why it matters |
|---|---|---|
| `|title=` | Always | Identifies the source |
| `|url=` | When source is online | Enables access |
| `|access-date=` | When `url` is present | Records when link was live |
| `|date=` or `|year=` | When available | Establishes timeliness |
| `|last=` / `|first=` | When available | Identifies the author |
| `|publisher=` | For web sources | Clarifies who published it |
| `|doi=`, `|isbn=`, `|pmid=` | When available | Persistent identifiers survive link rot |
| `|archive-url=` / `|archive-date=` | When possible | Protection against link rot |
| `|page=` or `|pages=` | For specific claims | Points to exactly where in the source |

### What the checker looks for

- **Bare URLs** used as citations without any template or formatting.
- **Missing `|access-date=`** on web citations.
- **Missing persistent identifiers** when they would be easy to add (e.g., an academic article cited without its DOI).
- **Missing `|page=`** for specific claims from long sources (books, reports).

### A note on strictness

Missing parameters are opportunities for improvement, not policy violations. The checker should suggest additions rather than treat incomplete templates as errors. A correctly sourced claim with a minimal citation is vastly better than no citation at all.
