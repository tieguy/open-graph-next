# Labeled Evaluation Dataset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a labeled evaluation dataset of ~500 historical Wikidata edits with ground truth labels derived from revert/patrol history.

**Architecture:** A new fetcher script queries pywikibot's RecentChanges API with dual-query strategy (mw-reverted tag + mw-rollback/mw-undo trace-back) for reverted edits, plus a survived pool. Self-revert and edit-war filtering cleans the labels. An `EditSource` protocol enables future Toolforge backends. The fetcher reuses enrichment functions from `fetch_patrol_edits.py`.

**Tech Stack:** Python 3.13, pywikibot, PyYAML, scikit-learn, numpy

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-02-19

**Testing patterns:** pytest with `pythonpath = ["scripts"]`; `unittest.mock` (MagicMock, patch); plain `assert`; `_make_*` helpers; classes grouping related tests; `tmp_path` for file I/O; `pytest.approx()` for float comparisons. See `tests/conftest.py` for shared fixtures. Run with `uv run pytest`.

---

## Phase 4: Metrics Computation Script

**Goal:** Compute per-model and ensemble metrics from verdict fanout results against ground truth labels.

**Key codebase facts (verified by investigation):**
- Verdict YAML files saved to `logs/wikidata-patrol-experiment/verdicts-fanout/` by `save_verdict()` in `run_verdict_fanout.py:502`
- Each verdict has: `timestamp`, `model`, `rcid`, `revid`, `title`, `property`, `property_label`, `value_label`, `diff_type`, `finish_status`, `turns`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `verdict`, `rationale`, `sources`
- Verdict values: `verified-high`, `verified-low`, `plausible`, `unverifiable`, `suspect`, `incorrect`, or `None`
- Ground truth labels (from Phase 1): `reverted` or `survived` with evidence type
- Enriched snapshot YAML has `{fetch_date, label, count, edits}` with per-edit `ground_truth` key
- `model_slug()` in `run_verdict_fanout.py:103` extracts short name from model ID

**External dependencies (researched):**
- scikit-learn 1.8.0: `confusion_matrix(y_true, y_pred)`, `precision_recall_curve(y_true, y_score)`, `average_precision_score(y_true, y_score)`
- numpy: `np.mean()`, `np.where()`, `np.asarray()`
- `precision_recall_curve` returns `(precision, recall, thresholds)` where `thresholds` has length `len(precision) - 1`
- FR@Recall is a custom metric computed from the PR curve

### Task 1: Add scikit-learn dependency and create script skeleton

**Files:**
- Modify: `wikidata-SIFT/pyproject.toml`
- Create: `scripts/analyze_verdicts.py`

**Step 1: Add scikit-learn and numpy to dependencies**

In `wikidata-SIFT/pyproject.toml`, add to the `dependencies` list:

```toml
dependencies = [
    "pywikibot>=10.7",
    "pyyaml",
    "trafilatura>=2.0",
    "httpx>=0.27",
    "openai>=1.40",
    "scikit-learn>=1.6",
    "numpy>=1.26",
]
```

**Step 2: Verify dependency installation**

Run: `cd /var/home/louie/Projects/Volunteering-Consulting/open-graph-next/.worktrees/labeled-evaluation-dataset/wikidata-SIFT && uv sync`

Expected: Dependencies install successfully.

**Step 3: Create script skeleton**

Create `scripts/analyze_verdicts.py`:

