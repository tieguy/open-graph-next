"""Integration tests for the edit enrichment pipeline."""

import pytest
from unittest.mock import patch

from unittest.mock import call, MagicMock

from fetch_patrol_edits import (
    _refine_diff_type,
    collect_entity_ids,
    compute_edit_diff,
    enrich_edit,
    enrich_edit_group,
    extract_reference_urls,
    find_removed_claims,
    group_edits,
    is_blocked_domain,
    LabelCache,
    load_blocked_domains,
    prefetch_edit_references,
    prefetch_reference_url,
)


@pytest.fixture
def sample_entity_json():
    """Raw entity JSON as returned by Special:EntityData."""
    return {
        "labels": {"en": {"language": "en", "value": "Some Person"}},
        "descriptions": {"en": {"language": "en", "value": "American musician"}},
        "claims": {
            "P31": [
                {
                    "id": "Q136291923$1",
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P31",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {
                                "entity-type": "item",
                                "id": "Q5",
                                "numeric-id": 5,
                            },
                        },
                    },
                    "rank": "normal",
                    "references": [],
                    "qualifiers": {},
                }
            ],
            "P106": [
                {
                    "id": "Q136291923$2",
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P106",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {
                                "entity-type": "item",
                                "id": "Q117321337",
                                "numeric-id": 117321337,
                            },
                        },
                    },
                    "rank": "normal",
                    "references": [],
                    "qualifiers": {},
                }
            ],
        },
    }


class TestFindRemovedClaims:
    def test_finds_removed_claim(self):
        old_entity = {
            "claims": {
                "P21": [
                    {"id": "stmt-1", "mainsnak": {"property": "P21"}},
                    {"id": "stmt-2", "mainsnak": {"property": "P21"}},
                ]
            }
        }
        new_entity = {
            "claims": {
                "P21": [
                    {"id": "stmt-2", "mainsnak": {"property": "P21"}},
                ]
            }
        }
        removed = find_removed_claims(old_entity, new_entity, "P21")
        assert len(removed) == 1
        assert removed[0]["id"] == "stmt-1"

    def test_no_removed_claims(self):
        old_entity = {"claims": {"P21": [{"id": "stmt-1"}]}}
        new_entity = {"claims": {"P21": [{"id": "stmt-1"}]}}
        removed = find_removed_claims(old_entity, new_entity, "P21")
        assert removed == []

    def test_property_missing_from_new_entity(self):
        old_entity = {"claims": {"P21": [{"id": "stmt-1"}]}}
        new_entity = {"claims": {}}
        removed = find_removed_claims(old_entity, new_entity, "P21")
        assert len(removed) == 1

    def test_property_missing_from_both(self):
        old_entity = {"claims": {}}
        new_entity = {"claims": {}}
        removed = find_removed_claims(old_entity, new_entity, "P999")
        assert removed == []


