#!/usr/bin/env python3
"""
Verify Wikidata Q-ids or search for Q-ids by label.

Usage:
    python scripts/verify_qid.py Q1765120 "Bachelor of Arts"   # Verify Q-id matches label
    python scripts/verify_qid.py --search "Bachelor of Arts"   # Search for Q-id by label
    python scripts/verify_qid.py Q1765120                      # Just show what a Q-id is
"""

import argparse
import sys

import pywikibot


def verify_qid(qid: str, expected_label: str | None = None) -> bool:
    """
    Verify a Q-id exists and optionally matches expected label.

    Returns True if valid, False if not.
    """
    site = pywikibot.Site('wikidata', 'wikidata')
    repo = site.data_repository()

    try:
        item = pywikibot.ItemPage(repo, qid)
        item.get()
    except pywikibot.exceptions.InvalidTitleError:
        print(f"ERROR: '{qid}' is not a valid Q-id format")
        return False
    except pywikibot.exceptions.NoPageError:
        print(f"ERROR: {qid} does not exist on Wikidata")
        return False
    except Exception as e:
        print(f"ERROR: Failed to fetch {qid}: {e}")
        return False

    actual_label = item.labels.get('en', '[no English label]')
    description = item.descriptions.get('en', '[no description]')

    print(f"{qid}: {actual_label}")
    print(f"  Description: {description}")

    if expected_label:
        # Check if expected label appears in actual label (case-insensitive)
        if expected_label.lower() in actual_label.lower():
            print(f"  ✓ MATCH: Label contains '{expected_label}'")
            return True
        else:
            print(f"  ✗ MISMATCH: Expected '{expected_label}', got '{actual_label}'")
            return False

    return True


def search_qid(label: str, limit: int = 5) -> list[tuple[str, str, str]]:
    """
    Search Wikidata for items matching a label.

    Returns list of (qid, label, description) tuples.
    """
    site = pywikibot.Site('wikidata', 'wikidata')

    from pywikibot.data.api import Request

    # Use wbsearchentities API for better search
    request = Request(
        site=site,
        parameters={
            'action': 'wbsearchentities',
            'search': label,
            'language': 'en',
            'limit': limit,
            'format': 'json'
        }
    )

    results = []
    try:
        data = request.submit()
        for item in data.get('search', []):
            qid = item.get('id', '')
            item_label = item.get('label', '[no label]')
            description = item.get('description', '[no description]')
            results.append((qid, item_label, description))
    except Exception as e:
        print(f"ERROR: Search failed: {e}")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Verify Wikidata Q-ids or search by label"
    )
    parser.add_argument(
        'qid',
        nargs='?',
        help="Q-id to verify (e.g., Q1765120)"
    )
    parser.add_argument(
        'expected_label',
        nargs='?',
        help="Expected label to match (optional)"
    )
    parser.add_argument(
        '--search', '-s',
        metavar='LABEL',
        help="Search for Q-id by label instead of verifying"
    )
    parser.add_argument(
        '--limit', '-n',
        type=int,
        default=5,
        help="Number of search results (default: 5)"
    )

    args = parser.parse_args()

    if args.search:
        # Search mode
        print(f"Searching Wikidata for: '{args.search}'\n")
        results = search_qid(args.search, args.limit)

        if not results:
            print("No results found.")
            sys.exit(1)

        for qid, label, description in results:
            print(f"{qid}: {label}")
            print(f"  {description}\n")

        # Print the first result in a copy-pasteable format
        if results:
            best = results[0]
            print(f"Best match: {best[0]}  # {best[1]}")

    elif args.qid:
        # Verify mode
        success = verify_qid(args.qid, args.expected_label)
        sys.exit(0 if success else 1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
