Instructions for Claude Code when working on this project.

Last updated: 2026-04-08

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
- `logs/wikidata-patrol-experiment/` -- SIFT-Patrol experiment (snapshots in `snapshot/`, control group in `control/`, multi-model verdicts in `verdicts-fanout/`, labeled evaluation dataset in `labeled/`, analysis output in `analysis/`)

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
   chainlink create "Verify: [Item Label] - [what you're checking]"
   ```

2. **When discovering new work**: During fact-checking, you may discover:
   - Organizations, awards, or other entities that need Wikidata items
   - Related claims that need separate verification
   - Conflicts with existing data that need investigation

   Create subissues or new issues for these:
   ```bash
   chainlink subissue [parent-issue-id] "Create item: [Entity Name]"
   ```

### Session Workflow

```bash
# Start session - see previous handoff notes
chainlink session start

# Set current working issue
chainlink start [issue-id]

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
  - `extract_item_reference_urls(item)` extracts all P854 reference URLs from serialized item claims
  - Enriched snapshots include `parsed_edit`, `item`, and `removed_claim` keys per edit
- `scripts/fetch_labeled_edits.py` -- Historical edit fetcher for labeled evaluation datasets. Builds ground-truth-labeled snapshots by querying Wikidata's RecentChanges API. Key capabilities:
  - `EditSource` protocol for pluggable data sources (currently: `RecentChangesSource`)
  - Dual-query strategy for reverted edits: Pool A (mw-reverted tag) + Pool B (trace-back from mw-rollback/mw-undo)
  - Survived pool: edits with 14+ day survival window, split by patrol status
  - Self-revert and edit-war filtering to remove ambiguous labels
  - Reuses `fetch_patrol_edits.py` enrichment pipeline (enrich_edit_group, LabelCache, etc.)
  - Output: enriched snapshot YAML with `ground_truth` key per edit (label: "reverted"/"survived", evidence type)
  - Saves to `logs/wikidata-patrol-experiment/labeled/`
- `scripts/tool_executor.py` -- Provides `web_search()` (via local SearXNG) and `web_fetch()` (via httpx + trafilatura) for model-agnostic tool calling. Respects `config/blocked_domains.yaml`, rate-limits fetches.
  - **Query-aware `web_fetch(url, query=None)`** (added 2026-04-08): when a query is passed, returns the page lead (first 2500 chars) plus paragraphs containing query terms, capped at ~9000 chars. Without a query, falls back to a 5000-char head-of-page snapshot. The query lets the model retrieve the relevant part of a long page (e.g. "Belgium" for a place-of-birth claim) instead of blind-truncating Wikipedia's intro.
  - `_extract_query_matches()` supports comma-separated multi-term queries; does whole-word match for single tokens and substring match for phrases.
- `scripts/run_verdict_fanout.py` -- Multi-model verdict runner via OpenRouter. Two-phase execution per edit: Phase A (investigation with tool-calling loop, max 15 turns) then Phase B (structured JSON verdict extraction). Features:
  - Runs edits from enriched snapshots across configurable model list
  - Interleaved execution order (all models per edit before moving to next edit)
  - **Checkpoint key is `revid`, not `rcid`** (changed 2026-04-08): rcid is None for ~21% of labeled-eval edits (all Pool B trace-back reverts fetched via revision-history API rather than RecentChanges). Keying state on rcid caused silent deduplication. `load_checkpoint` still accepts old rcid-keyed entries via fallback.
  - Per-verdict 180s wall-clock timeout
  - Cost tracking via OpenRouter generation endpoint
  - Verdicts saved to `logs/wikidata-patrol-experiment/verdicts-fanout/`
  - 500-edit run completed 2026-02-22: 1,854 verdicts, 29 timeouts, 3 errors, $39.27 total cost. Retroactively labeled 2026-04-05 (see `docs/preliminary-results-2026-04.md`)
  - **Current default model lineup (as of 2026-04-08):** Mistral Small 3.2, OLMo 3.1, Nemotron 3 Nano (note: Nemotron is weak at scale; see caveat below). Gemma 3 4B was dropped — no Gemma 3 variant on OpenRouter supports tool calling. The Sarabadani/Halfaker-comparable "Cheap-3" ensemble is Mistral Small + OLMo + DeepSeek V3.2 (the lineup from the 500-edit run).
  - **`MODELS_NO_RESPONSE_FORMAT` set** (2026-04-08): Nemotron's only OpenRouter provider (DeepInfra) rejects `response_format=json_object` at runtime despite advertising support. Phase B omits response_format for these models and relies on prompt + fence-stripping JSON parsing.
  - **`MODEL_EXTRA_BODY` map** (2026-04-08): per-model `extra_body` passed on every chat.completions call. Used to disable reasoning on hybrid-thinking models via `{"reasoning":{"enabled":false}}` (Nemotron 3 Nano, Gemma 4 31B are both hybrid-thinking and produce empty `content` with reasoning enabled). For Gemma 4, also sets `{"provider":{"require_parameters":true}}` to steer routing.
  - **Item context budget reduced to 15% of context window** (was 40%, 2026-04-08): item context YAML was blowing past Mistral's 131k context limit on edits with large item claim sets. Essential sections (diff, parsed_edit, removed_claim) are always included separately.
  - **Defensive handling of `response.choices = None`** (2026-04-08): some OpenRouter providers (notably Novita for Gemma 4) return a response with choices=None mid-investigation. The investigation loop now exits cleanly with `finish_status="empty_response"` rather than crashing.
  - `--eval` flag: evaluation mode that strips `ground_truth` from edits before sending to models, and uses `config/blocked_domains_eval.yaml` (blocks wikidata.org to prevent label leakage)
  - `build_edit_context` supports `context_budget` parameter for truncation, includes `edit_diff` and `prefetched_references` sections, prioritizes edited property claims when truncating item context