class TestEnrichEdit:
    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_enriches_update_edit(
        self, mock_fetch, sample_edit, sample_entity_json, mock_site
    ):
        mock_fetch.return_value = sample_entity_json

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q117321337", "singer-songwriter")
        cache.prime("P31", "instance of")
        cache.prime("Q5", "human")

        result = enrich_edit(sample_edit, cache)

        # Parsed edit summary
        assert result["parsed_edit"]["operation"] == "wbsetclaim-update"
        assert result["parsed_edit"]["property"] == "P106"
        assert result["parsed_edit"]["property_label"] == "occupation"
        assert result["parsed_edit"]["value_raw"] == "Q117321337"
        assert result["parsed_edit"]["value_label"] == "singer-songwriter"

        # Item context
        assert result["item"]["label_en"] == "Some Person"
        assert result["item"]["description_en"] == "American musician"
        assert "P31" in result["item"]["claims"]
        assert "P106" in result["item"]["claims"]
        assert result["item"]["claims"]["P31"]["property_label"] == "instance of"

        # Not a removal
        assert result["removed_claim"] is None

        # Entity fetched at correct revisions (new + old)
        assert mock_fetch.call_count == 2
        mock_fetch.assert_any_call("Q136291923", 2464102037)
        mock_fetch.assert_any_call("Q136291923", 2464100657)

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_enriches_removal_edit(self, mock_fetch, mock_site):
        edit = {
            "rcid": 123,
            "revid": 200,
            "old_revid": 100,
            "title": "Q42",
            "user": "TestUser",
            "timestamp": "2026-01-01T00:00:00Z",
            "comment": "/* wbremoveclaims-remove:1| */ [[Property:P21]]: [[Q6581097]]",
            "tags": ["new editor removing statement"],
        }

        new_entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        old_entity = {
            "claims": {
                "P21": [
                    {
                        "id": "Q42$1",
                        "mainsnak": {
                            "snaktype": "value",
                            "property": "P21",
                            "datavalue": {
                                "type": "wikibase-entityid",
                                "value": {
                                    "entity-type": "item",
                                    "id": "Q6581097",
                                    "numeric-id": 6581097,
                                },
                            },
                        },
                        "rank": "normal",
                        "references": [],
                        "qualifiers": {},
                    }
                ]
            }
        }

        # First call returns new entity (at revid), second returns old (at old_revid)
        mock_fetch.side_effect = [new_entity, old_entity]

        cache = LabelCache(mock_site)
        cache.prime("P21", "sex or gender")
        cache.prime("Q6581097", "male")

        result = enrich_edit(edit, cache)

        assert result["parsed_edit"]["operation"] == "wbremoveclaims-remove"
        assert result["removed_claim"] is not None
        assert result["removed_claim"]["value"] == "Q6581097"
        assert result["removed_claim"]["value_label"] == "male"

        # Two fetches: current revision, then old revision
        assert mock_fetch.call_count == 2
        mock_fetch.assert_any_call("Q42", 200)
        mock_fetch.assert_any_call("Q42", 100)

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_handles_entity_fetch_error(
        self, mock_fetch, sample_edit, mock_site
    ):
        mock_fetch.side_effect = Exception("Network error")

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q117321337", "singer-songwriter")

        result = enrich_edit(sample_edit, cache)

        # Parsing still works even when fetch fails
        assert result["parsed_edit"] is not None
        assert result["parsed_edit"]["operation"] == "wbsetclaim-update"

        # Item has error indicator
        assert "error" in result["item"]
        assert result["removed_claim"] is None

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_handles_removal_fetch_error(self, mock_fetch, mock_site):
        """When current entity fetches fine but old revision fetch fails."""
        edit = {
            "rcid": 123,
            "revid": 200,
            "old_revid": 100,
            "title": "Q42",
            "user": "TestUser",
            "timestamp": "2026-01-01T00:00:00Z",
            "comment": "/* wbremoveclaims-remove:1| */ [[Property:P21]]: [[Q6581097]]",
            "tags": [],
        }

        new_entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }

        # First call succeeds, second fails
        mock_fetch.side_effect = [new_entity, Exception("Deleted entity")]

        cache = LabelCache(mock_site)
        cache.prime("P21", "sex or gender")
        cache.prime("Q6581097", "male")

        result = enrich_edit(edit, cache)

        # Item context was fetched fine
        assert result["item"]["label_en"] == "Test"

        # Removed claim has error indicator
        assert "error" in result["removed_claim"]

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_unparseable_comment_still_enriches_item(
        self, mock_fetch, mock_site
    ):
        edit = {
            "rcid": 123,
            "revid": 200,
            "old_revid": 100,
            "title": "Q42",
            "user": "TestUser",
            "timestamp": "2026-01-01T00:00:00Z",
            "comment": "some non-standard edit",
            "tags": [],
        }

        entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        mock_fetch.return_value = entity

        cache = LabelCache(mock_site)

        result = enrich_edit(edit, cache)

        assert result["parsed_edit"] is None
        assert result["item"]["label_en"] == "Test"
        assert result["removed_claim"] is None


def _make_claim(stmt_id, prop, qid):
    """Helper to build a minimal claim JSON for diff tests."""
    return {
        "id": stmt_id,
        "mainsnak": {
            "snaktype": "value",
            "property": prop,
            "datavalue": {
                "type": "wikibase-entityid",
                "value": {"entity-type": "item", "id": qid, "numeric-id": int(qid[1:])},
            },
        },
        "rank": "normal",
        "references": [],
        "qualifiers": {},
    }


class TestComputeEditDiff:
    def test_statement_added(self, mock_site):
        old_entity = {"claims": {}}
        new_entity = {"claims": {"P106": [_make_claim("s1", "P106", "Q42")]}}
        parsed = {"operation": "wbsetclaim-create", "property": "P106",
                  "value_raw": "Q42"}

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")

        diff = compute_edit_diff(old_entity, new_entity, parsed, cache)

        assert diff["type"] == "statement_added"
        assert diff["property"] == "P106"
        assert diff["property_label"] == "occupation"
        assert diff["old_value"] is None
        assert diff["new_value"] is not None
        assert diff["new_value"]["value"] == "Q42"

    def test_statement_removed(self, mock_site):
        old_entity = {"claims": {"P21": [_make_claim("s1", "P21", "Q6581097")]}}
        new_entity = {"claims": {}}
        parsed = {"operation": "wbremoveclaims-remove", "property": "P21",
                  "value_raw": "Q6581097"}

        cache = LabelCache(mock_site)
        cache.prime("P21", "sex or gender")
        cache.prime("Q6581097", "male")

        diff = compute_edit_diff(old_entity, new_entity, parsed, cache)

        assert diff["type"] == "statement_removed"
        assert diff["old_value"] is not None
        assert diff["old_value"]["value"] == "Q6581097"
        assert diff["new_value"] is None

    def test_value_changed(self, mock_site):
        old_entity = {"claims": {"P106": [_make_claim("s1", "P106", "Q42")]}}
        new_entity = {"claims": {"P106": [_make_claim("s1", "P106", "Q5")]}}
        parsed = {"operation": "wbsetclaim-update", "property": "P106",
                  "value_raw": "Q5"}

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")
        cache.prime("Q5", "human")

        diff = compute_edit_diff(old_entity, new_entity, parsed, cache)

        assert diff["type"] == "value_changed"
        assert diff["old_value"]["value"] == "Q42"
        assert diff["new_value"]["value"] == "Q5"

    def test_reference_added(self, mock_site):
        old_claim = _make_claim("s1", "P106", "Q42")
        new_claim = _make_claim("s1", "P106", "Q42")
        new_claim["references"] = [{"snaks": {"P854": [
            {"snaktype": "value", "datavalue": {"type": "string", "value": "http://example.com"}}
        ]}}]

        old_entity = {"claims": {"P106": [old_claim]}}
        new_entity = {"claims": {"P106": [new_claim]}}
        parsed = {"operation": "wbsetreference-add", "property": "P106",
                  "value_raw": None}

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")
        cache.prime("P854", "reference URL")

        diff = compute_edit_diff(old_entity, new_entity, parsed, cache)

        assert diff["type"] == "reference_added"
        assert diff["old_value"] is not None
        assert diff["new_value"] is not None
        # New has reference, old doesn't
        assert len(diff["new_value"]["references"]) == 1
        assert len(diff["old_value"]["references"]) == 0

    def test_no_parsed_edit_returns_none(self, mock_site):
        cache = LabelCache(mock_site)
        diff = compute_edit_diff({}, {}, None, cache)
        assert diff is None


