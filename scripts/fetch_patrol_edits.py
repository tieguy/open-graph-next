#!/usr/bin/env python3
"""Fetch unpatrolled and autopatrolled statement edits from production Wikidata.

Saves raw edit metadata as YAML snapshots for reproducible analysis.

Unpatrolled edits are identified by "new editor" tags (these edits are from
non-autoconfirmed users whose edits require patrol review). Control edits are
statement edits by established users (autopatrolled by definition).

Usage:
    # Fetch 10 unpatrolled statement edits (default)
    python scripts/fetch_patrol_edits.py

    # Fetch 50 unpatrolled + 50 control edits
    python scripts/fetch_patrol_edits.py --unpatrolled 50 --control 50

    # Fetch only "changing" (not "removing") edits
    python scripts/fetch_patrol_edits.py --tag "new editor changing statement"

    # Dry run (print edits, don't save)
    python scripts/fetch_patrol_edits.py --dry-run
"""

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pywikibot
import yaml


STATEMENT_TAGS = [
    "new editor changing statement",
    "new editor removing statement",
]

STATEMENT_SUMMARY_PATTERNS = [
    "wbsetclaim",
    "wbcreateclaim",
    "wbremoveclaims",
    "wbsetclaimvalue",
    "wbsetreference",
    "wbremovereferences",
    "wbsetqualifier",
    "wbremovequalifiers",
]

SNAPSHOT_DIR = Path("logs/wikidata-patrol-experiment/snapshot")
CONTROL_DIR = Path("logs/wikidata-patrol-experiment/control")

EDIT_SUMMARY_RE = re.compile(
    r"/\*\s*(wb[a-z]+(?:-[a-z]+)?)"  # operation (e.g., wbsetclaim-update)
    r"[^*]*"                          # flags (e.g., :2||1)
    r"\*/"                            # end comment marker
    r"\s*\[\[Property:(P\d+)\]\]"     # property ID
    r"(?::\s*(.+))?"                  # optional value after colon
)

QID_IN_VALUE_RE = re.compile(r"\[\[(Q\d+)\]\]")


def get_production_site():
    """Connect to production Wikidata for read-only access."""
    return pywikibot.Site("wikidata", "wikidata")


def fetch_unpatrolled_edits(site, tag=None, total=10):
    """Fetch statement edits by new editors from production Wikidata.

    New editor edits are identified by tags like "new editor changing
    statement". These edits are from non-autoconfirmed users and require
    patrol review.

    Args:
        site: pywikibot Site object for production Wikidata.
        tag: Optional single tag to filter by. If None, queries all
            STATEMENT_TAGS.
        total: Maximum number of edits to return.

    Yields:
        dict with edit metadata for each unpatrolled edit.
    """
    tags_to_query = [tag] if tag else STATEMENT_TAGS

    count = 0
    for query_tag in tags_to_query:
        if count >= total:
            break
        for change in site.recentchanges(
            namespaces=[0],
            bot=False,
            tag=query_tag,
            total=total - count,
        ):
            yield normalize_change(change)
            count += 1
            if count >= total:
                break


def fetch_control_edits(site, total=10):
    """Fetch statement edits by established users as a control group.

    These are edits by autoconfirmed users (autopatrolled), identified by
    having statement-related edit summaries but no "new editor" tags.

    Args:
        site: pywikibot Site object for production Wikidata.
        total: Maximum number of edits to return.

    Yields:
        dict with edit metadata for each control edit.
    """
    count = 0
    for change in site.recentchanges(
        namespaces=[0],
        bot=False,
        total=total * 5,  # overfetch since we filter by edit summary
    ):
        comment = change.get("comment", "")
        tags = change.get("tags", [])

        is_statement_edit = any(p in comment for p in STATEMENT_SUMMARY_PATTERNS)
        is_new_editor = any(t in tags for t in STATEMENT_TAGS)

        if is_statement_edit and not is_new_editor:
            yield normalize_change(change)
            count += 1
            if count >= total:
                break


def normalize_change(change):
    """Normalize a recentchanges dict to a consistent snapshot format."""
    return {
        "rcid": change.get("rcid"),
        "revid": change.get("revid"),
        "old_revid": change.get("old_revid"),
        "title": change.get("title"),
        "user": change.get("user"),
        "timestamp": change.get("timestamp"),
        "comment": change.get("comment", ""),
        "tags": change.get("tags", []),
    }


