# Labeled Evaluation Dataset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a labeled evaluation dataset of ~500 historical Wikidata edits with ground truth labels derived from revert/patrol history.

**Architecture:** A new fetcher script queries pywikibot's RecentChanges API with dual-query strategy (mw-reverted tag + mw-rollback/mw-undo trace-back) for reverted edits, plus a survived pool. Self-revert and edit-war filtering cleans the labels. An `EditSource` protocol enables future Toolforge backends. The fetcher reuses enrichment functions from `fetch_patrol_edits.py`.

**Tech Stack:** Python 3.13, pywikibot, PyYAML, existing enrichment pipeline

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-02-19

**Testing patterns:** pytest with `pythonpath = ["scripts"]`; `unittest.mock` (MagicMock, patch); plain `assert`; `_make_*` helpers; classes grouping related tests; `tmp_path` for file I/O. See `tests/conftest.py` for shared fixtures. Run with `uv run pytest`.

---

## Phase 1: Historical Edit Fetcher

**Goal:** Create `scripts/fetch_labeled_edits.py` that fetches ~500 historical edits with ground truth labels from Wikidata's revert/patrol history.

**Key codebase facts (verified by investigation):**
- `fetch_patrol_edits.py` uses `site.recentchanges(namespaces=[0], bot=False, tag=tag, total=N)` — see lines 109-118
- `normalize_change()` at line 153 captures: rcid, revid, old_revid, title, user, timestamp, comment, tags
- `enrich_edit()` at line 663 and `enrich_edit_group()` at line 823 handle enrichment
- `group_edits()` at line 783 groups consecutive edits by (title, user)
- `save_snapshot()` at line 979 saves YAML with `{fetch_date, label, count, edits}`
- `LabelCache` at line 242, `load_blocked_domains()` at line 1011
- `get_production_site()` at line 82 returns pywikibot Site for production Wikidata
- pywikibot's `site.recentchanges()` accepts `start` (newer timestamp), `end` (older timestamp), `tag`, `patrolled`, `namespaces`, `bot`, `total` parameters

### Task 1: Script skeleton with EditSource protocol and CLI

**Files:**
- Create: `scripts/fetch_labeled_edits.py`

**Step 1: Create the script skeleton**

```python
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
```

**Step 2: Verify the script runs**

Run: `cd /var/home/louie/Projects/Volunteering-Consulting/open-graph-next/.worktrees/labeled-evaluation-dataset/wikidata-SIFT && uv run python scripts/fetch_labeled_edits.py --help`

Expected: Help text with --reverted, --survived, --dry-run, --no-enrich, --output-dir, --seed arguments.

**Step 3: Commit**

```bash
git add scripts/fetch_labeled_edits.py
git commit -m "feat: add fetch_labeled_edits.py skeleton with EditSource protocol"
```

---

### Task 2: Pool A — fetch edits tagged mw-reverted

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Create: `tests/test_labeled_edits.py`

**Step 1: Write tests for Pool A**

Create `tests/test_labeled_edits.py`:

```python
"""Tests for the labeled evaluation dataset fetcher."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call


def _make_rc_change(rcid, revid, old_revid, title, user, tags, comment="/* wbsetclaim-update:2||1 */ [[Property:P108]]: [[Q42]]", timestamp=None):
    """Build a recentchanges dict matching pywikibot's format."""
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).isoformat()
    return {
        "rcid": rcid,
        "revid": revid,
        "old_revid": old_revid,
        "title": title,
        "user": user,
        "timestamp": timestamp,
        "comment": comment,
        "tags": tags,
    }


class TestPoolA:
    """Tests for Pool A: mw-reverted tag query."""

    def test_fetches_reverted_new_editor_edits(self):
        """Pool A returns edits tagged both mw-reverted and new editor."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        change = _make_rc_change(
            rcid=100, revid=200, old_revid=199,
            title="Q42", user="NewUser1",
            tags=["mw-reverted", "new editor changing statement"],
        )
        site.recentchanges.return_value = iter([change])

        results = source._fetch_pool_a(limit=10)

        assert len(results) == 1
        assert results[0]["rcid"] == 100
        assert results[0]["ground_truth"]["label"] == "reverted"
        assert results[0]["ground_truth"]["evidence"] == "mw-reverted-tag"

    def test_filters_non_statement_edits(self):
        """Pool A skips edits without new-editor statement tags."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        # Has mw-reverted but NOT a new editor statement tag
        change = _make_rc_change(
            rcid=100, revid=200, old_revid=199,
            title="Q42", user="SomeUser",
            tags=["mw-reverted"],
        )
        site.recentchanges.return_value = iter([change])

        results = source._fetch_pool_a(limit=10)

        assert len(results) == 0

    def test_respects_limit(self):
        """Pool A stops collecting after reaching limit."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        changes = [
            _make_rc_change(
                rcid=i, revid=i + 100, old_revid=i + 99,
                title=f"Q{i}", user=f"User{i}",
                tags=["mw-reverted", "new editor changing statement"],
            )
            for i in range(5)
        ]
        site.recentchanges.return_value = iter(changes)

        results = source._fetch_pool_a(limit=2)

        assert len(results) == 2
```

