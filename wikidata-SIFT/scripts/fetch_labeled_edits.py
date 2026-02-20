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
import logging
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
    save_snapshot,
    STATEMENT_TAGS,
)


logger = logging.getLogger(__name__)


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

    def _fetch_pool_a(self, limit):
        """Pool A: edits tagged mw-reverted that are new-editor statement edits.

        Queries for edits with the mw-reverted tag in the time window, then
        filters to only those that also have a STATEMENT_TAGS tag.

        Returns:
            List of edit dicts with ground_truth key.
        """
        results = []
        for change in self.site.recentchanges(
            namespaces=[0],
            bot=False,
            tag="mw-reverted",
            start=self.rc_start,
            end=self.rc_end,
            total=limit * 5,  # overfetch since we filter
        ):
            tags = change.get("tags", [])
            is_new_editor_statement = any(t in tags for t in STATEMENT_TAGS)
            if not is_new_editor_statement:
                continue

            edit = normalize_change(change)
            edit["ground_truth"] = {
                "label": "reverted",
                "evidence": "mw-reverted-tag",
            }
            results.append(edit)

            if len(results) >= limit:
                break

        return results

    def _lookup_revision(self, revid):
        """Look up revision metadata via the MediaWiki API.

        Args:
            revid: Revision ID to look up.

        Returns:
            Dict with revid, user, comment, tags, parentid, timestamp.
            Returns None if the revision cannot be found.
        """
        try:
            request = self.site.simple_request(
                action="query",
                prop="revisions",
                revids=revid,
                rvprop="ids|user|comment|tags|timestamp",
            )
            data = request.submit()
            pages = data.get("query", {}).get("pages", {})
            # pages is a dict keyed by page ID (could be negative for missing)
            for page in pages.values() if isinstance(pages, dict) else pages:
                revisions = page.get("revisions", [])
                if revisions:
                    rev = revisions[0]
                    return {
                        "revid": rev.get("revid"),
                        "user": rev.get("user"),
                        "comment": rev.get("comment", ""),
                        "tags": rev.get("tags", []),
                        "parentid": rev.get("parentid"),
                        "timestamp": rev.get("timestamp"),
                    }
        except Exception as e:
            logger.debug("Failed to look up revision %s: %s", revid, e)
        return None

    def _fetch_pool_b(self, limit, exclude_revids=None):
        """Pool B: trace back from mw-rollback/mw-undo to find reverted edits.

        For each reverting action, looks up old_revid to find the edit that
        was reverted. Checks if it was a new-editor statement edit.

        Args:
            limit: Maximum number of reverted edits to collect.
            exclude_revids: Set of revids already found (for dedup).

        Returns:
            List of edit dicts with ground_truth key.
        """
        if exclude_revids is None:
            exclude_revids = set()

        results = []
        seen_revids = set(exclude_revids)

        for revert_tag in ("mw-rollback", "mw-undo"):
            if len(results) >= limit:
                break

            for change in self.site.recentchanges(
                namespaces=[0],
                bot=False,
                tag=revert_tag,
                start=self.rc_start,
                end=self.rc_end,
                total=limit * 5,
            ):
                if len(results) >= limit:
                    break

                reverted_revid = change.get("old_revid")
                if not reverted_revid or reverted_revid in seen_revids:
                    continue

                seen_revids.add(reverted_revid)

                # Look up the reverted revision's metadata
                rev_info = self._lookup_revision(reverted_revid)
                if rev_info is None:
                    continue

                # Check if it's a new-editor statement edit
                rev_tags = rev_info.get("tags", [])
                is_new_editor_statement = any(t in rev_tags for t in STATEMENT_TAGS)
                if not is_new_editor_statement:
                    continue

                # Build edit dict from revision info
                edit = {
                    "rcid": None,  # Not available from revision lookup
                    "revid": rev_info["revid"],
                    "old_revid": rev_info.get("parentid"),
                    "title": change.get("title"),
                    "user": rev_info["user"],
                    "timestamp": rev_info.get("timestamp"),
                    "comment": rev_info.get("comment", ""),
                    "tags": rev_tags,
                    "ground_truth": {
                        "label": "reverted",
                        "evidence": "reverter-traced",
                        "reverter_user": change.get("user"),
                        "revert_revid": change.get("revid"),
                    },
                }
                results.append(edit)

        return results

    def fetch_reverted(self, limit):
        """Fetch reverted edits via dual-query (Pool A + Pool B).

        Pool A: edits tagged mw-reverted that are new-editor statement edits.
        Pool B: trace-back from mw-rollback/mw-undo to find additional reverted edits.
        Results are deduplicated by revid.

        Args:
            limit: Maximum total reverted edits to collect.

        Returns:
            List of edit dicts with ground_truth key.
        """
        pool_a = self._fetch_pool_a(limit=limit)
        pool_a_revids = {e["revid"] for e in pool_a}

        remaining = limit - len(pool_a)
        pool_b = []
        if remaining > 0:
            pool_b = self._fetch_pool_b(
                limit=remaining,
                exclude_revids=pool_a_revids,
            )

        return pool_a + pool_b

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
