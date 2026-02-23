"""Tests for the verdict analysis pipeline."""

import pytest
import numpy as np
import yaml


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