**Step 2: Run tests to verify they fail**

Run: `cd /var/home/louie/Projects/Volunteering-Consulting/open-graph-next/.worktrees/labeled-evaluation-dataset/wikidata-SIFT && uv run pytest tests/test_labeled_edits.py -v`

Expected: FAIL — `_fetch_pool_a` does not exist.

**Step 3: Implement _fetch_pool_a**

In `scripts/fetch_labeled_edits.py`, replace the `fetch_reverted` stub in `RecentChangesSource` and add `_fetch_pool_a`:

```python
# Add these methods to RecentChangesSource class:

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
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py::TestPoolA -v`

Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: implement Pool A (mw-reverted tag query) with tests"
```

---

### Task 3: Pool B — trace-back from mw-rollback/mw-undo

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Modify: `tests/test_labeled_edits.py`

Pool B queries for `mw-rollback` and `mw-undo` tags (the reverting actions), then looks up the reverted revision via `old_revid` to check if it was a new-editor statement edit.

**Step 1: Write tests for Pool B**

Add to `tests/test_labeled_edits.py`:

```python
class TestPoolB:
    """Tests for Pool B: mw-rollback/mw-undo trace-back."""

    def test_traces_rollback_to_reverted_edit(self):
        """Pool B finds the reverted edit via old_revid on the rollback."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        # The rollback edit — its old_revid points to the reverted edit
        rollback = _make_rc_change(
            rcid=300, revid=301, old_revid=200,
            title="Q42", user="Patroller",
            tags=["mw-rollback"],
            comment="Reverted edits by NewUser",
        )
        site.recentchanges.return_value = iter([rollback])

        # Mock the revision lookup for old_revid=200 (the reverted edit)
        reverted_rev = {
            "revid": 200,
            "user": "NewUser",
            "comment": "/* wbsetclaim-update:2||1 */ [[Property:P31]]: [[Q5]]",
            "tags": ["new editor changing statement"],
            "parentid": 199,
            "timestamp": "2026-02-10T12:00:00Z",
        }
        site.simple_request.return_value = MagicMock(
            submit=MagicMock(return_value={
                "query": {"pages": [{"revisions": [reverted_rev]}]}
            })
        )

        results = source._fetch_pool_b(limit=10, exclude_rcids=set())

        assert len(results) == 1
        assert results[0]["revid"] == 200
        assert results[0]["user"] == "NewUser"
        assert results[0]["ground_truth"]["label"] == "reverted"
        assert results[0]["ground_truth"]["evidence"] == "reverter-traced"
        assert results[0]["ground_truth"]["reverter_user"] == "Patroller"
        assert results[0]["ground_truth"]["revert_revid"] == 301

    def test_skips_non_statement_reverted_edits(self):
        """Pool B skips reverted edits that aren't new-editor statement edits."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        rollback = _make_rc_change(
            rcid=300, revid=301, old_revid=200,
            title="Q42", user="Patroller",
            tags=["mw-rollback"],
        )
        site.recentchanges.return_value = iter([rollback])

        # Reverted edit is NOT a statement edit
        reverted_rev = {
            "revid": 200,
            "user": "SomeUser",
            "comment": "Changed label",
            "tags": [],
            "parentid": 199,
            "timestamp": "2026-02-10T12:00:00Z",
        }
        site.simple_request.return_value = MagicMock(
            submit=MagicMock(return_value={
                "query": {"pages": [{"revisions": [reverted_rev]}]}
            })
        )

        results = source._fetch_pool_b(limit=10, exclude_rcids=set())

        assert len(results) == 0

    def test_excludes_already_found_rcids(self):
        """Pool B deduplicates against Pool A results."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        rollback = _make_rc_change(
            rcid=300, revid=301, old_revid=200,
            title="Q42", user="Patroller",
            tags=["mw-rollback"],
        )
        site.recentchanges.return_value = iter([rollback])

        reverted_rev = {
            "revid": 200,
            "user": "NewUser",
            "comment": "/* wbsetclaim-update:2||1 */ [[Property:P31]]: [[Q5]]",
            "tags": ["new editor changing statement"],
            "parentid": 199,
            "timestamp": "2026-02-10T12:00:00Z",
        }
        # Simulate the revision having rcid 100 (already found in Pool A)
        # The dedup is by revid since we can't get rcid from revision lookup
        site.simple_request.return_value = MagicMock(
            submit=MagicMock(return_value={
                "query": {"pages": [{"revisions": [reverted_rev]}]}
            })
        )

        # Exclude revid 200 (already found)
        results = source._fetch_pool_b(limit=10, exclude_rcids=set(), exclude_revids={200})

        assert len(results) == 0
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_labeled_edits.py::TestPoolB -v`

Expected: FAIL — `_fetch_pool_b` does not exist.

**Step 3: Implement _fetch_pool_b**

Add to `RecentChangesSource` in `scripts/fetch_labeled_edits.py`:

```python
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
    except Exception:
        pass
    return None

def _fetch_pool_b(self, limit, exclude_rcids, exclude_revids=None):
    """Pool B: trace back from mw-rollback/mw-undo to find reverted edits.

    For each reverting action, looks up old_revid to find the edit that
    was reverted. Checks if it was a new-editor statement edit.

    Args:
        limit: Maximum number of reverted edits to collect.
        exclude_rcids: Set of rcids already found in Pool A (for dedup).
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
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py::TestPoolB -v`

Expected: 3 tests PASS.

Note: The test mocks `site.simple_request()` to return revision data. The actual `_lookup_revision` method calls `site.simple_request()` which the mock handles. The test for `exclude_revids` deduplicates by revid since rcid isn't available from the revision API.

**Step 5: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: implement Pool B (mw-rollback/mw-undo trace-back) with tests"
```