```python
#!/usr/bin/env python3
"""Analyze verdict fanout results against ground truth labels.

Reads verdict YAML files and a ground truth snapshot YAML, computes
per-model and ensemble metrics, and outputs structured analysis YAML.

Usage:
    python scripts/analyze_verdicts.py --verdicts-dir logs/.../verdicts-fanout/ --ground-truth logs/.../labeled/snapshot.yaml
    python scripts/analyze_verdicts.py --verdicts-dir DIR --ground-truth FILE --output analysis.yaml
"""

import argparse
from collections import defaultdict
from pathlib import Path

import numpy as np
import yaml
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_curve,
)


ANALYSIS_DIR = Path("logs/wikidata-patrol-experiment/analysis")

# Verdict-to-binary mapping (design spec)
ACCEPT_VERDICTS = {"verified-high", "verified-low", "plausible"}
REJECT_VERDICTS = {"incorrect", "suspect"}
ABSTAIN_VERDICTS = {"unverifiable", None}

# Ordinal scale for PR-AUC (higher = more confident "accept")
VERDICT_ORDINAL = {
    "verified-high": 5,
    "verified-low": 4,
    "plausible": 3,
    "unverifiable": 2,
    "suspect": 1,
    "incorrect": 0,
    None: 2,  # Same as unverifiable (flag for review)
}


def load_verdicts(verdicts_dir):
    """Load all verdict YAML files from a directory.

    Args:
        verdicts_dir: Path to directory containing verdict YAML files.

    Returns:
        List of verdict dicts.
    """
    verdicts_dir = Path(verdicts_dir)
    verdicts = []
    for path in sorted(verdicts_dir.glob("*.yaml")):
        with open(path) as f:
            verdict = yaml.safe_load(f)
        if verdict:
            verdicts.append(verdict)
    return verdicts


def load_ground_truth(snapshot_path):
    """Load ground truth labels from a labeled snapshot YAML.

    Args:
        snapshot_path: Path to labeled snapshot YAML.

    Returns:
        Dict mapping (rcid_or_revid, property) -> ground_truth dict.
        Uses revid as key since Pool B edits may lack rcid.
    """
    with open(snapshot_path) as f:
        snapshot = yaml.safe_load(f)

    gt_map = {}
    for edit in snapshot.get("edits", []):
        gt = edit.get("ground_truth")
        if not gt:
            continue
        # Key by revid + property for reliable matching
        parsed = edit.get("parsed_edit") or {}
        key = (edit.get("revid"), parsed.get("property"))
        gt_map[key] = gt

    return gt_map


def join_verdicts_with_ground_truth(verdicts, gt_map):
    """Join verdict results with ground truth labels.

    Args:
        verdicts: List of verdict dicts.
        gt_map: Dict from load_ground_truth.

    Returns:
        List of (verdict_dict, ground_truth_dict) tuples for matched pairs.
    """
    joined = []
    for v in verdicts:
        key = (v.get("revid"), v.get("property"))
        gt = gt_map.get(key)
        if gt:
            joined.append((v, gt))
    return joined


def verdict_to_binary(verdict_value):
    """Map a verdict string to accept/reject/abstain.

    Args:
        verdict_value: Verdict string or None.

    Returns:
        "accept", "reject", or "abstain".
    """
    if verdict_value in ACCEPT_VERDICTS:
        return "accept"
    elif verdict_value in REJECT_VERDICTS:
        return "reject"
    else:
        return "abstain"


def verdict_to_score(verdict_value):
    """Map a verdict string to an ordinal score for threshold metrics.

    Higher scores = more confident the edit is good.

    Args:
        verdict_value: Verdict string or None.

    Returns:
        int score from 0 (incorrect) to 5 (verified-high).
    """
    return VERDICT_ORDINAL.get(verdict_value, 2)


def main():
    parser = argparse.ArgumentParser(
        description="Analyze verdict fanout results against ground truth."
    )
    parser.add_argument(
        "--verdicts-dir", required=True,
        help="Directory containing verdict YAML files",
    )
    parser.add_argument(
        "--ground-truth", required=True,
        help="Path to labeled snapshot YAML with ground truth",
    )
    parser.add_argument(
        "--output", "-o", type=str, default=None,
        help="Output YAML path (default: auto-generated in analysis dir)",
    )
    args = parser.parse_args()

    print(f"Loading verdicts from {args.verdicts_dir}...")
    verdicts = load_verdicts(args.verdicts_dir)
    print(f"  Loaded {len(verdicts)} verdicts")

    print(f"Loading ground truth from {args.ground_truth}...")
    gt_map = load_ground_truth(args.ground_truth)
    print(f"  Loaded {len(gt_map)} ground truth labels")

    joined = join_verdicts_with_ground_truth(verdicts, gt_map)
    print(f"  Matched {len(joined)} verdict-ground truth pairs")

    if not joined:
        print("No matched pairs found. Check that verdicts and ground truth share revid+property keys.")
        return

    print("Not yet implemented — see Tasks 2-5")


if __name__ == "__main__":
    main()
```

**Step 4: Verify the script runs**

Run: `uv run python scripts/analyze_verdicts.py --help`

Expected: Help text with --verdicts-dir, --ground-truth, --output arguments.

**Step 5: Commit**

```bash
git add wikidata-SIFT/pyproject.toml scripts/analyze_verdicts.py
git commit -m "feat: add analyze_verdicts.py skeleton with verdict loading and ground truth joining"
```

Note: The `git add` path for pyproject.toml depends on your working directory. If you're in the wikidata-SIFT directory, use just `pyproject.toml`. Adjust accordingly.

---

### Task 2: Per-model confusion matrix and basic metrics

**Files:**
- Modify: `scripts/analyze_verdicts.py`
- Create: `tests/test_analyze_verdicts.py`

**Step 1: Write tests**

Create `tests/test_analyze_verdicts.py`:

