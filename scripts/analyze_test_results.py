#!/usr/bin/env python3
"""
Analyze SIFT methodology test results from YAML logs.

Usage: python scripts/analyze_test_results.py
"""

import yaml
from pathlib import Path
from collections import Counter, defaultdict


def load_test_logs(log_dir: str = "logs/wikidata-methodology-testing") -> list[dict]:
    """Load all test log files."""
    logs = []
    log_path = Path(log_dir)

    if not log_path.exists():
        print(f"Log directory not found: {log_dir}")
        return logs

    for file in log_path.glob("*.yaml"):
        with open(file, 'r') as f:
            try:
                log = yaml.safe_load(f)
                log['_filename'] = file.name
                logs.append(log)
            except yaml.YAMLError as e:
                print(f"Error parsing {file}: {e}")

    return logs


def analyze_results(logs: list[dict]) -> dict:
    """Analyze test results and return metrics."""
    results = {
        'total_claims': len(logs),
        'verified_claims': 0,
        'unverified_claims': 0,
        'sift_correct': 0,
        'sift_incorrect': 0,
        'value_correct': 0,
        'value_incorrect': 0,
        'failure_modes': Counter(),
        'by_entity_type': defaultdict(lambda: {'total': 0, 'correct': 0}),
        'by_property': defaultdict(lambda: {'total': 0, 'correct': 0}),
        'by_confidence': defaultdict(lambda: {'total': 0, 'correct': 0}),
    }

    for log in logs:
        human_verification = log.get('human_verification', {})

        if not human_verification or human_verification.get('reviewed_by') is None:
            results['unverified_claims'] += 1
            continue

        results['verified_claims'] += 1

        # SIFT correctness
        if human_verification.get('sift_correct'):
            results['sift_correct'] += 1
        else:
            results['sift_incorrect'] += 1

        # Value correctness
        if human_verification.get('proposed_value_correct'):
            results['value_correct'] += 1
        else:
            results['value_incorrect'] += 1

        # Failure modes
        failure_mode = human_verification.get('failure_mode')
        if failure_mode:
            results['failure_modes'][failure_mode] += 1

        # By entity type
        entity_type = log.get('entity_type', 'unknown')
        results['by_entity_type'][entity_type]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_entity_type'][entity_type]['correct'] += 1

        # By property
        prop = log.get('property', 'unknown')
        results['by_property'][prop]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_property'][prop]['correct'] += 1

        # By confidence
        confidence = log.get('proposed_claim', {}).get('confidence', 'unknown')
        results['by_confidence'][confidence]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_confidence'][confidence]['correct'] += 1

    return results


def calculate_accuracy(correct: int, total: int) -> float:
    """Calculate accuracy percentage."""
    if total == 0:
        return 0.0
    return (correct / total) * 100


def print_report(results: dict):
    """Print human-readable analysis report."""
    print("=" * 60)
    print("SIFT METHODOLOGY TEST RESULTS")
    print("=" * 60)

    print(f"\n## Summary")
    print(f"Total claims logged: {results['total_claims']}")
    print(f"Human-verified: {results['verified_claims']}")
    print(f"Awaiting verification: {results['unverified_claims']}")

    if results['verified_claims'] > 0:
        sift_accuracy = calculate_accuracy(
            results['sift_correct'], results['verified_claims']
        )
        value_accuracy = calculate_accuracy(
            results['value_correct'], results['verified_claims']
        )

        print(f"\n## Accuracy Metrics")
        print(f"SIFT accuracy: {sift_accuracy:.1f}% ({results['sift_correct']}/{results['verified_claims']})")
        print(f"Value accuracy: {value_accuracy:.1f}% ({results['value_correct']}/{results['verified_claims']})")

        # Go/no-go assessment
        print(f"\n## Go/No-Go Assessment")
        if sift_accuracy >= 99:
            print("✓ SIFT accuracy ≥99% - autonomous operation viable")
        elif sift_accuracy >= 95:
            print("~ SIFT accuracy 95-99% - consider confidence-based filtering")
        else:
            print("✗ SIFT accuracy <95% - methodology needs iteration")

        # Failure modes
        if results['failure_modes']:
            print(f"\n## Failure Modes")
            for mode, count in results['failure_modes'].most_common():
                pct = (count / results['verified_claims']) * 100
                print(f"  {mode}: {count} ({pct:.1f}%)")

        # By entity type
        print(f"\n## Accuracy by Entity Type")
        for entity_type, stats in sorted(results['by_entity_type'].items()):
            if stats['total'] > 0:
                acc = calculate_accuracy(stats['correct'], stats['total'])
                print(f"  {entity_type}: {acc:.1f}% ({stats['correct']}/{stats['total']})")

        # By confidence level
        print(f"\n## Accuracy by Confidence Level")
        for confidence, stats in sorted(results['by_confidence'].items()):
            if stats['total'] > 0:
                acc = calculate_accuracy(stats['correct'], stats['total'])
                print(f"  {confidence}: {acc:.1f}% ({stats['correct']}/{stats['total']})")

    print("\n" + "=" * 60)


def main():
    logs = load_test_logs()

    if not logs:
        print("No test logs found. Run the wikidata-methodology-testing skill first.")
        return

    results = analyze_results(logs)
    print_report(results)


if __name__ == "__main__":
    main()
