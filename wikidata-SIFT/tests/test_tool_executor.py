"""Tests for tool_executor.py — web_search and web_fetch functions."""

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_searxng_response(results):
    """Return a mock httpx.Response with SearXNG-format JSON."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"results": results}
    mock_resp.raise_for_status.return_value = None
    return mock_resp


def _make_http_response(status_code, text=""):
    """Return a mock httpx.Response with given status code and text."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.text = text
    mock_resp.raise_for_status.return_value = None
    return mock_resp


def _make_searxng_result(title="Result Title", url="https://example.com/page", content="Some snippet"):
    """Return a SearXNG result dict."""
    return {"title": title, "url": url, "content": content}


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
        """AC1.1: web_search returns titles, URLs, and snippets from SearXNG."""
        mock_resp = _make_searxng_response([
            _make_searxng_result(
                title="Test Article",
                url="https://example.com/article",
                content="This is a snippet about the topic.",
            )
        ])

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test query", searxng_url="http://localhost:8080/search")

        assert len(results) == 1
        assert results[0]["title"] == "Test Article"
        assert results[0]["url"] == "https://example.com/article"
        assert results[0]["snippet"] == "This is a snippet about the topic."

    def test_connect_error_returns_error_dict(self):
        """AC1.5: web_search returns error note when SearXNG is unreachable."""
        with patch("tool_executor.httpx.get", side_effect=httpx.ConnectError("refused")):
            results = web_search("test query", searxng_url="http://localhost:8080/search")

        assert len(results) == 1
        assert "error" in results[0]
        assert "unreachable" in results[0]["error"]

    def test_timeout_returns_error_dict(self):
        with patch("tool_executor.httpx.get", side_effect=httpx.TimeoutException("timed out")):
            results = web_search("test query", searxng_url="http://localhost:8080/search")

        assert len(results) == 1
        assert "error" in results[0]
        assert "timed out" in results[0]["error"]

    def test_blocked_domains_filtered_from_results(self):
        """Blocked domain URLs are removed from search results."""
        mock_resp = _make_searxng_response([
            _make_searxng_result(url="https://wikipedia.org/wiki/Test"),
            _make_searxng_result(url="https://example.com/page"),
        ])

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search(
                "test",
                blocked_domains={"wikipedia.org"},
                searxng_url="http://localhost:8080/search",
            )

        urls = [r["url"] for r in results]
        assert "https://wikipedia.org/wiki/Test" not in urls
        assert "https://example.com/page" in urls

    def test_results_capped_at_ten(self):
        """Results are capped at 10 items."""
        raw_results = [
            _make_searxng_result(url=f"https://example.com/{i}")
            for i in range(15)
        ]
        mock_resp = _make_searxng_response(raw_results)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", searxng_url="http://localhost:8080/search")

        assert len(results) == 10

    def test_invalid_json_returns_error_dict(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.side_effect = ValueError("invalid json")

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", searxng_url="http://localhost:8080/search")

        assert len(results) == 1
        assert "error" in results[0]

    def test_multiple_results_returned(self):
        """Multiple results are all returned (up to 10)."""
        raw_results = [
            _make_searxng_result(title=f"Result {i}", url=f"https://example.com/{i}")
            for i in range(5)
        ]
        mock_resp = _make_searxng_response(raw_results)

        with patch("tool_executor.httpx.get", return_value=mock_resp):
            results = web_search("test", searxng_url="http://localhost:8080/search")

        assert len(results) == 5
        assert results[0]["title"] == "Result 0"
        assert results[4]["title"] == "Result 4"


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
        """Very long page text is truncated at 15000 chars."""
        long_text = "x" * 20000
        mock_resp = _make_http_response(200, text="<html><body><p>" + long_text + "</p></body></html>")

        with patch("tool_executor.httpx.get", return_value=mock_resp), \
             patch("tool_executor.trafilatura.extract", return_value=long_text):
            result = web_fetch("https://example.com/long")

        assert len(result) < 20000
        assert "[Truncated" in result
        assert result.startswith("x" * 15000)

    def test_short_text_not_truncated(self):
        """Text under 15000 chars is not truncated."""
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

    def test_subdomain_of_blocked_domain_is_blocked(self):
        """Subdomains of blocked domains are also blocked."""
        with patch("tool_executor.httpx.get") as mock_get:
            result = web_fetch(
                "https://en.wikipedia.org/wiki/Test",
                blocked_domains={"wikipedia.org"},
            )
            mock_get.assert_not_called()

        assert result == "error: blocked_domain"