```python
"""Tests for the verdict analysis pipeline."""

import pytest
import numpy as np


def _make_verdict(model, revid, prop, verdict, cost_usd=0.001):
    """Build a minimal verdict dict for testing."""
    return {
        "model": model,
        "revid": revid,
        "property": prop,
        "verdict": verdict,
        "cost_usd": cost_usd,
        "diff_type": "value_changed",
    }


def _make_gt(label, evidence="mw-reverted-tag"):
    """Build a minimal ground truth dict for testing."""
    return {"label": label, "evidence": evidence}


class TestVerdictToBinary:
    """Tests for verdict-to-binary mapping."""

    def test_accept_verdicts(self):
        from analyze_verdicts import verdict_to_binary
        assert verdict_to_binary("verified-high") == "accept"
        assert verdict_to_binary("verified-low") == "accept"
        assert verdict_to_binary("plausible") == "accept"

    def test_reject_verdicts(self):
        from analyze_verdicts import verdict_to_binary
        assert verdict_to_binary("incorrect") == "reject"
        assert verdict_to_binary("suspect") == "reject"

    def test_abstain_verdicts(self):
        from analyze_verdicts import verdict_to_binary
        assert verdict_to_binary("unverifiable") == "abstain"
        assert verdict_to_binary(None) == "abstain"


class TestVerdictToScore:
    """Tests for ordinal verdict scoring."""

    def test_ordering(self):
        from analyze_verdicts import verdict_to_score
        assert verdict_to_score("verified-high") > verdict_to_score("verified-low")
        assert verdict_to_score("verified-low") > verdict_to_score("plausible")
        assert verdict_to_score("plausible") > verdict_to_score("unverifiable")
        assert verdict_to_score("unverifiable") > verdict_to_score("suspect")
        assert verdict_to_score("suspect") > verdict_to_score("incorrect")


class TestPerModelMetrics:
    """Tests for per-model metric computation."""

    def test_confusion_matrix_counts(self):
        """Confusion matrix correctly counts accept/reject/abstain vs ground truth."""
        from analyze_verdicts import compute_per_model_metrics

        joined = [
            (_make_verdict("model-a", 1, "P31", "verified-high"), _make_gt("survived")),
            (_make_verdict("model-a", 2, "P31", "incorrect"), _make_gt("reverted")),
            (_make_verdict("model-a", 3, "P31", "verified-low"), _make_gt("reverted")),
            (_make_verdict("model-a", 4, "P31", "suspect"), _make_gt("survived")),
        ]

        metrics = compute_per_model_metrics(joined)

        cm = metrics["confusion_matrix"]
        # Matrix is: rows=ground truth (reverted, survived), cols=decision (accept, reject, abstain)
        assert cm["reverted"]["accept"] == 1   # verified-low on reverted edit
        assert cm["reverted"]["reject"] == 1   # incorrect on reverted edit
        assert cm["survived"]["accept"] == 1   # verified-high on survived edit
        assert cm["survived"]["reject"] == 1   # suspect on survived edit

    def test_precision_on_accept(self):
        """Precision = survived_accepted / total_accepted."""
        from analyze_verdicts import compute_per_model_metrics

        joined = [
            (_make_verdict("m", 1, "P1", "verified-high"), _make_gt("survived")),
            (_make_verdict("m", 2, "P1", "verified-high"), _make_gt("survived")),
            (_make_verdict("m", 3, "P1", "verified-high"), _make_gt("reverted")),
        ]

        metrics = compute_per_model_metrics(joined)

        # 2 correct accepts out of 3 total accepts
        assert metrics["precision_accept"] == pytest.approx(2 / 3)

    def test_recall_on_reject(self):
        """Recall on reject = reverted_rejected / total_reverted."""
        from analyze_verdicts import compute_per_model_metrics

        joined = [
            (_make_verdict("m", 1, "P1", "incorrect"), _make_gt("reverted")),
            (_make_verdict("m", 2, "P1", "suspect"), _make_gt("reverted")),
            (_make_verdict("m", 3, "P1", "plausible"), _make_gt("reverted")),
        ]

        metrics = compute_per_model_metrics(joined)

        # 2 rejected out of 3 reverted
        assert metrics["recall_reject"] == pytest.approx(2 / 3)

    def test_cost_per_verdict(self):
        """Average cost computed from cost_usd fields."""
        from analyze_verdicts import compute_per_model_metrics

        joined = [
            (_make_verdict("m", 1, "P1", "verified-high", cost_usd=0.001), _make_gt("survived")),
            (_make_verdict("m", 2, "P1", "incorrect", cost_usd=0.003), _make_gt("reverted")),
        ]

        metrics = compute_per_model_metrics(joined)

        assert metrics["cost_per_verdict"] == pytest.approx(0.002)
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestPerModelMetrics -v`

Expected: FAIL — `compute_per_model_metrics` doesn't exist.

**Step 3: Implement compute_per_model_metrics**

Add to `scripts/analyze_verdicts.py`:

