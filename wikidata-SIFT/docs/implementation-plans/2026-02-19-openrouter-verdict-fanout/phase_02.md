# OpenRouter Verdict Fanout — Phase 2: Tool Executor

**Goal:** Shared `web_search` and `web_fetch` functions usable by all models via the verdict runner

**Architecture:** A standalone module `scripts/tool_executor.py` exposing two functions. `web_search` calls SearXNG's JSON API via httpx. `web_fetch` downloads a URL via httpx and extracts text via trafilatura. Both check blocked domains before fetching. Unit-tested with mocked HTTP responses following the project's existing unittest.mock patterns.

**Tech Stack:** httpx (new dependency), trafilatura (existing), SearXNG JSON API

**Scope:** Phase 2 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-verdict-fanout.AC1: Web research tools work equivalently for all models
- **openrouter-verdict-fanout.AC1.1 Success:** web_search returns titles, URLs, and snippets from SearXNG for a valid query
- **openrouter-verdict-fanout.AC1.2 Success:** web_fetch extracts article text from a fetchable URL via trafilatura
- **openrouter-verdict-fanout.AC1.3 Failure:** web_fetch returns "blocked_domain" for URLs in config/blocked_domains.yaml
- **openrouter-verdict-fanout.AC1.4 Failure:** web_fetch returns error string for HTTP 403/404/timeout responses
- **openrouter-verdict-fanout.AC1.5 Failure:** web_search returns empty list with error note when SearXNG is unreachable

---

<!-- START_TASK_1 -->
### Task 1: Add httpx dependency

**Files:**
- Modify: `wikidata-SIFT/pyproject.toml` (line 8, inside `dependencies` list)

**Step 1: Add httpx to dependencies**

Add `"httpx>=0.27"` to the `dependencies` list in `pyproject.toml`. The list should become:

```toml
dependencies = [
    "pywikibot>=10.7",
    "pyyaml",
    "trafilatura>=2.0",
    "httpx>=0.27",
]
```

**Step 2: Sync dependencies**

Run:
```bash
cd wikidata-SIFT && uv sync
```

Expected: `httpx` installed without errors.

**Step 3: Verify import works**

```bash
cd wikidata-SIFT && uv run python -c "import httpx; print(httpx.__version__)"
```

Expected: Prints version number (0.27.x or higher).

**Step 4: Commit**

```bash
git add wikidata-SIFT/pyproject.toml wikidata-SIFT/uv.lock
git commit -m "deps: add httpx for tool executor HTTP requests"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Implement tool_executor.py

**Verifies:** openrouter-verdict-fanout.AC1.1, openrouter-verdict-fanout.AC1.2, openrouter-verdict-fanout.AC1.3, openrouter-verdict-fanout.AC1.4, openrouter-verdict-fanout.AC1.5

**Files:**
- Create: `wikidata-SIFT/scripts/tool_executor.py`

**Implementation:**

Create `scripts/tool_executor.py` with the following structure and behavior:

```python
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
```

Key design decisions:
- `load_blocked_domains()` and `is_blocked_domain()` are copied from `fetch_patrol_edits.py` (not imported) to keep the tool executor self-contained — it must work independently of pywikibot.
- `web_search` filters out blocked domains from results (don't show URLs the model can't fetch).
- `web_fetch` returns error strings prefixed with `"error:"` rather than raising exceptions — the runner passes these back to the model as tool results.
- Rate limiting via `_rate_limit()` uses `time.monotonic()` for accurate delays between any fetch/search call.
- Results capped at 10 to avoid excessive context consumption.
- Page text truncated at 15K chars for context management.
- `follow_redirects=True` on fetch to handle common redirects.
- `favor_recall=True` on trafilatura to reduce empty extractions.

**Note:** The design specifies `web_search(query, num_results=5)` but this implementation uses `web_search(query, blocked_domains, searxng_url)` with results capped at 10. The `num_results` parameter is omitted because the tool JSON schema exposed to models does not include it — models have no way to pass it. The hardcoded cap of 10 provides sufficient results for investigation.

**Verification:**
```bash
cd wikidata-SIFT && PYTHONPATH=scripts uv run python -c "from tool_executor import web_search, web_fetch, load_blocked_domains; print('imports OK')"
```

Expected: "imports OK"
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for tool_executor

**Verifies:** openrouter-verdict-fanout.AC1.1, openrouter-verdict-fanout.AC1.2, openrouter-verdict-fanout.AC1.3, openrouter-verdict-fanout.AC1.4, openrouter-verdict-fanout.AC1.5

**Files:**
- Create: `wikidata-SIFT/tests/test_tool_executor.py`

**Testing:**

Tests must verify each AC listed above. Follow the project's testing patterns:
- Use `unittest.mock` (`patch`, `MagicMock`) for mocking httpx and trafilatura
- Organize into test classes per function under test
- Use plain `assert` statements
- Use `_make_*()` helper functions for test data

Test classes and what they verify:

**`TestWebSearch`:**
- openrouter-verdict-fanout.AC1.1: Mock httpx.get to return a SearXNG-format JSON response with `results` containing `title`, `url`, `content` fields. Assert returned list contains dicts with `title`, `url`, `snippet` keys.
- openrouter-verdict-fanout.AC1.5: Mock httpx.get to raise `httpx.ConnectError`. Assert returned list contains a dict with `error` key mentioning "unreachable".
- Test that blocked domain URLs are filtered from search results.
- Test that results are capped at 10 items.

**`TestWebFetch`:**
- openrouter-verdict-fanout.AC1.2: Mock httpx.get to return status 200 with HTML body. Mock trafilatura.extract to return extracted text. Assert function returns the extracted text string.
- openrouter-verdict-fanout.AC1.3: Call with a URL whose domain is in the blocked set. Assert returns "error: blocked_domain". (No HTTP mock needed — should not make a request.)
- openrouter-verdict-fanout.AC1.4: Mock httpx.get to return status 403. Assert returns "error: HTTP 403 Forbidden". Repeat for 404 and timeout.
- Test extraction_empty case: mock trafilatura.extract returning None.
- Test text truncation for very long pages.

**`TestLoadBlockedDomains`:**
- Test loading from a real YAML file (use `tmp_path` fixture).
- Test graceful return of empty set when file doesn't exist.

**`TestIsBlockedDomain`:**
- Test exact match (e.g., "wikipedia.org").
- Test subdomain match (e.g., "en.wikipedia.org" matches "wikipedia.org").
- Test non-match.

**Verification:**

Run: `cd wikidata-SIFT && uv run pytest tests/test_tool_executor.py -v`

Expected: All tests pass.

**Commit:**

```bash
git add wikidata-SIFT/scripts/tool_executor.py wikidata-SIFT/tests/test_tool_executor.py
git commit -m "feat: add tool executor with web_search and web_fetch for verdict fanout"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
