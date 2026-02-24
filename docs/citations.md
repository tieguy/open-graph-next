# Citation List

References relevant to the open-graph-next project: using LLMs to improve the open, human-readable knowledge graph.

> **Note:** Unless otherwise attributed, summaries are by Claude (Anthropic), not by Luis Villa.

Last updated: 2026-02-24

---

## Truth, Free Speech, and Open Knowledge

- **Michael C. Dorf.** ["Supporting and Implementing Truth as a Free Speech Value."](https://knightcolumbia.org/blog/supporting-and-implementing-truth-as-a-free-speech-value) Knight First Amendment Institute at Columbia University, February 2026.
  Argues that truth plays a surprisingly minor role in modern First Amendment doctrine, and proposes empowering truth-gathering and truth-verifying entities — including standalone nonprofit news organizations like ProPublica and crowdsourced knowledge hubs like Wikipedia — as an institutional counterweight to the spread of falsehood.

- **Jessica Hullman.** ["Living the Metascience Dream or Nightmare."](https://jessicahullman.substack.com/p/living-the-metascience-dream-or-nightmare) Substack, 2026.
  *(Article too new to summarize at time of writing.)*

## Methodology Foundations

- **Mike Caulfield.** [SIFT Toolbox / CheckPlease.](https://checkplease.neocities.org) Neocities.
  A lengthy instruction prompt and human-in-the-loop methodology that outperforms unmodified LLMs at fact-checking and contextualization, modeling a "research assistant" approach rather than a chatbot approach. The SIFT method (Stop, Investigate the source, Find better coverage, Trace claims) is foundational to this project's approach.

- **Maggie Appleton.** ["Gas Town."](https://maggieappleton.com/gastown) maggieappleton.com.
  A speculative design fiction exploring what comes after the current paradigm — framing the question of what a "world in which every single human being can freely share in the sum of all knowledge" looks like in an LLM-changed landscape.

## Wikidata Quality: The Scale of the Problem

- **Shenoy, K. et al.** ["A Study of the Quality of Wikidata."](https://www.sciencedirect.com/science/article/abs/pii/S1570826821000536) *Journal of Web Semantics*, 2022. Also at [Wikidata Workshop 2022](https://wikidataworkshop.github.io/2022/papers/Wikidata_Workshop_2022_paper_8029.pdf).
  The most comprehensive treatment of Wikidata quality. Proposes three quality indicators (community consensus, deprecated statements, constraint violations) and finds that simple validators catch syntactic errors but semantic validation is the hard, unsolved problem.

- **Piscopo, A. & Simperl, E.** ["A Study of the Quality of Wikidata."](https://arxiv.org/pdf/2107.00156) arXiv, 2021.
  Surveys approaches to assessing Wikidata quality; found that when constraint violations appear, 63% of active editors said the data "often" needs correction.

- **Dogan, G. & Patel-Schneider, P.** ["Disjointness Violations in Wikidata."](https://arxiv.org/abs/2410.13707) arXiv, December 2024.
  Identifies ~14,480 "culprit" items in Wikidata that each cause hundreds of cascading constraint violations, with the largest source being gene items caught between "abstract entity" and "concrete object" classifications.

- **Beghaeiraveri, S. et al.** ["RQSS: A Framework for Evaluating the Referencing Quality of Wikidata."](https://journals.sagepub.com/doi/full/10.3233/SW-243695) *Semantic Web Journal*, 2024.
  Proposes 40 reference-specific quality metrics across 21 dimensions. All Wikidata subsets studied scored low on completeness, verifiability, objectivity, and versatility, with an average score of 0.58 out of 1.0.

- **Ferranti, N. et al.** ["Formalizing Repairs for Wikidata Constraint Violations: A Taxonomy and Empirical Analysis."](https://link.springer.com/chapter/10.1007/978-3-032-09527-5_20) *ISWC 2025*. [PDF](https://aic.ai.wu.ac.at/~polleres/publications/ferr-etal-2025ISWC.pdf).
  Formalizes a taxonomy of repair strategies for Wikidata constraint violations, finding that 52% of type violations can be fixed by adding missing type statements and that T-box repairs (changing the class hierarchy) can fix many violations simultaneously.

- **Ferranti, N. et al.** ["Formalizing and Validating Wikidata's Property Constraints using SHACL and SPARQL."](https://www.semantic-web-journal.net/content/formalizing-and-validating-wikidatas-property-constraints-using-shaclsparql) *Semantic Web Journal*, 2024.
  Provides complete SPARQL formulations for all 30+ Wikidata constraint types, enabling programmatic constraint checking outside of Wikidata's own infrastructure.

## YAGO and Knowledge Base Curation

- **Tanon, T.P., Weikum, G. & Suchanek, F.** ["YAGO 4: A Reason-able Knowledge Base."](https://link.springer.com/chapter/10.1007/978-3-030-49461-2_34) *ESWC 2020*. [PDF](https://suchanek.name/work/publications/eswc-2020-yago.pdf).
  Core paper on YAGO 4, which filters Wikidata through strict OWL 2 DL constraints (domain, range, disjointness, cardinality), discarding 28% of all facts (132 million) to produce a logically consistent knowledge base.

- **Suchanek, F. et al.** ["YAGO 4.5: A Large and Clean Knowledge Base with a Rich Taxonomy."](https://dl.acm.org/doi/10.1145/3626772.3657876) *SIGIR 2024*. [arXiv](https://arxiv.org/html/2308.11884v2).
  Restores more of Wikidata's taxonomy (10,124 of ~2.4 million classes) while maintaining logical consistency, though with pickier entity filtering (64M → 49M entities).

- **Tanon, T.P. & Suchanek, F.** ["Neural Knowledge Base Repairs."](https://suchanek.name/work/publications/eswc-2021.pdf) *ESWC 2021*.
  Uses ML trained on historical Wikidata edit patterns to suggest fixes for constraint violations; found 1 million domain violations and 4.4 million single-value violations as of March 2020.

- **Peng, Y., Bonald, T. & Alam, M.** ["Refining Wikidata Taxonomy using Large Language Models (WiKC)."](https://arxiv.org/abs/2409.04056) *CIKM 2024*. [GitHub](https://github.com/peng-yiwen/WiKC).
  Applies LLMs to clean Wikidata's taxonomy, improving entity typing accuracy from 43% (raw Wikidata) to 70% (cleaned).

- **Suchanek, F.** ["Knowledge Bases and Language Models: Complementing Forces."](https://link.springer.com/chapter/10.1007/978-3-031-45072-3_1) *RuleML+RR 2023*.
  Argues that structured knowledge bases and LLMs are complementary paradigms: KBs provide ground truth, LLMs provide natural language understanding, and both will co-exist.

- **Suchanek, F. & Holzenberger, N.** ["Knowledge-Based Language Models" (KB-LM).](https://suchanek.name/work/research/kb-lm/kb-lm-white-paper.pdf) White paper. [Project page](https://suchanek.name/work/research/kb-lm/index.html).
  Proposes an architecture where LLMs handle reasoning while KBs provide and verify facts, with the goal of making LLMs stop hallucinating, become auditable, and become smaller by not needing to memorize facts.

- **Suchanek, F.** ["On Language Models and Knowledge Bases."](http://files.inria.fr/almanach/files/seminars/ALMAnaCH-seminar-2025-11-21-fabian-suchanek.pdf) ALMAnaCH Seminar, November 2025.
  Argues that "the fundamental problem is that language models are probabilistic, while truth is not" and that the KB-LM architecture — LLM reasoning verified by structured knowledge — can address this.

## LLMs and Knowledge Graphs

- **Wikimedia Research.** ["Using Language Models for Wikidata Vandalism Detection."](https://arxiv.org/pdf/2505.18136) *ACL 2025*. [Dataset](https://zenodo.org/records/15492678).
  Binary classification using language model features for detecting vandalism in Wikidata edits; the productionized Graph2Text system is the only LLM-based quality tool currently working at scale on Wikidata.

- **KGValidator.** ["LLMs for Automatic Validation of Knowledge Graph Completion."](https://arxiv.org/html/2404.15923v1) arXiv, 2024.
  Explores using LLMs for automatic validation of knowledge graph completion, noting the challenge of relying on manual verification at Wikidata's scale.

- **IBM Research.** ["LLM Store: A KIF Plugin for Wikidata-based Knowledge Base Completion via LLMs."](https://research.ibm.com/publications/llm-store-a-kif-plugin-for-wikidata-based-knowledge-base-completion-via-llms) *ISWC 2024*.
  KIF plugin using LLMs for Wikidata knowledge base completion, achieving an F1 score of 90.83% on the LM-KBC Challenge.

- **"Scholarly Wikidata."** [arXiv, 2024.](https://arxiv.org/html/2411.08696v1)
  Uses LLMs to populate Wikidata with conference metadata through a human-in-the-loop validation approach.

- **Suchanek, F. et al.** ["Retrieval-Constrained Decoding."](https://arxiv.org/abs/2509.23417) arXiv, September 2025.
  Shows LLMs know more facts than standard evaluation suggests — the problem is surface form variation ("NYC" vs. "New York City"). Using YAGO as ground truth with a 19,137-question dataset, Llama-3.1-70B's F1 jumps from 32.3% to 46.0% when aliases are accounted for.

- **Delétang, G. et al.** ["Reconfidencing LLMs from the Grouping Loss Perspective."](https://aclanthology.org/2024.findings-emnlp.85/) *EMNLP 2024 Findings*.
  Uses YAGO entities to demonstrate that LLM confidence scores are systematically biased by demographics — models are more overconfident about facts involving certain nationalities. Proposes per-subgroup calibration.

## Wikipedia, AI, and Information Integrity

- **Wagner, C.** ["Death by AI: Will large language models diminish Wikipedia?"](https://asistdl.onlinelibrary.wiley.com/doi/10.1002/asi.24975) *Journal of the Association for Information Science and Technology*, 2025.
  Analyzes the existential threat LLMs pose to Wikipedia's contributor ecosystem and the downstream implications for knowledge production.

- **Dergacheva, I. et al.** ["An Endangered Species: How LLMs Threaten Wikipedia's Sustainability."](https://link.springer.com/article/10.1007/s00146-025-02199-9) *AI & Society*, 2025.
  Documents how volunteer editors risk burnout as knowledge-sharing becomes "an increasingly investigative and adversarial process" of verifying machine-produced content.

- **"Wikipedia in the Era of LLMs: Evolution and Risks."** [arXiv, 2025.](https://arxiv.org/html/2503.02879v1)
  Surveys how LLMs are changing Wikipedia's knowledge production processes and the risks they introduce.

- **"Machines in the Margins: A Systematic Review of Automated Content Generation for Wikipedia."** [arXiv, 2025.](https://arxiv.org/html/2509.22443)
  Systematic review of automated content generation approaches for Wikipedia, covering both historical bot systems and emerging LLM methods.

- **Wikimedia Foundation.** ["The 3 Building Blocks of Trustworthy Information: Lessons from Wikipedia."](https://wikimediafoundation.org/news/2025/10/02/the-3-building-blocks-of-trustworthy-information-lessons-from-wikipedia/) October 2025.
  Distills Wikipedia's approach to trustworthy information into three pillars; institutional perspective on maintaining knowledge quality.

- **NPR.** ["Wikipedia Editors Publish New Guide to Help Readers Detect Entries Written by AI."](https://www.npr.org/2025/09/04/nx-s1-5519267/wikipedia-editors-publish-new-guide-to-help-readers-detect-entries-written-by-ai) September 2025.
  Reports on the Wikipedia community's efforts to help readers identify AI-generated content, reflecting the growing scale of the problem.

- **The Decoder.** ["Here's How to Spot AI Writing, According to Wikipedia Editors."](https://the-decoder.com/heres-how-to-spot-ai-writing-according-to-wikipedia-editors/) 2025.
  Covers the same Wikipedia AI detection guide with additional context on the specific linguistic and formatting patterns that flag AI-generated text.

- **Sarabadani, A. et al.** ["Building Automated Vandalism Detection Tools for Wikidata."](https://wikiworkshop.org/2017/papers/p1647-sarabadani.pdf) *Wiki Workshop*, 2017.
  Early work on automated vandalism detection for Wikidata, providing the foundation for the ORES system that now catches 89% of vandalism while reducing patroller workload by 98%.

## Digital Humanities and Open Knowledge Infrastructure

- **Rossenova, L. et al.** [Systematic Review of Wikidata in Digital Humanities.](https://academic.oup.com/dsh/article/38/2/852/6964525) *Digital Scholarship in the Humanities*, Oxford Academic, 2023.
  Systematic review of how Wikidata is used across digital humanities projects, documenting adoption patterns and challenges.

- **Halperin, J.R.** [Cooperative knowledge infrastructure.](https://jennierosehalperin.me)
  Inspiration for the "Rabbit Hole Browser" sub-project's approach to cooperative knowledge infrastructure connecting open sources.

## Referencing Quality

- **"Towards Automated Technologies in the Referencing Quality of Wikidata."** [Wikidata Workshop, 2022.](https://wikidataworkshop.github.io/2022/papers/Wikidata_Workshop_2022_paper_2049.pdf)
  Proposes automated pipelines for verifying whether Wikidata triples are supported by their documented sources — directly relevant to the "imported from Wikipedia" circular reference problem.
