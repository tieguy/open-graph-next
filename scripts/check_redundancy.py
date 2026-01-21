#!/usr/bin/env python3
"""Check if a property already exists on an entity (as claim or qualifier).

Usage:
    python scripts/check_redundancy.py Q42 P512
    python scripts/check_redundancy.py Q42 P512 --verbose
"""

import argparse
import sys
import pywikibot


def get_label(item_or_value, site):
    """Get English label for an item or value."""
    if hasattr(item_or_value, 'labels'):
        # It's an ItemPage
        try:
            item_or_value.get()
            return item_or_value.labels.get('en', str(item_or_value.id))
        except Exception:
            return str(item_or_value.id)
    elif hasattr(item_or_value, 'id'):
        return str(item_or_value.id)
    else:
        return str(item_or_value)


def check_redundancy(entity_id: str, property_id: str, verbose: bool = False):
    """Check if property exists as direct claim or qualifier on entity."""
    site = pywikibot.Site('wikidata', 'wikidata')
    repo = site.data_repository()

    try:
        item = pywikibot.ItemPage(repo, entity_id)
        item.get()
    except Exception as e:
        print(f"Error fetching {entity_id}: {e}", file=sys.stderr)
        return None

    entity_label = item.labels.get('en', entity_id)
    results = []

    # Check direct claims
    if property_id in item.claims:
        direct_claims = item.claims[property_id]
        for claim in direct_claims:
            value = claim.getTarget()
            value_label = get_label(value, site)
            results.append({
                'type': 'direct',
                'property': property_id,
                'value': value_label,
                'location': f'direct claim'
            })

    # Check all claims for this property as a qualifier
    for prop_id, claims in item.claims.items():
        for claim in claims:
            if hasattr(claim, 'qualifiers') and claim.qualifiers:
                if property_id in claim.qualifiers:
                    main_value = claim.getTarget()
                    main_label = get_label(main_value, site)

                    for qual in claim.qualifiers[property_id]:
                        qual_value = qual.getTarget()
                        qual_label = get_label(qual_value, site)
                        results.append({
                            'type': 'qualifier',
                            'property': property_id,
                            'value': qual_label,
                            'parent_property': prop_id,
                            'parent_value': main_label,
                            'location': f'qualifier on {prop_id} = {main_label}'
                        })

    return {
        'entity': entity_id,
        'entity_label': entity_label,
        'property': property_id,
        'found': len(results) > 0,
        'occurrences': results
    }


def main():
    parser = argparse.ArgumentParser(
        description='Check if a property already exists on an entity'
    )
    parser.add_argument('entity', help='Entity Q-id (e.g., Q42)')
    parser.add_argument('property', help='Property P-id to check (e.g., P512)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Show detailed output')

    args = parser.parse_args()

    result = check_redundancy(args.entity, args.property, args.verbose)

    if result is None:
        sys.exit(1)

    if result['found']:
        print(f"⚠ REDUNDANT: {args.property} already exists on {result['entity_label']} ({args.entity})")
        print()
        for occ in result['occurrences']:
            if occ['type'] == 'direct':
                print(f"  • Direct claim: {args.property} = {occ['value']}")
            else:
                print(f"  • Qualifier on {occ['parent_property']} ({occ['parent_value']}): {args.property} = {occ['value']}")
        sys.exit(2)  # Exit code 2 = redundant
    else:
        print(f"✓ OK: {args.property} not found on {result['entity_label']} ({args.entity})")
        print("  Property can be added as a new claim.")
        sys.exit(0)


if __name__ == '__main__':
    main()
