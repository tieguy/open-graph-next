"""Integration tests for the edit enrichment pipeline."""

import pytest
from unittest.mock import patch

from fetch_patrol_edits import enrich_edit, find_removed_claims, LabelCache


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

        # Entity fetched at correct revision
        mock_fetch.assert_called_once_with("Q136291923", 2464102037)

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
