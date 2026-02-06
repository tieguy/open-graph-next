# LLM-Assisted Knowledge Graph Quality: Research and Opportunity

Last updated: 2026-02-06

## Purpose

Wikidata is the world's largest open knowledge graph (~120M items, ~1.65B statements), but its data quality is structurally degraded: import is easy and highly automated (~200k bot edits/day), while validation remains overwhelmingly manual (~36k active human editors total). Roughly a third of all statements lack any reference, and rigorous constraint enforcement (as demonstrated by YAGO) would discard 28% of all facts.

No existing tool is systematically working through this backlog. The few deployed quality tools are either academic prototypes that never crossed the deployment gap, defensive-only (catching vandalism on ingress but not fixing existing problems), or deployed but barely used.

This project explores using LLMs to **increase the volume of Wikidata facts that meet high quality standards** — not necessarily by editing Wikidata in place (the community may be too resistant to automated edits at scale), but potentially by starting from a curated base like YAGO and expanding the set of data points that can meet YAGO-level quality thresholds, or similar standards adjusted to match what LLM-based verification can reliably assess.

---

## The Problem

### Scale of the quality deficit

| Metric | Value | Source |
|--------|-------|--------|
| Total items | ~120.3M | [Wikidata:Statistics](https://www.wikidata.org/wiki/Wikidata:Statistics) |
| Total statements | ~1.65B | [Wikidata:Statistics](https://www.wikidata.org/wiki/Wikidata:Statistics) |
| Statements with no reference | ~32-33% (~500M+) | [Wikidata:Automated finding references](https://www.wikidata.org/wiki/Wikidata:Automated_finding_references_input); Beghaeiraveri et al. 2021 |
| Statements referenced only with "imported from Wikipedia" (circular) | Largest single reference category | [Help:Sources](https://www.wikidata.org/wiki/Help:Sources) |
| Facts failing basic type constraints (YAGO4 analysis) | 132M (28% of all facts) | [YAGO 4: A Reason-able Knowledge Base (ESWC 2020)](https://link.springer.com/chapter/10.1007/978-3-030-49461-2_34) |
| Deprecated statements | ~10M | Shenoy et al. 2022 |
| Disjointness violation "culprit" items | ~14,480 | [Dogan & Patel-Schneider 2024](https://arxiv.org/abs/2410.13707) |
| Automated edits per day | ~200k | [Wikidata:Statistics](https://www.wikidata.org/wiki/Wikidata:Statistics) |
| Active human editors | ~36k | [Wikidata:Statistics](https://www.wikidata.org/wiki/Wikidata:Statistics) |

### The "imported from Wikipedia" problem

Wikidata's own Help:Sources page does not consider statements sourced only via P143 ("imported from Wikimedia project") to be properly referenced. These are circular references created by bots that scraped data from Wikipedia. More statements in Wikidata cite Wikipedia than all other sources combined. Filtering out P143-only references would push the true "unsourced" percentage well above 33%.

### The constraint system's limitations

Wikidata defines 30 types of property constraints (covering 98% of properties), but these are **advisory only** — nothing prevents adding logically impossible statements. Violations are listed in reports that a bot maintains at [Wikidata:Database reports/Constraint violations](https://www.wikidata.org/wiki/Wikidata:Database_reports/Constraint_violations), but:

- Nobody monitors them systematically
- Bot operators ignore their own violations despite policy requiring them to monitor
- The constraint exception system is breaking down (some constraints have 2,000+ exceptions; the software can't even load them)
- The constraint check API times out for large items
- The violation summary page was last updated September 2024

The [RFC on Data Quality Framework](https://www.wikidata.org/wiki/Wikidata:Requests_for_comment/Data_quality_framework_for_Wikidata) captures community frustration: "We neither have to waste the time of our contributors reviewing and cleaning every violation report every single day, nor allow adding mistakes and vandalisms in the cases that we know by hand that they are mistakes and vandalisms. This is currently a nonsense."

---

## YAGO: The Curated Downstream Alternative

[YAGO](https://yago-knowledge.org/) (Max Planck Institute / Telecom Paris, led by Fabian Suchanek) is the most significant effort to produce a clean, logically consistent knowledge base from Wikidata. It is not a fork in the governance sense but a periodic clean-room rebuild.

### Version history

| Version | Year | Sources | Entities | Facts | Key innovation |
|---------|------|---------|----------|-------|----------------|
| YAGO 1 | 2007 | Wikipedia + WordNet | ~2M | ~20M | First Wikipedia-derived KB |
| YAGO 2 | 2010 | Wikipedia + WordNet + GeoNames | 9.8M | 447M | Spatio-temporal anchoring |
| YAGO 3 | 2015 | 10 Wikipedias + WordNet + GeoNames + Wikidata | 17M | 150M | Multilingual support |
| YAGO 4 | 2020 | Wikidata + Schema.org | 64M | 2B triples | Logical consistency, OWL reasoning |
| YAGO 4.5 | 2024 | Wikidata + Schema.org (more taxonomy) | 49M | 109M facts | Restored Wikidata taxonomy classes |

### What YAGO does

YAGO 4+ is essentially a **filter pipeline** over Wikidata:

1. Take Wikidata's 2.4M classes, keep only ~10k that are logically consistent (99.6% reduction)
2. Map properties onto Schema.org's cleaner definitions
3. Apply SHACL constraints (disjointness, cardinality, domain/range)
4. Discard everything that violates the constraints (11M instances / 14% of entities; 132M facts / 28%)
5. Output a static snapshot

It does not add data. It only subtracts. The value proposition is "Wikidata minus the mess."

### YAGO 4 → 4.5 tension

YAGO 4 was criticized for being too aggressive — reducing 2.4M classes to the few hundred in Schema.org lost expressiveness (can't represent "train ferry route" or "financial regulatory agency"). YAGO 4.5 restored more of Wikidata's taxonomy while maintaining logical consistency, but got pickier about entities (64M → 49M).

### Suchanek's current direction: KB-LM (Knowledge-Based Language Models)

Suchanek's group is **not focused on improving Wikidata or YAGO's data quality**. Their research program goes in a different direction: using KBs to fix LLMs, not using LLMs to fix KBs.

Their project, **"Knowledge-Based Language Models" (KB-LM)**, is funded by the French Ministry of Armed Forces. The [white paper](https://suchanek.name/work/research/kb-lm/kb-lm-white-paper.pdf) (Suchanek & Holzenberger) and [project page](https://suchanek.name/work/research/kb-lm/index.html) lay out three goals:

1. **LLMs stop hallucinating** — by outsourcing factual knowledge to a structured KB rather than relying on parametric memory
2. **LLM knowledge becomes auditable and updatable** — trace where a fact came from and correct it
3. **LLMs become smaller** — by not needing to memorize facts, they focus on language/reasoning

The proposed architecture: **LLM does the reasoning, KB provides the facts, KB verifies the output.** The insight is that it's easier to verify an argument than to generate one. The LLM generates reasoning chains; the KG checks whether the factual claims in those chains are correct.

Suchanek's [November 2025 seminar talk](http://files.inria.fr/almanach/files/seminars/ALMAnaCH-seminar-2025-11-21-fabian-suchanek.pdf) "On Language Models and Knowledge Bases" argues that "the fundamental problem is that language models are probabilistic, while truth is not." His [2023 paper](https://link.springer.com/chapter/10.1007/978-3-031-45072-3_1) frames KBs and LLMs as complementary paradigms — KBs provide ground truth, LLMs provide natural language understanding.

#### Recent papers from the group

- **[Retrieval-Constrained Decoding](https://arxiv.org/abs/2509.23417)** (Sept 2025) — Uses YAGO as ground truth to show LLMs know more facts than standard evaluation suggests. The problem is surface form variation: the LLM says "NYC" when the benchmark expects "New York City." Their YAGO-QA dataset (19,137 questions) uses YAGO's canonical entity forms to resolve this. Finding: Llama-3.1-70B's F1 jumps from 32.3% to 46.0% when you account for aliases.

- **[Reconfidencing LLMs](https://aclanthology.org/2024.findings-emnlp.85/)** (EMNLP 2024) — Uses YAGO entities to show LLM confidence scores are systematically biased by demographics. LLMs are more overconfident about facts involving certain nationalities. Proposes per-subgroup calibration.

- **[Factuality in the Legal Domain](https://dl.acm.org/doi/10.1145/3627508.3638350)** (CIKM 2024) — Tests LLMs as knowledge bases for legal facts, using Wikidata as ground truth. Letting models abstain when uncertain + domain pre-training gets precision from 63% to 81%.

- **[FLORA: KB Alignment](https://link.springer.com/chapter/10.1007/978-3-031-77850-6_2)** (ISWC 2025, best paper) — Unsupervised knowledge graph alignment using fuzzy logic. About connecting different KBs to each other, not data quality within one.

- **YAGO 4.5** ([SIGIR 2024](https://dl.acm.org/doi/10.1145/3626772.3657876)) — The latest YAGO version itself.

- A new version of YAGO is in development.

#### What Suchanek's group is NOT doing

Notably absent from their agenda:

- **No work on improving Wikidata or YAGO's data quality.** They treat YAGO as a finished artifact — a source of ground truth for evaluating LLMs, not something to be expanded.
- **No reference verification or fact-checking pipeline.** ProVe-style "does this reference support this claim" work isn't in their portfolio.
- **No constraint violation remediation.** They're not trying to fix the 132M facts they threw away.
- **No work on expanding YAGO's coverage.** They accept the 28% loss as the cost of consistency.

The idea of using an LLM to *improve* the KB is almost the inverse of Suchanek's research program.

### Implication

YAGO is read-only and produces periodic static snapshots. Suchanek's group treats it as a finished ground-truth artifact for LLM evaluation, not as something to be expanded. They would likely be interested consumers of a larger quality-verified dataset (it would make YAGO-QA and their benchmarks richer), but they are not going to build it themselves. Their KB-LM architecture — LLM reasoning + KB verification — could potentially be applied in reverse: instead of using the KB to check the LLM, use the LLM to check facts that currently fail KB constraints and see if they can be repaired. Nobody is occupying this space.

---

## Existing Tools and Their Actual Status

### Tools that are actually in production

**ORES / Graph2Text vandalism detection** — The only thing working at scale. The original ORES catches 89% of vandalism while reducing patroller workload by 98%. The newer [Graph2Text system](https://arxiv.org/html/2505.18136v1) (Wikimedia Research, ACL 2025) has been productionized. But this is purely **defensive** — it flags bad edits on ingress. It does not touch the existing backlog.

**Traditional bots** — ~307 bots with bot flag, responsible for the majority of edits. But these are creating the quality problem, not fixing it. They add data at scale with inadequate sourcing.

**[OpenRefine](https://openrefine.org/)** — The primary pathway for structured bulk imports into Wikidata, especially from GLAM institutions (galleries, libraries, archives, museums). Originally Google Refine (acquired from Metaweb/Freebase), it became community-driven in 2012 and added Wikidata support in 2018 (v3.0). Won the [WikidataCon Award 2019](https://openrefine.org/blog/2019/11/02/wikidatacon-award).

The workflow: load tabular data → reconcile columns against Wikidata via fuzzy string matching → build a schema mapping to Wikidata properties → preview and fix → upload at ~60 edits/minute, or export to QuickStatements. Every batch is tracked via [EditGroups](https://editgroups.toolforge.org/?tool=OR).

**Scale:** Over 1,900 editors have used OpenRefine to make **more than 10 million Wikidata edits** and upload hundreds of thousands of files to Wikimedia Commons. Per the [2024 user survey](https://openrefine.org/blog/2025/01/24/Looking-Forward-2025), 76% of users are in research/academic (38%), librarian (33%), GLAM (30%), or Wikimedian (27%) communities.

**Budget and staffing:** Tiny. Fiscally sponsored by [Code for Science and Society](https://www.codeforsociety.org/fsp/projects/openrefine) (CS&S, a 501(c)(3); 15% overhead on donations). As of early 2025, the project has **two paid contributors** — and the lead developer (Antonin Delpeuch) retired from the project in March 2025, leaving one. Developer budget is $7,500/month. Primary funding is a [$50k/year Wikimedia Foundation grant](https://meta.wikimedia.org/wiki/Grants:Programs/Wikimedia_Community_Fund/General_Support_Fund/Maintenance_of_OpenRefine_and_its_Wikimedia-related_extensions.) (renewed annually). They were rejected for $100k from the Data Empowerment Fund, $400k from CZI, and $50k from Mozilla. They received two NLNet grants (~EUR 50k each) for 2026 work on reconciliation improvements. They are actively [fundraising for sustainability](https://openrefine.org/2025-fundraising).

**2025-2026 roadmap** ([priorities](https://openrefine.org/blog/2025/01/24/Looking-Forward-2025), [development roadmap](https://openrefine.org/docs/technical-reference/development-roadmap)):
- AI/Hugging Face integration — "community exploration of integration with an AI platform like Hugging Face for more seamless data wrangling"
- ML-enhanced reconciliation scoring — replacing opaque fuzzy-matching with learned models trained on user annotations
- Native in-app reconciliation of local datasets (NLNet grant, Jan-Aug 2026)
- Hosted/collaborative instances — removing the desktop-only barrier

**What OpenRefine doesn't do:** It's an import tool, not a validation tool. It helps get data *into* Wikidata cleanly but doesn't check whether what's already there is correct. No reference verification, no backlog processing, no autonomous operation. Reconciliation is fuzzy string matching, not semantic. The conceptual model (reconcile entities across datasets) is relevant to verification, and the ML/AI roadmap items suggest they see the opportunity, but they're building a better workbench for humans, not a system that works through the backlog.

### Tools that are deployed but barely used

**[Mismatch Finder](https://www.wikidata.org/wiki/Wikidata:Mismatch_Finder)** — Official Wikimedia Deutschland tool. Accepts bulk uploads of discrepancies between Wikidata and external databases, presents them for human review. The community itself says "the current version is **not widely used**." As of January 2025 the tool was broken (returning server errors). No published statistics on resolved mismatches. They ran a Purdue University student project in 2024 just to get more mismatches uploaded.

### Tools that haven't crossed the deployment gap

**[ProVe](https://www.wikidata.org/wiki/Wikidata:ProVe)** (King's College London) — Three-model pipeline (T5 + 2x BERT) that verbalizes Wikidata claims, finds relevant sentences in referenced URLs, and classifies whether they support the claim. Functional as a user script but **not an official gadget** — blocked because the backend runs on a university VM, not Wikimedia infrastructure. Even if deployed, it's a display tool — it shows verification scores but doesn't produce edits.

**[Wikidata Embedding Project](https://www.wikidata.org/wiki/Wikidata:Embedding_Project)** — Launched October 2025 by Wikimedia Deutschland + Jina.AI + DataStax. Makes Wikidata searchable via vector embeddings, supports MCP. Infrastructure, not a validation tool. Lists fact-checking as a use case but doesn't do it.

### Stalled proposals

**[RFC: AI-Assisted Wikidata Quality Control](https://www.wikidata.org/wiki/Wikidata:Requests_for_comment/Pilot_Project_for_AI-Assisted_Wikidata_Onboarding_%26_Quality_Control)** — Posted August 2025, proposing open-weight LLMs on Wikimedia infrastructure for external identifier verification. Community response was "entirely unclear what exactly is suggested or being built." One commenter pointed out Mismatch Finder already covers the proposed scope. No follow-up, no implementation. Effectively dead.

### Constraint violation reports

Reports exist (maintained by a bot), but **nobody acts on them systematically**. They are advisory wiki pages with no triage workflow. The [summary page](https://www.wikidata.org/wiki/Wikidata:Database_reports/Constraint_violations/Summary) was last updated September 2024.

---

## Academic Literature

### Comprehensive quality studies

- **"A Study of the Quality of Wikidata"** (Shenoy et al., [Journal of Web Semantics 2022](https://www.sciencedirect.com/science/article/abs/pii/S1570826821000536), also [Wikidata Workshop 2022](https://wikidataworkshop.github.io/2022/papers/Wikidata_Workshop_2022_paper_8029.pdf)) — Most comprehensive treatment. Proposes three quality indicators: community consensus, deprecated statements, constraint violations. Key finding: simple validators catch syntactic errors but semantic validation is the hard problem.

- **"Disjointness Violations in Wikidata"** (Dogan & Patel-Schneider, [December 2024](https://arxiv.org/abs/2410.13707)) — ~14,480 "culprit" items each causing hundreds of cascading violations. Largest source: gene items caught between "abstract entity" and "concrete object."

- **"Formalizing Repairs for Wikidata Constraint Violations"** ([ISWC 2025](https://link.springer.com/chapter/10.1007/978-3-032-09527-5_20)) — Taxonomy of repair strategies. Found 52% of type violations fixed by adding missing type statements; 85% of requires-statement violations fixed by adding the required statements. T-box repairs (changing class hierarchy) can fix many violations simultaneously.

### Referencing quality

- **RQSS Framework** (Beghaeiraveri et al., [Semantic Web Journal 2024](https://journals.sagepub.com/doi/full/10.3233/SW-243695)) — 40 reference-specific quality metrics across 21 dimensions. All Wikidata subsets scored low on completeness, verifiability, objectivity, and versatility. Average score: 0.58/1.0.

- **"Towards Automated Technologies in the Referencing Quality of Wikidata"** ([Wikidata Workshop 2022](https://wikidataworkshop.github.io/2022/papers/Wikidata_Workshop_2022_paper_2049.pdf)) — Proposes automated pipelines for verifying whether triples are supported by documented sources.

### LLM-specific

- **KGValidator** ([2024](https://arxiv.org/html/2404.15923v1)) — LLMs for automatic validation of knowledge graph completion. Notes the challenge of relying on manual verification at Wikidata's scale.

- **IBM LLM Store** ([ISWC 2024](https://research.ibm.com/publications/llm-store-a-kif-plugin-for-wikidata-based-knowledge-base-completion-via-llms)) — KIF plugin using LLMs for Wikidata KB completion. Achieved F1 of 90.83% on the LM-KBC Challenge.

- **"Using Language Models for Wikidata Vandalism Detection"** ([ACL 2025](https://arxiv.org/pdf/2505.18136)) — Binary classification using LM features. Companion [dataset on Zenodo](https://zenodo.org/records/15492678) (6.85 GB).

- **"Scholarly Wikidata"** ([2024](https://arxiv.org/html/2411.08696v1)) — LLMs to populate Wikidata with conference metadata, using human-in-the-loop validation.

- **Suchanek: "Knowledge Bases and Language Models: Complementing Forces"** ([RuleML+RR 2023](https://link.springer.com/chapter/10.1007/978-3-031-45072-3_1)) — Argues structured KBs and LLMs are complementary paradigms that will co-exist.

---

## Domain-Specific Backlog Characteristics

### Taxonomic / biological data — worst for constraint violations
~10,753 disjointness violations from gene items alone. Ontological confusion between abstract and concrete entities. The Gene Wiki WikiProject has high reference quality scores (active bots) but severe typing problems.

### Biographical data
Inconsistent ontology and property usage. Active cleanup of unreferenced P106 (occupation) values. Date consistency (birth before death, etc.) is highly structured and amenable to automated checking.

### Geographic data
No geographic or temporal precision constraints are implemented despite community proposals. Essentially unmonitored at the constraint level.

### Music
Lowest referencing quality score among topical subsets in the RQSS framework.

### Statements amenable to LLM verification

Several large, systematic categories seem particularly tractable:

1. **External identifier verification** — Check whether IDs (VIAF, ISNI, Library of Congress, etc.) resolve and point to the same entity. Well-defined, low-ambiguity.

2. **"Imported from Wikipedia" reference replacement** — For the hundreds of millions of P143-only statements: read the Wikipedia article the claim was imported from, find the actual cited source, propose a proper reference.

3. **Type constraint violations** — 52% fixable by adding a missing `instance of` or `subclass of`. An LLM reading the item's description and properties could propose the missing type.

4. **Biographical consistency** — Date ordering, occupation-matches-description, nationality-matches-birthplace. Highly structured checks cross-referenceable against Wikipedia articles.

5. **Disjointness violations in biological data** — Ontological confusion amenable to specialized prompts understanding biological taxonomy.

---

## Community Landscape

### Communication channels (all bridged together)

- **IRC**: `#wikidata` on Libera Chat, bridged to Matrix — [Wikidata:IRC](https://www.wikidata.org/wiki/Wikidata:IRC)
- **Telegram**: Bridged to IRC; WikiProject-specific groups exist
- **Discord**: `#wikidata` on Wikimedia community server — [Wikidata:Discord](https://www.wikidata.org/wiki/Wikidata:Discord)
- **Wikimedia Chat (Mattermost)**: chat.wmcloud.org (messages expire after 90 days)
- **On-wiki**: [Wikidata:Project chat](https://www.wikidata.org/wiki/Wikidata:Project_chat) — where governance and policy discussions happen

### Community stance on AI/LLM editing

The community is cautious but not closed:
- Bot permission requests involving LLMs face scrutiny on [Wikidata:Requests for permissions/Bot](https://www.wikidata.org/wiki/Wikidata:Requests_for_permissions/Bot)
- The Wikidata Workshop 2025 explicitly invited research on "Automated Fact-Checking and Bias Reduction" using LLMs
- Community members distinguish between **internal consistency work** (seen as promising — "internal tidying can be based on Q and P numbers with no understanding") and **external matching** (seen as risky — "so much scope for damage")
- Strong preference for **human-in-the-loop**: AI proposes, humans decide
- English Wikipedia's [2018 State of Affairs on Wikidata](https://en.wikipedia.org/wiki/Wikipedia:Wikidata/2018_State_of_affairs) documents concerns about circular sourcing and false authority

### The Wikibase ecosystem

The underlying Wikibase software is open source. Dozens of organizations run independent instances: EU Knowledge Graph, German National Library, French National Library, British Library, Rhizome, FactGrid, and others. Each defines its own ontology and quality standards. The [Wikibase ecosystem](https://professional.wiki/en/wikibase-wikidata-and-knowledge-graphs) vision is eventual federation, but today they are mostly islands.

### Nobody has proposed a community fork

No "let's leave and build our own Wikidata" proposal exists. YAGO is the closest thing — a curated downstream rebuild that implicitly says "the data quality problems are severe enough that serious users would rather re-derive the whole thing than work with it directly."

---

## The Gap

The landscape is:
- **Wikidata** is the only place where data gets added at scale, but it's too messy for rigorous use
- **YAGO** makes it clean but read-only and static, and only subtracts — it doesn't expand what qualifies
- **Existing tools** are either academic prototypes, barely used, or defensive-only
- **Nobody** is occupying the space of systematically expanding the set of facts that meet high quality standards

An LLM-based approach could work in this gap: starting from YAGO's quality-filtered base (or similar standards), identify facts currently excluded due to missing references, type violations, or constraint failures, and use LLM verification to bring them up to standard — producing a larger, high-quality knowledge graph without requiring direct edits to Wikidata itself.
