"""Tests for claim serialization from raw Wikibase JSON."""

import pytest
from fetch_patrol_edits import (
    LabelCache,
    extract_snak_value,
    serialize_statement,
    serialize_claims,
)


@pytest.fixture
def label_cache(mock_site):
    """A LabelCache pre-populated with test labels."""
    cache = LabelCache(mock_site)
    cache.prime("Q5", "human")
    cache.prime("Q42", "Douglas Adams")
    cache.prime("Q36578", "AllMusic")
    cache.prime("Q117321337", "singer-songwriter")
    cache.prime("P31", "instance of")
    cache.prime("P106", "occupation")
    cache.prime("P248", "stated in")
    cache.prime("P813", "retrieved")
    cache.prime("P580", "start time")
    return cache


class TestExtractSnakValue:
    def test_wikibase_entityid(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {
                "type": "wikibase-entityid",
                "value": {"entity-type": "item", "id": "Q5", "numeric-id": 5},
            },
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "Q5"
        assert label == "human"

    def test_time(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {
                "type": "time",
                "value": {
                    "time": "+1952-03-08T00:00:00Z",
                    "precision": 11,
                    "timezone": 0,
                    "before": 0,
                    "after": 0,
                    "calendarmodel": "http://www.wikidata.org/entity/Q1985727",
                },
            },
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "+1952-03-08T00:00:00Z"
        assert label is None

    def test_quantity(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {
                "type": "quantity",
                "value": {"amount": "+185", "unit": "1"},
            },
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "+185"
        assert label is None

    def test_string(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {"type": "string", "value": "https://example.com"},
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "https://example.com"
        assert label is None

    def test_globecoordinate(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {
                "type": "globecoordinate",
                "value": {
                    "latitude": 51.5,
                    "longitude": -0.1,
                    "precision": 0.001,
                },
            },
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "51.5,-0.1"
        assert label is None

    def test_monolingualtext(self, label_cache):
        snak = {
            "snaktype": "value",
            "datavalue": {
                "type": "monolingualtext",
                "value": {"text": "example text", "language": "en"},
            },
        }
        value, label = extract_snak_value(snak, label_cache)
        assert value == "example text"
        assert label is None

    def test_somevalue(self, label_cache):
        snak = {"snaktype": "somevalue"}
        value, label = extract_snak_value(snak, label_cache)
        assert value == "somevalue"
        assert label is None

    def test_novalue(self, label_cache):
        snak = {"snaktype": "novalue"}
        value, label = extract_snak_value(snak, label_cache)
        assert value == "novalue"
        assert label is None


class TestSerializeStatement:
    def test_simple_statement(self, label_cache):
        claim = {
            "mainsnak": {
                "snaktype": "value",
                "property": "P31",
                "datavalue": {
                    "type": "wikibase-entityid",
                    "value": {"entity-type": "item", "id": "Q5", "numeric-id": 5},
                },
            },
            "rank": "normal",
            "references": [],
            "qualifiers": {},
        }
        result = serialize_statement(claim, label_cache)
        assert result["value"] == "Q5"
        assert result["value_label"] == "human"
        assert result["rank"] == "normal"
        assert result["references"] == []
        assert result["qualifiers"] == {}

    def test_statement_with_reference(self, label_cache):
        claim = {
            "mainsnak": {
                "snaktype": "value",
                "property": "P31",
                "datavalue": {
                    "type": "wikibase-entityid",
                    "value": {"entity-type": "item", "id": "Q5", "numeric-id": 5},
                },
            },
            "rank": "normal",
            "references": [
                {
                    "snaks": {
                        "P248": [
                            {
                                "snaktype": "value",
                                "datavalue": {
                                    "type": "wikibase-entityid",
                                    "value": {
                                        "entity-type": "item",
                                        "id": "Q36578",
                                        "numeric-id": 36578,
                                    },
                                },
                            }
                        ]
                    }
                }
            ],
            "qualifiers": {},
        }
        result = serialize_statement(claim, label_cache)
        assert len(result["references"]) == 1
        ref = result["references"][0]
        assert "P248" in ref
        assert ref["P248"]["property_label"] == "stated in"
        assert ref["P248"]["value"] == "Q36578"
        assert ref["P248"]["value_label"] == "AllMusic"

    def test_statement_with_qualifier(self, label_cache):
        claim = {
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
            "qualifiers": {
                "P580": [
                    {
                        "snaktype": "value",
                        "datavalue": {
                            "type": "time",
                            "value": {
                                "time": "+2020-01-01T00:00:00Z",
                                "precision": 11,
                                "timezone": 0,
                                "before": 0,
                                "after": 0,
                                "calendarmodel": "http://www.wikidata.org/entity/Q1985727",
                            },
                        },
                    }
                ]
            },
        }
        result = serialize_statement(claim, label_cache)
        assert "P580" in result["qualifiers"]
        assert result["qualifiers"]["P580"]["property_label"] == "start time"
        assert result["qualifiers"]["P580"]["value"] == "+2020-01-01T00:00:00Z"


class TestSerializeClaims:
    def test_multiple_properties(self, label_cache):
        raw_claims = {
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
                    "references": [],
                    "qualifiers": {},
                }
            ],
            "P106": [
                {
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
        }
        result = serialize_claims(raw_claims, label_cache)
        assert "P31" in result
        assert result["P31"]["property_label"] == "instance of"
        assert len(result["P31"]["statements"]) == 1
        assert result["P31"]["statements"][0]["value"] == "Q5"
        assert "P106" in result
        assert result["P106"]["property_label"] == "occupation"
        assert result["P106"]["statements"][0]["value"] == "Q117321337"

    def test_empty_claims(self, label_cache):
        result = serialize_claims({}, label_cache)
        assert result == {}
