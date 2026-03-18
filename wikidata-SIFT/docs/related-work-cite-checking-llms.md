# Related Work: Cite-Checking with LLMs

Extracted from [Phabricator T399642: \[Signal\] Identify cases where reference does not support published claim](https://phabricator.wikimedia.org/T399642) and related resources. This task tracks Wikimedia's own exploration of using LLMs to verify that citations actually support the claims they're attached to.

## Context

T399642 is part of the Wikimedia Edit Checks initiative within VisualEditor. The goal: when a new sentence is added with a citation, or when reviewing existing content, automatically flag cases where the reference doesn't support the published claim. This is directly analogous to our SIFT-Patrol work, but operating on Wikipedia article text rather than Wikidata structured claims.

### Key challenges noted in the task

- **Claim extraction**: Varying approaches from basic heuristics (grab the sentence or paragraph) to LLM-based extraction of the specific claim. The task references "Dense X Retrieval" for optimal granularity.
- **Source access**: Paywalled and bot-blocking content makes it hard to fetch the actual cited source. False positives from inaccessible sources are a real concern — mirrors our experience with `blocked_domains.yaml`.
- **Scope**: Applying a model to existing content ("Suggested Edits") is harder than intercepting new edits, because you must isolate the specific claim without fact-checking the entire passage.

## Related Phabricator Tasks

- [T276857: Surface Reference Reliability signal within VE](https://phabricator.wikimedia.org/T276857) — Meta-task for equipping editors with tools to assess source reliability when adding or encountering citations in VisualEditor. Tags: VisualEditor, EditCheck, Community-Wishlist-Survey-2023, Editing-team. Key research findings referenced: percentage of English Wikipedia sentences missing a citation dropped 20% in the last decade; non-authoritative sources stayed below 1%; experienced editors make better reference quality changes; new editors who co-edit with experienced editors are more likely to avoid risky references in future edits; untrustworthy sources in one language persist across other language versions.
- [T352134: Build reference reliability check MVP](https://phabricator.wikimedia.org/T352134) — Implementation of reference reliability checking in VisualEditor. First step: warn when editors cite domains a project has deemed spam. Future vision: use consensus stored in [WP:RSP](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) (Reliable Sources Perennial list) to offer real-time feedback about source reliability. Part of the broader [EditCheck system](https://www.mediawiki.org/wiki/Edit_check/Status/2023) that went live Oct 11, 2023.
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

## Active Community Tools

### 5. AI Source Verification (Wikipedia Userscript)

- **Author**: Wikipedia user [Alaexis](https://en.wikipedia.org/wiki/User:Alaexis), with contributions from [Polygnotus](https://en.wikipedia.org/wiki/User:Polygnotus)
- **Links**: [User:Polygnotus/Scripts/AI Source Verification](https://en.wikipedia.org/wiki/User:Polygnotus/Scripts/AI_Source_Verification) · [User:Alaexis/AI Source Verification](https://en.wikipedia.org/wiki/User:Alaexis/AI_Source_Verification)
- **Part of**: [WikiProject AI Tools](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Tools)
- **What it does**: A Wikipedia userscript that checks whether a cited source actually supports the claim it's attached to. Works for sources available online. Editors can run it while viewing articles to get per-citation verification.
- **Models supported**: Open-source models (free), Claude, Gemini (free), or ChatGPT — editor's choice.
- **Relevance to our work**: This is the closest community-facing analog to our SIFT-Patrol. It operates on individual Wikipedia citations in real-time (userscript in the browser), whereas we batch-process Wikidata edits. The multi-model support mirrors our verdict fanout approach.

### 6. CitationVerification (Python Script)

- **Author**: Wikipedia user [Polygnotus](https://en.wikipedia.org/wiki/User:Polygnotus)
- **Link**: [User:Polygnotus/CitationVerification](https://en.wikipedia.org/wiki/User:Polygnotus/CitationVerification)
- **What it does**: A Python script that uses MiniCheck (an NLI-based fact-verification model) and Claude to check if a source supports a claim. Companion to the browser-based AI Source Verification userscript.
- **Relevance to our work**: The MiniCheck + LLM hybrid approach is notable — using a lightweight NLI model as a fast first pass, then escalating to a larger LLM. Could inform a tiered approach for our verdict fanout (cheap model for easy cases, expensive model for hard ones).

### 7. Wiki Cite Checker (Web App)

- **Link**: [wiki-cite-checker.replit.app](https://wiki-cite-checker.replit.app/)
- **What it does**: Web app for Wikipedia citation verification (appears related to the Polygnotus/Alaexis tooling ecosystem). Blocked by proxy at time of research — details TBD.

### 8. Citation Checker Script + LLM Benchmarking

- **Author**: [alex-o-748](https://github.com/alex-o-748) (likely Polygnotus/Alaexis based on cross-references)
- **Links**: [GitHub](https://github.com/alex-o-748/citation-checker-script) · [LLM Benchmarking](https://github.com/alex-o-748/citation-checker-script/blob/main/Citation%20Verification%20-%20LLM%20Benchmarking.md)
- **What it does**: JavaScript-based citation checker with a systematic LLM benchmarking suite. Tests models on a ground-truth dataset of 76 claim-citation pairs from Wikipedia articles, classified as Supported / Partially supported / Not supported.
- **Benchmarking results** (76 claim-citation pairs, temperature 0.1):

| Model | Exact Accuracy | Lenient Accuracy | Avg Latency | Confidence Calibration |
|---|---|---|---|---|
| **Claude Sonnet 4.5** | **75.0%** | **76.3%** | 4,093ms | 39.04 |
| Qwen-SEA-LION-v4-32B | 73.3% | 74.7% | 3,657ms | 30.25 |
| OLMo-3.1-32B | 66.7% | 66.7% | 3,002ms | 43.20 |
| Apertus-70B | 57.3% | 60.0% | 4,398ms | 8.15 |

- **Key findings**:
  - Claude Sonnet 4.5 wins on accuracy and confidence calibration (86.9% confidence when correct vs. 47.9% when wrong).
  - Qwen-SEA-LION nearly matches Claude as best open-source option (73.3% vs 75.0%).
  - Apertus-70B is overly conservative — labels many "Supported" claims as "Partially supported" (24/60 cases), creating false positives.
  - **Dangerous false negatives** (missing real problems): Qwen missed 9, Claude 6, OLMo 6, Apertus 5. These are cases where unsupported claims pass verification.
  - **Subtle numerical inaccuracies fool all models**: A case where the source said "40K–120K" but Wikipedia claimed "50K–100K" was marked "Supported" by 3 of 4 models. Models treat "close enough" numbers as matches.
  - "Not Supported" category is underrepresented (only 5 of 76 examples), making it hard to evaluate detection of the most critical failures.
- **Technical notes**: Uses trafilatura for source text extraction (30% cleaner than regex). Compound claims before a single citation create ambiguity about what the source actually supports. Researcher feedback suggests a three-way input (claim, paragraph context, source text) improves results.
- **Relevance to our work**: Directly comparable to our verdict fanout. Their 75% accuracy ceiling on Wikipedia text verification is a useful benchmark. The false negative analysis is especially relevant — in our Wikidata context, missing a bad edit (false accept) is more costly than flagging a good one (false reject). Their dataset construction methodology (semi-random article selection, manual ground truth) parallels our labeled evaluation dataset approach. OLMo and Claude are models we also test.

### 9. SIDE: Improving Wikipedia Verifiability with AI

- **Authors**: Fabio Petroni, Samuel Broscheit, Aleksandra Piktus et al. (Samaya AI / Meta FAIR)
- **Links**: [Nature Machine Intelligence (2023)](https://www.nature.com/articles/s42256-023-00726-1) · [Wikidata item](https://www.wikidata.org/wiki/Q123138220)
- **What it does**: Neural system that identifies Wikipedia citations unlikely to support their claims and recommends better alternatives from the web. Uses Sphere retrieval engine + fine-tuned BERT verification engine.
- **Key results**: For the top 10% most likely unverifiable citations, humans preferred SIDE's suggested alternative 70% of the time. Wikipedia editors preferred SIDE's first recommendation twice as often as the existing citation.
- **Relevance to our work**: SIDE goes beyond detection to recommendation — not just "this citation is bad" but "here's a better one." Our SIFT approach currently stops at verdict (accept/reject/suspect); SIDE's recommendation step is a potential future extension. Their fine-tuned BERT verifier is a different architecture from our LLM-based approach.

## Comparison with Our SIFT-Patrol Approach

| Dimension | T399642 / Papers | Community Tools | Our SIFT-Patrol |
|---|---|---|---|
| **Domain** | Wikipedia free text | Wikipedia free text | Wikidata structured claims |
| **Granularity** | Must decompose sentences → subclaims | Per-citation in article | Claims already atomic (S-P-V triples) |
| **Source access** | Cited URLs (paywalls, 403s) | Cited URLs + trafilatura | External sources via web search |
| **Verification** | Entailment/NLI models or LLMs | LLMs (multi-model) + MiniCheck | LLM + web search tool use (SIFT) |
| **Scale tested** | 1,485 entities (PeopleProfiles); WIKICOLLIDE benchmark | 76 claim-citation pairs | 45 verdicts on 50 unpatrolled edits |
| **Accuracy** | ~27% unsupported; 3.3% inconsistent | 75% exact accuracy (best model) | 26.7% incorrect; 70% error on P31/P279 |
| **Human-in-loop** | CLAIRE user study | Wikipedia editor use | Approval gates before any edit |
| **Multi-model** | GPT-4o, GPT-4o-mini, Llama-3.1-70B | Claude, Qwen, OLMo, Apertus | Sonnet 4.6, Haiku, DeepSeek, OLMo, Nemotron |
| **Deployment** | Research papers | Userscript + web app | Research experiment |

## Community Suggestions from T399642

- A community member proposed "AI agents that can spot fake references and references that don't support the content cited to them" — arguing this could address ~90% of current AI-related quality problems on Wikipedia.
- English Wikipedia uses the `{{Failed verification}}` template for marking cases where a source doesn't support the claim.
- The recommended approach: gather claims + citations, scrape sources, run through multiple LLMs or fine-tuned models to gauge accuracy with a basic setup — essentially what our verdict fanout does for Wikidata.

## Key Takeaways for Our Work

1. **We're not alone**: There's a growing ecosystem of cite-checking tools operating on Wikipedia text. Our Wikidata-side work is complementary and distinct (structured claims vs. free text).
2. **75% accuracy ceiling**: The best LLM achieves ~75% exact accuracy on Wikipedia citation verification. Our verdict fanout should benchmark against this.
3. **False negatives are the real danger**: Missing bad edits is costlier than over-flagging good ones. The benchmarking data shows all models have blind spots, especially for subtle numerical inaccuracies.
4. **Multi-model helps**: Both the community tools and our fanout use multiple models. The benchmarking shows meaningfully different error profiles per model — ensemble approaches should reduce blind spots.
5. **MiniCheck as fast filter**: The community's use of MiniCheck (lightweight NLI model) as a first pass before LLMs suggests a tiered architecture worth exploring for scaling our verdict pipeline.
6. **Proposition granularity is our advantage**: Wikidata's S-P-V structure means we skip the hardest part of the Wikipedia text pipeline (claim decomposition). This should show up as higher accuracy on comparable tasks.
