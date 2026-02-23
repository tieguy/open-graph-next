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
        except (ValueError, ZeroDivisionError):
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