class TestGroupEdits:
    def test_consecutive_same_item_user_grouped(self):
        edits = [
            {"title": "Q42", "user": "Alice", "revid": 1, "old_revid": 0},
            {"title": "Q42", "user": "Alice", "revid": 2, "old_revid": 1},
            {"title": "Q42", "user": "Alice", "revid": 3, "old_revid": 2},
        ]
        groups = group_edits(edits)
        assert len(groups) == 1
        assert len(groups[0]) == 3

    def test_splits_on_different_item(self):
        edits = [
            {"title": "Q42", "user": "Alice", "revid": 1, "old_revid": 0},
            {"title": "Q100", "user": "Alice", "revid": 2, "old_revid": 1},
        ]
        groups = group_edits(edits)
        assert len(groups) == 2

    def test_splits_on_different_user(self):
        edits = [
            {"title": "Q42", "user": "Alice", "revid": 1, "old_revid": 0},
            {"title": "Q42", "user": "Bob", "revid": 2, "old_revid": 1},
        ]
        groups = group_edits(edits)
        assert len(groups) == 2

    def test_non_consecutive_same_pair_stays_separate(self):
        edits = [
            {"title": "Q42", "user": "Alice", "revid": 1, "old_revid": 0},
            {"title": "Q100", "user": "Bob", "revid": 2, "old_revid": 1},
            {"title": "Q42", "user": "Alice", "revid": 3, "old_revid": 2},
        ]
        groups = group_edits(edits)
        assert len(groups) == 3

    def test_group_fields_added(self):
        edits = [
            {"title": "Q42", "user": "Alice", "revid": 1, "old_revid": 0},
            {"title": "Q42", "user": "Alice", "revid": 2, "old_revid": 1},
        ]
        groups = group_edits(edits)
        assert edits[0]["group_id"] == 0
        assert edits[0]["group_seq"] == 0
        assert edits[0]["group_size"] == 2
        assert edits[1]["group_seq"] == 1

    def test_empty_edits(self):
        assert group_edits([]) == []


class TestEnrichEditGroup:
    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    @patch("fetch_patrol_edits.time")
    def test_caches_shared_revisions(self, mock_time, mock_fetch, mock_site):
        """Two edits sharing a revision should only fetch it once."""
        entity_v0 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        entity_v1 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {"P106": [_make_claim("s1", "P106", "Q42")]},
        }
        entity_v2 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {"P106": [_make_claim("s1", "P106", "Q5")]},
        }

        # Revisions 100, 200, 300 — sorted, so fetch order is 100, 200, 300
        def fetch_side_effect(qid, revid):
            return {100: entity_v0, 200: entity_v1, 300: entity_v2}[revid]

        mock_fetch.side_effect = fetch_side_effect

        group = [
            {
                "title": "Q42", "user": "Alice",
                "revid": 200, "old_revid": 100,
                "comment": "/* wbsetclaim-create:2||1 */ [[Property:P106]]: [[Q42]]",
                "tags": [],
            },
            {
                "title": "Q42", "user": "Alice",
                "revid": 300, "old_revid": 200,
                "comment": "/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q5]]",
                "tags": [],
            },
        ]

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")
        cache.prime("Q5", "human")

        enrich_edit_group(group, cache)

        # 3 unique revisions (100, 200, 300), so 3 fetch calls
        assert mock_fetch.call_count == 3
        # Both edits share the same item context (from latest revision 300)
        assert group[0]["item"] is group[1]["item"]
        # Both have edit_diff
        assert group[0]["edit_diff"]["type"] == "statement_added"
        assert group[1]["edit_diff"]["type"] == "value_changed"

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    @patch("fetch_patrol_edits.time")
    def test_handles_partial_failure(self, mock_time, mock_fetch, mock_site):
        """When one revision fails, other edits still get enriched."""
        entity_v1 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }

        def fetch_side_effect(qid, revid):
            if revid == 100:
                raise Exception("Deleted revision")
            return entity_v1

        mock_fetch.side_effect = fetch_side_effect

        group = [
            {
                "title": "Q42", "user": "Alice",
                "revid": 200, "old_revid": 100,
                "comment": "/* wbsetclaim-create:2||1 */ [[Property:P106]]: [[Q42]]",
                "tags": [],
            },
        ]

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")

        enrich_edit_group(group, cache)

        # Item context still populated from new revision
        assert group[0]["item"]["label_en"] == "Test"
        # Diff has partial error
        assert group[0]["edit_diff"]["partial"] is True
        assert "error" in group[0]["edit_diff"]


