# Labeled Evaluation Dataset for SIFT-Patrol Verdict Fanout

## Summary

SIFT-Patrol is an experiment in LLM-assisted Wikidata edit review. The existing system fetches unpatrolled Wikidata edits, enriches them with item context and web-fetched references, and runs them through a panel of language models that each produce a structured verdict (verified, suspect, unverifiable, etc.). What has been missing is a way to measure whether those verdicts are actually correct. This design builds the infrastructure to answer that question.

The approach is to construct a labeled evaluation dataset from Wikidata's own revert history: edits that were reverted serve as negative examples, edits that survived 14+ days without revert serve as positive examples. A dual-query strategy and self-revert/edit-war filtering make the labels as clean as possible given the constraints of the MediaWiki RecentChanges API. The labeled dataset is fed through an enhanced version of the existing enrichment and verdict fanout pipeline, with Wikidata itself blocked from search results to prevent the models from reading their own ground truth. An analysis script and notebook then compute standard information retrieval metrics — Filter Rate at Recall, PR-AUC, per-model confusion matrices, and cost-per-verdict — to characterize each model's performance and the behavior of multi-model ensemble strategies.

## Definition of Done

1. **A labeled evaluation dataset** of ~500 historical Wikidata edits (reverted, survived-30d, patrolled pools) with self-revert/edit-war filtering, in the same enriched snapshot format the verdict fanout already consumes
2. **An evaluation-mode blocked domain config** that adds wikidata.org to prevent label leakage during model runs
3. **Enhanced enrichment with item-wide citation prefetching** — prefetch all reference URLs on the item (not just the edit-specific ones) to compensate for blocking Wikidata. Design must respect OLMo's 65k context limit.
4. **An analysis pipeline** that computes Filter Rate at Recall (FR@99%, FR@90%), PR-AUC, per-model confusion matrices, and cost-per-verdict from verdict fanout results against ground truth labels
5. **A fetcher designed for extensibility** so Toolforge can be plugged in later as an alternative data source

## Glossary

- **SIFT**: Stop, Investigate the source, Find better coverage, Trace claims — a lateral-reading fact-checking framework adapted here for automated Wikidata edit review.
- **SIFT-Patrol**: The experiment built on SIFT that evaluates individual unpatrolled Wikidata edits rather than whole items.
- **Verdict fanout**: The multi-model execution pipeline (`run_verdict_fanout.py`) that sends each edit to several LLMs and collects a structured verdict from each.
- **Enriched snapshot**: A YAML file containing fetched Wikidata edits augmented with item context, parsed edit summaries, resolved property/value labels, and prefetched web references. The standard data format consumed by the verdict fanout.
- **Ground truth**: The label assigned to each historical edit based on observable outcome — `reverted` or `survived` — used to evaluate model verdict accuracy.
- **Label leakage**: The risk that a model looks up the edit on Wikidata during evaluation and reads information that reveals whether the edit was accepted or reverted, contaminating the evaluation.
- **RecentChanges API**: The MediaWiki API endpoint that returns a rolling log of recent edits across a wiki. Limited to approximately the last 30 days of history on Wikidata.
- **`mw-reverted` tag**: A MediaWiki change tag automatically applied to edits that were later reverted. Has approximately 80% coverage — not all reverts produce this tag.
- **`mw-rollback` / `mw-undo` tags**: Change tags applied to the reverting action itself (not the reverted edit). Nearly 100% reliable, but require trace-back logic to identify which edit was reverted.
- **Self-revert filtering**: Discarding edits where the reverter is the same user as the original editor, which are not useful as quality signal.
- **Edit-war filtering**: Discarding edits caught in mutual revert chains (user A reverts user B, then B reverts A within 24 hours), which represent content disputes rather than clear quality failures.
- **Survivorship bias**: The risk that "survived" edits include vandalism or errors that were simply never caught, making them unreliable positive examples.
- **`EditSource` interface**: An abstraction layer in the fetcher design that allows the RecentChanges API implementation to be swapped for a Toolforge-based implementation without changing the rest of the pipeline.
- **Toolforge**: Wikimedia's cloud computing platform for tools that access Wikimedia databases directly. Could provide deeper edit history than the RC API's 30-day window.
- **P854**: The Wikidata property identifier for "reference URL" — the property used to record the web source supporting a claim.
- **Item-wide citation prefetching**: Fetching all reference URLs across all claims on a Wikidata item, not just those referenced in the specific edit being evaluated. Compensates for blocking Wikidata access during evaluation.
- **`context_budget`**: A per-model token limit parameter added to `build_edit_context()` that controls how much of the enriched item data is included in the prompt before truncation.
- **OLMo**: An open-weight language model (here, OLMo 32B) with a 65k-token context window — the tightest constraint in the model panel, driving the truncation priority design.
- **OpenRouter**: An API aggregator that provides unified access to multiple LLM providers. Used by the verdict fanout to run edits across Mistral, OLMo, DeepSeek, and Claude models.
- **PR-AUC**: Area Under the Precision-Recall Curve. A standard metric for binary classifiers on imbalanced datasets, preferred here over ROC-AUC because the reverted/survived pools may not be equal in deployment.
- **FR@Recall (Filter Rate at Recall)**: The fraction of edits a model can confidently accept (filter from the patrol queue) while still catching at least X% of bad edits. FR@99% and FR@90% are the specific operating points computed. The standard Wikimedia metric for patrol workload reduction tools such as ORES/Lift Wing.
- **ORES / Lift Wing**: Wikimedia's existing machine learning edit-quality scoring service. A benchmark against which SIFT-Patrol results can be compared.
- **Ensemble**: A combined verdict derived from multiple models' individual verdicts, using strategies like majority vote or unanimous accept.
- **WDVC corpus**: The Wikidata Vandalism Corpus (Heindorf et al. 2015/2016) — prior academic work on Wikidata edit quality that this design draws on for dataset construction methodology.
- **SearXNG**: A self-hosted, privacy-respecting metasearch engine. Used by `tool_executor.py` to provide web search capability to models during the investigation phase.
- **pywikibot**: The official Python library for interacting with MediaWiki APIs. Used here for fetching recent changes and item data from Wikidata.
- **`rcid`**: RecentChanges ID — the unique identifier for an entry in the MediaWiki RecentChanges log. Used as the join key between verdict YAMLs and ground truth labels.

