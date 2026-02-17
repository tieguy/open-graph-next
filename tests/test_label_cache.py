"""Tests for entity label resolution cache."""

from unittest.mock import MagicMock, patch

from fetch_patrol_edits import LabelCache


class TestLabelCache:
    def test_resolve_item_label(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"en": "human"}
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
            mock_pwb.ItemPage.return_value = mock_item

            cache.resolve("Q5")
            cache.resolve("Q5")

        assert mock_pwb.ItemPage.call_count == 1

    def test_fallback_to_entity_id_when_no_english_label(self, mock_site):
        cache = LabelCache(mock_site)

        with patch("fetch_patrol_edits.pywikibot") as mock_pwb:
            mock_item = MagicMock()
            mock_item.labels = {"de": "Mensch"}  # German only
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