```python
def compute_per_model_metrics(joined):
    """Compute confusion matrix and basic metrics for one model.

    Args:
        joined: List of (verdict_dict, ground_truth_dict) tuples,
            all for the same model.

    Returns:
        Dict with confusion_matrix, precision_accept, recall_reject,
        cost_per_verdict, and sample_count.
    """
    # Confusion matrix: rows = ground truth label, cols = decision
    cm = {
        "reverted": {"accept": 0, "reject": 0, "abstain": 0},
        "survived": {"accept": 0, "reject": 0, "abstain": 0},
    }

    costs = []
    for verdict, gt in joined:
        decision = verdict_to_binary(verdict.get("verdict"))
        label = gt["label"]
        if label in cm:
            cm[label][decision] += 1
        cost = verdict.get("cost_usd")
        if cost is not None:
            costs.append(cost)

    # Precision on accept = survived_accepted / total_accepted
    total_accepted = cm["reverted"]["accept"] + cm["survived"]["accept"]
    precision_accept = cm["survived"]["accept"] / total_accepted if total_accepted > 0 else 0.0

    # Recall on reject = reverted_rejected / total_reverted
    total_reverted = cm["reverted"]["accept"] + cm["reverted"]["reject"] + cm["reverted"]["abstain"]
    recall_reject = cm["reverted"]["reject"] / total_reverted if total_reverted > 0 else 0.0

    # Cost per verdict
    cost_per_verdict = sum(costs) / len(costs) if costs else None

    return {
        "confusion_matrix": cm,
        "precision_accept": precision_accept,
        "recall_reject": recall_reject,
        "cost_per_verdict": cost_per_verdict,
        "sample_count": len(joined),
    }
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_analyze_verdicts.py -v`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add scripts/analyze_verdicts.py tests/test_analyze_verdicts.py
git commit -m "feat: add per-model confusion matrix and basic metrics computation"
```

---

### Task 3: FR@Recall and PR-AUC computation

**Files:**
- Modify: `scripts/analyze_verdicts.py`
- Modify: `tests/test_analyze_verdicts.py`

**Step 1: Write tests**

Add to `tests/test_analyze_verdicts.py`:

```python
class TestFilterRateAtRecall:
    """Tests for FR@Recall computation."""

    def test_perfect_classifier(self):
        """Perfect classifier has filter_rate = survived_fraction at recall=1.0."""
        from analyze_verdicts import compute_filter_rate_at_recall

        # 5 survived (score 5) + 5 reverted (score 0) = perfect separation
        y_true = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]  # 1 = reverted (bad)
        y_score = [5, 5, 5, 5, 5, 0, 0, 0, 0, 0]  # higher = more confident accept

        fr, threshold, recall = compute_filter_rate_at_recall(y_true, y_score, target_recall=0.99)

        # All reverted edits caught, all survived edits filtered
        assert fr == pytest.approx(0.5)
        assert recall >= 0.99

    def test_returns_zero_for_random_classifier(self):
        """Random classifier achieves very low filter rate at high recall."""
        from analyze_verdicts import compute_filter_rate_at_recall

        # All same score — can't distinguish
        y_true = [0, 0, 1, 1]
        y_score = [3, 3, 3, 3]

        # With identical scores, FR@99% should require accepting almost nothing
        # (or raise an error if recall is unachievable)
        try:
            fr, threshold, recall = compute_filter_rate_at_recall(y_true, y_score, target_recall=0.99)
            assert fr <= 0.01  # Very low filter rate
        except ValueError:
            pass  # Acceptable: recall target unachievable

    def test_lower_recall_target_allows_more_filtering(self):
        """FR@90% >= FR@99% (lower recall target = more aggressive filtering)."""
        from analyze_verdicts import compute_filter_rate_at_recall

        # Mixed quality scores
        y_true = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
        y_score = [5, 4, 4, 3, 2, 1, 1, 0, 0, 0]

        fr_99, _, _ = compute_filter_rate_at_recall(y_true, y_score, target_recall=0.99)
        fr_90, _, _ = compute_filter_rate_at_recall(y_true, y_score, target_recall=0.90)

        assert fr_90 >= fr_99


