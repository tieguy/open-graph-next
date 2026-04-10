"""Tests for tool_executor.py — web_search and web_fetch functions."""

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from tool_executor import (
    is_blocked_domain,
    load_blocked_domains,
    web_fetch,
    web_search,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _skip_rate_limit(monkeypatch):
    monkeypatch.setattr("tool_executor._rate_limit", lambda: None)
    monkeypatch.setattr("tool_executor._search_rate_limit", lambda: None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_brave_response(results):
    """Return a mock httpx.Response with Brave Search API-format JSON."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"web": {"results": results}}
    mock_resp.raise_for_status.return_value = None
    return mock_resp


def _make_http_response(status_code, text=""):
    """Return a mock httpx.Response with given status code and text."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.text = text
    mock_resp.raise_for_status.return_value = None
    return mock_resp


def _make_brave_result(title="Result Title", url="https://example.com/page", description="Some snippet"):
    """Return a Brave Search API result dict."""
    return {"title": title, "url": url, "description": description}


# ---------------------------------------------------------------------------
# TestLoadBlockedDomains
# ---------------------------------------------------------------------------


class TestLoadBlockedDomains:
    def test_load_from_yaml_file(self, tmp_path):
        config = tmp_path / "blocked_domains.yaml"
        config.write_text(
            "domains:\n"
            "  - domain: wikipedia.org\n"
            "    reason: circular\n"
            "  - domain: imdb.com\n"
            "    reason: blocked\n"
        )
        result = load_blocked_domains(config_path=str(config))
        assert result == {"wikipedia.org", "imdb.com"}

    def test_missing_file_returns_empty_set(self, tmp_path):
        result = load_blocked_domains(config_path=str(tmp_path / "nonexistent.yaml"))
        assert result == set()

    def test_empty_domains_key_returns_empty_set(self, tmp_path):
        config = tmp_path / "blocked_domains.yaml"
        config.write_text("domains: []\n")
        result = load_blocked_domains(config_path=str(config))
        assert result == set()

    def test_missing_domains_key_returns_empty_set(self, tmp_path):
        config = tmp_path / "blocked_domains.yaml"
        config.write_text("other_key: value\n")
        result = load_blocked_domains(config_path=str(config))
        assert result == set()


# ---------------------------------------------------------------------------
# TestIsBlockedDomain
# ---------------------------------------------------------------------------


class TestIsBlockedDomain:
    def test_exact_domain_match(self):
        assert is_blocked_domain("https://wikipedia.org/wiki/Test", {"wikipedia.org"})

    def test_subdomain_match(self):
        assert is_blocked_domain("https://en.wikipedia.org/wiki/Test", {"wikipedia.org"})

    def test_no_match(self):
        assert not is_blocked_domain("https://example.com/page", {"wikipedia.org", "imdb.com"})

    def test_empty_blocked_set(self):
        assert not is_blocked_domain("https://wikipedia.org/wiki/Test", set())

    def test_partial_domain_does_not_match(self):
        # "mywikipedia.org" should NOT match "wikipedia.org"
        assert not is_blocked_domain("https://mywikipedia.org/", {"wikipedia.org"})


# ---------------------------------------------------------------------------
# TestWebSearch
# ---------------------------------------------------------------------------


class TestWebSearch:
    def test_returns_results_with_correct_keys(self):
        """web_search returns titles, URLs, and snippets from Brave Search API."""
        mock_resp = _make_brave_response([
            _make_brave_result(
                title="Test Article",
                url="https://example.com/article",
                description="This is a snippet about the topic.",
            )
        ])

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test query", api_key="test-key")

        assert len(results) == 1
        assert results[0]["title"] == "Test Article"
        assert results[0]["url"] == "https://example.com/article"
        assert results[0]["snippet"] == "This is a snippet about the topic."

    def test_missing_api_key_returns_error(self):
        """web_search returns error when no API key is available."""
        with patch.dict("os.environ", {}, clear=True):
            results = web_search("test query", api_key="")

        assert len(results) == 1
        assert "error" in results[0]
        assert "BRAVE_API_KEY" in results[0]["error"]

    def test_timeout_returns_error_dict(self):
        with patch("tool_executor.httpx.get", side_effect=httpx.TimeoutException("timed out")):
            results = web_search("test query", api_key="test-key")

        assert len(results) == 1
        assert "error" in results[0]
        assert "timed out" in results[0]["error"]

    def test_blocked_domains_filtered_from_results(self):
        """Blocked domain URLs are removed from search results."""
        mock_resp = _make_brave_response([
            _make_brave_result(url="https://wikipedia.org/wiki/Test"),
            _make_brave_result(url="https://example.com/page"),
        ])

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search(
                "test",
                blocked_domains={"wikipedia.org"},
                api_key="test-key",
            )

        urls = [r["url"] for r in results]
        assert "https://wikipedia.org/wiki/Test" not in urls
        assert "https://example.com/page" in urls

    def test_results_capped_at_ten(self):
        """Results are capped at 10 items."""
        raw_results = [
            _make_brave_result(url=f"https://example.com/{i}")
            for i in range(15)
        ]
        mock_resp = _make_brave_response(raw_results)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", api_key="test-key")

        assert len(results) == 10

    def test_invalid_json_returns_error_dict(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.side_effect = ValueError("invalid json")

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", api_key="test-key")

        assert len(results) == 1
        assert "error" in results[0]

    def test_multiple_results_returned(self):
        """Multiple results are all returned (up to 10)."""
        raw_results = [
            _make_brave_result(title=f"Result {i}", url=f"https://example.com/{i}")
            for i in range(5)
        ]
        mock_resp = _make_brave_response(raw_results)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", api_key="test-key")

        assert len(results) == 5
        assert results[0]["title"] == "Result 0"
        assert results[4]["title"] == "Result 4"

    def test_http_error_returns_error_dict(self):
        """HTTP errors from Brave API are caught and returned as error dicts."""
        with patch("tool_executor.httpx.get", side_effect=httpx.HTTPStatusError(
            "429", request=MagicMock(), response=MagicMock()
        )):
            results = web_search("test", api_key="test-key")

        assert len(results) == 1
        assert "error" in results[0]


# ---------------------------------------------------------------------------
# TestWebFetch
# ---------------------------------------------------------------------------


class TestWebFetch:
    def test_returns_extracted_text_on_success(self):
        """AC1.2: web_fetch extracts article text from a fetchable URL."""
        mock_resp = _make_http_response(200, text="<html><body><p>Article content here.</p></body></html>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value="Article content here."):
            result = web_fetch("https://example.com/article")

        assert result == "Article content here."

    def test_blocked_domain_returns_error(self):
        """AC1.3: web_fetch returns error string for blocked domain URLs."""
        with patch("tool_executor.httpx.get") as mock_get:
            result = web_fetch(
                "https://en.wikipedia.org/wiki/Test",
                blocked_domains={"wikipedia.org"},
            )
            # Should not make any HTTP request
            mock_get.assert_not_called()

        assert result == "error: blocked_domain"

    def test_http_403_returns_error(self):
        """AC1.4: web_fetch returns error string for HTTP 403 response."""
        mock_resp = _make_http_response(403)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            result = web_fetch("https://example.com/protected")

        assert result == "error: HTTP 403 Forbidden"

    def test_http_404_returns_error(self):
        """AC1.4: web_fetch returns error string for HTTP 404 response."""
        mock_resp = _make_http_response(404)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            result = web_fetch("https://example.com/missing")

        assert result == "error: HTTP 404 Not Found"

    def test_timeout_returns_error(self):
        """AC1.4: web_fetch returns error string for timeout."""
        with patch("tool_executor.httpx.get", side_effect=httpx.TimeoutException("timed out")):
            result = web_fetch("https://example.com/slow")

        assert result == "error: timeout"

    def test_extraction_empty_returns_error(self):
        """Returns error when trafilatura extracts nothing."""
        mock_resp = _make_http_response(200, text="<html><body></body></html>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=None):
            result = web_fetch("https://example.com/empty")

        assert result == "error: extraction_empty"

    def test_long_text_is_truncated(self):
        """Very long page text with no query is truncated at fallback size."""
        long_text = "x" * 20000
        mock_resp = _make_http_response(200, text="<html><body><p>" + long_text + "</p></body></html>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=long_text):
            result = web_fetch("https://example.com/long")

        assert len(result) < 20000
        assert "[Truncated" in result
        assert result.startswith("x" * 5000)

    def test_short_text_not_truncated(self):
        """Text under fallback size is returned unchanged when no query given."""
        short_text = "Short article content."
        mock_resp = _make_http_response(200, text="<html><body><p>" + short_text + "</p></body></html>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=short_text):
            result = web_fetch("https://example.com/short")

        assert result == short_text
        assert "[Truncated" not in result

    def test_other_http_status_returns_error(self):
        """Non-200/403/404 status codes return generic error."""
        mock_resp = _make_http_response(500)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            result = web_fetch("https://example.com/server-error")

        assert result.startswith("error: HTTP 500")

    def test_query_aware_extraction_returns_lead_plus_matches(self):
        """When query is provided, web_fetch returns lead + matching paragraphs."""
        # Lead is all generic filler — must exceed FETCH_LEAD_CHARS (2500)
        # so that the matching paragraph lands in rest_of_page.
        lead = "Generic introduction filler. " * 120  # ~3480 chars
        middle = "\n\nUnrelated paragraph about weather and sports.\n\n"
        matching = "Wentworth Miller was born in Chipping Norton, England, in 1972."
        more_filler = "\n\nAnother unrelated paragraph about cooking.\n\n"
        page_text = lead + middle + matching + more_filler
        mock_resp = _make_http_response(200, text="<html/>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=page_text):
            result = web_fetch("https://example.com/miller", query="Chipping Norton")

        assert "Page lead" in result
        assert "Chipping Norton" in result
        assert "match:" in result
        # Unrelated paragraphs past the lead should not appear
        assert "cooking" not in result

    def test_query_with_no_matches_notes_absence(self):
        """When query yields no matches past the lead, output notes that."""
        lead = "Introduction about a different topic. " * 40
        rest = "\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.\n\n" * 20
        page_text = lead + rest
        mock_resp = _make_http_response(200, text="<html/>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=page_text):
            result = web_fetch("https://example.com/mismatch", query="Belgium")

        assert "Page lead" in result
        assert "No query matches found" in result or "No matches found" in result

    def test_subdomain_of_blocked_domain_is_blocked(self):
        """Subdomains of blocked domains are also blocked."""
        with patch("tool_executor.httpx.get") as mock_get:
            result = web_fetch(
                "https://en.wikipedia.org/wiki/Test",
                blocked_domains={"wikipedia.org"},
            )
            mock_get.assert_not_called()

        assert result == "error: blocked_domain"
