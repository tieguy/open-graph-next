#!/usr/bin/env python3
"""
Find the next untested entity from test-entities.yaml.

Usage:
    python scripts/next_test_entity.py          # Show next untested entity
    python scripts/next_test_entity.py --batch 5    # Show next 5 untested entities
    python scripts/next_test_entity.py --type human # Show next untested human
    python scripts/next_test_entity.py --status     # Show testing progress
"""

import argparse
from pathlib import Path

import yaml


def load_test_entities(entities_file: str = "docs/test-entities.yaml") -> list[dict]:
    """Load all test entities from YAML, flattened with type info."""
    entities_path = Path(entities_file)

    if not entities_path.exists():
        print(f"Error: {entities_file} not found")
        return []

    with open(entities_path, 'r') as f:
        data = yaml.safe_load(f)

    entities = []
    for entity_type in ['humans', 'organizations', 'creative_works']:
        for entity in data.get(entity_type, []):
            entity['type'] = entity_type.rstrip('s')  # human, organization, creative_work
            entities.append(entity)

    return entities


def get_tested_entities(log_dir: str = "logs/wikidata-methodology-testing") -> set[str]:
    """Get set of entity Q-ids that have been tested (have log files)."""
    log_path = Path(log_dir)

    if not log_path.exists():
        return set()

    tested = set()
    for log_file in log_path.glob("*.yaml"):
        # Log files are named: YYYY-MM-DD-Q123-P456.yaml
        # Extract Q-id from filename
        parts = log_file.stem.split('-')
        for part in parts:
            if part.startswith('Q') and part[1:].isdigit():
                tested.add(part)
                break

    return tested


def show_status(entities: list[dict], tested: set[str]):
    """Show testing progress by type and difficulty."""
    print("=" * 50)
    print("TESTING PROGRESS")
    print("=" * 50)

    by_type = {}
    by_difficulty = {}

    for entity in entities:
        etype = entity['type']
        difficulty = entity.get('difficulty', 'unknown')
        is_tested = entity['id'] in tested

        if etype not in by_type:
            by_type[etype] = {'total': 0, 'tested': 0}
        by_type[etype]['total'] += 1
        if is_tested:
            by_type[etype]['tested'] += 1

        if difficulty not in by_difficulty:
            by_difficulty[difficulty] = {'total': 0, 'tested': 0}
        by_difficulty[difficulty]['total'] += 1
        if is_tested:
            by_difficulty[difficulty]['tested'] += 1

    total = len(entities)
    total_tested = len(tested & {e['id'] for e in entities})

    print(f"\nOverall: {total_tested}/{total} ({100*total_tested/total:.0f}%)")

    print("\nBy Type:")
    for etype, stats in sorted(by_type.items()):
        pct = 100 * stats['tested'] / stats['total'] if stats['total'] > 0 else 0
        print(f"  {etype}: {stats['tested']}/{stats['total']} ({pct:.0f}%)")

    print("\nBy Difficulty:")
    for difficulty in ['easy', 'medium', 'hard']:
        if difficulty in by_difficulty:
            stats = by_difficulty[difficulty]
            pct = 100 * stats['tested'] / stats['total'] if stats['total'] > 0 else 0
            print(f"  {difficulty}: {stats['tested']}/{stats['total']} ({pct:.0f}%)")

    print()


def main():
    parser = argparse.ArgumentParser(description="Find next untested entity")
    parser.add_argument('--batch', '-n', type=int, default=1,
                        help="Number of entities to show (default: 1)")
    parser.add_argument('--type', '-t', choices=['human', 'organization', 'creative_work'],
                        help="Filter by entity type")
    parser.add_argument('--difficulty', '-d', choices=['easy', 'medium', 'hard'],
                        help="Filter by difficulty")
    parser.add_argument('--status', '-s', action='store_true',
                        help="Show testing progress status")
    args = parser.parse_args()

    entities = load_test_entities()
    if not entities:
        return

    tested = get_tested_entities()

    if args.status:
        show_status(entities, tested)
        return

    # Filter to untested entities
    untested = [e for e in entities if e['id'] not in tested]

    # Apply type filter
    if args.type:
        untested = [e for e in untested if e['type'] == args.type]

    # Apply difficulty filter
    if args.difficulty:
        untested = [e for e in untested if e.get('difficulty') == args.difficulty]

    if not untested:
        filters = []
        if args.type:
            filters.append(f"type={args.type}")
        if args.difficulty:
            filters.append(f"difficulty={args.difficulty}")
        filter_str = f" (filters: {', '.join(filters)})" if filters else ""
        print(f"All entities tested{filter_str}!")
        return

    # Show next N entities
    to_show = untested[:args.batch]

    for entity in to_show:
        print(f"{entity['id']}  {entity['label']}")
        print(f"    Type: {entity['type']}, Difficulty: {entity.get('difficulty', 'unknown')}")
        if entity.get('notes'):
            print(f"    Notes: {entity['notes']}")
        print()

    remaining = len(untested) - len(to_show)
    if remaining > 0:
        print(f"({remaining} more untested entities)")


if __name__ == "__main__":
    main()
