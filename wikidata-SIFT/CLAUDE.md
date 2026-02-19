Instructions for Claude Code when working on this project.

Last updated: 2026-02-19

## Project Purpose

This is a research experiment exploring whether LLM-assisted fact-checking can reliably support Wikidata contributions. The goal is to understand the practical constraints—not to maximize edit volume, but to understand what "correct" looks like.

## Core Principles

### 1. No writes to production Wikidata

All pywikibot **write** operations target `test.wikidata.org` only. The config enforces this, but double-check before any edit operation. If you're uncertain whether something targets test or production, stop and verify.

**Read-only access to production is expected.** The methodology-testing skill and the SIFT-Patrol experiment both read from production Wikidata (fetching items, recent changes, revision diffs). This is safe and intentional. The constraint is on writes only.

### 2. Every claim needs a verifiable reference

Wikidata's standard: claims should be verifiable from reliable published sources. This means:

- Primary sources (official websites, government records) are preferred
- Secondary sources (news, encyclopedias) are acceptable with appropriate caution
- No claim should rely solely on LLM "knowledge"—always fetch and cite an actual source

### 3. Log everything in machine-readable format

All fact-checking output should be logged in structured YAML format with timestamps. This provenance chain is the main research output. Log directories by experiment:

- `logs/wikidata-enhance/` -- Item enhancement logs (see `skills/wikidata-enhance-and-check/SKILL.md` Step 13 for schema)
- `logs/wikidata-methodology-testing/` -- SIFT methodology test results
- `logs/wikidata-patrol-experiment/` -- SIFT-Patrol experiment (snapshots in `snapshot/`, control group in `control/`, multi-model verdicts in `verdicts-fanout/`)

### 4. Respect Wikidata's data model

When adding claims, include:

- **References**: At minimum, `stated in` (P248) or `reference URL` (P854) with `retrieved` (P813)
- **Precision**: Dates need appropriate precision (year vs. day). Don't claim false precision.
- **Qualifiers**: Use when relevant (e.g., `start time`, `end time` for things that change)

## Session Management with Chainlink