class TestRefineDiffType:
    """Tests for _refine_diff_type which distinguishes reference/qualifier
    changes from value changes when wbsetclaim-update fires."""

    def _stmt(self, value="Q5", refs=None, quals=None, rank="normal"):
        return {
            "value": value,
            "value_label": None,
            "rank": rank,
            "references": refs or [],
            "qualifiers": quals or {},
        }

    def test_value_changed(self):
        old = self._stmt(value="Q5")
        new = self._stmt(value="Q42")
        assert _refine_diff_type(old, new) == "value_changed"

    def test_reference_added(self):
        old = self._stmt(refs=[])
        new = self._stmt(refs=[{"P248": {"value": "Q131454"}}])
        assert _refine_diff_type(old, new) == "reference_added"

    def test_reference_removed(self):
        old = self._stmt(refs=[{"P248": {"value": "Q131454"}}])
        new = self._stmt(refs=[])
        assert _refine_diff_type(old, new) == "reference_removed"

    def test_reference_changed(self):
        old = self._stmt(refs=[{"P248": {"value": "Q131454"}}])
        new = self._stmt(refs=[{"P248": {"value": "Q36578"}}])
        assert _refine_diff_type(old, new) == "reference_changed"

    def test_qualifier_added(self):
        old = self._stmt(quals={})
        new = self._stmt(quals={"P580": {"value": "2023"}})
        assert _refine_diff_type(old, new) == "qualifier_added"

    def test_qualifier_removed(self):
        old = self._stmt(quals={"P580": {"value": "2023"}})
        new = self._stmt(quals={})
        assert _refine_diff_type(old, new) == "qualifier_removed"

    def test_qualifier_changed(self):
        old = self._stmt(quals={"P580": {"value": "2023"}})
        new = self._stmt(quals={"P580": {"value": "2024"}})
        assert _refine_diff_type(old, new) == "qualifier_changed"

    def test_rank_changed(self):
        old = self._stmt(rank="normal")
        new = self._stmt(rank="preferred")
        assert _refine_diff_type(old, new) == "rank_changed"

    def test_multiple_changes_stays_value_changed(self):
        """When refs and quals both change, keep the generic type."""
        old = self._stmt(refs=[], quals={})
        new = self._stmt(
            refs=[{"P248": {"value": "Q131454"}}],
            quals={"P580": {"value": "2023"}},
        )
        assert _refine_diff_type(old, new) == "value_changed"

    def test_no_changes(self):
        """Identical statements — shouldn't happen but handle gracefully."""
        old = self._stmt()
        new = self._stmt()
        # No changes detected, multiple-change fallback
        assert _refine_diff_type(old, new) == "value_changed"

    def test_value_change_takes_priority(self):
        """If value changed along with refs, it's still value_changed."""
        old = self._stmt(value="Q5", refs=[])
        new = self._stmt(value="Q42", refs=[{"P248": {"value": "Q131454"}}])
        assert _refine_diff_type(old, new) == "value_changed"


class TestCollectEntityIds:
    def test_finds_property_ids(self):
        claims = {
            "P31": [{"mainsnak": {"snaktype": "value"}}],
            "P106": [{"mainsnak": {"snaktype": "value"}}],
        }
        ids = collect_entity_ids(claims)
        assert "P31" in ids
        assert "P106" in ids

    def test_finds_qids_in_mainsnaks(self):
        claims = {
            "P31": [
                {
                    "mainsnak": {
                        "snaktype": "value",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {"entity-type": "item", "id": "Q5"},
                        },
                    },
                }
            ],
        }
        ids = collect_entity_ids(claims)
        assert "Q5" in ids
        assert "P31" in ids

    def test_finds_ids_in_references(self):
        claims = {
            "P106": [
                {
                    "mainsnak": {"snaktype": "value"},
                    "references": [
                        {
                            "snaks": {
                                "P248": [
                                    {
                                        "snaktype": "value",
                                        "datavalue": {
                                            "type": "wikibase-entityid",
                                            "value": {"entity-type": "item", "id": "Q36578"},
                                        },
                                    }
                                ],
                                "P854": [
                                    {
                                        "snaktype": "value",
                                        "datavalue": {"type": "string", "value": "http://example.com"},
                                    }
                                ],
                            }
                        }
                    ],
                }
            ],
        }
        ids = collect_entity_ids(claims)
        assert "P248" in ids
        assert "Q36578" in ids
        assert "P854" in ids

    def test_finds_ids_in_qualifiers(self):
        claims = {
            "P106": [
                {
                    "mainsnak": {"snaktype": "value"},
                    "qualifiers": {
                        "P580": [
                            {
                                "snaktype": "value",
                                "datavalue": {"type": "time", "value": {"time": "+2020-01-01T00:00:00Z"}},
                            }
                        ],
                        "P582": [
                            {
                                "snaktype": "value",
                                "datavalue": {
                                    "type": "wikibase-entityid",
                                    "value": {"entity-type": "item", "id": "Q100"},
                                },
                            }
                        ],
                    },
                }
            ],
        }
        ids = collect_entity_ids(claims)
        assert "P580" in ids
        assert "P582" in ids
        assert "Q100" in ids

    def test_handles_numeric_id_format(self):
        claims = {
            "P31": [
                {
                    "mainsnak": {
                        "snaktype": "value",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {"entity-type": "item", "numeric-id": 5},
                        },
                    },
                }
            ],
        }
        ids = collect_entity_ids(claims)
        assert "Q5" in ids

    def test_empty_claims(self):
        assert collect_entity_ids({}) == set()


