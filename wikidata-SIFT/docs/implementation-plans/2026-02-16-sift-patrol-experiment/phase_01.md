# SIFT-Patrol Experiment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Fetch unpatrolled and autopatrolled statement edits from production Wikidata and save as reproducible YAML snapshots.

**Architecture:** Script fetches recent changes from production Wikidata using pywikibot, filtering by "new editor" tags for unpatrolled edits and by edit summary patterns for autopatrolled control edits. No patrol rights required — tags serve as proxy for patrol status. Snapshots saved as timestamped YAML files.

**Tech Stack:** Python 3.13, pywikibot, PyYAML 6.0.2

**Scope:** Phase 1 of 6 from design plan `docs/design-plans/2026-02-16-sift-patrol-experiment.md`

**Codebase verified:** 2026-02-16

---

## Task 1: Create Directory Structure

**Files:**
- Create: `logs/wikidata-patrol-experiment/.gitkeep`
- Create: `logs/wikidata-patrol-experiment/snapshot/.gitkeep`
- Create: `logs/wikidata-patrol-experiment/control/.gitkeep`

**Step 1: Create directories with .gitkeep files**

```bash
mkdir -p logs/wikidata-patrol-experiment/snapshot
mkdir -p logs/wikidata-patrol-experiment/control
touch logs/wikidata-patrol-experiment/.gitkeep
touch logs/wikidata-patrol-experiment/snapshot/.gitkeep
touch logs/wikidata-patrol-experiment/control/.gitkeep
```

**Step 2: Verify**

```bash
ls -R logs/wikidata-patrol-experiment/
```

Expected: Shows `control/`, `snapshot/`, and `.gitkeep` files.

**Step 3: Commit**

```bash
git add logs/wikidata-patrol-experiment/
git commit -m "chore: create patrol experiment log directories"
```

---

## Task 2: Write `scripts/fetch_patrol_edits.py`

**Files:**
- Create: `scripts/fetch_patrol_edits.py`

This script follows the patterns established by existing scripts in `scripts/` (argparse, pathlib, yaml.safe_dump, `#!/usr/bin/env python3`, self-contained). It connects to production Wikidata via `pywikibot.Site('wikidata', 'wikidata')` for read-only access, matching the pattern in `scripts/verify_qid.py` and `scripts/check_redundancy.py`.

**Important context:**
- The account lacks `patrol`/`patrolmarks` rights, so we cannot use `patrolled=False` as a filter (it would be silently ignored).
- Instead, we use "new editor" tags as a proxy: edits tagged `"new editor changing statement"` or `"new editor removing statement"` are from non-autoconfirmed users (inherently unpatrolled).
- For the control group, we fetch statement edits by established users identified by edit summary patterns (`wbsetclaim`, `wbcreateclaim`, etc.) that do NOT have "new editor" tags.
- pywikibot's `site.recentchanges()` accepts keyword-only args: `namespaces`, `bot`, `tag`, `total`. The `tag` parameter accepts a single string.
- Each yielded dict contains: `rcid`, `revid`, `old_revid`, `title`, `user`, `timestamp`, `comment`, `tags`.

**Step 1: Create the script**

Write the following to `scripts/fetch_patrol_edits.py`:

```python
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

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")
    filename = f"{timestamp}-{label}.yaml"
    filepath = snapshot_dir / filename

    snapshot = {
        "fetch_date": datetime.now(timezone.utc).isoformat(),
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

        if args.dry_run:
            for edit in control:
                print(f"  {edit['title']} by {edit['user']} at {edit['timestamp']}")
                print(f"    comment: {edit['comment']}")
        else:
            path = save_snapshot(control, "control", args.output_dir)
            print(f"  Saved to {path}")

    print("Done.")
    sys.exit(0)


if __name__ == "__main__":
    main()
```

**Step 2: Make executable and verify syntax**

```bash
chmod +x scripts/fetch_patrol_edits.py
python -m py_compile scripts/fetch_patrol_edits.py
```

Expected: No output (clean compile).

**Step 3: Commit**

```bash
git add scripts/fetch_patrol_edits.py
git commit -m "feat: add patrol edit fetcher script"
```

---

## Task 3: Verify Script Operationally

**Step 1: Dry-run test with small fetch**

```bash
python scripts/fetch_patrol_edits.py --unpatrolled 3 --dry-run
```

Expected: Prints 3 edits with title (Q-id), user, timestamp, comment, and tags. Each edit should have at least one of the "new editor" tags.

**Step 2: Dry-run with control group**

```bash
python scripts/fetch_patrol_edits.py --unpatrolled 3 --control 3 --dry-run
```

Expected: Prints 3 unpatrolled edits (with "new editor" tags) and 3 control edits (statement edits without "new editor" tags).

**Step 3: Full test — save snapshots**

```bash
python scripts/fetch_patrol_edits.py --unpatrolled 5 --control 5
```

Expected: Saves two YAML files to `logs/wikidata-patrol-experiment/snapshot/`. Verify:

```bash
ls logs/wikidata-patrol-experiment/snapshot/
```

Should show two files like `2026-02-16-HHMMSS-unpatrolled.yaml` and `2026-02-16-HHMMSS-control.yaml`.

**Step 4: Verify snapshot contents**

Inspect one of the files to confirm the YAML structure:

```bash
head -30 logs/wikidata-patrol-experiment/snapshot/*-unpatrolled.yaml
```

Expected: YAML with `fetch_date`, `label`, `count`, and `edits` list containing dicts with `rcid`, `revid`, `old_revid`, `title`, `user`, `timestamp`, `comment`, `tags`.

**Step 5: Verify snapshots can be reloaded**

```python
python -c "
import yaml
from pathlib import Path
files = list(Path('logs/wikidata-patrol-experiment/snapshot').glob('*.yaml'))
for f in files:
    data = yaml.safe_load(open(f))
    print(f'{f.name}: {data[\"label\"]} - {data[\"count\"]} edits')
    if data['edits']:
        print(f'  First: {data[\"edits\"][0][\"title\"]} by {data[\"edits\"][0][\"user\"]}')
"
```

Expected: Prints filename, label, count, and first edit for each snapshot file.

**Note:** Do not commit the snapshot files — they are experiment data, not source code. Add to `.gitignore` if desired.
