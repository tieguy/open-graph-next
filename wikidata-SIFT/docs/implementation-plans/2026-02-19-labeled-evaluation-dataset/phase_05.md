# Labeled Evaluation Dataset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a labeled evaluation dataset of ~500 historical Wikidata edits with ground truth labels derived from revert/patrol history.

**Architecture:** A new fetcher script queries pywikibot's RecentChanges API with dual-query strategy (mw-reverted tag + mw-rollback/mw-undo trace-back) for reverted edits, plus a survived pool. Self-revert and edit-war filtering cleans the labels. An `EditSource` protocol enables future Toolforge backends. The fetcher reuses enrichment functions from `fetch_patrol_edits.py`.

**Tech Stack:** Python 3.13, pywikibot, PyYAML, scikit-learn, numpy, matplotlib, seaborn, jupyter

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-02-19

---

## Phase 5: Analysis Notebook

**Goal:** Interactive exploration and visualization of evaluation results via a Jupyter notebook.

**Key codebase facts (verified by investigation):**
- Analysis YAML output from Phase 4 lives in `logs/wikidata-patrol-experiment/analysis/`
- Analysis YAML has: `summary`, `per_model` (each with confusion_matrix, precision_accept, recall_reject, pr_auc, fr_at_99, fr_at_90, cost_per_verdict), `ensemble`
- No existing notebooks in the project
- `pyproject.toml` currently has: pywikibot, pyyaml, trafilatura, httpx, openai, scikit-learn, numpy (added in Phase 4)

### Task 1: Add visualization dependencies and create notebook skeleton

**Files:**
- Modify: `wikidata-SIFT/pyproject.toml`
- Create: `notebooks/verdict_analysis.ipynb`

This is an infrastructure task — verified operationally, not by tests.

**Step 1: Add matplotlib, seaborn, and jupyter to dev dependencies**

In `wikidata-SIFT/pyproject.toml`, add to the `[dependency-groups]` dev section:

```toml
[dependency-groups]
dev = [
    "pytest>=9.0.2",
    "matplotlib>=3.8",
    "seaborn>=0.13",
    "jupyter>=1.0",
]
```

**Step 2: Verify dependency installation**

Run: `cd /var/home/louie/Projects/Volunteering-Consulting/open-graph-next/.worktrees/labeled-evaluation-dataset/wikidata-SIFT && uv sync`

Expected: Dependencies install successfully.

**Step 3: Create notebook directory**

Run: `mkdir -p notebooks`

**Step 4: Create notebook skeleton**

Create `notebooks/verdict_analysis.ipynb` with the following cells:

**Cell 1 (markdown):**
```markdown
# SIFT-Patrol Verdict Analysis

Interactive exploration of evaluation results from the labeled evaluation dataset.

Load the analysis YAML produced by `scripts/analyze_verdicts.py` and generate:
- Confusion matrix heatmaps per model
- Precision-Recall curves
- FR@Recall curves
- Cost vs accuracy scatterplots
- Disagreement breakdowns
- Per-property-type charts
```

**Cell 2 (code) — Imports and setup:**
```python
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
import yaml

# Add scripts to path so we can reuse analysis functions
sys.path.insert(0, str(Path("../scripts")))
from analyze_verdicts import (
    verdict_to_binary,
    verdict_to_score,
    compute_per_model_metrics,
    compute_pr_auc,
    compute_filter_rate_at_recall,
    compute_ensemble_verdicts,
    VERDICT_ORDINAL,
)

sns.set_theme(style="whitegrid", palette="muted")
plt.rcParams["figure.figsize"] = (10, 6)
plt.rcParams["figure.dpi"] = 100
```

**Cell 3 (code) — Load analysis data:**
```python
# Update this path to point to your analysis output
ANALYSIS_PATH = Path("../logs/wikidata-patrol-experiment/analysis/")

# Find the most recent analysis file
analysis_files = sorted(ANALYSIS_PATH.glob("*-analysis.yaml"))
if not analysis_files:
    raise FileNotFoundError(f"No analysis files found in {ANALYSIS_PATH}")

analysis_path = analysis_files[-1]
print(f"Loading: {analysis_path}")

with open(analysis_path) as f:
    analysis = yaml.safe_load(f)

print(f"Summary: {analysis['summary']}")
```

**Cell 4 (markdown):**
```markdown
## Confusion Matrices
```