---

### Task 4: Combine Pools A+B into fetch_reverted()

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Modify: `tests/test_labeled_edits.py`

**Step 1: Write test for fetch_reverted combining pools**

Add to `tests/test_labeled_edits.py`:

```python
class TestFetchReverted:
    """Tests for combined fetch_reverted (Pool A + B with dedup)."""

    @patch.object(
        __import__("fetch_labeled_edits").RecentChangesSource, "_fetch_pool_b"
    )
    @patch.object(
        __import__("fetch_labeled_edits").RecentChangesSource, "_fetch_pool_a"
    )
    def test_combines_pools_and_deduplicates(self, mock_pool_a, mock_pool_b):
        """fetch_reverted combines Pool A and B, deduplicating by revid."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        pool_a_edit = {
            "rcid": 100, "revid": 200, "old_revid": 199,
            "title": "Q42", "user": "User1",
            "ground_truth": {"label": "reverted", "evidence": "mw-reverted-tag"},
        }
        pool_b_edit = {
            "rcid": None, "revid": 300, "old_revid": 299,
            "title": "Q99", "user": "User2",
            "ground_truth": {"label": "reverted", "evidence": "reverter-traced"},
        }
        mock_pool_a.return_value = [pool_a_edit]
        mock_pool_b.return_value = [pool_b_edit]

        results = source.fetch_reverted(limit=10)

        assert len(results) == 2
        # Pool B called with exclude_revids from Pool A
        mock_pool_b.assert_called_once()
        call_kwargs = mock_pool_b.call_args
        assert 200 in call_kwargs[1].get("exclude_revids", call_kwargs[0][1] if len(call_kwargs[0]) > 1 else set())
```