- `scripts/prefetch_search_refs.py` (added 2026-04-08) -- Eager pre-enrichment script that runs `web_search` + `web_fetch` per edit and populates `prefetched_references` before the fanout runs. Intended to reduce per-edit turn counts by front-loading the common investigation work across all models in the ensemble. **Not yet validated at scale**: the 10-edit test run returned zero results because SearXNG's upstream engines (Brave, DuckDuckGo, Google) were all rate-limit-suspended after heavy testing.
- `scripts/analyze_verdicts.py` -- Metrics computation for labeled evaluation. Joins verdict YAML files with ground-truth snapshot, computes per-model and ensemble metrics. Features:
  - Verdict-to-binary mapping: accept (verified-high/low, plausible), reject (incorrect, suspect), abstain (unverifiable)
  - Per-model confusion matrix, precision on accept, recall on reject
  - PR-AUC via ordinal verdict scale (0-5)
  - Filter Rate at Recall (FR@99%, FR@90%): what fraction of edits can be auto-accepted while catching N% of bad edits
  - Ensemble strategies: majority vote and unanimous accept
  - Open-model-only ensemble variant (excludes Claude/Anthropic models)
  - Breakdowns by evidence type, diff type, and Wikidata property
  - Output: YAML analysis file to `logs/wikidata-patrol-experiment/analysis/`
- `notebooks/verdict_analysis.ipynb` -- Jupyter notebook for visualizing analysis results with matplotlib/seaborn (confusion matrices, PR curves, model comparisons)
- `config/sift_prompt_openrouter.md` -- Model-agnostic SIFT prompt for the verdict fanout (no Claude-specific features)
- `config/blocked_domains_eval.yaml` -- Extended blocked domains for evaluation mode (adds wikidata.org to prevent label leakage)
- `docker-compose.yml` -- SearXNG + Valkey containers for local web search (SearXNG on `localhost:8080`, config in `config/searxng/`)
- Requires `OPENROUTER_API_KEY` env var for verdict fanout runs
- Requires `scikit-learn` and `numpy` for analyze_verdicts.py; `matplotlib`, `seaborn`, and `jupyter` as dev dependencies
- `docs/hard-patrol-problems.md` -- Analysis of 72 split-decision edits from the 500-edit fanout where models genuinely disagree. Categorizes 10 types of hard patrol problems (disambiguation, ontological modeling, source hierarchy disputes, etc.)
- `docs/preliminary-results-2026-04.md` -- Full preliminary results report with ground-truth evaluation, ensemble metrics, cost analysis, and planned 2000-edit re-run. **Updated 2026-04-08** with PR-AUC/ROC-AUC numbers and head-to-head comparison with Sarabadani et al. 2017.
- `docs/wikicredcon-lightning-talk-2026.md` -- 3-slide lightning talk for WikiCredCon 2026, Marp format. Visually sparse slides; speaker notes carry the detail.
- `docs/wikicredcon-lightning-talk-companion.md` -- Companion web page for the lightning talk with all numbers, tables, false positive / false negative analysis, Sarabadani comparison, prompt design notes, and reproducibility instructions.
- `scripts/label_existing_edits.py` -- Retroactive ground truth labeling: queries Wikidata API to check if revisions were reverted (mw-reverted tag) or deleted. Outputs labeled snapshot YAML.
- Single-model edit-centric SIFT verification: `skills/sift-patrol/SKILL.md` (used for the 50-edit Sonnet 4.6 run)

### Next: Codifying Patrol Knowledge (chainlink #42)

Meta-issue for building deterministic pre-filters from fanout findings. Key sub-issues:
- #41: Typological vandalism detection — value type mismatches, temporal impossibility, absurd numerics
- #43: Pre-LLM reference fetch — verify cited source mentions claim terms before invoking LLM
- #44: Property format validation — regex/constraint checks derived from fanout data
- #45: Edit spree detection — if any edit in a batch fails type-checking, flag the whole batch
- #46: New vs established items risk disparity (brainstorm)
- #47: Research Wikidata best practices for Wikipedia-as-source references

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

# Start SearXNG for verdict fanout web search (uses podman, not docker)
podman compose up -d                # start SearXNG + Valkey
podman compose down                 # stop containers

# Fetch labeled evaluation dataset
python scripts/fetch_labeled_edits.py --dry-run                                          # preview without saving
python scripts/fetch_labeled_edits.py --reverted 250 --survived 250                      # default sizes
python scripts/fetch_labeled_edits.py --reverted 1000 --survived 1000 --max-qid 130000000 --enrich  # large run, no new items

# Retroactively label an existing snapshot
python scripts/label_existing_edits.py --snapshot logs/.../snapshot/SNAPSHOT.yaml --dry-run
python scripts/label_existing_edits.py --snapshot logs/.../snapshot/SNAPSHOT.yaml

# Load API key from .env (gitignored)
export $(cat .env | xargs)

# Run verdict fanout (requires OPENROUTER_API_KEY and SearXNG running)
python scripts/run_verdict_fanout.py --snapshot logs/wikidata-patrol-experiment/snapshot/SNAPSHOT.yaml --dry-run
python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --limit 3  # first 3 edits
python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --models deepseek/deepseek-v3.2  # single model
python scripts/run_verdict_fanout.py --snapshot LABELED.yaml --eval      # evaluation mode (blocks wikidata.org, strips ground truth)

# Analyze verdicts against ground truth
python scripts/analyze_verdicts.py --verdicts-dir logs/.../verdicts-fanout/ --ground-truth logs/.../labeled/snapshot.yaml
python scripts/analyze_verdicts.py --verdicts-dir DIR --ground-truth FILE --output analysis.yaml

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
