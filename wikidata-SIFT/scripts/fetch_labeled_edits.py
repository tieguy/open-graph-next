#!/usr/bin/env python3
"""Fetch labeled historical edits from Wikidata for evaluation.

Builds a labeled dataset by querying Wikidata's RecentChanges API for:
- Reverted edits (negative pool): edits tagged mw-reverted or traced via mw-rollback/mw-undo
- Survived edits (positive pool): edits that survived 14+ days without revert

Self-reverts and edit-war edits are filtered out. Output is an enriched
snapshot YAML with ground_truth labels, in the same format consumed by
run_verdict_fanout.py.

Usage:
    python scripts/fetch_labeled_edits.py --dry-run
    python scripts/fetch_labeled_edits.py --reverted 250 --survived 250
    python scripts/fetch_labeled_edits.py --reverted 250 --survived 250 --no-enrich
"""

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Protocol

import pywikibot
import yaml

from fetch_patrol_edits import (
    enrich_edit_group,
    get_production_site,
    group_edits,
    LabelCache,
    load_blocked_domains,
    normalize_change,
    parse_edit_summary,
    save_snapshot,
    STATEMENT_TAGS,
)


SNAPSHOT_DIR = "logs/wikidata-patrol-experiment/labeled"


class EditSource(Protocol):
    """Interface for fetching labeled historical edits.

    Implementations provide reverted and survived edit pools from different
    data sources (RecentChanges API, Toolforge, etc.).
    """

    def fetch_reverted(self, limit: int) -> list[dict]:
        """Fetch edits that were reverted (negative pool).

        Returns list of edit dicts, each with a ground_truth key containing:
            label: "reverted"
            evidence: str describing how the revert was detected
            reverter_user: str (user who performed the revert)
            revert_revid: int (revision ID of the reverting edit)
        """
        ...

    def fetch_survived(self, limit: int, exclude_revids: set[int] | None = None) -> list[dict]:
        """Fetch edits that survived without revert (positive pool).

        Args:
            limit: Maximum number of survived edits to collect.
            exclude_revids: Set of revids from reverted pools to exclude.

        Returns list of edit dicts, each with a ground_truth key containing:
            label: "survived"
            evidence: "patrolled" or "not-reverted-14d"
        """
        ...


class RecentChangesSource:
    """Fetch labeled edits from Wikidata's RecentChanges API.

    Uses a dual-query strategy for reverted edits (mw-reverted tag + trace-back
    from mw-rollback/mw-undo) and a time-window approach for survived edits.

    Args:
        site: pywikibot Site for production Wikidata.
        window_start_days: How many days ago the time window starts (default 30).
        window_end_days: How many days ago the time window ends (default 14).
    """

    def __init__(self, site, window_start_days=30, window_end_days=14):
        self.site = site
        now = datetime.now(timezone.utc)
        # start = newer boundary, end = older boundary (pywikibot convention)
        self.rc_start = now - timedelta(days=window_end_days)
        self.rc_end = now - timedelta(days=window_start_days)

    def fetch_reverted(self, limit):
        raise NotImplementedError("Implemented in Task 2-4")

    def fetch_survived(self, limit):
        raise NotImplementedError("Implemented in Task 5")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch labeled historical edits from Wikidata for evaluation."
    )
    parser.add_argument(
        "--reverted", type=int, default=250,
        help="Target number of reverted edits (default: 250)",
    )
    parser.add_argument(
        "--survived", type=int, default=250,
        help="Target number of survived edits (default: 250)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print summary without saving",
    )
    parser.add_argument(
        "--no-enrich", action="store_true",
        help="Skip enrichment (fetch labels only)",
    )
    parser.add_argument(
        "--output-dir", "-o", type=str, default=SNAPSHOT_DIR,
        help=f"Output directory (default: {SNAPSHOT_DIR})",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for sampling (default: 42)",
    )
    args = parser.parse_args()

    print(f"Arguments: reverted={args.reverted}, survived={args.survived}")
    print("Not yet implemented — see Tasks 2-8")


if __name__ == "__main__":
    main()
