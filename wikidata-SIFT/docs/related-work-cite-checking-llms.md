# Related Work: Cite-Checking with LLMs

Extracted from [Phabricator T399642: \[Signal\] Identify cases where reference does not support published claim](https://phabricator.wikimedia.org/T399642) and related resources. This task tracks Wikimedia's own exploration of using LLMs to verify that citations actually support the claims they're attached to.

---

## ORES vs. SIFT-Patrol: Style vs. Content

### Slide version

- **ORES checks the _style_ of an edit**: Does it _look like_ vandalism? Character ratios, byte counts, bad-word detectors, boolean property flags. Fast, cheap, no understanding of truth.
- **SIFT checks the _content_ of an edit**: Is the claim _actually correct_? Reads cited sources, searches for corroboration, reasons about whether evidence supports the specific claim. Slow, expensive, understands meaning.
- **ORES features are ~67 hand-engineered statistics**: Numeric/boolean features fed to a gradient-boosted classifier (700 estimators, 0.985 ROC-AUC). No access to external sources. No semantic understanding.
- **SIFT features are ~15 structured inputs + unbounded LLM reasoning over live sources**: The model receives the full item context and edit diff, then actively investigates via web search and page fetching. The prompt directs a specific verification workflow (SIFT: Stop, Investigate, Find, Trace).
- **They're complementary, not competing**: ORES is a cheap first-pass filter (catches obvious vandalism patterns). SIFT is a deep second-pass verifier (catches plausible-but-wrong edits that sail through ORES). Neither alone is sufficient.

### Full-detail comparison

The table below distinguishes between information the LLM _has access to_ (present in the input context) and information the prompt _specifically directs_ it to use (explicit instructions in the SIFT workflow). ORES has no such distinction — its features are fixed inputs to a statistical classifier.

#### ORES (Wikidata `editquality` models)

All features are **fixed inputs to a gradient-boosted classifier** (GradientBoosting, 700 estimators, learning rate 0.01, max depth 7). Trained on 16,135 labeled revisions. ~95.4% accuracy, 0.985 ROC-AUC. There is no "available but unused" category — every feature is engineered and weighted by the model.

Sources: [`editquality/feature_lists/wikidatawiki.py`](https://github.com/wikimedia/editquality/blob/master/editquality/feature_lists/wikidatawiki.py), Sarabadani, Halfaker & Taraborelli (2017) "[Building automated vandalism detection tools for Wikidata](https://arxiv.org/abs/1703.03861)", Halfaker & Geiger (2020) "[ORES: Lowering Barriers with Participatory Machine Learning in Wikipedia](https://arxiv.org/abs/1909.05189)".

| Category | Features | What it captures |
|---|---|---|
| **Edit type flags** (7) | `is_revert`, `is_restore`, `is_item_creation`, `is_merge_into`, `is_merge_from`, `is_client_move`, `is_client_delete` | Structural edit classification |
| **User signals** (8) | `user_is_anon`, `is_bot`, `is_admin`, `has_advanced_rights`, `is_trusted`, `is_patroller`, `is_curator`, `log(seconds_since_registration + 1)` | Editor identity/trust (SIFT deliberately excludes this) |
| **Parent revision state** (9, log-transformed) | `log(parent.claims + 1)`, `log(parent.properties + 1)`, `log(parent.aliases + 1)`, `log(parent.sources + 1)`, `log(parent.qualifiers + 1)`, `log(parent.badges + 1)`, `log(parent.labels + 1)`, `log(parent.sitelinks + 1)`, `log(parent.descriptions + 1)` | How developed was the item before this edit |
| **Comment vandalism heuristics** (11) | `comment_longest_repeated_char`, `comment_uppercase_ratio`, `comment_numbers_ratio`, `comment_whitespace_ratio`, `comment_longest_repeated_uppercase_char`, `comment_has_url`, `comment_english_bad_words`, `comment_english_informals`, `comment_has_first_person_pronouns_en`, `comment_has_second_person_pronouns_en`, `comment_has_do_or_dont_en` | Whether the edit summary _looks_ suspicious |
| **Comment structure** (2) | `has_section_comment`, `has_wikilink_comment` | Structural patterns in edit summary |
| **Entity structure diff** (27 counts) | Sitelinks added/removed/changed, labels added/removed/changed, descriptions added/removed/changed, aliases added/removed, properties added/removed/changed, claims added/removed/changed, sources added/removed, qualifiers added/removed, badges added/removed/changed, identifiers changed | Volume and shape of the edit (not its correctness) |
| **Proportional features** (3) | `proportion_of_qid_added`, `proportion_of_language_added`, `proportion_of_links_added` | Edit composition ratios |
| **Targeted property flags** (9) | P21 (sex/gender), P27 (citizenship), P54 (sports team), P569 (DOB), P18 (image), P109 (signature), P373 (Commons category), P856 (official website) changed; `en_label_changed` | High-vandalism-risk properties as booleans |
| **Entity type flags** (2) | `is_human` (Q5), `is_blp` (has birth date, no death date) | Entity sensitivity classification |
| **NOT available to ORES** | Actual claim values, reference content, external source verification, semantic correctness, ontological consistency, whether the source supports the claim | ORES cannot assess truth, only pattern |

Note: The related **WDVD system** (Heindorf, Potthast, Stein & Engels, [CIKM 2016](https://dl.acm.org/doi/10.1145/2983323.2983740)) used 47 features including user geolocation (city, country, timezone) and session context (position within editing session). The later **FAIR-S** debiased variant ([WWW 2019](https://dl.acm.org/doi/10.1145/3308558.3313507)) reduced to 14 features by removing user-identifying features to reduce bias against anonymous editors. ORES is now deprecated in favor of **Lift Wing**, which runs the same revscoring models on updated infrastructure.

#### SIFT-Patrol (LLM-based verification)

| Category | Feature / Signal | Available | Prompted | Notes |
|---|---|---|---|---|
| **Edit metadata** | Revision IDs (old/new), timestamp | Yes | No | Present in input, not called out in workflow |
| | User name | Yes | Explicitly deprioritized | Prompt: "for situational awareness only"; Design notes: "No editor identity signals — we assess the edit on its merits, not the editor's reputation" |
| | Edit comment (raw Wikibase summary) | Yes | No | Available but SIFT never directs the model to analyze comment text patterns |
| | Tags (e.g., "new editor changing statement") | Yes | Yes (Step 1) | Prompt: "What do the tags suggest?" |
| | Parsed operation type | Yes | Yes (Step 1) | Part of understanding "what changed" |
| **Edit diff** | Diff type (statement_added, value_changed, reference_added, etc.) | Yes | Yes (Step 1) | Core to understanding the edit |
| | Full old_value / new_value structures (value, rank, references, qualifiers with resolved labels) | Yes | Yes (Step 2) | Prompt directs checking references in the statement structure |
| | Property label and value label/description (human-readable) | Yes | Yes (Steps 1-3) | Used throughout — search queries built from labels |
| **Full item context** | Entity label, description | Yes | Yes (Step 1) | Prompt: "What kind of entity is this?" |
| | All current claims with resolved labels (entire item state) | Yes | Yes (Steps 1-2) | Prompt: "What other claims exist?"; used to locate references and detect conflicts |
| | P31/instance of (entity type) | Yes | Yes (Step 1) | Explicitly called out: "check P31/instance of" |
| **Edit session context** | group_id, group_seq, group_size | Yes | Yes (Step 1) | Prompt: "Is this part of a batch of edits (group_size > 1)?" |
| **Removed claim data** | Full serialized deleted statement (for removal edits) | Yes | Yes (Steps 2-3) | Needed to verify whether removal was justified |
| **Prefetched reference content** | HTTP status, extracted text, error category, fetch date per reference URL | Yes | Yes (Step 2) | Prompt gives detailed instructions: check prefetched first, respect blocked domains, don't retry errors |
| **Live web search** | Independent source discovery via SearXNG | Tool | Yes (Step 3) | Prompt: "MUST call these tools during Steps 2-4. Do not skip investigation." Default query template provided. |
| | Search query variations | Tool | Yes (Step 3) | Prompt specifies fallback strategies: drop property, drop item, translate |
| **Live page fetching** | Full text extraction from web pages | Tool | Yes (Steps 2-3) | Up to 3 pages per edit; used to verify cited and independent sources |
| **Source provenance tracking** | `verified` vs. `reported` per source | Output | Yes (Step 3) | Mandatory in prompt: "Source provenance is mandatory. Every source must be marked." Mismarking "invalidates the verdict." |
| **Source type classification** | primary / secondary / tertiary | Output | Yes (Step 3) | Required per source in verdict output |
| **Claim-source entailment** | Does the reference actually support the specific claim? | Reasoning | Yes (Step 2) | Prompt: "Does the content actually support the specific claim being made?" |
| **Source authority assessment** | Is the source authoritative for this type of claim? | Reasoning | Yes (Step 2) | Prompt: "Is the source authoritative for this type of claim?" |
| **Circular reference detection** | Wikipedia citing Wikidata | Reasoning | Yes (Step 2) | Prompt: "NEVER use [Wikipedia] as a Wikidata reference source. Wikipedia cites Wikidata, so using it as a source is circular." |
| **External identifier cross-referencing** | API lookup + 2-fact entity matching | Reasoning | Yes (Step 3) | Prompt: "confirming the ID exists is necessary but not sufficient — you must also cross-reference... Match on at least two independent facts" |
| **Direct quote extraction** | Verbatim quotes from fetched sources | Output | Yes (Step 3) | Prompt: "including a direct quote from the fetched content... This proves you read the actual page" |
| **Contradiction resolution** | Trace to primary/authoritative source | Reasoning | Yes (Step 4) | Conditional step, triggered "only if Step 2 and Step 3 produced contradictory evidence" |
| **Ontological reasoning** | Is P31/P279 classification sensible? Are required qualifiers present? | Reasoning | Implicit | Not explicitly prompted but emerges from item context + LLM knowledge of Wikidata conventions |
| **Data model correctness** | Right property for this claim type? Appropriate date precision? | Reasoning | Yes (Step 5) | Prompt directs proposing improvements: "Missing qualifiers... Precision improvements (e.g., year -> day for dates)" |
| **Confidence calibration** | Verdict maps to evidence strength | Output | Yes (Step 5) | Six-level verdict scale with precise definitions (e.g., "verified-high" requires "primary source or multiple independent sources") |
| **LLM training data** | General world knowledge | Yes | Explicitly restricted | Prompt: "never render a verdict based solely on your training data. Every claim must be checked against live web sources" |

#### Key structural differences

| Dimension | ORES | SIFT-Patrol |
|---|---|---|
| **Architecture** | Gradient-boosted trees (fixed features) | LLM with tool use (open-ended reasoning) |
| **Feature count** | ~67 hand-engineered (700 estimators, 0.985 ROC-AUC) | ~15 structured inputs + unbounded reasoning |
| **External access** | None | Web search + page fetch (live) |
| **Reads source content** | No | Yes (and is required to) |
| **Understands claim semantics** | No | Yes |
| **Editor identity** | Used (user_is_bot, user rights) | Deliberately excluded |
| **Comment analysis** | Vandalism heuristics (char ratios, bad words) | Available but not directed |
| **Verdict type** | Binary probability (damaging / good-faith) | Six-level ordinal (verified-high → incorrect) |
| **Latency** | Milliseconds | Minutes (web search + multi-page fetch) |
| **Cost per edit** | Negligible | $0.01–0.10 per model per edit |
| **What it catches** | Obvious vandalism, bot edits, edit-war patterns | Plausible-but-wrong facts, unsupported claims, subtle errors |
| **What it misses** | Any edit that _looks normal_ but is factually wrong | Nothing structural — but limited by source availability and LLM accuracy (~75% ceiling) |

---

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
