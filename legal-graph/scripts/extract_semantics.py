#!/usr/bin/env python3
"""Extract citation treatment semantics using LLM.

Reads citation YAML files from data/citations/, sends each citation context
to an LLM with the citation semantics prompt, and saves structured results.

Output: logs/seed-extraction/{case-slug}.yaml

Requires ANTHROPIC_API_KEY for API mode. Can also be run with pre-computed
results (for inline extraction during development).
"""

import os
import sys
import yaml
from datetime import datetime, timezone
from pathlib import Path

CITATIONS_DIR = Path(__file__).parent.parent / "data" / "citations"
LOGS_DIR = Path(__file__).parent.parent / "logs" / "seed-extraction"
PROMPT_PATH = Path(__file__).parent.parent / "config" / "citation_semantics_prompt.md"


def load_prompt() -> str:
    """Load the citation semantics prompt."""
    with open(PROMPT_PATH) as f:
        return f.read()


def build_user_message(case_name: str, case_citation: str, cite: dict) -> str:
    """Build the user message for a single citation extraction."""
    ctx = cite.get("context", {})
    return f"""Analyze this citation:

**Citing case:** {case_name}, {case_citation}
**Cited case:** {cite['cited_case']}
**Opinion section:** {cite.get('opinion_type', 'unknown')}

**Text before citation:**
{ctx.get('before', '[not available]')}

**Citation:** {ctx.get('citation_text', cite['cited_case'])}

**Text after citation:**
{ctx.get('after', '[not available]')}

Extract the proposition, treatment type, depth, supporting passage (if available), accuracy assessment, and confidence level. Output as YAML."""


def extract_via_api(system_prompt: str, user_message: str) -> dict | None:
    """Call Anthropic API for extraction. Returns parsed YAML or None."""
    try:
        import anthropic
    except ImportError:
        print("  anthropic package not installed. Install with: pip install anthropic", file=sys.stderr)
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("  ANTHROPIC_API_KEY not set", file=sys.stderr)
        return None

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    # Parse YAML from response
    text = response.content[0].text
    # Try to extract YAML block
    if "```yaml" in text:
        yaml_text = text.split("```yaml")[1].split("```")[0]
    elif "```" in text:
        yaml_text = text.split("```")[1].split("```")[0]
    else:
        yaml_text = text

    try:
        parsed = yaml.safe_load(yaml_text)
        if isinstance(parsed, list) and len(parsed) > 0:
            return parsed[0]
        return parsed
    except yaml.YAMLError as e:
        print(f"  Failed to parse YAML response: {e}", file=sys.stderr)
        return {"raw_response": text}


def process_citations_file(filepath: Path, system_prompt: str, dry_run: bool = False) -> Path | None:
    """Process a single citations file and extract semantics."""
    with open(filepath) as f:
        data = yaml.safe_load(f)

    if not data or not data.get("citations"):
        print(f"  No citations in {filepath.name}", file=sys.stderr)
        return None

    results = {
        "case_name": data["case_name"],
        "citation": data["citation"],
        "year": data["year"],
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "extraction_method": "anthropic_api" if not dry_run else "dry_run",
        "total_citations": data["total_citations"],
        "extractions": [],
    }

    for i, cite in enumerate(data["citations"]):
        user_msg = build_user_message(data["case_name"], data["citation"], cite)

        if dry_run:
            print(f"  [{i+1}/{data['total_citations']}] {cite['cited_case']} — DRY RUN")
            results["extractions"].append({
                "cited_case": cite["cited_case"],
                "context_before": cite.get("context", {}).get("before", "")[:100],
                "user_message_preview": user_msg[:200],
                "result": None,
            })
            continue

        print(f"  [{i+1}/{data['total_citations']}] {cite['cited_case']}...")
        result = extract_via_api(system_prompt, user_msg)

        results["extractions"].append({
            "cited_case": cite["cited_case"],
            "context": cite.get("context", {}),
            "result": result,
        })

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = LOGS_DIR / filepath.name
    with open(out_path, "w") as f:
        yaml.dump(results, f, default_flow_style=False, allow_unicode=True, width=120)

    return out_path


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Extract citation treatment semantics via LLM")
    parser.add_argument("--dry-run", action="store_true", help="Preview without calling API")
    parser.add_argument("--file", type=str, help="Process a specific citations file")
    args = parser.parse_args()

    print("Extracting citation treatment semantics...")
    system_prompt = load_prompt()

    if args.file:
        files = [Path(args.file)]
    else:
        files = sorted(CITATIONS_DIR.glob("*.yaml"))

    if not files:
        print("No citation files found in data/citations/. Run extract_citations.py first.", file=sys.stderr)
        sys.exit(1)

    for filepath in files:
        print(f"\n--- {filepath.name} ---")
        out = process_citations_file(filepath, system_prompt, dry_run=args.dry_run)
        if out:
            print(f"  Saved to {out}")

    print("\nDone.")


if __name__ == "__main__":
    main()
