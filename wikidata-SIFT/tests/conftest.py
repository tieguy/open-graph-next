"""Shared test fixtures for patrol edit enrichment tests."""

import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_site():
    """A mock pywikibot Site with a mock data repository."""
    site = MagicMock()
    repo = MagicMock()
    site.data_repository.return_value = repo
    return site


@pytest.fixture
def sample_edit():
    """A sample edit dict matching the existing snapshot schema.

    Based on real data from logs/wikidata-patrol-experiment/snapshot/.
    """
    return {
        "rcid": 2540280597,
        "revid": 2464102037,
        "old_revid": 2464100657,
        "title": "Q136291923",
        "user": "~2026-10645-04",
        "timestamp": "2026-02-17T04:42:31Z",
        "comment": "/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]",
        "tags": ["new editor changing statement", "wikidata-ui"],
    }
