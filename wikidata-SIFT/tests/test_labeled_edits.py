"""Tests for the labeled evaluation dataset fetcher."""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch


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

        results = source._fetch_pool_b(limit=10)

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

        results = source._fetch_pool_b(limit=10)

        assert len(results) == 0

    def test_excludes_already_found_revids(self):
        """Pool B deduplicates against Pool A results by revid."""
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
        results = source._fetch_pool_b(limit=10, exclude_revids={200})

        assert len(results) == 0


class TestFetchReverted:
    """Tests for combined fetch_reverted (Pool A + B with dedup)."""

    def test_combines_pools_and_deduplicates(self):
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

        with patch.object(source, "_fetch_pool_a", return_value=[pool_a_edit]) as mock_pool_a, \
             patch.object(source, "_fetch_pool_b", return_value=[pool_b_edit]) as mock_pool_b:

            results = source.fetch_reverted(limit=10)

            assert len(results) == 2
            # Pool B called with exclude_revids from Pool A
            mock_pool_b.assert_called_once()
            call_kwargs = mock_pool_b.call_args
            # Check exclude_revids contains Pool A's revid
            exclude_revids = call_kwargs.kwargs.get("exclude_revids") or (call_kwargs.args[2] if len(call_kwargs.args) > 2 else None)
            assert exclude_revids is not None
            assert 200 in exclude_revids


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
