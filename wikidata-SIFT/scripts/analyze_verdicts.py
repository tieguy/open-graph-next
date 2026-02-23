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