class TestPRAUC:
    """Tests for PR-AUC computation."""

    def test_perfect_classifier_has_high_auc(self):
        """Perfect classifier has PR-AUC close to 1.0."""
        from analyze_verdicts import compute_pr_auc

        y_true = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
        y_score = [5, 5, 5, 5, 5, 0, 0, 0, 0, 0]

        auc = compute_pr_auc(y_true, y_score)

        assert auc > 0.95

    def test_random_classifier_has_low_auc(self):
        """Random scores produce PR-AUC near the positive class fraction."""
        from analyze_verdicts import compute_pr_auc

        np.random.seed(42)
        y_true = [0] * 50 + [1] * 50
        y_score = list(np.random.uniform(0, 5, 100))

        auc = compute_pr_auc(y_true, y_score)

        # Random baseline ≈ positive rate = 0.5
        assert 0.3 < auc < 0.7
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestFilterRateAtRecall tests/test_analyze_verdicts.py::TestPRAUC -v`

Expected: FAIL — functions don't exist.

**Step 3: Implement FR@Recall and PR-AUC**

Add to `scripts/analyze_verdicts.py`:

```python
def compute_filter_rate_at_recall(y_true, y_score, target_recall=0.99):
    """Compute Filter Rate at a given Recall threshold.

    Filter rate = fraction of all samples below the operating threshold
    (auto-accepted without human review), when the threshold is chosen
    so that recall >= target_recall.

    For this metric, y_true=1 means the edit needs review (reverted).
    y_score should be INVERTED (higher = more likely to be good/accepted),
    so we compute the PR curve with pos_label=1 on inverted scores.

    Actually, for FR@Recall we want:
    - Recall = fraction of reverted edits caught (scored LOW)
    - Filter rate = fraction of all edits scored HIGH (auto-accepted)

    So we use: pos_label=1 (reverted=positive), and INVERT y_score
    so that low scores (likely reverted) get high inverted scores.

    Args:
        y_true: Binary labels (1 = reverted/bad, 0 = survived/good).
        y_score: Ordinal scores (higher = more confident the edit is good).
        target_recall: Minimum recall on reverted edits (default 0.99).

    Returns:
        (filter_rate, operating_threshold, achieved_recall) tuple.

    Raises:
        ValueError: If no threshold achieves the target recall.
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score, dtype=float)

    # Invert scores: higher inverted score = more likely reverted (bad)
    inverted_scores = -y_score

    precision, recall, thresholds = precision_recall_curve(
        y_true, inverted_scores, pos_label=1
    )

    # thresholds has length len(precision) - 1
    recall_at_thresholds = recall[:-1]

    valid_mask = recall_at_thresholds >= target_recall
    if not np.any(valid_mask):
        raise ValueError(
            f"No threshold achieves recall >= {target_recall}. "
            f"Max recall: {recall.max():.4f}"
        )

    # Pick the highest threshold that meets recall target
    # (most aggressive filtering while meeting the recall constraint)
    valid_indices = np.where(valid_mask)[0]
    chosen_idx = valid_indices[-1]

    operating_threshold = thresholds[chosen_idx]
    achieved_recall = recall_at_thresholds[chosen_idx]

    # Filter rate = fraction of samples with inverted_score < threshold
    # i.e., samples the model thinks are good (original score is high)
    filter_rate = float(np.mean(inverted_scores < operating_threshold))

    return filter_rate, float(operating_threshold), float(achieved_recall)


def compute_pr_auc(y_true, y_score):
    """Compute PR-AUC (Average Precision) for reverted edit detection.

    Uses inverted scores so that reverted edits (pos_label=1) are
    the positive class.

    Args:
        y_true: Binary labels (1 = reverted/bad, 0 = survived/good).
        y_score: Ordinal scores (higher = more confident the edit is good).

    Returns:
        float: Average precision score (PR-AUC).
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score, dtype=float)

    # Invert: higher inverted score = more likely reverted
    return float(average_precision_score(y_true, -y_score))
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestFilterRateAtRecall tests/test_analyze_verdicts.py::TestPRAUC -v`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add scripts/analyze_verdicts.py tests/test_analyze_verdicts.py
git commit -m "feat: add FR@Recall and PR-AUC computation"
```

---

### Task 4: Ensemble metrics

**Files:**
- Modify: `scripts/analyze_verdicts.py`
- Modify: `tests/test_analyze_verdicts.py`

**Step 1: Write tests for ensemble strategies**

Add to `tests/test_analyze_verdicts.py`:

```python
class TestEnsembleStrategies:
    """Tests for multi-model ensemble verdict computation."""

    def test_majority_vote_rejects_when_3_of_4_reject(self):
        """Majority vote: 3/4 reject -> ensemble rejects."""
        from analyze_verdicts import majority_vote

        verdicts = ["incorrect", "suspect", "incorrect", "verified-high"]
        assert majority_vote(verdicts) == "reject"

    def test_majority_vote_accepts_when_3_of_4_accept(self):
        """Majority vote: 3/4 accept -> ensemble accepts."""
        from analyze_verdicts import majority_vote

        verdicts = ["verified-high", "verified-low", "plausible", "suspect"]
        assert majority_vote(verdicts) == "accept"

    def test_majority_vote_tie_goes_to_reject(self):
        """Majority vote: 2/4 each -> tie goes to reject (conservative)."""
        from analyze_verdicts import majority_vote

        verdicts = ["verified-high", "verified-low", "suspect", "incorrect"]
        assert majority_vote(verdicts) == "reject"

    def test_unanimous_accept_requires_all(self):
        """Unanimous accept: all models must accept."""
        from analyze_verdicts import unanimous_accept

        assert unanimous_accept(["verified-high", "verified-low", "plausible", "verified-high"]) == "accept"
        assert unanimous_accept(["verified-high", "verified-low", "suspect", "verified-high"]) == "reject"
        assert unanimous_accept(["verified-high", "unverifiable", "plausible", "verified-high"]) == "reject"

    def test_ensemble_from_per_edit_verdicts(self):
        """compute_ensemble_verdicts groups by edit and applies strategy."""
        from analyze_verdicts import compute_ensemble_verdicts

        verdicts_with_gt = [
            (_make_verdict("model-a", 1, "P31", "verified-high"), _make_gt("survived")),
            (_make_verdict("model-b", 1, "P31", "verified-low"), _make_gt("survived")),
            (_make_verdict("model-c", 1, "P31", "plausible"), _make_gt("survived")),
            (_make_verdict("model-d", 1, "P31", "suspect"), _make_gt("survived")),
            (_make_verdict("model-a", 2, "P31", "incorrect"), _make_gt("reverted")),
            (_make_verdict("model-b", 2, "P31", "suspect"), _make_gt("reverted")),
            (_make_verdict("model-c", 2, "P31", "incorrect"), _make_gt("reverted")),
            (_make_verdict("model-d", 2, "P31", "verified-low"), _make_gt("reverted")),
        ]

        ensemble = compute_ensemble_verdicts(verdicts_with_gt, strategy="majority_vote")

        assert len(ensemble) == 2  # 2 edits
        # Edit 1: 3 accept + 1 reject -> majority accept
        # Edit 2: 3 reject + 1 accept -> majority reject
        decisions = {e["revid"]: e["decision"] for e in ensemble}
        assert decisions[1] == "accept"
        assert decisions[2] == "reject"
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestEnsembleStrategies -v`

Expected: FAIL — ensemble functions don't exist.

**Step 3: Implement ensemble functions**

Add to `scripts/analyze_verdicts.py`:

