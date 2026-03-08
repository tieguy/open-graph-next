---
title: "After the citation: Wikidata"
license: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
metadata:
  author: Mike Tiegerman
---

Wikidata's post-citation processes reflect its structured data model. Because Wikidata stores atomic property-value pairs rather than prose, the review systems, automated tools, and community processes differ substantially from Wikipedia's. This document describes what happens after a reference is added to a Wikidata statement.

## Human review processes

### Recent changes patrol

Wikidata has a patrol system similar in concept to Wikipedia's, but different in practice. Patrollers review edits via the Recent Changes feed and can mark edits as patrolled, revert them, or flag them for further review.

Key differences from Wikipedia:
- **Structured diffs are harder to read.** A Wikipedia diff shows text changes in context. A Wikidata diff shows changes to property-value pairs, which requires understanding the data model to interpret. "Changed P108 from Q12345 to Q67890" is less immediately meaningful than seeing a sentence change in prose.
- **Autopatrolled users.** Established editors and bots with the autopatrolled flag have their edits automatically marked as patrolled, removing them from the queue. This means most bot edits (which constitute a large share of Wikidata activity) bypass patrol entirely.
- **Language-specific patrolling is difficult.** Wikidata edits to labels and descriptions in a specific language affect that language's Wikipedia, but the Recent Changes feed cannot easily be filtered by language. This makes it hard for, say, Portuguese-speaking patrollers to find edits relevant to Portuguese Wikipedia. PLtools provides a partial workaround.

See: https://www.wikidata.org/wiki/Wikidata:Patrol

### Counter-vandalism

Wikidata's WikiProject Counter-Vandalism coordinates community efforts to detect and revert bad edits. The primary tool is ORES (Objective Revision Evaluation Service), a machine-learning system that scores edits for likely vandalism.

- **ORES scores.** Each edit receives a probability score for being damaging or in good faith. High-probability damaging edits are surfaced in the vandalism dashboard.
- **Human judgment remains final.** ORES flags edits for review but does not automatically revert them. Patrollers make the final decision.
- **Limitations.** ORES is better at detecting blatant vandalism (nonsense values, mass deletions) than subtle errors (plausible but incorrect claims with well-formatted references).

See: https://www.wikidata.org/wiki/Wikidata:WikiProject_Counter-Vandalism

### Cross-project impact

A Wikidata edit can affect every Wikipedia and Wikimedia project that reads from it. This is the single most important difference from Wikipedia's post-edit landscape:

- **Infoboxes and Wikidata queries.** Many Wikipedia infoboxes pull data directly from Wikidata. A change to a Wikidata statement may immediately change what readers see on Wikipedia articles in dozens of languages.
- **No per-language gatekeeping.** Unlike Wikipedia, where each language edition controls its own content, Wikidata edits propagate globally. A vandal editing a Wikidata item can simultaneously affect the English, French, Japanese, and Arabic Wikipedias.
- **Reversion is global too.** Reverting a bad Wikidata edit fixes the problem everywhere, but it requires someone to notice the problem in the first place.

This global reach makes each Wikidata edit higher-stakes than a typical Wikipedia edit, but the patrol capacity has not scaled proportionally. The ratio of edits to patrollers is significantly higher on Wikidata than on English Wikipedia.

### No pending changes equivalent

Wikidata does not have a pending changes system. Edits by all users — including unregistered and brand-new accounts — go live immediately. Page protection can restrict who can edit, but there is no review queue for edits awaiting approval.

## Automated systems

### Constraint violations

Wikidata has a built-in system of *property constraints* — machine-readable rules about what values are valid for a given property. When a statement violates a constraint, it is flagged in an automated violation report.

Types of constraints include:
- **Type constraints.** "P19 (place of birth) should only be used on items that are instances of human (Q5)."
- **Value type constraints.** "The value of P19 should be a geographic location."
- **Cardinality constraints.** "An item should have at most one value for P569 (date of birth)."
- **Range constraints.** "P1082 (population) should be a positive number."
- **Format constraints.** "P213 (ISNI) should match a specific regex pattern."
- **Conflicts-with constraints.** "P570 (date of death) should not coexist with P3828 (date of extinction) on the same item."

Constraint violations are published on HTML report pages and are expected to be monitored by the editors or bot operators who generated them. They are not automatically corrected.

