"""Tests for entity label resolution cache."""

from unittest.mock import MagicMock, patch

from fetch_patrol_edits import LabelCache


class TestLabelCache:
    def test_resolve_item_label(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "human"}
            mock_item.descriptions = {"en": "common name of Homo sapiens"}
            mock_pwb.ItemPage.return_value = mock_item

            label = cache.resolve("Q5")

        assert label == "human"
        mock_pwb.ItemPage.assert_called_once_with(
            mock_site.data_repository(), "Q5"
        )
        mock_item.get.assert_called_once()

    def test_resolve_property_label(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_prop = MagicMock()
            mock_prop.labels = {"en": "occupation"}
            mock_prop.descriptions = {"en": "occupation of a person"}
            mock_pwb.PropertyPage.return_value = mock_prop

            label = cache.resolve("P106")

        assert label == "occupation"
        mock_pwb.PropertyPage.assert_called_once_with(
            mock_site.data_repository(), "P106"
        )

    def test_cache_prevents_duplicate_fetches(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "human"}
            mock_item.descriptions = {"en": "common name of Homo sapiens"}
            mock_pwb.ItemPage.return_value = mock_item

            cache.resolve("Q5")
            cache.resolve("Q5")

        assert mock_pwb.ItemPage.call_count == 1

    def test_fallback_to_non_english_label(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"de": "Mensch"}  # German only
            mock_item.descriptions = {"de": "Bezeichnung"}
            mock_pwb.ItemPage.return_value = mock_item

            label = cache.resolve("Q5")

        assert label == "Mensch [de]"

    def test_fallback_to_entity_id_when_no_known_language(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"xz": "something"}  # unknown language
            mock_item.descriptions = {}
            mock_pwb.ItemPage.return_value = mock_item

            label = cache.resolve("Q5")

        assert label == "Q5"

    def test_fallback_to_entity_id_on_api_error(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_pwb.ItemPage.side_effect = Exception("API timeout")

            label = cache.resolve("Q99999")

        assert label == "Q99999"

    def test_prime_populates_cache(self, mock_site):
        cache = LabelCache(mock_site)
        cache.prime("Q5", "human")

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            label = cache.resolve("Q5")

        assert label == "human"
        mock_pwb.ItemPage.assert_not_called()

    def test_resolve_description(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "car collision"}
            mock_item.descriptions = {
                "en": "a traffic collision involving at least one car"
            }
            mock_pwb.ItemPage.return_value = mock_item

            desc = cache.resolve_description("Q61037771")

        assert desc == "a traffic collision involving at least one car"

    def test_resolve_description_none_when_missing(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "something"}
            mock_item.descriptions = {}  # no English description
            mock_pwb.ItemPage.return_value = mock_item

            desc = cache.resolve_description("Q12345")

        assert desc is None

    def test_resolve_description_after_prime(self, mock_site):
        cache = LabelCache(mock_site)
        cache.prime("Q5", "human", "common name of Homo sapiens")
        assert cache.resolve_description("Q5") == "common name of Homo sapiens"

    def test_prime_without_description(self, mock_site):
        cache = LabelCache(mock_site)
        cache.prime("Q5", "human")
        assert cache.resolve("Q5") == "human"
        assert cache.resolve_description("Q5") is None

    def test_resolve_description_uses_cache(self, mock_site):
        """resolve_description should not make extra API calls."""
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "human"}
            mock_item.descriptions = {"en": "common name"}
            mock_pwb.ItemPage.return_value = mock_item

            cache.resolve("Q5")
            desc = cache.resolve_description("Q5")

        assert desc == "common name"
        assert mock_pwb.ItemPage.call_count == 1