class TestResolveBatch:
    def _setup_repo_response(self, mock_site, response_data):
        """Configure mock_site's repo to return response_data from simple_request().submit()."""
        mock_req = MagicMock()
        mock_req.submit.return_value = response_data
        repo = mock_site.data_repository()
        repo.simple_request.return_value = mock_req
        return repo

    def test_primes_cache_from_api(self, mock_site):
        repo = self._setup_repo_response(mock_site, {
            "entities": {
                "Q5": {"labels": {"en": {"value": "human"}}},
                "P31": {"labels": {"en": {"value": "instance of"}}},
            }
        })

        cache = LabelCache(mock_site)
        cache.resolve_batch(["Q5", "P31"])

        assert cache.resolve("Q5") == "human"
        assert cache.resolve("P31") == "instance of"
        repo.simple_request.assert_called_once()
        call_kwargs = repo.simple_request.call_args
        assert call_kwargs.kwargs["ids"] == "Q5|P31"
        assert call_kwargs.kwargs["props"] == "labels|descriptions"

    def test_skips_already_cached(self, mock_site):
        repo = self._setup_repo_response(mock_site, {
            "entities": {
                "P31": {"labels": {"en": {"value": "instance of"}}},
            }
        })

        cache = LabelCache(mock_site)
        cache.prime("Q5", "human")
        cache.resolve_batch(["Q5", "P31"])

        # Only P31 should be requested (Q5 already cached)
        repo.simple_request.assert_called_once()
        call_kwargs = repo.simple_request.call_args
        assert "Q5" not in call_kwargs.kwargs["ids"]

    def test_all_cached_no_api_call(self, mock_site):
        repo = mock_site.data_repository()
        cache = LabelCache(mock_site)
        cache.prime("Q5", "human")
        cache.prime("P31", "instance of")

        cache.resolve_batch(["Q5", "P31"])
        repo.simple_request.assert_not_called()

    def test_handles_api_error(self, mock_site):
        repo = mock_site.data_repository()
        repo.simple_request.side_effect = Exception("API error")

        cache = LabelCache(mock_site)
        cache.resolve_batch(["Q5", "P31"])

        # Falls back to entity ID as its own label
        assert cache.resolve("Q5") == "Q5"
        assert cache.resolve("P31") == "P31"

    def test_empty_input(self, mock_site):
        repo = mock_site.data_repository()
        cache = LabelCache(mock_site)

        cache.resolve_batch([])
        repo.simple_request.assert_not_called()

    def test_fallback_to_non_english_label(self, mock_site):
        repo = self._setup_repo_response(mock_site, {
            "entities": {
                "Q1283344": {
                    "labels": {"de": {"value": "Edelreis"}},
                    "descriptions": {},
                },
                "Q5": {
                    "labels": {"en": {"value": "human"}},
                    "descriptions": {"en": {"value": "common name"}},
                },
            }
        })

        cache = LabelCache(mock_site)
        cache.resolve_batch(["Q1283344", "Q5"])

        assert cache.resolve("Q1283344") == "Edelreis [de]"
        assert cache.resolve("Q5") == "human"

    def test_fallback_to_entity_id_when_no_labels(self, mock_site):
        repo = self._setup_repo_response(mock_site, {
            "entities": {
                "Q999": {"labels": {}, "descriptions": {}},
            }
        })

        cache = LabelCache(mock_site)
        cache.resolve_batch(["Q999"])

        assert cache.resolve("Q999") == "Q999"