Note: This test structure may need adjustment based on how you wire `_fetch_pool_a` and `_fetch_pool_b` into `fetch_reverted`. The key assertion is that Pool B receives the revids from Pool A for dedup.

**Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_labeled_edits.py::TestFetchReverted -v`

Expected: FAIL — `fetch_reverted` still raises NotImplementedError.

**Step 3: Implement fetch_reverted**

Replace the stub `fetch_reverted` in `RecentChangesSource`:

```python
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
    pool_a_rcids = {e["rcid"] for e in pool_a if e.get("rcid")}

    remaining = limit - len(pool_a)
    pool_b = []
    if remaining > 0:
        pool_b = self._fetch_pool_b(
            limit=remaining,
            exclude_rcids=pool_a_rcids,
            exclude_revids=pool_a_revids,
        )

    return pool_a + pool_b
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py::TestFetchReverted -v`

Expected: PASS. Also run all Pool A and Pool B tests to make sure nothing broke:

Run: `uv run pytest tests/test_labeled_edits.py -v`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: combine Pool A + B into fetch_reverted with dedup"
```

---

### Task 5: Pool C — survived edits with patrol status split

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Modify: `tests/test_labeled_edits.py`

**Step 1: Write tests for fetch_survived**

Add to `tests/test_labeled_edits.py`:

```python
class TestFetchSurvived:
    """Tests for Pool C: survived edits."""

    def test_fetches_survived_edits(self):
        """fetch_survived returns edits not in the reverted pool."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        change = _make_rc_change(
            rcid=500, revid=600, old_revid=599,
            title="Q99", user="NewUser2",
            tags=["new editor changing statement"],
        )
        site.recentchanges.return_value = iter([change])

        results = source.fetch_survived(limit=10, exclude_revids=set())

        assert len(results) == 1
        assert results[0]["ground_truth"]["label"] == "survived"

    def test_excludes_reverted_edits(self):
        """fetch_survived skips edits whose revid is in the exclude set."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        change = _make_rc_change(
            rcid=500, revid=600, old_revid=599,
            title="Q99", user="NewUser2",
            tags=["new editor changing statement"],
        )
        site.recentchanges.return_value = iter([change])

        results = source.fetch_survived(limit=10, exclude_revids={600})

        assert len(results) == 0

    def test_patrolled_evidence(self):
        """Patrolled edits get evidence='patrolled'."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        change = _make_rc_change(
            rcid=500, revid=600, old_revid=599,
            title="Q99", user="NewUser2",
            tags=["new editor changing statement"],
        )
        change["patrolled"] = True
        site.recentchanges.return_value = iter([change])

        results = source.fetch_survived(limit=10, exclude_revids=set())

        assert len(results) == 1
        assert results[0]["ground_truth"]["evidence"] == "patrolled"

    def test_unpatrolled_evidence(self):
        """Unpatrolled survived edits get evidence='not-reverted-14d'."""
        from fetch_labeled_edits import RecentChangesSource

        site = MagicMock()
        source = RecentChangesSource(site)

        change = _make_rc_change(
            rcid=500, revid=600, old_revid=599,
            title="Q99", user="NewUser2",
            tags=["new editor changing statement"],
        )
        # No patrolled key or patrolled=False
        site.recentchanges.return_value = iter([change])

        results = source.fetch_survived(limit=10, exclude_revids=set())

        assert len(results) == 1
        assert results[0]["ground_truth"]["evidence"] == "not-reverted-14d"
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_labeled_edits.py::TestFetchSurvived -v`

Expected: FAIL — `fetch_survived` raises NotImplementedError or wrong signature.

**Step 3: Implement fetch_survived**

Replace the stub `fetch_survived` in `RecentChangesSource`:

```python
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
            if revid in exclude_revids:
                continue

            edit = normalize_change(change)

            is_patrolled = change.get("patrolled", False)
            edit["ground_truth"] = {
                "label": "survived",
                "evidence": "patrolled" if is_patrolled else "not-reverted-14d",
            }
            results.append(edit)

    return results
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py::TestFetchSurvived -v`

Expected: 4 tests PASS.