This project uses [chainlink](https://github.com/dollspace-gay/chainlink) to track fact-checking sessions and preserve context across conversations.

### When to Create Issues

Create chainlink issues:

1. **At session start**: When beginning a fact-checking task
   ```bash
   chainlink new "Verify: [Item Label] - [what you're checking]"
   ```

2. **When discovering new work**: During fact-checking, you may discover:
   - Organizations, awards, or other entities that need Wikidata items
   - Related claims that need separate verification
   - Conflicts with existing data that need investigation

   Create subissues or new issues for these:
   ```bash
   chainlink new "Create item: [Entity Name]" --parent [parent-issue-id]
   ```

### Session Workflow

```bash
# Start session - see previous handoff notes
chainlink session start

# Set current working issue
chainlink set [issue-id]

# Log progress as you work
chainlink comment "Found primary source: [url]"
chainlink comment "Verified birth date with high confidence"

# End session with handoff notes
chainlink session end --notes "Verified X, Y. Blocked on Z - need [specific source]"
```

### Issue Structure

```
Main issue: "Verify: Douglas Adams biographical claims"
├── Subissue: "Verify birth date"
├── Subissue: "Verify nationality"
├── Subissue: "Create item: The Hitchhiker's Guide (if missing)"
└── Subissue: "Resolve conflict: death date precision"
```

## Fact-Checking Protocol

The full fact-checking methodology is in `docs/wikidata-methodology.md`. Key principles:

### SIFT Framework
- **Stop** - Don't accept claims at face value
- **Investigate the source** - Who published this? What's their authority?
- **Find better coverage** - What do other reliable sources say?
- **Trace claims** - Find the original/primary source

### Evidence Types
See `docs/wikidata-methodology.md` for the full evidence type taxonomy and how each maps to Wikidata reference properties.

### Wikidata-Specific Checks
Before proposing any claim:
1. Does this property exist? Is it the right one for this claim?
2. How do similar items model this relationship?
3. Are there existing claims that conflict?
4. What precision is actually supported by the source?

## Skills

This project includes Claude Code skills for structured workflows:

- **wikidata-enhance-and-check** (`skills/wikidata-enhance-and-check/SKILL.md`): Systematically verify and add claims to Wikidata test items with SIFT methodology, human approval gates, and chainlink session tracking. Invoke with `/wikidata-enhance-and-check Q42` or just `/wikidata-enhance-and-check` to resume.

- **wikidata-methodology-testing** (`skills/wikidata-methodology-testing/SKILL.md`): Test SIFT methodology accuracy by reading production Wikidata entities, running full verification pipelines, and logging proposed claims for human verification. This is READ-ONLY (never writes to Wikidata). Uses test entities from `docs/test-entities.yaml`. Results logged to `logs/wikidata-methodology-testing/`. Invoke with `/wikidata-methodology-testing Q42`.

### SIFT-Patrol Experiment (in progress)

Edit-centric SIFT verification for Wikidata patrol. Unlike the item-centric skills above, this evaluates individual unpatrolled edits ("is this specific change correct?"). Design plan: `docs/design-plans/2026-02-16-sift-patrol-experiment.md`. Enriched snapshots design: `docs/implementation-plans/2026-02-16-sift-patrol-enriched-snapshots/`. Infrastructure built so far:

- `scripts/fetch_patrol_edits.py` -- Fetches unpatrolled and control statement edits from production Wikidata via RecentChanges API. Saves YAML snapshots to `logs/wikidata-patrol-experiment/snapshot/`. Key capabilities:
  - `--enrich` flag adds item context (labels, descriptions, all serialized claims), parsed edit summaries, resolved property/value labels, and removed claim data for removal edits
  - Uses `pwb_http.fetch` + `Special:EntityData` for revision-specific entity fetching (pywikibot's API layer doesn't support revision-specific fetches)
  - `LabelCache` resolves Q-ids and P-ids to English labels with in-memory caching
  - Enriched snapshots include `parsed_edit`, `item`, and `removed_claim` keys per edit
- `scripts/tool_executor.py` -- Provides `web_search()` (via local SearXNG) and `web_fetch()` (via httpx + trafilatura) for model-agnostic tool calling. Respects `config/blocked_domains.yaml`, rate-limits fetches, truncates pages to 15k chars.
- `scripts/run_verdict_fanout.py` -- Multi-model verdict runner via OpenRouter. Two-phase execution per edit: Phase A (investigation with tool-calling loop, max 15 turns) then Phase B (structured JSON verdict extraction). Features:
  - Runs edits from enriched snapshots across configurable model list (default: Nemotron, OLMo, DeepSeek, Claude Haiku)
  - Interleaved execution order (all models per edit before moving to next edit)
  - Checkpoint/resume via `logs/wikidata-patrol-experiment/fanout-state.yaml`
  - Per-verdict 180s wall-clock timeout
  - Cost tracking via OpenRouter generation endpoint
  - Verdicts saved to `logs/wikidata-patrol-experiment/verdicts-fanout/`
- `config/sift_prompt_openrouter.md` -- Model-agnostic SIFT prompt for the verdict fanout (no Claude-specific features)
- `docker-compose.yml` -- SearXNG + Valkey containers for local web search (SearXNG on `localhost:8080`, config in `config/searxng/`)
- Requires `OPENROUTER_API_KEY` env var for verdict fanout runs
- Skill for edit-centric SIFT verification is planned for Phase 3.

## Working with pywikibot

### Reading an item

```python
import pywikibot
site = pywikibot.Site('test', 'wikidata')
repo = site.data_repository()
item = pywikibot.ItemPage(repo, 'Q42')
item.get()
# item.claims, item.labels, item.descriptions now populated
```

### Adding a claim with reference

```python
claim = pywikibot.Claim(repo, 'P31')  # instance of
target = pywikibot.ItemPage(repo, 'Q5')  # human
claim.setTarget(target)

# Add reference
ref = pywikibot.Claim(repo, 'P854')  # reference URL
ref.setTarget('https://example.com/source')
retrieved = pywikibot.Claim(repo, 'P813')  # retrieved
retrieved.setTarget(pywikibot.WbTime(year=2025, month=1, day=19))
claim.addSources([ref, retrieved])

item.addClaim(claim, summary='Adding claim with reference')
```

### SPARQL queries

```python
from pywikibot import pagegenerators
query = '''SELECT ?item WHERE { ?item wdt:P31 wd:Q5 . } LIMIT 10'''
generator = pagegenerators.WikidataSPARQLPageGenerator(query, site=site)
```

## Useful Commands

```bash
# Test pywikibot connection
python -c "import pywikibot; print(pywikibot.Site('test', 'wikidata'))"

# Run a script with throttling (pywikibot handles this, but be aware)
python -m pywikibot.scripts.login  # interactive login if needed

# Fetch patrol edits (read-only from production)
python scripts/fetch_patrol_edits.py --dry-run          # preview without saving
python scripts/fetch_patrol_edits.py -u 10 -c 10       # 10 unpatrolled + 10 control
python scripts/fetch_patrol_edits.py -u 5 -c 5 --enrich  # with enrichment

# Run tests (uses uv for dependency management)
uv run pytest                    # all tests
uv run pytest tests/test_enrichment.py  # specific test file
uv run pytest -k "test_name"     # specific test by name

# First-time SearXNG setup (generate settings with secret key)
cp config/searxng/settings.yml.template config/searxng/settings.yml
sed -i "s/GENERATE_AND_REPLACE.*/$(openssl rand -hex 32)/" config/searxng/settings.yml

# Start SearXNG for verdict fanout web search
docker compose up -d                # start SearXNG + Valkey
docker compose down                 # stop containers

# Run verdict fanout (requires OPENROUTER_API_KEY and SearXNG running)
python scripts/run_verdict_fanout.py --snapshot logs/wikidata-patrol-experiment/snapshot/SNAPSHOT.yaml --dry-run
python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --limit 3  # first 3 edits
python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --models deepseek/deepseek-v3.2  # single model

# Chainlink basics
chainlink list              # see all issues
chainlink show [id]         # see issue details
chainlink session status    # see current session state
```

## What Success Looks Like

The research output is understanding, not volume. Success is:

- Clear documentation of what fact-checking steps are necessary
- Realistic estimates of time/effort per claim
- Identified failure modes (where does LLM fact-checking fall short?)
- A refined prompt methodology tuned for Wikidata's norms
- Enough logged examples to analyze patterns

## Questions to Explore

As you work, note observations about:

- Which types of claims are easy vs. hard to verify?
- Where do source quality judgments get tricky?
- What's the gap between "LLM thinks this is true" and "verifiable from cited source"?
- How often do you find conflicting information?
- What would a sustainable human-in-the-loop workflow look like?
