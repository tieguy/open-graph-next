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

import os

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
FETCH_TIMEOUT = 15.0
SEARCH_TIMEOUT = 10.0
FETCH_DELAY = 0.5  # seconds between fetches, matching existing codebase pattern
SEARCH_DELAY = 1.0  # Brave API free tier: 1 req/sec
USER_AGENT = "wikidata-sift-tool-executor/1.0"

_last_search_time = 0.0

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


def _search_rate_limit():
    """Enforce minimum delay between search API calls."""
    global _last_search_time
    now = time.monotonic()
    elapsed = now - _last_search_time
    if elapsed < SEARCH_DELAY:
        time.sleep(SEARCH_DELAY - elapsed)
    _last_search_time = time.monotonic()


def web_search(query, blocked_domains=None, api_key=None):
    """Search the web via Brave Search API.

    Args:
        query: Search query string.
        blocked_domains: Set of blocked domain strings (optional).
        api_key: Brave Search API key. Falls back to BRAVE_API_KEY env var.

    Returns:
        list[dict]: Each dict has keys: title, url, snippet.
        On error, returns a list with a single dict containing an "error" key.
    """
    key = api_key or os.environ.get("BRAVE_API_KEY", "")
    if not key:
        return [{"error": "BRAVE_API_KEY not set"}]

    if blocked_domains is None:
        blocked_domains = set()

    try:
        _search_rate_limit()
        resp = httpx.get(
            BRAVE_SEARCH_URL,
            params={"q": query},
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": key,
            },
            timeout=SEARCH_TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.TimeoutException:
        return [{"error": "Brave Search request timed out"}]
    except httpx.HTTPError as exc:
        return [{"error": f"Brave Search error: {exc}"}]

    try:
        data = resp.json()
    except Exception:
        return [{"error": "Brave Search returned invalid JSON"}]

    results = []
    for item in data.get("web", {}).get("results", []):
        item_url = item.get("url", "")
        if is_blocked_domain(item_url, blocked_domains):
            continue
        results.append({
            "title": item.get("title", ""),
            "url": item_url,
            "snippet": item.get("description", ""),
        })

    return results[:10]


# Query-aware extraction tuning constants.
FETCH_LEAD_CHARS = 2500      # always-included lead/intro
FETCH_MATCH_WINDOW = 600     # chars around each query match
FETCH_MAX_MATCHES = 8        # cap distinct matches returned
FETCH_MAX_TOTAL_CHARS = 9000 # hard cap on total returned text
FETCH_FALLBACK_CHARS = 5000  # when no query or no matches, return head of page


def _extract_query_matches(text, query):
    """Find paragraphs containing any of the query terms.

    Splits on double-newline boundaries (trafilatura output) so we return
    coherent paragraphs rather than mid-sentence windows. For terms that are
    a single token, does whole-word match to avoid "US" hitting "plus".
    For multi-word phrases, does a substring match.

    Args:
        text: Full page text (after trafilatura extraction).
        query: Search string. May contain multiple comma-separated terms.

    Returns:
        list of (match_term, paragraph_text) tuples, up to FETCH_MAX_MATCHES.
    """
    import re

    terms = [t.strip() for t in query.split(",") if t.strip()]
    if not terms:
        return []

    # Build case-insensitive patterns: whole-word for single tokens,
    # substring for multi-word phrases.
    patterns = []
    for term in terms:
        if " " in term:
            patterns.append((term, re.compile(re.escape(term), re.IGNORECASE)))
        else:
            patterns.append((term, re.compile(r"\b" + re.escape(term) + r"\b", re.IGNORECASE)))

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    matches = []
    seen_paragraph_starts = set()

    for para in paragraphs:
        for term, pat in patterns:
            if pat.search(para):
                # Dedupe by first 60 chars of paragraph so we don't return
                # the same para twice if it matches multiple terms.
                key = para[:60]
                if key in seen_paragraph_starts:
                    break
                seen_paragraph_starts.add(key)

                # Truncate very long paragraphs to a window around the first match
                if len(para) > FETCH_MATCH_WINDOW * 2:
                    m = pat.search(para)
                    start = max(0, m.start() - FETCH_MATCH_WINDOW)
                    end = min(len(para), m.end() + FETCH_MATCH_WINDOW)
                    excerpt = ("..." if start > 0 else "") + para[start:end] + ("..." if end < len(para) else "")
                else:
                    excerpt = para
                matches.append((term, excerpt))
                break  # one term hit is enough; move to next paragraph

        if len(matches) >= FETCH_MAX_MATCHES:
            break

    return matches


def web_fetch(url, query=None, blocked_domains=None):
    """Fetch and extract text from a web page.

    When `query` is provided, returns the page lead (first FETCH_LEAD_CHARS)
    plus paragraphs containing any of the query terms. When `query` is None
    or empty, returns the first FETCH_FALLBACK_CHARS of extracted text.

    Args:
        url: URL to fetch.
        query: Optional string of comma-separated terms to locate in the page.
            Typically the claim value being verified.
        blocked_domains: Set of blocked domain strings (optional).

    Returns:
        str: Extracted text (lead + relevant excerpts) on success, or an
        error string prefixed with "error:" on failure.
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

    full_length = len(text)

    # Always include the lead / first part of the page (infobox + intro live here
    # for most Wikipedia-style sources)
    lead = text[:FETCH_LEAD_CHARS]
    lead_truncated = full_length > FETCH_LEAD_CHARS

    if not query:
        # No query provided: fall back to a generic head-of-page snapshot
        if full_length <= FETCH_FALLBACK_CHARS:
            return text
        return (
            text[:FETCH_FALLBACK_CHARS]
            + f"\n\n[Truncated — full page was {full_length} chars; "
              "re-fetch with a query parameter to get targeted excerpts]"
        )

    # Query provided: return lead + matches from the rest of the page
    rest_of_page = text[FETCH_LEAD_CHARS:]
    matches = _extract_query_matches(rest_of_page, query)

    parts = []
    parts.append("## Page lead\n" + lead)
    if lead_truncated and not matches:
        parts.append(
            f"\n[Note: full page was {full_length} chars. No matches found "
            f"for query terms: {query!r}. The fact you are looking for may "
            "not be in this source.]"
        )
    elif matches:
        parts.append(f"\n## Excerpts matching query: {query!r}\n")
        for term, excerpt in matches:
            parts.append(f"### [match: {term!r}]\n{excerpt}\n")
        if len(matches) >= FETCH_MAX_MATCHES:
            parts.append(
                f"\n[Additional matches may exist in the full {full_length}-char "
                "page; narrow your query for more targeted results]"
            )
    elif lead_truncated:
        parts.append(
            f"\n[Note: full page was {full_length} chars. No query matches found "
            "beyond the lead section shown above.]"
        )

    result = "\n".join(parts)
    # Hard safety cap
    if len(result) > FETCH_MAX_TOTAL_CHARS:
        result = result[:FETCH_MAX_TOTAL_CHARS] + "\n\n[Truncated — hit total output cap]"
    return result