See: https://www.wikidata.org/wiki/Help:Property_constraints_portal

### Reference hygiene bots

Automated tools maintain the quality of existing references:

- **Redundant reference cleanup.** Bots remove lower-quality provenance markers (like `imported from Wikimedia project`, P143) when a proper external reference (`stated in` or `reference URL`) is added to the same statement.
- **Rank adjustment.** When a statement has both a sourced value and an unsourced value for the same property, bots may adjust ranks so that the sourced value is preferred.
- **Identifier validation.** Bots that add external identifiers (ORCID, VIAF, etc.) verify that the identifier resolves correctly and links to the expected entity.

### ProVe (experimental)

ProVe (Provenance Verification) is an experimental tool from King's College London that automatically checks whether a reference URL actually supports the Wikidata statement it is attached to. It uses a pipeline of text extraction, claim verbalisation, sentence selection, and textual entailment to score references from -1 (refutes) to +1 (supports).

ProVe is deployed as a Wikidata gadget but remains a research prototype. It is hosted on university infrastructure, not Wikimedia servers. Its limitations include weak performance on numerical claims, inability to handle multi-hop reasoning, and dependence on the reference URL being accessible and text-rich.

See: https://www.wikidata.org/wiki/Wikidata:ProVe

## Bot approval and sourcing requirements

Wikidata has a formal process for approving bots, with specific sourcing expectations:

### Bot approval process

1. **Request for permissions.** Bot operators submit a request describing what the bot will do, what sources it will use, and what safeguards are in place.
2. **Test runs.** The community reviews 50–250 test edits before granting approval.
3. **Ongoing monitoring.** Bot operators are expected to monitor constraint violations and errors generated by their bots.

### Sourcing requirements for bots

A 2018 Request for Comment established that bots adding statements to Wikidata should also add references — with limited exceptions for "common knowledge" claims (e.g., "France is a country"). This policy reflects community concern that mass bot imports of unreferenced data undermine Wikidata's credibility.

In practice, enforcement is uneven. A significant portion of Wikidata's content was imported by bots from external databases with only `imported from Wikimedia project` (P143) or `based on heuristic` (P887) as provenance — neither of which constitutes a verifiable reference.

See: https://www.wikidata.org/wiki/Wikidata:Requests_for_comment/Sourcing_requirements_for_bots

## The lifecycle of a Wikidata reference

After a reference is added to a Wikidata statement:

1. **Immediate.** The edit appears in Recent Changes. If the editor is not autopatrolled, the edit enters the patrol queue. The change propagates to all Wikimedia projects that read this item.
2. **Minutes to hours.** ORES scores the edit. If flagged as potentially damaging, it appears on the counter-vandalism dashboard.
3. **Automated checks.** Constraint violations are evaluated. If the statement (not the reference itself) violates a constraint, it appears in violation reports.
4. **Reference hygiene.** If the new reference supersedes a weaker provenance marker (P143, P887), bots may clean up the redundant marker.
5. **Ongoing.** Other editors may review the reference during routine patrol, improve it (adding missing properties like `retrieved` or `page(s)`), or challenge it on the item's talk page.
6. **Experimental.** ProVe may evaluate whether the reference URL supports the claim, if the item is queued for analysis.

Unlike Wikipedia, there is no systematic link-rot detection on Wikidata. Reference URLs may go dead without automated detection or repair. There is no Wikidata equivalent of InternetArchiveBot.

## Key differences from Wikipedia's post-citation landscape

| Aspect | Wikipedia | Wikidata |
|---|---|---|
| Edit visibility | Local to one article, one language | Global across all Wikimedia projects |
| Review queue | Pending changes for protected articles | No equivalent |
| Vandalism detection | Human patrol + edit filters | Human patrol + ORES ML scoring |
| Citation maintenance bots | IABot, Citation bot, OAbot | Reference hygiene bots (less comprehensive) |
| Link rot protection | IABot archives and repairs links | No automated equivalent |
| Constraint checking | None (human editorial judgment) | Machine-readable property constraints |
| Semantic verification | None | ProVe (experimental) |
| BLP equivalent | Strict policy with edit filters | No equivalent heightened standard |
| Unsourced content markers | `{{citation needed}}` tag | No inline marker; statements simply lack references |
