# legal-graph

Constitutional caselaw knowledge graph prototype — building an open, verified semantic layer on top of Free Law Project's citation graph.

## Project Purpose

Extract citation treatment semantics from US constitutional caselaw using LLMs, verify against human ground truth, and publish as CC0 structured data. The "Semantic Scholar for Law" concept: what proposition does opinion A take from opinion B, and is that characterization accurate?

## Core Principles

### 1. Standard citator taxonomy

Citation treatment uses the established Shepard's/KeyCite categories: followed, distinguished, overruled, criticized, questioned, limited, explained, harmonized. See `plans/plan-2026-04-01.md` for full taxonomy with definitions.

### 2. Public domain corpus only

All source material is US federal caselaw (public domain) via CourtListener / Free Law Project. Output is CC0.

### 3. Log everything in YAML

All extraction output logged in structured YAML with timestamps and provenance. Log directories:
- `logs/seed-extraction/` — LLM extraction results for seed cases
- `data/opinions/` — Fetched opinion text

### 4. No writes to production Wikidata

Same constraint as wikidata-SIFT. All Wikidata write operations target test.wikidata.org only. Read-only access to production is expected.

## Structure

```
legal-graph/
  plans/              — Design documents
  scripts/            — Python scripts for the pipeline
    fetch_opinions.py   — Fetch opinion text from CourtListener API
    extract_citations.py — Run Eyecite to enumerate citations
    extract_semantics.py — LLM extraction of citation treatment
  config/             — Prompts and configuration
    citation_semantics_prompt.md — Prompt for LLM treatment extraction
  data/
    opinions/         — Fetched opinion YAML files
  logs/
    seed-extraction/  — Extraction results
```

## Seed Cases

First Amendment free speech chain:
1. *Schenck v. United States*, 249 U.S. 47 (1919) — CourtListener ID: `schenck-v-united-states`
2. *Brandenburg v. Ohio*, 395 U.S. 444 (1969) — CourtListener ID: `brandenburg-v-ohio`
3. *Ashcroft v. Free Speech Coalition*, 535 U.S. 234 (2002) — CourtListener ID: `ashcroft-v-free-speech-coalition`

## Dependencies

```
eyecite          — FLP's citation parser
httpx            — HTTP client for CourtListener API
pyyaml           — YAML output
anthropic        — Claude API for LLM extraction (future)
```

## Environment Variables

- `COURTLISTENER_API_KEY` — Required for CourtListener API access (register at https://www.courtlistener.com/sign-in/)
- `ANTHROPIC_API_KEY` — Required for LLM extraction via API (currently done inline)

## Useful Commands

```bash
# Fetch opinions for seed cases (requires COURTLISTENER_API_KEY)
python scripts/fetch_opinions.py

# Extract citations from fetched opinions
python scripts/extract_citations.py

# Run LLM treatment extraction (requires ANTHROPIC_API_KEY)
python scripts/extract_semantics.py

# Run all three in sequence
python scripts/fetch_opinions.py && python scripts/extract_citations.py && python scripts/extract_semantics.py
```