class TestEnrichmentUsesBatch:
    def _setup_repo_response(self, mock_site, response_data):
        """Configure mock_site's repo to return response_data from simple_request().submit()."""
        mock_req = MagicMock()
        mock_req.submit.return_value = response_data
        repo = mock_site.data_repository()
        repo.simple_request.return_value = mock_req
        return repo

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_enrich_edit_pre_resolves_labels(
        self, mock_fetch, sample_edit, sample_entity_json, mock_site
    ):
        """enrich_edit should batch-resolve labels before serialization."""
        mock_fetch.return_value = sample_entity_json

        repo = self._setup_repo_response(mock_site, {
            "entities": {
                "P31": {"labels": {"en": {"value": "instance of"}}},
                "P106": {"labels": {"en": {"value": "occupation"}}},
                "Q5": {"labels": {"en": {"value": "human"}}},
                "Q117321337": {"labels": {"en": {"value": "singer-songwriter"}}},
            }
        })

        cache = LabelCache(mock_site)
        result = enrich_edit(sample_edit, cache)

        # Batch resolve was called
        repo.simple_request.assert_called()

        # Labels were resolved correctly
        assert result["parsed_edit"]["property_label"] == "occupation"
        assert result["parsed_edit"]["value_label"] == "singer-songwriter"
        assert result["item"]["claims"]["P31"]["property_label"] == "instance of"

    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    def test_enrich_edit_primes_entity_label(
        self, mock_fetch, sample_edit, sample_entity_json, mock_site
    ):
        """enrich_edit should prime cache with the entity's own label."""
        mock_fetch.return_value = sample_entity_json

        self._setup_repo_response(mock_site, {
            "entities": {
                "P31": {"labels": {"en": {"value": "instance of"}}},
                "P106": {"labels": {"en": {"value": "occupation"}}},
                "Q5": {"labels": {"en": {"value": "human"}}},
                "Q117321337": {"labels": {"en": {"value": "singer-songwriter"}}},
            }
        })

        cache = LabelCache(mock_site)
        enrich_edit(sample_edit, cache)

        # Entity's own QID should be primed with its label
        assert cache.resolve("Q136291923") == "Some Person"


def _make_ref_block(url):
    """Helper to build a reference block with a P854 URL."""
    return {
        "P854": {
            "property_label": "reference URL",
            "value": url,
            "value_label": None,
        }
    }


class TestExtractReferenceUrls:
    def test_extracts_p854_from_new_value(self):
        edit_diff = {
            "type": "statement_added",
            "new_value": {
                "references": [_make_ref_block("https://example.com/source")],
            },
            "old_value": None,
        }
        urls = extract_reference_urls(edit_diff)
        assert urls == {"https://example.com/source"}

    def test_extracts_p854_from_old_value(self):
        edit_diff = {
            "type": "statement_removed",
            "old_value": {
                "references": [_make_ref_block("https://example.com/old")],
            },
            "new_value": None,
        }
        urls = extract_reference_urls(edit_diff)
        assert urls == {"https://example.com/old"}

    def test_extracts_from_both_values(self):
        edit_diff = {
            "type": "reference_changed",
            "old_value": {
                "references": [_make_ref_block("https://example.com/old")],
            },
            "new_value": {
                "references": [_make_ref_block("https://example.com/new")],
            },
        }
        urls = extract_reference_urls(edit_diff)
        assert urls == {"https://example.com/old", "https://example.com/new"}

    def test_no_references(self):
        edit_diff = {
            "type": "statement_added",
            "new_value": {"references": []},
            "old_value": None,
        }
        urls = extract_reference_urls(edit_diff)
        assert urls == set()

    def test_non_p854_refs_ignored(self):
        edit_diff = {
            "type": "statement_added",
            "new_value": {
                "references": [{
                    "P248": {
                        "property_label": "stated in",
                        "value": "Q36578",
                        "value_label": "GND",
                    }
                }],
            },
            "old_value": None,
        }
        urls = extract_reference_urls(edit_diff)
        assert urls == set()

    def test_error_edit_diff(self):
        edit_diff = {"error": "Deleted revision"}
        urls = extract_reference_urls(edit_diff)
        assert urls == set()

    def test_none_edit_diff(self):
        urls = extract_reference_urls(None)
        assert urls == set()


class TestIsBlockedDomain:
    def test_exact_match(self):
        blocked = {"wikipedia.org", "imdb.com"}
        assert is_blocked_domain("https://wikipedia.org/wiki/Test", blocked)

    def test_subdomain_match(self):
        blocked = {"wikipedia.org"}
        assert is_blocked_domain("https://en.wikipedia.org/wiki/Test", blocked)

    def test_no_match(self):
        blocked = {"wikipedia.org", "imdb.com"}
        assert not is_blocked_domain("https://example.com/page", blocked)

    def test_empty_blocked_set(self):
        assert not is_blocked_domain("https://wikipedia.org/wiki/Test", set())

    def test_invalid_url(self):
        blocked = {"wikipedia.org"}
        assert not is_blocked_domain("not-a-url", blocked)

    def test_partial_domain_no_match(self):
        """fakewikipedia.org should NOT match wikipedia.org."""
        blocked = {"wikipedia.org"}
        assert not is_blocked_domain("https://fakewikipedia.org/page", blocked)