**Cell 5 (code) — Confusion matrix heatmaps:**
```python
models = list(analysis["per_model"].keys())
n_models = len(models)
fig, axes = plt.subplots(1, n_models, figsize=(5 * n_models, 4))
if n_models == 1:
    axes = [axes]

for ax, model in zip(axes, models):
    cm = analysis["per_model"][model]["confusion_matrix"]

    # Build matrix: rows = ground truth, cols = decision
    labels_gt = ["reverted", "survived"]
    labels_dec = ["accept", "reject", "abstain"]
    matrix = np.array([[cm[gt][dec] for dec in labels_dec] for gt in labels_gt])

    sns.heatmap(
        matrix, annot=True, fmt="d", cmap="YlOrRd",
        xticklabels=labels_dec, yticklabels=labels_gt,
        ax=ax,
    )
    # Short model name
    short_name = model.split("/")[-1] if "/" in model else model
    ax.set_title(short_name)
    ax.set_ylabel("Ground Truth")
    ax.set_xlabel("Model Decision")

plt.tight_layout()
plt.savefig("confusion_matrices.png", bbox_inches="tight")
plt.show()
```

**Cell 6 (markdown):**
```markdown
## Precision-Recall Curves

PR curves using the ordinal verdict scale as a confidence ranking.
Higher area under the curve = better discrimination between reverted and survived edits.
```

**Cell 7 (code) — PR curves:**
```python
# To draw PR curves, we need the raw verdicts, not just the aggregated analysis.
# Load the verdicts and ground truth directly.

VERDICTS_DIR = Path("../logs/wikidata-patrol-experiment/verdicts-fanout/")
GT_PATH = sorted(Path("../logs/wikidata-patrol-experiment/labeled/").glob("*.yaml"))[-1]

from analyze_verdicts import load_verdicts, load_ground_truth, join_verdicts_with_ground_truth

verdicts = load_verdicts(VERDICTS_DIR)
gt_map = load_ground_truth(GT_PATH)
joined = join_verdicts_with_ground_truth(verdicts, gt_map)

print(f"Loaded {len(joined)} matched verdict-ground truth pairs")
```

**Cell 8 (code) — Draw PR curves:**
```python
from sklearn.metrics import precision_recall_curve, average_precision_score
from collections import defaultdict

by_model = defaultdict(list)
for verdict, gt in joined:
    by_model[verdict.get("model", "unknown")].append((verdict, gt))

fig, ax = plt.subplots(figsize=(8, 6))
colors = sns.color_palette("husl", len(by_model))

for (model, model_joined), color in zip(sorted(by_model.items()), colors):
    y_true = np.array([1 if gt["label"] == "reverted" else 0 for _, gt in model_joined])
    y_score = np.array([verdict_to_score(v.get("verdict")) for v, _ in model_joined])

    precision, recall, _ = precision_recall_curve(y_true, -y_score, pos_label=1)
    ap = average_precision_score(y_true, -y_score)

    short_name = model.split("/")[-1] if "/" in model else model
    ax.plot(recall, precision, color=color, label=f"{short_name} (AP={ap:.3f})", linewidth=2)

# Baseline: random classifier
positive_rate = sum(1 for _, gt in joined if gt["label"] == "reverted") / len(joined)
ax.axhline(y=positive_rate, color="gray", linestyle="--", label=f"Random (AP={positive_rate:.3f})")

ax.set_xlabel("Recall (fraction of reverted edits caught)")
ax.set_ylabel("Precision (fraction of flagged edits that were actually reverted)")
ax.set_title("Precision-Recall Curves by Model")
ax.legend(loc="best")
ax.set_xlim([0, 1.05])
ax.set_ylim([0, 1.05])

plt.tight_layout()
plt.savefig("pr_curves.png", bbox_inches="tight")
plt.show()
```

**Cell 9 (markdown):**
```markdown
## FR@Recall Curves

Filter Rate at different recall thresholds. Shows what fraction of the patrol queue
can be auto-accepted while maintaining a given catch rate for bad edits.
```

