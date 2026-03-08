---
name: wikipedia-citation-practices
title: Wikipedia citation practices
description: An accord for adding and evaluating citations on Wikipedia and Wikidata. Establishes shared vocabulary grounded in Wikipedia's own policies, guidelines, and community norms. Use when contributing references, evaluating source quality, or assisting with citation-related tasks on Wikimedia projects.
license: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
metadata:
  author: Mike Tiegerman
presentation:
  order:
    - verifiability-and-reliable-sources
    - citing-sources-on-wikipedia
    - wikidata-references
    - after-the-citation-wikipedia
    - after-the-citation-wikidata
---

This is an *accord*: an orientation document that gives humans and LLM agents common language and expectations for achieving goals together. Accords are packaged as Agent Skills for agents, and quick-reference HTML guides for humans.

This accord covers three domains essential to citation work on Wikimedia projects. It draws terminology directly from Wikipedia's policies, guidelines, and essays, rather than imposing external frameworks. Where possible, references to specific Wikipedia pages are provided; because Wikipedia's bot-detection may block automated retrieval of these pages, citations should be verified manually.

## Verifiability and reliable sources

Wikipedia's core content policies determine what belongs in the encyclopedia and what does not. For citation work, two policies are foundational:

- **Verifiability** (WP:V): the threshold for inclusion is whether readers can *check* a claim against a published, reliable source — not whether editors personally know it to be true.
- **Reliable sources** (WP:RS): not all publications are equal. Editorial oversight, fact-checking processes, and reputation for accuracy determine whether a source can support a claim.
- **No original research** (WP:NOR): Wikipedia reports what reliable sources say. Editors must not synthesize sources to advance a position that none of them individually state.
- **Burden of evidence**: the editor who adds or restores material bears responsibility for providing a citation. Unsourced material may be challenged and removed.

See [Verifiability and reliable sources](references/verifiability-and-reliable-sources.md).

## Citing sources on Wikipedia

The mechanics of citation on Wikipedia have evolved through years of community practice into a sophisticated system with specific expectations:

- **Inline citations** (WP:INCITE): citations belong immediately after the claim they support, using `<ref>` tags that generate numbered footnotes.
- **Citation templates**: structured templates like `{{cite web}}`, `{{cite journal}}`, and `{{cite book}}` ensure consistent formatting and machine-readability.
- **General references** vs. **inline citations**: general references in a bibliography section are acceptable but inline citations are strongly preferred, especially for contentious or surprising claims.
- **When to cite**: direct quotations, contentious claims about living persons (WP:BLP), statistical data, and any material likely to be challenged all require citations.

See [Citing sources on Wikipedia](references/citing-sources-on-wikipedia.md).

## Wikidata references

Wikidata is a structured knowledge base where claims carry machine-readable references. Citation practices differ from Wikipedia's prose-based model but serve the same verifiability goals:

- **Reference properties**: Wikidata citations use properties like *stated in* (P248), *reference URL* (P854), and *retrieved* (P813) to describe where a claim's evidence comes from.
- **Source types**: primary sources (official records, government databases), secondary sources (journalism, scholarship), and tertiary sources (aggregator databases) each have appropriate uses.
- **Circular reference avoidance**: Wikipedia should not be cited as a reference on Wikidata, and vice versa, since they share a content ecosystem.

See [Wikidata references](references/wikidata-references.md).

## After the citation: Wikipedia

Adding a citation to Wikipedia is not the end of the process. Both human reviewers and automated systems act on edits after they are saved:

- **Recent changes patrol**: editors monitor the live feed of edits to catch vandalism, policy violations, and sourcing problems. Most citation edits are reviewed through watchlists rather than a formal patrol queue.
- **Pending changes**: on protected articles, edits by new or unregistered users wait in a review queue until a reviewer accepts them.
- **Citation bots**: automated tools like Citation bot (expands partial citations via DOIs and ISBNs), InternetArchiveBot (saves linked URLs to the Wayback Machine and rescues dead links), and OAbot (adds open-access links) act on citations after they are placed.
- **BLP enforcement**: biographies of living persons have the strictest sourcing standards. Edit filters automatically flag potential violations, and unsourced contentious material must be removed immediately.
- **Citation needed removal**: when a citation satisfies an existing `{{citation needed}}` tag, the editor removes the tag manually. There is no automated process for this.

See [After the citation: Wikipedia](references/after-the-citation-wikipedia.md).

## After the citation: Wikidata

Wikidata's post-citation processes reflect its structured data model and differ substantially from Wikipedia's prose-based workflows:

- **Wikidata patrol**: patrollers review edits via the Recent Changes feed, assisted by ORES machine-learning scores that flag suspicious edits. Autopatrolled users' edits are marked automatically.
- **Constraint violations**: Wikidata has machine-readable property constraints (type, value, cardinality) with automated violation reports. Bot operators are expected to monitor violations their bots generate.
- **Reference hygiene bots**: automated tools clean up redundant references (e.g., removing "imported from Wikimedia project" when a proper "stated in" reference exists) and adjust statement ranks.
- **Cross-project impact**: a Wikidata edit affects every Wikipedia that consumes it via infoboxes and queries, making each edit higher-stakes but harder to patrol comprehensively.
- **Bot sourcing requirements**: bots that add statements must also add references (unless the claim qualifies as common knowledge). Bot approval requires community-reviewed test runs.

See [After the citation: Wikidata](references/after-the-citation-wikidata.md).