**Step 5: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: implement Pool C (survived edits with patrol split) with tests"
```

---

### Task 6: Self-revert and edit-war filtering

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Modify: `tests/test_labeled_edits.py`

**Step 1: Write tests for filtering**

Add to `tests/test_labeled_edits.py`:

```python
class TestSelfRevertFiltering:
    """Tests for self-revert filtering."""

    def test_removes_self_reverts(self):
        """Edits where reverter == original editor are filtered out."""
        from fetch_labeled_edits import filter_self_reverts

        edits = [
            {
                "user": "Alice",
                "ground_truth": {
                    "label": "reverted",
                    "reverter_user": "Alice",  # self-revert
                },
            },
            {
                "user": "Bob",
                "ground_truth": {
                    "label": "reverted",
                    "reverter_user": "Carol",  # not self-revert
                },
            },
        ]

        filtered = filter_self_reverts(edits)

        assert len(filtered) == 1
        assert filtered[0]["user"] == "Bob"

    def test_passes_survived_edits_through(self):
        """Survived edits have no reverter_user and pass through."""
        from fetch_labeled_edits import filter_self_reverts

        edits = [
            {
                "user": "Alice",
                "ground_truth": {"label": "survived", "evidence": "patrolled"},
            },
        ]

        filtered = filter_self_reverts(edits)

        assert len(filtered) == 1

    def test_passes_reverted_without_reverter(self):
        """Reverted edits from Pool A (no reverter_user) pass through."""
        from fetch_labeled_edits import filter_self_reverts

        edits = [
            {
                "user": "Alice",
                "ground_truth": {"label": "reverted", "evidence": "mw-reverted-tag"},
            },
        ]

        filtered = filter_self_reverts(edits)

        assert len(filtered) == 1


class TestEditWarFiltering:
    """Tests for edit-war filtering."""

    def test_removes_edit_war_edits(self):
        """Edits in revert chains (reverter was also reverted) are filtered."""
        from fetch_labeled_edits import filter_edit_wars

        edits = [
            {
                "revid": 100,
                "ground_truth": {
                    "label": "reverted",
                    "revert_revid": 200,  # revision 200 reverted this
                },
            },
            {
                "revid": 200,
                "ground_truth": {
                    "label": "reverted",
                    "revert_revid": 300,  # revision 200 was itself reverted
                },
            },
            {
                "revid": 500,
                "ground_truth": {
                    "label": "reverted",
                    "revert_revid": 600,  # not in a chain
                },
            },
        ]

        filtered = filter_edit_wars(edits)

        # Edit 100 was reverted by 200, and 200 was itself reverted -> edit war
        # Edit 200 was itself reverted -> edit war participant
        # Edit 500 is standalone revert, not part of chain
        assert len(filtered) == 1
        assert filtered[0]["revid"] == 500

    def test_passes_survived_edits_through(self):
        """Survived edits have no revert_revid and pass through."""
        from fetch_labeled_edits import filter_edit_wars

        edits = [
            {
                "revid": 100,
                "ground_truth": {"label": "survived"},
            },
        ]

        filtered = filter_edit_wars(edits)

        assert len(filtered) == 1
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_labeled_edits.py::TestSelfRevertFiltering -v && uv run pytest tests/test_labeled_edits.py::TestEditWarFiltering -v`

Expected: FAIL — functions don't exist.

**Step 3: Implement filtering functions**

Add to `scripts/fetch_labeled_edits.py` (module-level functions, not inside a class):

```python
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
    # Build set of revids that were reverted (these are the revert_revids)
    revert_revids = set()
    for edit in edits:
        gt = edit.get("ground_truth", {})
        rr = gt.get("revert_revid")
        if rr:
            revert_revids.add(rr)

    # Build set of revids whose revert_revid is itself a reverted edit
    # i.e., the reverter was also reverted -> edit war
    war_revids = set()
    for edit in edits:
        gt = edit.get("ground_truth", {})
        rr = gt.get("revert_revid")
        # If this edit's reverter (revert_revid) also appears as a revid
        # in the dataset AND that reverter was itself reverted, it's a war
        if rr and rr in {e["revid"] for e in edits if e.get("ground_truth", {}).get("label") == "reverted"}:
            war_revids.add(edit["revid"])
            war_revids.add(rr)

    return [e for e in edits if e.get("revid") not in war_revids]
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py::TestSelfRevertFiltering tests/test_labeled_edits.py::TestEditWarFiltering -v`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: implement self-revert and edit-war filtering with tests"
```