## Architecture

### Overview

Three components: a historical edit fetcher that builds a labeled dataset, an enhanced enrichment pipeline that compensates for blocked Wikidata access, and an analysis pipeline that computes metrics against ground truth.

The fetcher produces enriched snapshot YAMLs in the same format `run_verdict_fanout.py` already consumes, with an added `ground_truth` key that is stripped before models see the data. The analysis pipeline reads verdict YAMLs and ground truth labels to compute per-model and ensemble metrics.

### Historical Edit Fetcher

New script `scripts/fetch_labeled_edits.py`. Does not modify the existing `fetch_patrol_edits.py` (which is mid-run).

**Dual-query strategy for reverted edits:**

Pool A — query `site.recentchanges()` with `tag="mw-reverted"`, `start=30_days_ago`, `end=14_days_ago`. Filter results to edits that also carry a "new editor" statement tag. This catches ~80% of reverted new-editor statement edits.

Pool B — query `site.recentchanges()` separately for `tag="mw-rollback"` and `tag="mw-undo"` (the reverting actions, ~100% reliable). For each reverting edit, use `old_revid` to identify the revision that was restored and the range of reverted revisions. Check if any reverted revision was a new-editor statement edit. Dedup against Pool A by `rcid`.

**Survived edits (positive pool):**

Pool C — query `site.recentchanges()` with `tag="new editor changing statement"` and `tag="new editor removing statement"`, same time window. Exclude any `rcid` that appears in Pool A or B. These edits survived 14+ days without revert.

Within Pool C, split by patrol status: `survived-patrolled` (patrol flag set) vs `survived-unpatrolled` (no patrol flag). Tracked as distinct label types.

**Self-revert and edit-war filtering:**

Discard edits where the reverter is the same user as the original editor. Discard edits in revert chains (A reverts B, then B reverts A within 24 hours) — detect by checking whether the reverting edit was itself reverted within 24 hours.

**Sampling:** Target ~250 reverted + ~250 survived. Random sample if pools exceed target.

**Output format:** Same enriched snapshot YAML as `fetch_patrol_edits.py` with added key per edit:

```yaml
ground_truth:
  label: reverted    # or survived
  evidence: mw-reverted-tag  # or reverter-traced, patrolled, not-reverted-14d
  reverter_user: ExampleUser  # only for reverted edits
  revert_revid: 12345678      # only for reverted edits
```

**Extensibility:** The fetcher defines an `EditSource` interface with `fetch_reverted(limit)` and `fetch_survived(limit)` methods. The RC API implementation is one concrete class. A future Toolforge implementation would be another, returning the same data shape.

### Enhanced Enrichment

Reuses the existing enrichment functions from `fetch_patrol_edits.py` (imported, not duplicated) with two enhancements:

