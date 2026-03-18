# Related Work: Cite-Checking with LLMs

Extracted from [Phabricator T399642: \[Signal\] Identify cases where reference does not support published claim](https://phabricator.wikimedia.org/T399642) and related resources. This task tracks Wikimedia's own exploration of using LLMs to verify that citations actually support the claims they're attached to.

## Context

T399642 is part of the Wikimedia Edit Checks initiative within VisualEditor. The goal: when a new sentence is added with a citation, or when reviewing existing content, automatically flag cases where the reference doesn't support the published claim. This is directly analogous to our SIFT-Patrol work, but operating on Wikipedia article text rather than Wikidata structured claims.

### Key challenges noted in the task

- **Claim extraction**: Varying approaches from basic heuristics (grab the sentence or paragraph) to LLM-based extraction of the specific claim. The task references "Dense X Retrieval" for optimal granularity.
- **Source access**: Paywalled and bot-blocking content makes it hard to fetch the actual cited source. False positives from inaccessible sources are a real concern — mirrors our experience with `blocked_domains.yaml`.
- **Scope**: Applying a model to existing content ("Suggested Edits") is harder than intercepting new edits, because you must isolate the specific claim without fact-checking the entire passage.

## Related Phabricator Tasks

- [T414816: Exploration of automated verifiability checks](https://phabricator.wikimedia.org/T414816) — Wikimedia Research initiative (FY2025-26, Jan–Mar) exploring automated verifiability. Assigned to Isaac.
- [T360489: Generate and present edit suggestions at scale](https://phabricator.wikimedia.org/T360489) — Broader edit suggestions infrastructure.

## Key Papers

### 1. How Grounded is Wikipedia? A Study on Structured Evidential Support and Retrieval

- **Authors**: William Walden, Kathryn Ricci, Miriam Wanner, Zhengping Jiang, Chandler May, Rongkun Zhou, Benjamin Van Durme
- **Links**: [arXiv:2506.12637](https://arxiv.org/abs/2506.12637) · [OpenReview](https://openreview.net/forum?id=4rzbZnDRBW)
- **Described as the closest analog to T399642's goals.**
- **Dataset**: PeopleProfiles — large-scale, multi-level claim support annotations on biographical Wikipedia articles.
- **Key findings**:
  - ~20% of claims in Wikipedia lead sections are unsupported by the article body.
  - ~27% of claims in article bodies are unsupported by their cited sources.
  - >80% of lead claims cannot be traced to cited sources via annotated body evidence.
  - Recovery of complex grounding evidence remains a challenge for standard retrieval.
- **Method**: Uses GPT-4o-mini for claim decomposition ("DnD" method — joint contextualized/decontextualized subclaims). LLM re-ranking is important as a final step after basic retrieval.
- **Relevance to our work**: Their ~27% body-unsupported rate on biographies provides a useful baseline for comparing our Wikidata-side verification. Different domain (free text vs. structured claims), but the claim decomposition and multi-level verification approach is instructive.

### 2. WiCE: Real-World Entailment for Claims in Wikipedia

- **Authors**: Ryo Kamoi, Tanya Goyal, Juan Diego Rodriguez, Greg Durrett
- **Links**: [arXiv:2303.01432](https://arxiv.org/abs/2303.01432) · [ACL Anthology (EMNLP 2023)](https://aclanthology.org/2023.emnlp-main.470/) · [GitHub](https://github.com/ryokamoi/wice)
- **Noted in T399642 as taking a similar approach but with smaller language models.**
- **Dataset**: Fine-grained textual entailment dataset built on natural claim/evidence pairs from Wikipedia. Sentences citing webpages are annotated for whether cited content entails the sentence.
- **Key contributions**:
  - Entailment judgments at the sub-sentence level, with minimal evidence subsets per subclaim.
  - Automatic claim decomposition via GPT-3.5 improves entailment model performance.
  - Real Wikipedia claims involve harder verification and retrieval problems than existing entailment benchmarks.
- **Relevance to our work**: The sub-claim decomposition approach is relevant to how we break down Wikidata edits into individually verifiable claims. Their dataset could serve as a benchmark for comparing our SIFT methodology's precision.

### 3. Detecting Corpus-Level Knowledge Inconsistencies in Wikipedia with LLMs

- **Authors**: Sina J. Semnani et al. (Stanford)
- **Links**: [arXiv:2509.23233](https://arxiv.org/abs/2509.23233) · [GitHub](https://github.com/stanford-oval/inconsistency-detection) · [EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1765.pdf)
- **Noted in T399642 for solid data pipeline ideas; focuses on fact-checking Wikipedia against itself.**
- **System**: CLAIRE — agentic system combining LLM reasoning with retrieval to surface inconsistent claims with contextual evidence for human review.
- **Dataset**: WIKICOLLIDE — first benchmark of real Wikipedia inconsistencies.
- **Key findings**:
  - At least 3.3% of English Wikipedia facts contradict another fact elsewhere in Wikipedia.
  - Inconsistencies propagate into downstream datasets: 7.3% of FEVEROUS, 4.0% of AmbigQA.
  - Best automated system achieves AUROC of only 75.1% — substantial headroom.
  - History articles have the highest inconsistency rate (17.7%); Mathematics the lowest (5.6%).
  - In user study, Wikipedia editors found 64.7% more inconsistencies with CLAIRE assistance.
- **Relevance to our work**: The "Wikipedia vs. itself" approach complements our "Wikidata claims vs. external sources" approach. Their inconsistency rates by domain could inform which Wikidata property domains to prioritize. CLAIRE's agentic architecture (LLM + retrieval) is similar to our SIFT tool-use pattern.

### 4. Dense X Retrieval: What Retrieval Granularity Should We Use?

- **Authors**: Tong Chen, Hongwei Wang, Sihao Chen, Wenhao Yu, Kaixin Ma, Xinran Zhao, Hongming Zhang, Dong Yu
- **Links**: [arXiv:2312.06648](https://arxiv.org/abs/2312.06648) · [ACL Anthology (EMNLP 2024)](https://aclanthology.org/2024.emnlp-main.845/) · [GitHub](https://github.com/chentong0/factoid-wiki)
- **Referenced in T399642 for claim extraction granularity.**
- **Key idea**: Introduces "proposition" as a retrieval unit — atomic, self-contained factoid expressions. Outperforms passage and sentence retrieval for both retrieval accuracy and downstream QA.
- **Resources**: FactoidWiki dataset (Wikipedia indexed at proposition level), Propositionizer model on HuggingFace.
- **Relevance to our work**: Wikidata claims are already at roughly proposition granularity (subject-property-value triples), which may be an inherent advantage over free-text verification approaches that must first decompose text into atomic claims.

## Comparison with Our SIFT-Patrol Approach

| Dimension | T399642 / Papers | Our SIFT-Patrol |
|---|---|---|
| **Domain** | Wikipedia free text | Wikidata structured claims |
| **Granularity** | Must decompose sentences → subclaims | Claims already atomic (S-P-V triples) |
| **Source access** | Cited URLs (paywalls, 403s) | External sources via web search |
| **Verification** | Entailment/NLI models or LLMs | LLM + web search tool use (SIFT) |
| **Scale tested** | 1,485 entities (PeopleProfiles); WIKICOLLIDE benchmark | 45 verdicts on 50 unpatrolled edits |
| **Error rates found** | ~27% unsupported (body claims); 3.3% inconsistent | 26.7% incorrect; 70% error rate on P31/P279 |
| **Human-in-loop** | CLAIRE user study | Approval gates before any edit |
| **Multi-model** | GPT-4o, GPT-4o-mini, Llama-3.1-70B | Sonnet 4.6, Haiku, DeepSeek, OLMo, Nemotron |

## Community Suggestions from T399642

- A community member proposed "AI agents that can spot fake references and references that don't support the content cited to them" — arguing this could address ~90% of current AI-related quality problems on Wikipedia.
- English Wikipedia uses the `{{Failed verification}}` template for marking cases where a source doesn't support the claim.
- The recommended approach: gather claims + citations, scrape sources, run through multiple LLMs or fine-tuned models to gauge accuracy with a basic setup — essentially what our verdict fanout does for Wikidata.