class TestPrefetchReferenceUrl:
    @patch("fetch_patrol_edits.pwb_http")
    @patch("fetch_patrol_edits.trafilatura")
    def test_success(self, mock_traf, mock_http):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<html><body>Article text here</body></html>"
        mock_http.fetch.return_value = mock_resp
        mock_traf.extract.return_value = "Article text here"

        result = prefetch_reference_url("https://example.com/article")

        assert result["status"] == 200
        assert result["extracted_text"] == "Article text here"
        assert result["error"] is None
        assert result["url"] == "https://example.com/article"

    @patch("fetch_patrol_edits.pwb_http")
    @patch("fetch_patrol_edits.trafilatura")
    def test_403_error(self, mock_traf, mock_http):
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_http.fetch.return_value = mock_resp

        result = prefetch_reference_url("https://blocked.com/page")

        assert result["status"] == 403
        assert result["extracted_text"] is None
        assert result["error"] == "HTTP 403"

    @patch("fetch_patrol_edits.pwb_http")
    @patch("fetch_patrol_edits.trafilatura")
    def test_timeout(self, mock_traf, mock_http):
        mock_http.fetch.side_effect = Exception("Connection timed out")

        result = prefetch_reference_url("https://slow.com/page")

        assert result["status"] is None
        assert result["extracted_text"] is None
        assert "timed out" in result["error"]

    @patch("fetch_patrol_edits.pwb_http")
    @patch("fetch_patrol_edits.trafilatura")
    def test_empty_extraction(self, mock_traf, mock_http):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<html><body></body></html>"
        mock_http.fetch.return_value = mock_resp
        mock_traf.extract.return_value = None

        result = prefetch_reference_url("https://example.com/empty")

        assert result["status"] == 200
        assert result["extracted_text"] is None
        assert result["error"] == "extraction_empty"

    @patch("fetch_patrol_edits.pwb_http")
    @patch("fetch_patrol_edits.trafilatura")
    def test_long_text_preserved(self, mock_traf, mock_http):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<html><body>Long text</body></html>"
        mock_http.fetch.return_value = mock_resp
        mock_traf.extract.return_value = "x" * 10000

        result = prefetch_reference_url("https://example.com/long")

        assert len(result["extracted_text"]) == 10000
        assert result["error"] is None


class TestPrefetchEditReferences:
    @patch("fetch_patrol_edits.prefetch_reference_url")
    def test_blocked_domain_skipped(self, mock_prefetch):
        edit = {
            "edit_diff": {
                "type": "statement_added",
                "new_value": {
                    "references": [_make_ref_block("https://en.wikipedia.org/wiki/Test")],
                },
                "old_value": None,
            }
        }
        blocked = {"wikipedia.org"}
        results = prefetch_edit_references(edit, blocked)

        assert "https://en.wikipedia.org/wiki/Test" in results
        assert results["https://en.wikipedia.org/wiki/Test"]["error"] == "blocked_domain"
        mock_prefetch.assert_not_called()

    @patch("fetch_patrol_edits.prefetch_reference_url")
    @patch("fetch_patrol_edits.time")
    def test_mixed_urls(self, mock_time, mock_prefetch):
        mock_prefetch.return_value = {
            "url": "https://example.com/source",
            "status": 200,
            "extracted_text": "Some text",
            "error": None,
            "fetch_date": "2026-02-19T00:00:00+00:00",
        }
        edit = {
            "edit_diff": {
                "type": "reference_changed",
                "new_value": {
                    "references": [_make_ref_block("https://example.com/source")],
                },
                "old_value": {
                    "references": [_make_ref_block("https://en.wikipedia.org/wiki/Old")],
                },
            }
        }
        blocked = {"wikipedia.org"}
        results = prefetch_edit_references(edit, blocked)

        assert results["https://en.wikipedia.org/wiki/Old"]["error"] == "blocked_domain"
        assert results["https://example.com/source"]["status"] == 200
        mock_prefetch.assert_called_once_with("https://example.com/source")

    def test_no_edit_diff(self):
        edit = {"edit_diff": None}
        results = prefetch_edit_references(edit, set())
        assert results == {}

    def test_error_edit_diff(self):
        edit = {"edit_diff": {"error": "fetch failed"}}
        results = prefetch_edit_references(edit, set())
        assert results == {}


class TestLoadBlockedDomains:
    def test_loads_valid_file(self, tmp_path):
        config = tmp_path / "blocked.yaml"
        config.write_text(
            "domains:\n"
            "  - domain: wikipedia.org\n"
            "    reason: circular\n"
            "  - domain: imdb.com\n"
            "    reason: blocked\n"
        )
        domains = load_blocked_domains(config)
        assert domains == {"wikipedia.org", "imdb.com"}

    def test_missing_file(self, tmp_path):
        domains = load_blocked_domains(tmp_path / "nonexistent.yaml")
        assert domains == set()

    def test_empty_domains(self, tmp_path):
        config = tmp_path / "blocked.yaml"
        config.write_text("domains: []\n")
        domains = load_blocked_domains(config)
        assert domains == set()

    def test_default_config_path(self):
        """Default path should resolve to config/blocked_domains.yaml."""
        domains = load_blocked_domains()
        # Should load without error; actual content depends on the config file
        assert isinstance(domains, set)
        assert "wikipedia.org" in domains