---

### Task 7: Main orchestration — sample, enrich, save with ground_truth

**Files:**
- Modify: `scripts/fetch_labeled_edits.py`
- Modify: `tests/test_labeled_edits.py`

**Step 1: Write test for build_labeled_snapshot**

Add to `tests/test_labeled_edits.py`:

```python
class TestBuildLabeledSnapshot:
    """Tests for the main orchestration function."""

    def test_samples_to_target_sizes(self):
        """build_labeled_snapshot samples to requested pool sizes."""
        from fetch_labeled_edits import build_labeled_snapshot

        reverted = [
            {"revid": i, "title": f"Q{i}", "user": f"U{i}", "comment": "",
             "tags": [], "ground_truth": {"label": "reverted"}}
            for i in range(10)
        ]
        survived = [
            {"revid": i + 100, "title": f"Q{i + 100}", "user": f"U{i}", "comment": "",
             "tags": [], "ground_truth": {"label": "survived"}}
            for i in range(10)
        ]

        result = build_labeled_snapshot(reverted, survived, target_reverted=3, target_survived=3, seed=42)

        reverted_count = sum(1 for e in result if e["ground_truth"]["label"] == "reverted")
        survived_count = sum(1 for e in result if e["ground_truth"]["label"] == "survived")
        assert reverted_count == 3
        assert survived_count == 3

    def test_deterministic_with_seed(self):
        """Same seed produces same sample."""
        from fetch_labeled_edits import build_labeled_snapshot

        edits = [
            {"revid": i, "title": f"Q{i}", "user": f"U{i}", "comment": "",
             "tags": [], "ground_truth": {"label": "reverted"}}
            for i in range(20)
        ]

        r1 = build_labeled_snapshot(edits, [], target_reverted=5, target_survived=0, seed=42)
        r2 = build_labeled_snapshot(edits, [], target_reverted=5, target_survived=0, seed=42)

        assert [e["revid"] for e in r1] == [e["revid"] for e in r2]

    def test_keeps_all_if_under_target(self):
        """If pool is smaller than target, keep all edits."""
        from fetch_labeled_edits import build_labeled_snapshot

        edits = [
            {"revid": 1, "title": "Q1", "user": "U1", "comment": "",
             "tags": [], "ground_truth": {"label": "reverted"}}
        ]

        result = build_labeled_snapshot(edits, [], target_reverted=5, target_survived=0, seed=42)

        assert len(result) == 1
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_labeled_edits.py::TestBuildLabeledSnapshot -v`

Expected: FAIL — `build_labeled_snapshot` doesn't exist.

**Step 3: Implement build_labeled_snapshot and wire up main()**

Add to `scripts/fetch_labeled_edits.py`:

```python
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
```

Then update `main()` to orchestrate the full pipeline:

```python
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

    site = get_production_site()
    source = RecentChangesSource(site)

    print(f"Fetching reverted edits (target: {args.reverted})...")
    reverted_raw = source.fetch_reverted(limit=args.reverted * 2)
    print(f"  Found {len(reverted_raw)} candidates")

    print(f"Fetching survived edits (target: {args.survived})...")
    reverted_revids = {e["revid"] for e in reverted_raw}
    survived_raw = source.fetch_survived(limit=args.survived * 2, exclude_revids=reverted_revids)
    print(f"  Found {len(survived_raw)} candidates")

    # Filter
    all_edits = reverted_raw + survived_raw
    print(f"Filtering self-reverts...")
    all_edits = filter_self_reverts(all_edits)
    print(f"Filtering edit wars...")
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
    print(f"Sampled: {len([e for e in edits if e['ground_truth']['label'] == 'reverted'])} reverted, "
          f"{len([e for e in edits if e['ground_truth']['label'] == 'survived'])} survived")

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
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_labeled_edits.py -v`

Expected: All tests PASS.

**Step 5: Run full test suite to verify no regressions**

Run: `uv run pytest`

Expected: All 220+ tests PASS.

**Step 6: Commit**

```bash
git add scripts/fetch_labeled_edits.py tests/test_labeled_edits.py
git commit -m "feat: complete labeled edit fetcher with sampling, enrichment, and CLI"
```
