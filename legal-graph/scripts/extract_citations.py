#!/usr/bin/env python3
"""Extract citations from fetched opinion text using Eyecite.

Reads opinion YAML files from data/opinions/, runs Eyecite to find all
citations, extracts surrounding context, and outputs a structured citation
list for each case.

Output: data/citations/{case-slug}.yaml
"""

import re
import sys
import yaml
from pathlib import Path

from eyecite import get_citations, resolve_citations
from eyecite.models import FullCaseCitation

OPINIONS_DIR = Path(__file__).parent.parent / "data" / "opinions"
CITATIONS_DIR = Path(__file__).parent.parent / "data" / "citations"

# Characters of context to extract before and after each citation
CONTEXT_WINDOW = 300


def strip_html(text: str) -> str:
    """Remove HTML tags, keeping text content."""
    clean = re.sub(r"<[^>]+>", " ", text)
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip()


def extract_context(text: str, start: int, end: int, window: int = CONTEXT_WINDOW) -> dict:
    """Extract text before and after a citation span."""
    ctx_start = max(0, start - window)
    ctx_end = min(len(text), end + window)
    return {
        "before": text[ctx_start:start].strip(),
        "citation_text": text[start:end],
        "after": text[end:ctx_end].strip(),
        "char_offset_start": start,
        "char_offset_end": end,
    }


def process_opinion(opinion_text: str, opinion_meta: dict) -> list[dict]:
    """Run Eyecite on an opinion and return structured citation data."""
    # Strip HTML if present
    clean_text = strip_html(opinion_text)

    # Get all citations
    found = get_citations(clean_text)

    # Resolve citations (group short-form cites with their full-form antecedent)
    resolved = resolve_citations(found)

    citations = []
    for citation in found:
        if not isinstance(citation, FullCaseCitation):
            continue  # Skip short-form, supra, id. references for now

        # Get the span in the text
        span = citation.span()
        if not span:
            continue

        start, end = span

        entry = {
            "cited_case": str(citation),
            "reporter": citation.corrected_reporter() if hasattr(citation, "corrected_reporter") else str(citation.groups.get("reporter", "")),
            "volume": citation.groups.get("volume", ""),
            "page": citation.groups.get("page", ""),
            "year": citation.metadata.year if hasattr(citation, "metadata") and citation.metadata else None,
            "context": extract_context(clean_text, start, end),
            "opinion_type": opinion_meta.get("type", "unknown"),
            "opinion_author": opinion_meta.get("author", ""),
        }
        citations.append(entry)

    return citations


def process_case_file(filepath: Path) -> Path | None:
    """Process a single case opinion file and output citation data."""
    with open(filepath) as f:
        case_data = yaml.safe_load(f)

    if not case_data or not case_data.get("opinions"):
        print(f"  No opinions found in {filepath.name}", file=sys.stderr)
        return None

    all_citations = []
    for opinion in case_data["opinions"]:
        text = opinion.get("text", "")
        if not text:
            continue

        cites = process_opinion(text, opinion)
        all_citations.extend(cites)
        print(f"  Opinion (type={opinion.get('type', '?')}): found {len(cites)} full citations")

    output = {
        "case_name": case_data["case_name"],
        "citation": case_data["citation"],
        "year": case_data["year"],
        "total_citations": len(all_citations),
        "citations": all_citations,
    }

    CITATIONS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CITATIONS_DIR / filepath.name
    with open(out_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, allow_unicode=True, width=120)

    return out_path


def main():
    print("Extracting citations from fetched opinions...")

    opinion_files = sorted(OPINIONS_DIR.glob("*.yaml"))
    if not opinion_files:
        print("No opinion files found in data/opinions/. Run fetch_opinions.py first.", file=sys.stderr)
        sys.exit(1)

    for filepath in opinion_files:
        print(f"\n--- {filepath.name} ---")
        out = process_case_file(filepath)
        if out:
            print(f"  Saved to {out}")

    print("\nDone.")


if __name__ == "__main__":
    main()
