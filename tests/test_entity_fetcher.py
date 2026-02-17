"""Tests for revision-specific entity fetching via Special:EntityData."""

import pytest
from unittest.mock import MagicMock, patch

from fetch_patrol_edits import fetch_entity_at_revision


class TestFetchEntityAtRevision:
    @patch("fetch_patrol_edits.requests.get")
    def test_fetches_entity_at_specific_revision(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "entities": {
                "Q42": {
                    "labels": {
                        "en": {"language": "en", "value": "Douglas Adams"}
                    },
                    "descriptions": {
                        "en": {"language": "en", "value": "English author"}
                    },
                    "claims": {},
                }
            }
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = fetch_entity_at_revision("Q42", 12345)

        assert result["labels"]["en"]["value"] == "Douglas Adams"
        assert result["descriptions"]["en"]["value"] == "English author"
        mock_get.assert_called_once_with(
            "https://www.wikidata.org/wiki/Special:EntityData/Q42.json?revision=12345",
            timeout=30,
        )

    @patch("fetch_patrol_edits.requests.get")
    def test_raises_on_http_error(self, mock_get):
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("404 Not Found")
        mock_get.return_value = mock_response

        with pytest.raises(Exception, match="404"):
            fetch_entity_at_revision("Q99999", 12345)

    @patch("fetch_patrol_edits.requests.get")
    def test_returns_claims_from_entity(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "entities": {
                "Q42": {
                    "labels": {},
                    "descriptions": {},
                    "claims": {
                        "P31": [
                            {
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
                            }
                        ]
                    },
                }
            }
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = fetch_entity_at_revision("Q42", 12345)

        assert "P31" in result["claims"]
        assert result["claims"]["P31"][0]["mainsnak"]["datavalue"]["value"]["id"] == "Q5"