**Cell 10 (code) — FR@Recall curves:**
```python
fig, ax = plt.subplots(figsize=(8, 6))
recall_targets = np.arange(0.5, 1.0, 0.01)

for (model, model_joined), color in zip(sorted(by_model.items()), colors):
    y_true = np.array([1 if gt["label"] == "reverted" else 0 for _, gt in model_joined])
    y_score = np.array([verdict_to_score(v.get("verdict")) for v, _ in model_joined])

    filter_rates = []
    valid_recalls = []
    for target in recall_targets:
        try:
            fr, _, achieved = compute_filter_rate_at_recall(y_true, y_score, target)
            filter_rates.append(fr)
            valid_recalls.append(target)
        except ValueError:
            break

    short_name = model.split("/")[-1] if "/" in model else model
    ax.plot(valid_recalls, filter_rates, color=color, label=short_name, linewidth=2)

# Mark key operating points
for target in [0.90, 0.99]:
    ax.axvline(x=target, color="gray", linestyle=":", alpha=0.5)
    ax.annotate(f"FR@{int(target*100)}%", xy=(target, 0.02), fontsize=8, color="gray")

ax.set_xlabel("Recall Target (minimum catch rate for bad edits)")
ax.set_ylabel("Filter Rate (fraction of queue auto-accepted)")
ax.set_title("Filter Rate at Recall by Model")
ax.legend(loc="best")

plt.tight_layout()
plt.savefig("fr_at_recall.png", bbox_inches="tight")
plt.show()
```

**Cell 11 (markdown):**
```markdown
## Cost vs Accuracy
```

**Cell 12 (code) — Cost vs accuracy scatterplot:**
```python
fig, ax = plt.subplots(figsize=(8, 6))

for model, metrics in analysis["per_model"].items():
    short_name = model.split("/")[-1] if "/" in model else model
    cost = metrics.get("cost_per_verdict")
    pr_auc = metrics.get("pr_auc")

    if cost is not None and pr_auc is not None:
        ax.scatter(cost, pr_auc, s=150, zorder=5)
        ax.annotate(short_name, (cost, pr_auc), textcoords="offset points",
                    xytext=(10, 5), fontsize=10)

ax.set_xlabel("Cost per Verdict (USD)")
ax.set_ylabel("PR-AUC")
ax.set_title("Cost vs Accuracy by Model")

plt.tight_layout()
plt.savefig("cost_vs_accuracy.png", bbox_inches="tight")
plt.show()
```

**Cell 13 (markdown):**
```markdown
## Model Disagreement Analysis

Which edits do models disagree on? Are there patterns in disagreements?
```

**Cell 14 (code) — Disagreement breakdown:**
```python
# Group verdicts by edit
edit_verdicts = defaultdict(dict)
edit_gt = {}
for verdict, gt in joined:
    key = (verdict.get("revid"), verdict.get("property"))
    model = verdict.get("model", "unknown")
    short_name = model.split("/")[-1] if "/" in model else model
    edit_verdicts[key][short_name] = verdict_to_binary(verdict.get("verdict"))
    edit_gt[key] = gt["label"]

# Count agreement patterns
from collections import Counter
agreement_counter = Counter()
for key, model_decisions in edit_verdicts.items():
    decisions = tuple(sorted(model_decisions.values()))
    agreement_counter[decisions] += 1

print("Decision patterns (sorted by frequency):")
for pattern, count in agreement_counter.most_common(20):
    gt_labels = [edit_gt[k] for k, v in edit_verdicts.items()
                 if tuple(sorted(v.values())) == pattern]
    reverted_pct = sum(1 for l in gt_labels if l == "reverted") / len(gt_labels) * 100
    print(f"  {pattern}: {count} edits ({reverted_pct:.0f}% reverted)")
```

**Cell 15 (markdown):**
```markdown
## Breakdown by Edit Operation Type

Are certain edit operations (value_changed, statement_added, etc.) harder to evaluate?
```

**Cell 16 (code) — Edit operation type breakdown:**
```python
# Group by diff_type (edit operation: value_changed, statement_added, etc.)
by_diff_type = defaultdict(list)
for verdict, gt in joined:
    diff_type = verdict.get("diff_type", "unknown")
    by_diff_type[diff_type].append((verdict, gt))

print("Metrics by edit operation type:")
print(f"{'Type':<25} {'Count':>6} {'Precision':>10} {'Recall':>8} {'PR-AUC':>8}")
print("-" * 65)

for diff_type in sorted(by_diff_type.keys()):
    items = by_diff_type[diff_type]
    metrics = compute_per_model_metrics(items)

    y_true = [1 if gt["label"] == "reverted" else 0 for _, gt in items]
    y_score = [verdict_to_score(v.get("verdict")) for v, _ in items]

    try:
        pr_auc = compute_pr_auc(y_true, y_score)
    except Exception:
        pr_auc = None

    pr_auc_str = f"{pr_auc:.3f}" if pr_auc is not None else "N/A"
    print(f"{diff_type:<25} {len(items):>6} {metrics['precision_accept']:>10.3f} {metrics['recall_reject']:>8.3f} {pr_auc_str:>8}")
```