class TestEnrichEditGroupPrefetch:
    @patch("fetch_patrol_edits.prefetch_reference_url")
    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    @patch("fetch_patrol_edits.time")
    def test_prefetch_adds_references(
        self, mock_time, mock_fetch, mock_prefetch, mock_site
    ):
        old_entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        new_entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {
                "P106": [{
                    "id": "s1",
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P106",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {"entity-type": "item", "id": "Q42", "numeric-id": 42},
                        },
                    },
                    "rank": "normal",
                    "references": [{
                        "snaks": {
                            "P854": [{
                                "snaktype": "value",
                                "datavalue": {"type": "string", "value": "https://example.com/ref"},
                            }]
                        }
                    }],
                    "qualifiers": {},
                }],
            },
        }

        def fetch_side_effect(qid, revid):
            return {100: old_entity, 200: new_entity}[revid]

        mock_fetch.side_effect = fetch_side_effect
        mock_prefetch.return_value = {
            "url": "https://example.com/ref",
            "status": 200,
            "extracted_text": "Relevant text",
            "error": None,
            "fetch_date": "2026-02-19T00:00:00+00:00",
        }

        group = [{
            "title": "Q42", "user": "Alice",
            "revid": 200, "old_revid": 100,
            "comment": "/* wbsetclaim-create:2||1 */ [[Property:P106]]: [[Q42]]",
            "tags": [],
        }]

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")
        cache.prime("P854", "reference URL")

        enrich_edit_group(group, cache, prefetch=True, blocked_domains=set())

        assert "prefetched_references" in group[0]
        refs = group[0]["prefetched_references"]
        assert "https://example.com/ref" in refs
        assert refs["https://example.com/ref"]["extracted_text"] == "Relevant text"

    @patch("fetch_patrol_edits.prefetch_reference_url")
    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    @patch("fetch_patrol_edits.time")
    def test_prefetch_false_skips(
        self, mock_time, mock_fetch, mock_prefetch, mock_site
    ):
        entity = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        mock_fetch.return_value = entity

        group = [{
            "title": "Q42", "user": "Alice",
            "revid": 200, "old_revid": 100,
            "comment": "/* wbsetclaim-create:2||1 */ [[Property:P106]]: [[Q42]]",
            "tags": [],
        }]

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")

        enrich_edit_group(group, cache, prefetch=False)

        assert "prefetched_references" not in group[0]
        mock_prefetch.assert_not_called()

    @patch("fetch_patrol_edits.prefetch_reference_url")
    @patch("fetch_patrol_edits.fetch_entity_at_revision")
    @patch("fetch_patrol_edits.time")
    def test_deduplication_across_group(
        self, mock_time, mock_fetch, mock_prefetch, mock_site
    ):
        """Same URL in two edits should only be fetched once."""
        ref_claim = {
            "id": "s1",
            "mainsnak": {
                "snaktype": "value",
                "property": "P106",
                "datavalue": {
                    "type": "wikibase-entityid",
                    "value": {"entity-type": "item", "id": "Q42", "numeric-id": 42},
                },
            },
            "rank": "normal",
            "references": [{
                "snaks": {
                    "P854": [{
                        "snaktype": "value",
                        "datavalue": {"type": "string", "value": "https://example.com/shared"},
                    }]
                }
            }],
            "qualifiers": {},
        }

        entity_v0 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {},
        }
        entity_v1 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {"P106": [ref_claim]},
        }
        entity_v2 = {
            "labels": {"en": {"language": "en", "value": "Test"}},
            "descriptions": {},
            "claims": {"P106": [{
                **ref_claim,
                "mainsnak": {
                    "snaktype": "value",
                    "property": "P106",
                    "datavalue": {
                        "type": "wikibase-entityid",
                        "value": {"entity-type": "item", "id": "Q5", "numeric-id": 5},
                    },
                },
            }]},
        }

        def fetch_side_effect(qid, revid):
            return {100: entity_v0, 200: entity_v1, 300: entity_v2}[revid]

        mock_fetch.side_effect = fetch_side_effect
        mock_prefetch.return_value = {
            "url": "https://example.com/shared",
            "status": 200,
            "extracted_text": "Shared text",
            "error": None,
            "fetch_date": "2026-02-19T00:00:00+00:00",
        }

        group = [
            {
                "title": "Q42", "user": "Alice",
                "revid": 200, "old_revid": 100,
                "comment": "/* wbsetclaim-create:2||1 */ [[Property:P106]]: [[Q42]]",
                "tags": [],
            },
            {
                "title": "Q42", "user": "Alice",
                "revid": 300, "old_revid": 200,
                "comment": "/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q42]]",
                "tags": [],
            },
        ]

        cache = LabelCache(mock_site)
        cache.prime("P106", "occupation")
        cache.prime("Q42", "Douglas Adams")
        cache.prime("Q5", "human")
        cache.prime("P854", "reference URL")

        enrich_edit_group(group, cache, prefetch=True, blocked_domains=set())

        # prefetch_reference_url should only be called once for the shared URL
        assert mock_prefetch.call_count == 1

        # Both edits should have the prefetched reference
        assert "prefetched_references" in group[0]
        assert "prefetched_references" in group[1]
        assert group[0]["prefetched_references"]["https://example.com/shared"]["status"] == 200