**Item-wide citation prefetching:** Walk all `references` blocks across all serialized claims on the item, extract every P854 (reference URL), and prefetch via `prefetch_reference_url()`. Replaces the current approach in `extract_reference_urls()` which only looks at the edit-specific diff.

**Context-aware truncation in `build_edit_context()`:** New `context_budget` parameter derived from model context limits:

| Model | Context Limit | Prompt Budget |
|-------|--------------|---------------|
| OLMo 32B | 65k | ~30k tokens |
| Mistral Small | 131k | ~60k tokens |
| DeepSeek v3.2 | 164k | ~70k tokens |
| Claude Haiku | 200k | ~80k tokens |

Truncation priority (highest to lowest):
1. Edit metadata, parsed edit, verification question, edit diff — always included
2. Claims on the edited property with all their citations
3. Claims on related properties with citations
4. Remaining claims and citations
5. External-id claims (already skipped)

**Fixing existing gaps in `build_edit_context()`:** Currently `prefetched_references` and `edit_diff` are described in the SIFT prompt but never injected into the user message. The design adds `## Edit diff` and `## Prefetched references` sections to the constructed message.

### Label Leakage Prevention

**Blocked domains:** New `config/blocked_domains_eval.yaml` extending base config with `wikidata.org`. Wikipedia already blocked in base config. The `run_verdict_fanout.py` runner gets a `--eval` flag that loads the eval config instead.

**Ground truth stripping:** The fanout runner strips `ground_truth` from each edit dict before passing to `build_edit_context()`. Models never see labels.

### Analysis Pipeline

**`scripts/analyze_verdicts.py`** — reads verdict YAMLs from a directory and a ground truth snapshot YAML. Joins on `rcid` + property. Computes metrics. Outputs structured YAML.

**Verdict-to-binary mapping:**
- Accept: `verified-high`, `verified-low`, `plausible`
- Reject: `incorrect`, `suspect`
- Abstain: `unverifiable`, `null` (treated as "flag for human review" — same as reject for patrol workload)

**Per-model metrics:**
- Confusion matrix (accept/reject/abstain vs reverted/survived)
- Precision on accept decisions
- Recall on reject decisions (catching bad edits)
- FR@99% and FR@90% (Filter Rate at Recall)
- PR-AUC using ordinal verdict scale as confidence ranking
- Cost per verdict from `cost_usd` field

**Ensemble metrics:**
- Majority vote (3/4 reject → ensemble rejects)
- Unanimous accept (all models must agree to accept)
- Open-model-only ensemble (exclude Haiku — the deployment-realistic panel)

**Breakdown dimensions:** by ground truth label type, edit operation type, property type.

**Output:** `logs/wikidata-patrol-experiment/analysis/YYYY-MM-DD-analysis.yaml`

**`notebooks/verdict_analysis.ipynb`** — loads analysis YAML. Generates confusion matrix heatmaps, PR curves, FR@Recall curves, cost-vs-accuracy scatterplots, disagreement breakdowns, and per-property-type charts.

## Existing Patterns

Investigation found the following patterns in the codebase that this design follows:

**Script organization:** All scripts live in `scripts/`. The fetcher (`fetch_patrol_edits.py`), fanout runner (`run_verdict_fanout.py`), and tool executor (`tool_executor.py`) follow a pattern of standalone CLI scripts with `argparse`, structured YAML output, and pywikibot for Wikidata API access.

**Enrichment pipeline:** `fetch_patrol_edits.py` defines `enrich_edit()`, `enrich_edit_group()`, `LabelCache`, `serialize_claims()`, and `prefetch_reference_url()`. The new fetcher imports and reuses these rather than duplicating.

**Blocked domain config:** `config/blocked_domains.yaml` with domain list. `tool_executor.py` and `fetch_patrol_edits.py` both have `load_blocked_domains()` — loaded once at startup, passed through the call chain.

**Checkpoint/resume:** `run_verdict_fanout.py` uses `fanout-state.yaml` with a `completed` set of `(rcid, model)` tuples. New analysis scripts follow the same YAML-based state pattern.

**Log directory structure:** `logs/wikidata-patrol-experiment/` with subdirectories (`snapshot/`, `control/`, `verdicts-fanout/`). New outputs go in `analysis/`.

**Divergence:** `build_edit_context()` currently omits `prefetched_references` and `edit_diff` from the model message despite the SIFT prompt describing them. This design fixes that gap and adds context-aware truncation — a new pattern not present in the existing code.

## Implementation Phases