```python
def majority_vote(verdicts):
    """Apply majority vote to a list of verdict strings.

    Counts accept vs reject+abstain decisions. Ties go to reject (conservative).

    Args:
        verdicts: List of verdict strings.

    Returns:
        "accept" or "reject".
    """
    accept_count = sum(1 for v in verdicts if verdict_to_binary(v) == "accept")
    total = len(verdicts)
    return "accept" if accept_count > total / 2 else "reject"


def unanimous_accept(verdicts):
    """Unanimous accept: all models must classify as accept.

    Any reject or abstain -> ensemble rejects.

    Args:
        verdicts: List of verdict strings.

    Returns:
        "accept" or "reject".
    """
    if all(verdict_to_binary(v) == "accept" for v in verdicts):
        return "accept"
    return "reject"


def compute_ensemble_verdicts(joined, strategy="majority_vote", model_filter=None):
    """Compute ensemble verdicts by grouping per-edit model verdicts.

    Args:
        joined: List of (verdict_dict, ground_truth_dict) tuples.
        strategy: "majority_vote" or "unanimous_accept".
        model_filter: Optional set of model strings to include. If None, all models.

    Returns:
        List of dicts with revid, property, decision, ground_truth_label.
    """
    strategy_fn = majority_vote if strategy == "majority_vote" else unanimous_accept

    # Group by (revid, property)
    groups = defaultdict(lambda: {"verdicts": [], "gt": None})
    for verdict, gt in joined:
        if model_filter and verdict.get("model") not in model_filter:
            continue
        key = (verdict.get("revid"), verdict.get("property"))
        groups[key]["verdicts"].append(verdict.get("verdict"))
        groups[key]["gt"] = gt

    results = []
    for (revid, prop), data in groups.items():
        decision = strategy_fn(data["verdicts"])
        results.append({
            "revid": revid,
            "property": prop,
            "decision": decision,
            "ground_truth_label": data["gt"]["label"],
            "model_verdicts": data["verdicts"],
        })

    return results
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestEnsembleStrategies -v`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add scripts/analyze_verdicts.py tests/test_analyze_verdicts.py
git commit -m "feat: add ensemble verdict strategies (majority vote, unanimous accept)"
```

---

### Task 5: Output formatting, breakdown dimensions, and CLI wiring

**Files:**
- Modify: `scripts/analyze_verdicts.py`
- Modify: `tests/test_analyze_verdicts.py`

**Step 1: Write test for full analysis output**

Add to `tests/test_analyze_verdicts.py`:

```python
class TestFullAnalysis:
    """Tests for the complete analysis pipeline."""

    def test_produces_structured_output(self):
        """run_analysis produces YAML-serializable dict with all sections."""
        from analyze_verdicts import run_analysis

        joined = [
            (_make_verdict("model-a", 1, "P31", "verified-high", 0.001), _make_gt("survived")),
            (_make_verdict("model-a", 2, "P31", "incorrect", 0.002), _make_gt("reverted")),
            (_make_verdict("model-b", 1, "P31", "verified-low", 0.003), _make_gt("survived")),
            (_make_verdict("model-b", 2, "P31", "suspect", 0.004), _make_gt("reverted")),
        ]

        result = run_analysis(joined)

        # Has per-model section
        assert "per_model" in result
        assert "model-a" in result["per_model"]
        assert "model-b" in result["per_model"]

        # Each model has required metrics
        for model_metrics in result["per_model"].values():
            assert "confusion_matrix" in model_metrics
            assert "precision_accept" in model_metrics
            assert "recall_reject" in model_metrics
            assert "cost_per_verdict" in model_metrics
            assert "sample_count" in model_metrics

        # Has ensemble section
        assert "ensemble" in result

        # Has breakdowns section
        assert "breakdowns" in result
        assert "by_evidence_type" in result["breakdowns"]
        assert "by_diff_type" in result["breakdowns"]
        assert "by_property" in result["breakdowns"]

        # Has summary
        assert "summary" in result
        assert result["summary"]["total_verdicts"] == 4
        assert result["summary"]["total_edits"] == 2

    def test_output_is_yaml_serializable(self, tmp_path):
        """Analysis output can be serialized to YAML."""
        from analyze_verdicts import run_analysis

        joined = [
            (_make_verdict("model-a", 1, "P31", "verified-high", 0.001), _make_gt("survived")),
            (_make_verdict("model-a", 2, "P31", "incorrect", 0.002), _make_gt("reverted")),
        ]

        result = run_analysis(joined)

        # Should not raise
        out_path = tmp_path / "analysis.yaml"
        with open(out_path, "w") as f:
            yaml.safe_dump(result, f, default_flow_style=False)

        # Should round-trip
        with open(out_path) as f:
            loaded = yaml.safe_load(f)
        assert loaded["summary"]["total_verdicts"] == 2
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_analyze_verdicts.py::TestFullAnalysis -v`

Expected: FAIL — `run_analysis` doesn't exist.

**Step 3: Implement run_analysis and wire up main**

Add to `scripts/analyze_verdicts.py`:

```python
def run_analysis(joined):
    """Run the complete analysis pipeline.

    Args:
        joined: List of (verdict_dict, ground_truth_dict) tuples.

    Returns:
        Dict with per_model, ensemble, and summary sections.
        All values are YAML-serializable (no numpy types).
    """
    # Group by model
    by_model = defaultdict(list)
    for verdict, gt in joined:
        model = verdict.get("model", "unknown")
        by_model[model].append((verdict, gt))

    # Per-model metrics
    per_model = {}
    for model, model_joined in sorted(by_model.items()):
        metrics = compute_per_model_metrics(model_joined)

        # Compute threshold-based metrics
        y_true = [1 if gt["label"] == "reverted" else 0 for _, gt in model_joined]
        y_score = [verdict_to_score(v.get("verdict")) for v, _ in model_joined]

        try:
            metrics["pr_auc"] = compute_pr_auc(y_true, y_score)
        except Exception:
            metrics["pr_auc"] = None

        for target, key in [(0.99, "fr_at_99"), (0.90, "fr_at_90")]:
            try:
                fr, _, recall = compute_filter_rate_at_recall(y_true, y_score, target)
                metrics[key] = {"filter_rate": fr, "achieved_recall": recall}
            except ValueError:
                metrics[key] = None

        per_model[model] = metrics

    # Ensemble metrics
    ensemble = {}
    for strategy in ("majority_vote", "unanimous_accept"):
        ensemble_results = compute_ensemble_verdicts(joined, strategy=strategy)
        if ensemble_results:
            # Compute metrics on ensemble decisions
            ensemble_joined = [
                ({"verdict": "verified-high" if r["decision"] == "accept" else "incorrect"}, {"label": r["ground_truth_label"]})
                for r in ensemble_results
            ]
            ensemble[strategy] = compute_per_model_metrics(ensemble_joined)

    # Open-model-only ensemble (exclude Claude Haiku)
    open_models = {m for m in by_model if "claude" not in m.lower() and "anthropic" not in m.lower()}
    if open_models:
        for strategy in ("majority_vote", "unanimous_accept"):
            key = f"open_models_{strategy}"
            ensemble_results = compute_ensemble_verdicts(joined, strategy=strategy, model_filter=open_models)
            if ensemble_results:
                ensemble_joined = [
                    ({"verdict": "verified-high" if r["decision"] == "accept" else "incorrect"}, {"label": r["ground_truth_label"]})
                    for r in ensemble_results
                ]
                ensemble[key] = compute_per_model_metrics(ensemble_joined)

    # Summary
    unique_edits = set()
    for verdict, _ in joined:
        unique_edits.add((verdict.get("revid"), verdict.get("property")))

    summary = {
        "total_verdicts": len(joined),
        "total_edits": len(unique_edits),
        "models": sorted(by_model.keys()),
        "ground_truth_distribution": {
            "reverted": sum(1 for _, gt in joined if gt["label"] == "reverted"),
            "survived": sum(1 for _, gt in joined if gt["label"] == "survived"),
        },
    }

    # Breakdowns by dimension
    breakdowns = {}

    # By ground truth evidence type (mw-reverted-tag, reverter-traced, patrolled, not-reverted-14d)
    by_evidence = defaultdict(list)
    for verdict, gt in joined:
        evidence = gt.get("evidence", "unknown")
        by_evidence[evidence].append((verdict, gt))
    breakdowns["by_evidence_type"] = {
        ev: compute_per_model_metrics(items)
        for ev, items in sorted(by_evidence.items())
    }

    # By edit operation type (diff_type: value_changed, statement_added, etc.)
    by_diff = defaultdict(list)
    for verdict, gt in joined:
        diff_type = verdict.get("diff_type", "unknown")
        by_diff[diff_type].append((verdict, gt))
    breakdowns["by_diff_type"] = {
        dt: compute_per_model_metrics(items)
        for dt, items in sorted(by_diff.items())
    }

    # By Wikidata property (P31, P106, etc.)
    by_property = defaultdict(list)
    for verdict, gt in joined:
        prop = verdict.get("property", "unknown")
        by_property[prop].append((verdict, gt))
    breakdowns["by_property"] = {
        prop: compute_per_model_metrics(items)
        for prop, items in sorted(by_property.items())
    }

    return {
        "summary": summary,
        "per_model": per_model,
        "ensemble": ensemble,
        "breakdowns": breakdowns,
    }
