#!/usr/bin/env python3
"""Fetch full opinion text for seed cases from CourtListener API.

Saves each opinion as a YAML file in data/opinions/.

Requires COURTLISTENER_API_KEY environment variable.
CourtListener API docs: https://www.courtlistener.com/help/api/rest/
"""

import os
import sys
import yaml
import httpx
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data" / "opinions"

# Seed cases: CourtListener opinion IDs
# These are looked up via the search API by case citation
SEED_CASES = [
    {
        "name": "Schenck v. United States",
        "citation": "249 U.S. 47",
        "year": 1919,
        "search_query": "Schenck v. United States",
    },
    {
        "name": "Brandenburg v. Ohio",
        "citation": "395 U.S. 444",
        "year": 1969,
        "search_query": "Brandenburg v. Ohio",
    },
    {
        "name": "Ashcroft v. Free Speech Coalition",
        "citation": "535 U.S. 234",
        "year": 2002,
        "search_query": "Ashcroft v. Free Speech Coalition",
    },
]

BASE_URL = "https://www.courtlistener.com/api/rest/v4"


def get_client() -> httpx.Client:
    api_key = os.environ.get("COURTLISTENER_API_KEY")
    headers = {}
    if api_key:
        headers["Authorization"] = f"Token {api_key}"
    else:
        print("WARNING: No COURTLISTENER_API_KEY set. Using unauthenticated access (rate-limited).", file=sys.stderr)
    return httpx.Client(base_url=BASE_URL, headers=headers, timeout=30.0)


def search_opinion(client: httpx.Client, case: dict) -> dict | None:
    """Search for a case by name and return the cluster + opinion data."""
    # Search for the opinion cluster
    resp = client.get("/search/", params={
        "q": case["search_query"],
        "type": "o",  # opinions
        "filed_after": f"{case['year']}-01-01",
        "filed_before": f"{case['year']}-12-31",
        "court": "scotus",
    })
    resp.raise_for_status()
    results = resp.json()

    if not results.get("results"):
        print(f"  No results found for {case['name']}", file=sys.stderr)
        return None

    # Take the first result
    result = results["results"][0]
    return result


def fetch_cluster_opinions(client: httpx.Client, cluster_id: int) -> list[dict]:
    """Fetch all opinions (majority, concurrence, dissent) for a cluster."""
    resp = client.get(f"/opinions/", params={"cluster": cluster_id})
    resp.raise_for_status()
    return resp.json().get("results", [])


def fetch_opinion_text(client: httpx.Client, opinion_id: int) -> dict:
    """Fetch full opinion detail including text."""
    resp = client.get(f"/opinions/{opinion_id}/")
    resp.raise_for_status()
    return resp.json()


def save_opinion(case: dict, search_result: dict, opinions: list[dict]) -> Path:
    """Save opinion data as YAML."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    slug = case["name"].lower().replace(" ", "-").replace(".", "")
    # Clean up slug
    for char in ["'", ",", "("]:
        slug = slug.replace(char, "")

    output = {
        "case_name": case["name"],
        "citation": case["citation"],
        "year": case["year"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "courtlistener",
        "cluster_id": search_result.get("cluster_id"),
        "opinions": [],
    }

    for op in opinions:
        # Opinion text can be in several fields; prefer html, fall back to plain_text
        text = op.get("plain_text") or op.get("html") or op.get("html_lawbox") or op.get("html_columbia") or ""
        opinion_entry = {
            "opinion_id": op.get("id"),
            "type": op.get("type", "unknown"),
            "author": op.get("author_str", ""),
            "text": text,
            "word_count": len(text.split()) if text else 0,
        }
        output["opinions"].append(opinion_entry)

    filepath = DATA_DIR / f"{slug}.yaml"
    with open(filepath, "w") as f:
        yaml.dump(output, f, default_flow_style=False, allow_unicode=True, width=120)

    return filepath


def main():
    print("Fetching seed case opinions from CourtListener...")
    client = get_client()

    for case in SEED_CASES:
        print(f"\n--- {case['name']} ({case['citation']}) ---")

        # Search for the case
        result = search_opinion(client, case)
        if not result:
            print(f"  SKIPPED: could not find case", file=sys.stderr)
            continue

        cluster_id = result.get("cluster_id")
        print(f"  Found cluster ID: {cluster_id}")

        # Fetch all opinions in the cluster
        opinions = fetch_cluster_opinions(client, cluster_id)
        print(f"  Found {len(opinions)} opinion(s)")

        # Fetch full text for each opinion
        full_opinions = []
        for op in opinions:
            op_id = op.get("id")
            print(f"  Fetching opinion {op_id}...")
            full_op = fetch_opinion_text(client, op_id)
            full_opinions.append(full_op)

        # Save
        filepath = save_opinion(case, result, full_opinions)
        print(f"  Saved to {filepath}")

    print("\nDone.")


if __name__ == "__main__":
    main()
