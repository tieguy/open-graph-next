#!/usr/bin/env python3
"""Filter and combine enriched snapshots for the verdict fanout pipeline.

Removes edits matching excluded properties (e.g., P18 image edits) and
backfills from a supplementary snapshot to reach a target count.
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml


def main():
    parser = argparse.ArgumentParser(
        description="Filter properties from a snapshot and backfill to target count."
    )
    parser.add_argument(
        "primary", help="Primary snapshot YAML file"
    )
    parser.add_argument(
        "--backfill", help="Supplementary snapshot to draw extra edits from"
    )
    parser.add_argument(
        "--exclude-properties", "-x", nargs="+", default=["P18"],
        help="Property IDs to exclude (default: P18)"
    )
    parser.add_argument(
        "--target", "-n", type=int, default=500,
        help="Target edit count (default: 500)"
    )
    parser.add_argument(
        "--output", "-o", help="Output file (default: auto-generated in same dir as primary)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print stats without writing"
    )
    args = parser.parse_args()

    exclude = set(args.exclude_properties)

    # Load primary snapshot
    with open(args.primary) as f:
        primary_data = yaml.safe_load(f)
    primary_edits = primary_data["edits"]

    # Filter out excluded properties
    filtered = [
        e for e in primary_edits
        if e.get("parsed_edit", {}).get("property") not in exclude
    ]
    removed_count = len(primary_edits) - len(filtered)

    print(f"Primary: {len(primary_edits)} edits")
    print(f"Excluded ({', '.join(exclude)}): {removed_count} edits")
    print(f"After filter: {len(filtered)} edits")

    # Collect existing rcids to avoid duplicates
    existing_rcids = {e["rcid"] for e in filtered}

    # Backfill if needed
    shortfall = args.target - len(filtered)
    backfilled = 0
    if shortfall > 0 and args.backfill:
        with open(args.backfill) as f:
            backfill_data = yaml.safe_load(f)
        backfill_edits = backfill_data["edits"]

        for edit in backfill_edits:
            if backfilled >= shortfall:
                break
            prop = edit.get("parsed_edit", {}).get("property")
            rcid = edit["rcid"]
            if prop not in exclude and rcid not in existing_rcids:
                filtered.append(edit)
                existing_rcids.add(rcid)
                backfilled += 1

        print(f"Backfilled: {backfilled} edits from {args.backfill}")
    elif shortfall > 0:
        print(f"WARNING: {shortfall} edits short of target {args.target}, no backfill provided")

    print(f"Final count: {len(filtered)} edits")

    if args.dry_run:
        return

    # Write output
    if args.output:
        output_path = Path(args.output)
    else:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        output_path = Path(args.primary).parent / f"2026-02-19-{ts}-unpatrolled-filtered.yaml"

    output_data = {
        "label": f"Filtered snapshot (excluded: {', '.join(exclude)})",
        "count": len(filtered),
        "fetch_date": primary_data.get("fetch_date"),
        "filter_date": datetime.now(timezone.utc).isoformat(),
        "excluded_properties": list(exclude),
        "source_primary": str(args.primary),
        "source_backfill": str(args.backfill) if args.backfill else None,
        "edits": filtered,
    }

    with open(output_path, "w") as f:
        yaml.safe_dump(output_data, f, default_flow_style=False, allow_unicode=True)

    print(f"Written to: {output_path}")


if __name__ == "__main__":
    main()
