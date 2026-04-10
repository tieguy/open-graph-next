#!/usr/bin/env python3
"""Pre-enrich a labeled snapshot with search-derived reference fetches.

For each edit, runs a single web_search (via the same SearXNG used by the
fanout runner) on a query built from the item label + property label + value
label, then fetches the top N results and stores them in the edit's
`prefetched_references` dict. Existing entries are preserved.

This front-loads the investigation work that every model in the fanout would
otherwise repeat — if the ensemble has 3 models, prefetching the same 3 URLs
once saves 9 web_fetch calls across the ensemble and substantially reduces
per-edit turn counts.

Usage:
    python scripts/prefetch_search_refs.py \\
        --snapshot logs/wikidata-patrol-experiment/labeled/SNAP.yaml \\
        --output   logs/wikidata-patrol-experiment/labeled/SNAP-prefetched.yaml \\
        --limit 20 \\
        --start 712 \\
        --top 3
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Reuse SearXNG + fetch + blocked-domain logic from the fanout tool layer.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tool_executor import (  # noqa: E402
    web_search,
    web_fetch,
    load_blocked_domains,
    is_blocked_domain,
)
# extract_item_reference_urls no longer needed — replaced by _extract_p854_urls_by_property

EVAL_BLOCKED_DOMAINS_PATH = Path("config/blocked_domains_eval.yaml")


def load_eval_blocked_domains():
    script_dir = Path(__file__).resolve().parent
    candidate = script_dir.parent / EVAL_BLOCKED_DOMAINS_PATH
    return load_blocked_domains(candidate if candidate.exists() else EVAL_BLOCKED_DOMAINS_PATH)


def build_search_query(edit):
    """Build a targeted search query string from an enriched edit.

    Prefers item label + property label + value label. Falls back to the
    Q-id if no item label is available.
    """
    item = edit.get("item") or {}
    item_label = item.get("label_en") or edit.get("title", "")

    parsed = edit.get("parsed_edit") or {}
    prop_label = parsed.get("property_label") or ""
    value_label = parsed.get("value_label") or ""

    parts = [p for p in (item_label, prop_label, value_label) if p]
    return " ".join(parts).strip()


def build_query_terms(edit):
    """Build a comma-separated query string for web_fetch's query parameter.

    Uses the claim's value label (what we're trying to verify) and the item
    label. web_fetch's _extract_query_matches will search for these terms in
    the fetched page and return surrounding paragraphs.
    """
    parsed = edit.get("parsed_edit") or {}
    value_label = parsed.get("value_label") or ""
    item = edit.get("item") or {}
    item_label = item.get("label_en") or ""

    terms = [t for t in (value_label, item_label) if t]
    return ", ".join(terms)


# Biographical properties whose P854 refs tend to be comprehensive profiles
# (obituaries, biographical databases, institutional pages).
BIOGRAPHICAL_PROPS = {"P569", "P570", "P106", "P69", "P166"}


def _extract_p854_urls_by_property(item):
    """Extract P854 URLs grouped by property from serialized item claims.

    Returns dict mapping property ID (e.g. "P19") -> set of URL strings.
    """
    claims = item.get("claims", {})
    by_prop = {}

    for prop_key, prop_data in claims.items():
        if not isinstance(prop_data, dict):
            continue
        prop_id = prop_key.split(" ")[0] if " " in prop_key else prop_key
        urls = set()
        for stmt in prop_data.get("statements", []):
            for ref_block in stmt.get("references", []):
                p854 = ref_block.get("P854")
                if p854 and isinstance(p854, dict):
                    url = p854.get("value")
                    if url and isinstance(url, str) and url.startswith("http"):
                        urls.add(url)
        if urls:
            by_prop[prop_id] = urls

    return by_prop


def _prioritize_p854_urls(edit, max_refs=5):
    """Select the most useful P854 URLs for an edit, prioritized by relevance.

    Priority order:
    1. URLs from the edited property's claims (most directly relevant)
    2. URLs from biographical core properties (P569, P570, P106, P69, P166)
    3. URLs from other properties

    Returns list of (url, source_note) tuples, up to max_refs.
    """
    item = edit.get("item") or {}
    parsed = edit.get("parsed_edit") or {}
    edited_prop = parsed.get("property")

    by_prop = _extract_p854_urls_by_property(item)
    if not by_prop:
        return []

    selected = []
    seen = set()

    # Tier 1: edited property refs
    if edited_prop and edited_prop in by_prop:
        for url in sorted(by_prop[edited_prop]):
            if len(selected) >= max_refs:
                break
            if url not in seen:
                selected.append((url, f"p854-{edited_prop}"))
                seen.add(url)

    # Tier 2: biographical core properties
    for prop in BIOGRAPHICAL_PROPS:
        if len(selected) >= max_refs:
            break
        if prop in by_prop and prop != edited_prop:
            for url in sorted(by_prop[prop]):
                if len(selected) >= max_refs:
                    break
                if url not in seen:
                    selected.append((url, f"p854-{prop}"))
                    seen.add(url)
                    break  # one URL per biographical property

    # Tier 3: any remaining properties (one each)
    if len(selected) < max_refs:
        for prop, urls in sorted(by_prop.items()):
            if len(selected) >= max_refs:
                break
            if prop == edited_prop or prop in BIOGRAPHICAL_PROPS:
                continue
            for url in sorted(urls):
                if url not in seen:
                    selected.append((url, f"p854-{prop}"))
                    seen.add(url)
                    break

    return selected


def fetch_item_refs(edit, blocked_domains, fetch_query, max_refs=3, verbose=False):
    """Fetch prioritized P854 reference URLs from the item.

    Prioritizes: edited property refs > biographical property refs > other.
    Returns dict mapping URL -> prefetch result dict.
    """
    picks = _prioritize_p854_urls(edit, max_refs=max_refs)
    if not picks:
        return {}, 0, 0

    prefetched = {}
    fetch_count = 0
    error_count = 0

    for url, source_note in picks:
        if is_blocked_domain(url, blocked_domains):
            if verbose:
                print(f"  p854 skip (blocked): {url}")
            continue

        if verbose:
            print(f"  p854 fetch: {url}")

        content = web_fetch(
            url,
            query=fetch_query or None,
            blocked_domains=blocked_domains,
        )
        fetch_count += 1

        entry = {
            "url": url,
            "status": None,
            "extracted_text": None,
            "error": None,
            "fetch_date": datetime.now(timezone.utc).isoformat(),
            "source": source_note,
        }

        if isinstance(content, str) and content.startswith("error:"):
            entry["error"] = content.split(":", 1)[1].strip()
            error_count += 1
        else:
            entry["status"] = 200
            entry["extracted_text"] = content

        prefetched[url] = entry
        time.sleep(0.3)

    return prefetched, fetch_count, error_count


def prefetch_for_edit(edit, top_n, blocked_domains, verbose=False):
    """Run P854 ref fetches + search + fetch top N results for a single edit.

    Returns dict mapping URL -> prefetch result dict (same shape as
    existing prefetched_references entries).
    """
    fetch_query = build_query_terms(edit)

    # Phase 1: fetch existing P854 reference URLs (no search engine needed)
    p854_refs, p854_fetches, p854_errors = fetch_item_refs(
        edit, blocked_domains, fetch_query, verbose=verbose,
    )

    # Phase 2: search + fetch top N results
    search_query = build_search_query(edit)
    search_refs = {}
    search_fetches = 0
    search_errors = 0

    if search_query:
        if verbose:
            print(f"  search: {search_query!r}")
            print(f"  fetch query terms: {fetch_query!r}")

        try:
            results = web_search(search_query, blocked_domains=blocked_domains)
        except Exception as e:
            if verbose:
                print(f"  search failed: {e}")
            results = []

        if isinstance(results, list) and results:
            if len(results) == 1 and "error" in results[0]:
                if verbose:
                    print(f"  search error: {results[0].get('error')}")
            else:
                picks = results[:top_n]
                for r in picks:
                    url = r.get("url")
                    if not url or url in p854_refs:
                        continue

                    if verbose:
                        print(f"  fetch: {url}")

                    content = web_fetch(
                        url,
                        query=fetch_query or None,
                        blocked_domains=blocked_domains,
                    )
                    search_fetches += 1

                    entry = {
                        "url": url,
                        "status": None,
                        "extracted_text": None,
                        "error": None,
                        "fetch_date": datetime.now(timezone.utc).isoformat(),
                        "source": "search-prefetch",
                        "search_query": search_query,
                        "snippet": r.get("snippet", ""),
                        "title": r.get("title", ""),
                    }

                    if isinstance(content, str) and content.startswith("error:"):
                        entry["error"] = content.split(":", 1)[1].strip()
                        search_errors += 1
                    else:
                        entry["status"] = 200
                        entry["extracted_text"] = content

                    search_refs[url] = entry
                    time.sleep(0.3)

    # Merge: P854 refs first, then search results
    merged = {**p854_refs, **search_refs}
    total_fetches = p854_fetches + search_fetches
    total_errors = p854_errors + search_errors

    return merged, total_fetches, total_errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", type=int, default=0,
                        help="First edit index (0-based)")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max number of edits to process")
    parser.add_argument("--top", type=int, default=3,
                        help="Number of top search results to fetch per edit")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--overwrite-existing", action="store_true",
                        help="If set, clobber existing prefetched_references "
                             "entries; default is to merge (keep existing)")
    args = parser.parse_args()

    with open(args.snapshot) as f:
        snapshot = yaml.safe_load(f)

    edits = snapshot.get("edits", [])
    total = len(edits)

    start = args.start
    end = min(total, start + args.limit) if args.limit else total
    window = edits[start:end]

    blocked = load_eval_blocked_domains()
    print(f"Processing edits [{start}:{end}] of {total}")
    print(f"Top results per edit: {args.top}")
    print(f"Blocked domains: {len(blocked)}")

    t0 = time.time()
    new_refs_total = 0
    fetches_total = 0
    errors_total = 0

    for i, edit in enumerate(window):
        idx = start + i
        title = edit.get("title", "?")
        parsed = edit.get("parsed_edit") or {}
        existing = edit.get("prefetched_references") or {}
        print(f"[{idx+1}/{total}] {title} {parsed.get('property_label','?')}={parsed.get('value_label','?')}", flush=True)

        new_refs, nf, ne = prefetch_for_edit(
            edit, args.top, blocked, verbose=args.verbose
        )

        if args.overwrite_existing:
            merged = {**existing, **new_refs}
        else:
            merged = {**new_refs, **existing}

        edit["prefetched_references"] = merged
        new_refs_total += len(new_refs)
        fetches_total += nf
        errors_total += ne

    elapsed = time.time() - t0
    print(f"\nDone. window_edits={len(window)} "
          f"new_refs={new_refs_total} fetches={fetches_total} "
          f"errors={errors_total} elapsed={elapsed:.0f}s "
          f"({elapsed/max(len(window),1):.1f}s/edit)")

    # Write output snapshot
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        yaml.safe_dump(snapshot, f, default_flow_style=False, allow_unicode=True)
    print(f"Wrote: {out_path}")


if __name__ == "__main__":
    main()
