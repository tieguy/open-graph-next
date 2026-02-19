#!/usr/bin/env python3
"""Tool executor for OpenRouter verdict fanout.

Provides web_search() and web_fetch() functions that can be called
by any model via the verdict runner's tool-calling loop.
"""

import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import trafilatura
import yaml

SEARXNG_URL = "http://localhost:8080/search"
FETCH_TIMEOUT = 15.0
SEARCH_TIMEOUT = 10.0
FETCH_DELAY = 0.5  # seconds between fetches, matching existing codebase pattern
USER_AGENT = "wikidata-sift-tool-executor/1.0"

_last_fetch_time = 0.0


def load_blocked_domains(config_path=None):
    """Load blocked domain list from YAML config.

    Args:
        config_path: Path to blocked_domains.yaml. Defaults to
            config/blocked_domains.yaml relative to project root.

    Returns:
        Set of domain strings (e.g., {"wikipedia.org", "imdb.com"}).
    """
    if config_path is None:
        config_path = (
            Path(__file__).resolve().parent.parent / "config" / "blocked_domains.yaml"
        )
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        return set()

    with open(config_path) as f:
        data = yaml.safe_load(f)

    if not data or "domains" not in data:
        return set()

    return {entry["domain"] for entry in data["domains"] if "domain" in entry}


def is_blocked_domain(url, blocked_domains):
    """Check if a URL's domain is in the blocked set.

    Matches exact domain or any subdomain (e.g., "en.wikipedia.org"
    matches "wikipedia.org").
    """
    try:
        hostname = urlparse(url).hostname
    except Exception:
        return False
    if not hostname:
        return False
    hostname = hostname.lower()
    for domain in blocked_domains:
        if hostname == domain or hostname.endswith("." + domain):
            return True
    return False


def _rate_limit():
    """Enforce minimum delay between fetches."""
    global _last_fetch_time
    now = time.monotonic()
    elapsed = now - _last_fetch_time
    if elapsed < FETCH_DELAY:
        time.sleep(FETCH_DELAY - elapsed)
    _last_fetch_time = time.monotonic()


def web_search(query, blocked_domains=None, searxng_url=None):
    """Search the web via SearXNG.

    Args:
        query: Search query string.
        blocked_domains: Set of blocked domain strings (optional).
        searxng_url: Override SearXNG URL (for testing).

    Returns:
        list[dict]: Each dict has keys: title, url, snippet.
        On error, returns a list with a single dict containing an "error" key.
    """
    url = searxng_url or SEARXNG_URL
    if blocked_domains is None:
        blocked_domains = set()

    try:
        _rate_limit()
        resp = httpx.get(
            url,
            params={"q": query, "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=SEARCH_TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.TimeoutException:
        return [{"error": "SearXNG request timed out"}]
    except httpx.ConnectError:
        return [{"error": "SearXNG is unreachable at " + url}]
    except httpx.HTTPError as exc:
        return [{"error": f"SearXNG error: {exc}"}]

    try:
        data = resp.json()
    except Exception:
        return [{"error": "SearXNG returned invalid JSON"}]

    results = []
    for item in data.get("results", []):
        item_url = item.get("url", "")
        if is_blocked_domain(item_url, blocked_domains):
            continue
        results.append({
            "title": item.get("title", ""),
            "url": item_url,
            "snippet": item.get("content", ""),
        })

    return results[:10]


def web_fetch(url, blocked_domains=None):
    """Fetch and extract text from a web page.

    Args:
        url: URL to fetch.
        blocked_domains: Set of blocked domain strings (optional).

    Returns:
        str: Extracted text on success, or an error string prefixed
        with "error:" on failure.
    """
    if blocked_domains is None:
        blocked_domains = set()

    if is_blocked_domain(url, blocked_domains):
        return "error: blocked_domain"

    try:
        _rate_limit()
        resp = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
        )
    except httpx.TimeoutException:
        return "error: timeout"
    except httpx.HTTPError as exc:
        return f"error: {exc}"

    if resp.status_code == 403:
        return "error: HTTP 403 Forbidden"
    if resp.status_code == 404:
        return "error: HTTP 404 Not Found"
    if resp.status_code != 200:
        return f"error: HTTP {resp.status_code}"

    text = trafilatura.extract(resp.text, url=url, favor_recall=True)
    if not text:
        return "error: extraction_empty"

    # Truncate very long pages to avoid blowing up model context
    if len(text) > 15000:
        text = text[:15000] + "\n\n[Truncated — full page was longer]"

    return text
