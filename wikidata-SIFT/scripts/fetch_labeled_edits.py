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

    def __init__(self, site, window_start_days=30, window_end_days=14, max_qid=None):
        self.site = site
        self.max_qid = max_qid
        now = datetime.now(timezone.utc)
        # start = newer boundary, end = older boundary (pywikibot convention)
        self.rc_start = now - timedelta(days=window_end_days)
        self.rc_end = now - timedelta(days=window_start_days)

    def _passes_qid_filter(self, change):
        """Check if an edit's item Q-id is within the allowed range."""
        if self.max_qid is None:
            return True
        title = change.get("title", "")
        if title.startswith("Q"):
            try:
                return int(title[1:]) <= self.max_qid
            except ValueError:
                pass
        return True

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
            if not self._passes_qid_filter(change):
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
                if not self._passes_qid_filter(change):
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

    def fetch_survived(self, limit, exclude_revids=None):
        """Pool C: edits that survived 14+ days without revert.

        Queries for new-editor statement edits in the time window, excluding
        any that appear in the reverted pools. Splits by patrol status.

        Args:
            limit: Maximum number of survived edits to collect.
            exclude_revids: Set of revids from reverted pools (for exclusion).

        Returns:
            List of edit dicts with ground_truth key.
        """
        if exclude_revids is None:
            exclude_revids = set()

        results = []
        seen_revids = set(exclude_revids)

        for tag in STATEMENT_TAGS:
            if len(results) >= limit:
                break

            for change in self.site.recentchanges(
                namespaces=[0],
                bot=False,
                tag=tag,
                start=self.rc_start,
                end=self.rc_end,
                total=limit * 3,
            ):
                if len(results) >= limit:
                    break

                revid = change.get("revid")
                if revid in seen_revids:
                    continue
                if not self._passes_qid_filter(change):
                    continue
                seen_revids.add(revid)

                edit = normalize_change(change)

                is_patrolled = change.get("patrolled", False)
                edit["ground_truth"] = {
                    "label": "survived",
                    "evidence": "patrolled" if is_patrolled else "not-reverted-14d",
                }
                results.append(edit)

        return results


def filter_self_reverts(edits):
    """Remove edits where the reverter is the same user as the original editor.

    Self-reverts don't represent quality failures — they're corrections
    by the original editor.

    Args:
        edits: List of edit dicts with ground_truth keys.

    Returns:
        Filtered list with self-reverts removed.
    """
    filtered = []
    for edit in edits:
        gt = edit.get("ground_truth", {})
        reverter = gt.get("reverter_user")
        if reverter and reverter == edit.get("user"):
            continue
        filtered.append(edit)
    return filtered


def filter_edit_wars(edits):
    """Remove edits caught in mutual revert chains.

    An edit war is detected when the reverting edit was itself reverted.
    Both the original edit and the reverting edit are removed.

    Args:
        edits: List of edit dicts with ground_truth keys.

    Returns:
        Filtered list with edit-war participants removed.
    """
    # Build set of revids whose revert_revid is itself a reverted edit
    # i.e., the reverter was also reverted -> edit war
    war_revids = set()
    reverted_revids_in_dataset = {
        e["revid"] for e in edits
        if e.get("ground_truth", {}).get("label") == "reverted"
    }
    for edit in edits:
        gt = edit.get("ground_truth", {})
        rr = gt.get("revert_revid")
        # If this edit's reverter (revert_revid) also appears as a revid
        # in the dataset AND that reverter was itself reverted, it's a war
        if rr and rr in reverted_revids_in_dataset:
            war_revids.add(edit["revid"])
            war_revids.add(rr)

    return [e for e in edits if e.get("revid") not in war_revids]


def build_labeled_snapshot(reverted, survived, target_reverted=250, target_survived=250, seed=42):
    """Sample and combine reverted + survived pools into a labeled snapshot.

    Applies random sampling if pools exceed targets. Combines into a single
    list with ground_truth labels preserved.

    Args:
        reverted: List of reverted edit dicts.
        survived: List of survived edit dicts.
        target_reverted: Target number of reverted edits.
        target_survived: Target number of survived edits.
        seed: Random seed for reproducible sampling.

    Returns:
        Combined list of sampled edit dicts.
    """
    rng = random.Random(seed)

    if len(reverted) > target_reverted:
        reverted = rng.sample(reverted, target_reverted)
    if len(survived) > target_survived:
        survived = rng.sample(survived, target_survived)

    return reverted + survived


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
    parser.add_argument(
        "--max-qid", type=int, default=None,
        help="Exclude items with Q-id above this number (e.g., 130000000)",
    )
    args = parser.parse_args()

    site = get_production_site()
    source = RecentChangesSource(site, max_qid=args.max_qid)

    print(f"Fetching reverted edits (target: {args.reverted})...")
    reverted_raw = source.fetch_reverted(limit=args.reverted * 2)
    print(f"  Found {len(reverted_raw)} candidates")

    print(f"Fetching survived edits (target: {args.survived})...")
    reverted_revids = {e["revid"] for e in reverted_raw}
    survived_raw = source.fetch_survived(limit=args.survived * 2, exclude_revids=reverted_revids)
    print(f"  Found {len(survived_raw)} candidates")

    # Filter
    all_edits = reverted_raw + survived_raw
    print("Filtering self-reverts...")
    all_edits = filter_self_reverts(all_edits)
    print("Filtering edit wars...")
    all_edits = filter_edit_wars(all_edits)

    # Split back into pools after filtering
    reverted = [e for e in all_edits if e["ground_truth"]["label"] == "reverted"]
    survived = [e for e in all_edits if e["ground_truth"]["label"] == "survived"]
    print(f"After filtering: {len(reverted)} reverted, {len(survived)} survived")

    # Sample
    edits = build_labeled_snapshot(
        reverted, survived,
        target_reverted=args.reverted,
        target_survived=args.survived,
        seed=args.seed,
    )
    print(
        f"Sampled: {len([e for e in edits if e['ground_truth']['label'] == 'reverted'])} reverted, "
        f"{len([e for e in edits if e['ground_truth']['label'] == 'survived'])} survived"
    )

    if args.dry_run:
        for edit in edits:
            gt = edit["ground_truth"]
            print(f"  {edit.get('title', '?')} [{gt['label']}] ({gt.get('evidence', '?')})")
        return

    # Enrich
    if not args.no_enrich:
        print("Enriching edits...")
        label_cache = LabelCache(site)
        blocked_domains = load_blocked_domains()
        groups = group_edits(edits)
        for i, group in enumerate(groups):
            print(f"  Enriching group {i + 1}/{len(groups)} ({group[0]['title']})...")
            enrich_edit_group(group, label_cache, blocked_domains=blocked_domains)
            time.sleep(0.5)

    # Save
    filepath = save_snapshot(edits, "labeled-eval", args.output_dir)
    print(f"Saved {len(edits)} labeled edits to {filepath}")


if __name__ == "__main__":
    main()