### Phase 1: Historical Edit Fetcher

**Goal:** Fetch and label ~500 historical edits with ground truth from Wikidata's revert/patrol history.

**Components:**
- `scripts/fetch_labeled_edits.py` — dual-query fetcher with self-revert/edit-war filtering, sampling, and `EditSource` interface
- Imports enrichment functions from `fetch_patrol_edits.py`

**Dependencies:** None (first phase). Requires worktree since `fetch_patrol_edits.py` is mid-run.

**Done when:** Script produces an enriched snapshot YAML with ~500 edits, each with a `ground_truth` key. Reverted and survived pools are roughly balanced. Self-reverts and edit-war edits are filtered out. Tests verify filtering logic and label assignment.

### Phase 2: Enhanced Enrichment

**Goal:** Prefetch all item-wide citation URLs and inject `prefetched_references` and `edit_diff` into model messages.

**Components:**
- Item-wide citation extraction function (walks all claims, not just edit diff)
- Modified `build_edit_context()` with `context_budget` parameter and truncation logic
- New `## Edit diff` and `## Prefetched references` sections in constructed message

**Dependencies:** Phase 1 (labeled edits to test with).

**Done when:** `build_edit_context()` produces messages that include prefetched references and edit diff. OLMo-budget messages stay under 30k tokens. Tests verify truncation at each priority level.

### Phase 3: Evaluation Mode

**Goal:** Prevent label leakage during model evaluation runs.

**Components:**
- `config/blocked_domains_eval.yaml` with wikidata.org added
- `--eval` flag on `run_verdict_fanout.py` to load eval config
- Ground truth stripping before prompt construction

**Dependencies:** Phase 2 (enhanced enrichment must work before running evaluations).

**Done when:** Running with `--eval` blocks wikidata.org from search results and web fetches. Ground truth key is absent from model messages. Tests verify stripping and domain blocking.

### Phase 4: Metrics Computation Script

**Goal:** Compute per-model and ensemble metrics from verdict fanout results against ground truth.

**Components:**
- `scripts/analyze_verdicts.py` — loads verdicts and ground truth, computes confusion matrices, FR@Recall, PR-AUC, cost-per-verdict, ensemble metrics
- Output schema in `logs/wikidata-patrol-experiment/analysis/`

**Dependencies:** Phase 3 (need evaluation-mode verdicts to analyze). Can be developed in parallel with Phase 3 using the existing non-eval verdicts for testing the pipeline.

**Done when:** Script produces a structured analysis YAML with all specified metrics. Tests verify metric computation against hand-calculated examples.

### Phase 5: Analysis Notebook

**Goal:** Interactive exploration and visualization of evaluation results.

**Components:**
- `notebooks/verdict_analysis.ipynb` — loads analysis YAML, generates charts (confusion matrices, PR curves, FR@Recall curves, cost-vs-accuracy, disagreement breakdowns, property-type breakdowns)

**Dependencies:** Phase 4 (needs analysis YAML to visualize).

**Done when:** Notebook renders all specified charts from analysis data. Can be re-run against new analysis outputs.

## Additional Considerations

**Prior art:** This design draws on the WDVC corpus methodology (Heindorf et al. 2015/2016), the ORES/Lift Wing vandalism detection system, and the 2025 Graph2Text paper (arXiv:2505.18136). The revert-as-label approach with self-revert/edit-war filtering follows the methodology of the Graph2Text paper, which found 57.7% of initially-reverted edits were noise requiring filtering.

**Label reliability:** `mw-reverted` tag has ~80% coverage on Wikidata; `mw-rollback`/`mw-undo` tags are ~100% reliable but require trace-back logic. The dual-query approach captures both. The "survived 14+ days" positive label follows WDVC convention but carries survivorship bias — vandalism never caught appears as "survived." The analysis should acknowledge this.

**30-day RC API limit:** The MediaWiki RecentChanges API retains ~30 days of data. The `EditSource` interface is designed so a Toolforge implementation can provide deeper history without changing the rest of the pipeline.

**Metric choice:** Filter Rate at Recall (FR@) is the standard Wikimedia metric for patrol workload reduction. PR-AUC is preferred over ROC-AUC for imbalanced datasets. The ordinal verdict scale (verified-high through incorrect) provides a natural confidence ranking for threshold-based metrics.

**Model cost context:** Haiku serves as the expensive, high-capability baseline. The deployment-realistic panel is Mistral Small + OLMo + DeepSeek (all open-weight models available via OpenRouter). The cost-vs-accuracy analysis will quantify whether Haiku's premium is justified.