```

Then update `main()` to use `run_analysis`:

```python
def main():
    parser = argparse.ArgumentParser(
        description="Analyze verdict fanout results against ground truth."
    )
    parser.add_argument(
        "--verdicts-dir", required=True,
        help="Directory containing verdict YAML files",
    )
    parser.add_argument(
        "--ground-truth", required=True,
        help="Path to labeled snapshot YAML with ground truth",
    )
    parser.add_argument(
        "--output", "-o", type=str, default=None,
        help="Output YAML path (default: auto-generated in analysis dir)",
    )
    args = parser.parse_args()

    print(f"Loading verdicts from {args.verdicts_dir}...")
    verdicts = load_verdicts(args.verdicts_dir)
    print(f"  Loaded {len(verdicts)} verdicts")

    print(f"Loading ground truth from {args.ground_truth}...")
    gt_map = load_ground_truth(args.ground_truth)
    print(f"  Loaded {len(gt_map)} ground truth labels")

    joined = join_verdicts_with_ground_truth(verdicts, gt_map)
    print(f"  Matched {len(joined)} verdict-ground truth pairs")

    if not joined:
        print("No matched pairs found. Check that verdicts and ground truth share revid+property keys.")
        return

    print("Computing metrics...")
    analysis = run_analysis(joined)

    # Output
    if args.output:
        out_path = Path(args.output)
    else:
        ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
        from datetime import datetime, timezone
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out_path = ANALYSIS_DIR / f"{date_str}-analysis.yaml"

    with open(out_path, "w") as f:
        yaml.safe_dump(analysis, f, default_flow_style=False, allow_unicode=True)

    print(f"Analysis saved to {out_path}")

    # Print summary
    summary = analysis["summary"]
    print(f"\nSummary: {summary['total_verdicts']} verdicts across {summary['total_edits']} edits")
    print(f"Ground truth: {summary['ground_truth_distribution']}")
    for model, metrics in analysis["per_model"].items():
        print(f"\n  {model}:")
        print(f"    Precision (accept): {metrics['precision_accept']:.3f}")
        print(f"    Recall (reject):    {metrics['recall_reject']:.3f}")
        if metrics.get("pr_auc") is not None:
            print(f"    PR-AUC:             {metrics['pr_auc']:.3f}")
        if metrics.get("fr_at_99"):
            print(f"    FR@99%:             {metrics['fr_at_99']['filter_rate']:.3f}")
        if metrics.get("fr_at_90"):
            print(f"    FR@90%:             {metrics['fr_at_90']['filter_rate']:.3f}")
        if metrics.get("cost_per_verdict") is not None:
            print(f"    Cost/verdict:       ${metrics['cost_per_verdict']:.4f}")


if __name__ == "__main__":
    main()
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_analyze_verdicts.py -v`

Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `uv run pytest`

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add scripts/analyze_verdicts.py tests/test_analyze_verdicts.py
git commit -m "feat: complete analysis pipeline with per-model, ensemble, and output formatting"
```
