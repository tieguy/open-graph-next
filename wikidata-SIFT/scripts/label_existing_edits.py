#!/usr/bin/env python3
"""Retroactively label existing fanout edits by checking revision status.

For each edit in the snapshot, queries the Wikidata API to determine if
the revision was subsequently reverted (mw-reverted tag) or has survived.

Usage:
    uv run python scripts/label_existing_edits.py --dry-run
    uv run python scripts/label_existing_edits.py
"""

import argparse
import logging
import time
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger(__name__)

SNAPSHOT_PATH = Path("logs/wikidata-patrol-experiment/snapshot/2026-02-20-filtered-no-p18.yaml")
OUTPUT_DIR = Path("logs/wikidata-patrol-experiment/labeled")
API_URL = "https://www.wikidata.org/w/api.php"
BATCH_SIZE = 50  # MediaWiki API allows up to 50 revids per query


def check_revisions_batch(revids: list[int], client: httpx.Client) -> dict[int, dict]:
    """Query revision info for a batch of revids.

    Returns dict mapping revid -> {tags: [...], ...} for each found revision.
    """
    params = {
        "action": "query",
        "prop": "revisions",
        "revids": "|".join(str(r) for r in revids),
        "rvprop": "ids|tags|timestamp",
        "format": "json",
        "formatversion": "2",
    }
    resp = client.get(API_URL, params=params)
    resp.raise_for_status()
    data = resp.json()

    results = {}
    # Collect from pages
    for page in data.get("query", {}).get("pages", []):
        for rev in page.get("revisions", []):
            results[rev["revid"]] = {
                "tags": rev.get("tags", []),
                "timestamp": rev.get("timestamp", ""),
                "pageid": page.get("pageid"),
                "title": page.get("title"),
            }

    # Check badrevids
    for revid_str, info in data.get("query", {}).get("badrevids", {}).items():
        results[int(revid_str)] = {"tags": [], "deleted": True}

    return results


def label_edit(rev_info: dict | None) -> dict:
    """Determine ground truth label from revision info."""
    if rev_info is None:
        return {"label": "unknown", "evidence": "revid-not-found"}

    if rev_info.get("deleted"):
        return {"label": "reverted", "evidence": "revision-deleted"}

    tags = rev_info.get("tags", [])
    if "mw-reverted" in tags:
        return {"label": "reverted", "evidence": "mw-reverted-tag"}

    return {"label": "survived", "evidence": "not-reverted-as-of-check"}


def main():
    parser = argparse.ArgumentParser(description="Label existing fanout edits")
    parser.add_argument("--dry-run", action="store_true", help="Show counts without saving")
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT_PATH)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    logger.info("Loading snapshot: %s", args.snapshot)
    snap = yaml.safe_load(open(args.snapshot))
    edits = snap["edits"]
    logger.info("Loaded %d edits", len(edits))

    # Collect all unique revids
    revids = [e["revid"] for e in edits]
    logger.info("Unique revids: %d", len(set(revids)))

    # Query in batches
    rev_info = {}
    client = httpx.Client(
        headers={"User-Agent": "wikidata-SIFT/1.0 (research; mailto:luis@lu.is)"},
        timeout=30,
    )

    batches = [revids[i : i + BATCH_SIZE] for i in range(0, len(revids), BATCH_SIZE)]
    for i, batch in enumerate(batches):
        logger.info("Querying batch %d/%d (%d revids)", i + 1, len(batches), len(batch))
        batch_results = check_revisions_batch(batch, client)
        rev_info.update(batch_results)
        if i < len(batches) - 1:
            time.sleep(0.5)  # be polite

    client.close()

    # Label each edit
    labels = {}
    for revid in revids:
        labels[revid] = label_edit(rev_info.get(revid))

    # Stats
    from collections import Counter
    label_counts = Counter(l["label"] for l in labels.values())
    evidence_counts = Counter(l["evidence"] for l in labels.values())
    logger.info("Label distribution: %s", dict(label_counts))
    logger.info("Evidence distribution: %s", dict(evidence_counts))

    if args.dry_run:
        logger.info("Dry run — not saving")
        return

    # Write labeled snapshot (same format as fetch_labeled_edits output)
    labeled_edits = []
    for edit in edits:
        labeled_edit = dict(edit)
        labeled_edit["ground_truth"] = labels[edit["revid"]]
        labeled_edits.append(labeled_edit)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "2026-02-20-retroactive-labels.yaml"
    output = {
        "count": len(labeled_edits),
        "source_snapshot": str(args.snapshot),
        "label_method": "retroactive-revid-check",
        "label_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "edits": labeled_edits,
    }
    with open(output_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, allow_unicode=True, width=120)
    logger.info("Saved labeled snapshot: %s", output_path)


if __name__ == "__main__":
    main()