**Cell 17 (markdown):**
```markdown
## Breakdown by Wikidata Property

Are certain properties (P31 instance-of, P106 occupation, etc.) harder to evaluate?
```

**Cell 18 (code) — Per-property breakdown:**
```python
# Group by Wikidata property (P31, P106, etc.)
by_property = defaultdict(list)
for verdict, gt in joined:
    prop = verdict.get("property", "unknown")
    prop_label = verdict.get("property_label", prop)
    by_property[(prop, prop_label)].append((verdict, gt))

print("Metrics by Wikidata property:")
print(f"{'Property':<35} {'Count':>6} {'Precision':>10} {'Recall':>8}")
print("-" * 65)

for (prop, prop_label) in sorted(by_property.keys(), key=lambda x: -len(by_property[x])):
    items = by_property[(prop, prop_label)]
    if len(items) < 4:  # Skip properties with very few verdicts
        continue
    metrics = compute_per_model_metrics(items)
    print(f"{prop_label or prop:<35} {len(items):>6} {metrics['precision_accept']:>10.3f} {metrics['recall_reject']:>8.3f}")
```

**Cell 19 (markdown):**
```markdown
## Breakdown by Ground Truth Evidence Type

Does model accuracy differ based on how the ground truth was established?
```

**Cell 20 (code) — Evidence type breakdown:**
```python
# Group by ground truth evidence type
by_evidence = defaultdict(list)
for verdict, gt in joined:
    evidence = gt.get("evidence", "unknown")
    by_evidence[evidence].append((verdict, gt))

print("Metrics by ground truth evidence type:")
print(f"{'Evidence':<25} {'Count':>6} {'Precision':>10} {'Recall':>8}")
print("-" * 55)

for evidence in sorted(by_evidence.keys()):
    items = by_evidence[evidence]
    metrics = compute_per_model_metrics(items)
    print(f"{evidence:<25} {len(items):>6} {metrics['precision_accept']:>10.3f} {metrics['recall_reject']:>8.3f}")
```

**Cell 21 (markdown):**
```markdown
## Summary Table
```

**Cell 22 (code) — Summary table:**
```python
print(f"\n{'Model':<35} {'N':>4} {'Prec':>6} {'Rec':>6} {'PR-AUC':>7} {'FR@99':>6} {'FR@90':>6} {'$/v':>8}")
print("=" * 85)
for model, metrics in sorted(analysis["per_model"].items()):
    short_name = model.split("/")[-1] if "/" in model else model

    fr99 = metrics.get("fr_at_99", {})
    fr90 = metrics.get("fr_at_90", {})

    fr99_str = f"{fr99['filter_rate']:.3f}" if fr99 else "N/A"
    fr90_str = f"{fr90['filter_rate']:.3f}" if fr90 else "N/A"
    pr_auc_str = f"{metrics['pr_auc']:.3f}" if metrics.get("pr_auc") is not None else "N/A"
    cost_str = f"${metrics['cost_per_verdict']:.4f}" if metrics.get("cost_per_verdict") is not None else "N/A"

    print(f"{short_name:<35} {metrics['sample_count']:>4} {metrics['precision_accept']:>6.3f} {metrics['recall_reject']:>6.3f} {pr_auc_str:>7} {fr99_str:>6} {fr90_str:>6} {cost_str:>8}")

# Ensemble rows
print("-" * 85)
for strategy, metrics in sorted(analysis.get("ensemble", {}).items()):
    fr99_str = "N/A"
    fr90_str = "N/A"
    pr_auc_str = "N/A"
    cost_str = "N/A"
    print(f"{'ensemble/' + strategy:<35} {metrics['sample_count']:>4} {metrics['precision_accept']:>6.3f} {metrics['recall_reject']:>6.3f} {pr_auc_str:>7} {fr99_str:>6} {fr90_str:>6} {cost_str:>8}")
```

**Step 5: Verify notebook loads without errors**

Run: `cd /var/home/louie/Projects/Volunteering-Consulting/open-graph-next/.worktrees/labeled-evaluation-dataset/wikidata-SIFT && uv run jupyter nbconvert --to script notebooks/verdict_analysis.ipynb --stdout | head -20`

Expected: Notebook converts to Python script without syntax errors. The cells that load data will fail (no analysis data yet), but the notebook structure should be valid.

**Step 6: Commit**

```bash
git add pyproject.toml notebooks/verdict_analysis.ipynb
git commit -m "feat: add verdict analysis notebook with visualization cells"
```
