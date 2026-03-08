---
title: Wikidata references
license: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
metadata:
  author: Mike Tiegerman
---

Wikidata is a structured knowledge base where statements carry machine-readable references. Unlike Wikipedia's prose-based citations, Wikidata references are built from *property-value pairs* attached to individual statements. This document covers how references work on Wikidata, what properties are used, and how sourcing standards differ from Wikipedia.

## Anatomy of a Wikidata statement

Every Wikidata statement has three potential layers:

1. **The claim itself**: a subject-property-value triple. For example, item Q42 (Douglas Adams), property P19 (place of birth), value Q350 (Cambridge).
2. **Qualifiers**: property-value pairs that add context to the claim — time periods, measurement methods, object roles. Qualifiers refine the claim but do not provide evidence for it.
3. **References**: property-value pairs that record *where the information comes from*. References provide the evidence that the claim is verifiable.

The distinction between qualifiers and references is important. A qualifier says *something about the claim* (e.g., "start time: 1999"). A reference says *where we learned the claim* (e.g., "stated in: Who's Who, page 42").

## Core reference properties

Three properties form the backbone of most Wikidata references:

### Stated in (P248)

Used when the information comes from a published work that has its own Wikidata item. The value is a Wikidata item representing the source publication.

Example: a birth date sourced from *Encyclopaedia Britannica Online* would use `stated in: Q5375741` (Encyclopaedia Britannica Online).

Typically combined with:
- **Page(s) (P304)**: specific page number within the source
- **Section, verse, paragraph, or clause (P958)**: specific location within the source
- **Title (P1476)**: title of the specific article or entry within a larger work

### Reference URL (P854)

Used when the information comes from a web page that does not have (or does not warrant) its own Wikidata item. The value is the full URL.

Example: a company's founding date sourced from its "About" page would use `reference URL: https://example.com/about`.

Use `stated in` (P248) when a Wikidata item exists for the source publication. Use `reference URL` (P854) when pointing directly to a web page. Both may appear in the same reference block.

### Retrieved (P813)

Records when the source was consulted. Essential for web sources (which change or disappear) and good practice for all references.

The value is a date with appropriate precision — typically day-level for web sources.

## Additional reference properties

Beyond the core three, Wikidata offers many specialized reference properties:

| Property | Use for |
|---|---|
| **P143** (imported from Wikimedia project) | Data imported from a Wikipedia, Wikisource, etc. Not a true reference — indicates provenance, not evidence. |
| **P887** (based on heuristic) | Data derived from an automated rule or heuristic, not a direct source. |
| **P1683** (quote) | A direct quotation from the source supporting the claim. |
| **P304** (page(s)) | Page number(s) within a stated-in source. |
| **P478** (volume) | Volume of a periodical or multi-volume work. |
| **P433** (issue) | Issue number of a periodical. |
| **P356** (DOI) | Digital Object Identifier for academic publications. |
| **P698** (PubMed ID) | PubMed identifier for biomedical literature. |
| **P212** (ISBN-13) | ISBN for books. |
| **P1065** (archive URL) | Archived version of a reference URL. |
| **P2960** (archive date) | Date the URL was archived. |

## Source type hierarchy on Wikidata

Wikidata inherits Wikipedia's general sourcing philosophy but applies it to structured data:

### Primary sources

Official records, government databases, organizational websites. On Wikidata, these are often the *most useful* sources because structured data frequently consists of factual claims (dates, identifiers, geographic coordinates) that primary sources state directly.

Examples: a person's birth date from a civil registry, a company's registration number from a government business register, a geographic coordinate from an official survey.

### Secondary sources

Journalism, scholarship, biographies. Important for claims that involve interpretation or that are contested, but less commonly used for straightforward factual claims on Wikidata than on Wikipedia.

Examples: a person's significance or notability (sourced from news coverage), a historical event's causes (sourced from scholarly analysis).

### Tertiary sources

Aggregator databases, encyclopedias, reference works. On Wikidata, these are often used as *importing sources* — the data originated in a tertiary database and was imported into Wikidata. The `imported from Wikimedia project` (P143) and `based on heuristic` (P887) properties flag this provenance.

The key difference from Wikipedia: because Wikidata stores atomic factual claims rather than narrative prose, primary sources play a larger and more legitimate role.

## Circular reference avoidance

Wikipedia and Wikidata share a content ecosystem. Citing one to support the other creates a closed loop:

- **Do not cite Wikipedia as a reference on Wikidata.** Wikipedia is not a reliable source by its own standards, and Wikidata statements feed back into Wikipedia via infoboxes and queries.
- **Do not cite Wikidata as a reference on Wikipedia.** Wikidata is not an independent source relative to Wikipedia.
- **`Imported from Wikimedia project` (P143) is not a reference.** It indicates *where the data was copied from*, not evidence that the data is correct. Statements sourced only with P143 are effectively unreferenced.

When migrating data between Wikipedia and Wikidata, trace back to the original external source and cite that instead.

## Reference completeness

The minimum viable reference on Wikidata typically includes:

- `stated in` (P248) **or** `reference URL` (P854) — *which source*
- `retrieved` (P813) — *when checked* (especially for web sources)

A stronger reference adds:

- `page(s)` (P304) or `quote` (P1683) — *where specifically in the source*
- Persistent identifiers (DOI, ISBN, PMID) — *how to find the source again*
- `archive URL` (P1065) with `archive date` (P2960) — *protection against link rot*

## Multiple references per statement

A Wikidata statement can have multiple independent reference blocks. Each block is a separate set of property-value pairs representing a distinct source.

Multiple references strengthen a statement: if one source becomes unavailable or is disputed, others remain. For important or contentious claims, providing two or more independent references is good practice.

## Differences from Wikipedia citation practices

| Aspect | Wikipedia | Wikidata |
|---|---|---|
| Format | Prose templates in wikitext | Structured property-value pairs |
| Placement | Inline after specific claims | Attached to individual statements |
| Primary sources | Used cautiously, secondary preferred | Frequently the most appropriate source type |
| Machine-readability | Via citation templates (semi-structured) | Natively machine-readable |
| Link rot protection | InternetArchiveBot adds archive links | Manual (archive URL property) |
| Unreferenced content marker | `{{citation needed}}` tag | No equivalent — statements simply lack references |

See: https://www.wikidata.org/wiki/Help:Sources
