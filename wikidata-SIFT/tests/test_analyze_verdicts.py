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