def parse_edit_summary(comment):
    """Parse a Wikibase edit summary into operation, property, and value.

    Wikibase generates standardized edit summaries like:
        /* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]

    Returns:
        dict with 'operation', 'property', 'value_raw' keys, or None if
        the comment doesn't match a known Wikibase edit summary format.
    """
    match = EDIT_SUMMARY_RE.search(comment)
    if not match:
        return None

    operation = match.group(1)
    prop = match.group(2)
    raw_value = match.group(3)

    if raw_value:
        raw_value = raw_value.strip()
        qid_match = QID_IN_VALUE_RE.search(raw_value)
        if qid_match:
            raw_value = qid_match.group(1)

    return {
        "operation": operation,
        "property": prop,
        "value_raw": raw_value,
    }


class LabelCache:
    """In-memory cache for resolving Wikidata entity IDs to English labels.

    Resolves Q-ids via ItemPage and P-ids via PropertyPage. Caches results
    so repeated lookups for the same entity avoid duplicate API calls.
    """

    def __init__(self, site):
        self._repo = site.data_repository()
        self._cache = {}

    def resolve(self, entity_id):
        """Resolve an entity ID to its English label.

        Args:
            entity_id: A Q-id (e.g., "Q5") or P-id (e.g., "P106").

        Returns:
            The English label string, or the entity_id itself if no
            English label is available or the lookup fails.
        """
        if entity_id in self._cache:
            return self._cache[entity_id]

        try:
            if entity_id.startswith("P"):
                page = pywikibot.PropertyPage(self._repo, entity_id)
            else:
                page = pywikibot.ItemPage(self._repo, entity_id)
            page.get()
            label = page.labels.get("en", entity_id)
        except Exception:
            label = entity_id

        self._cache[entity_id] = label
        return label

    def prime(self, entity_id, label):
        """Pre-populate the cache with a known label."""
        self._cache[entity_id] = label


def save_snapshot(edits, label, snapshot_dir):
    """Save a list of edits as a timestamped YAML snapshot.

    Args:
        edits: List of edit dicts to save.
        label: Descriptive label (e.g., "unpatrolled", "control").
        snapshot_dir: Path to snapshot directory.

    Returns:
        Path to the saved file.
    """
    snapshot_dir = Path(snapshot_dir)
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d-%H%M%S")
    filename = f"{timestamp}-{label}.yaml"
    filepath = snapshot_dir / filename

    snapshot = {
        "fetch_date": now.isoformat(),
        "label": label,
        "count": len(edits),
        "edits": edits,
    }

    with open(filepath, "w") as f:
        yaml.safe_dump(snapshot, f, default_flow_style=False, allow_unicode=True)

    return filepath


def main():
    parser = argparse.ArgumentParser(
        description="Fetch unpatrolled and control statement edits from Wikidata."
    )
    parser.add_argument(
        "--unpatrolled", "-u",
        type=int,
        default=10,
        help="Number of unpatrolled edits to fetch (default: 10)",
    )
    parser.add_argument(
        "--control", "-c",
        type=int,
        default=0,
        help="Number of autopatrolled control edits to fetch (default: 0)",
    )
    parser.add_argument(
        "--tag", "-t",
        type=str,
        default=None,
        help="Filter by specific tag (default: all statement tags)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print edits to stdout instead of saving",
    )
    parser.add_argument(
        "--output-dir", "-o",
        type=str,
        default=str(SNAPSHOT_DIR),
        help=f"Output directory for snapshots (default: {SNAPSHOT_DIR})",
    )
    args = parser.parse_args()

    site = get_production_site()

    # Fetch unpatrolled edits
    print(f"Fetching {args.unpatrolled} unpatrolled statement edits...")
    unpatrolled = list(fetch_unpatrolled_edits(site, tag=args.tag, total=args.unpatrolled))
    print(f"  Found {len(unpatrolled)} edits")

    if args.dry_run:
        for edit in unpatrolled:
            print(f"  {edit['title']} by {edit['user']} at {edit['timestamp']}")
            print(f"    comment: {edit['comment']}")
            print(f"    tags: {edit['tags']}")
    else:
        path = save_snapshot(unpatrolled, "unpatrolled", args.output_dir)
        print(f"  Saved to {path}")

    # Fetch control group if requested
    if args.control > 0:
        print(f"Fetching {args.control} control (autopatrolled) statement edits...")
        control = list(fetch_control_edits(site, total=args.control))
        print(f"  Found {len(control)} edits")
        if len(control) < args.control:
            print(
                f"  WARNING: requested {args.control} control edits but only "
                f"{len(control)} found — overfetch pool may be too small"
            )

        if args.dry_run:
            for edit in control:
                print(f"  {edit['title']} by {edit['user']} at {edit['timestamp']}")
                print(f"    comment: {edit['comment']}")
        else:
            path = save_snapshot(control, "control", CONTROL_DIR)
            print(f"  Saved to {path}")

    print("Done.")
    sys.exit(0)


if __name__ == "__main__":
    main()
