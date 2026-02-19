# wikidata-factcheck-experiment

An experiment by [Luis Villa](https://meta.wikimedia.org/wiki/User:LuisVilla) exploring LLM-assisted fact-checking for Wikidata contributions. I do not expect anyone other than myself will use this, but I provide it here in the interests of transparency.

## Research Questions

1. **Throughput**: If every claim is rigorously fact-checked before submission, what's a realistic rate for creating/updating Wikidata claims?
1. **Validation requirements**: What level of source verification is necessary to meet Wikidata's community standards? Where do LLM confidence levels map to Wikidata's reference requirements?
1. **Prompt engineering**: How should fact-checking prompts (like [CheckPlease](https://checkplease.neocities.org)) be adapted for Wikidata's specific data model and sourcing norms?
1. **Model comparison**: Do different LLMs produce meaningfully different verdicts on the same edits? How do cost, speed, and accuracy trade off?
1. **Next-generation ideation**: If there is going to be a [Gas Town](https://steveklabnik.com/writing/how-to-think-about-gas-town/) for "a world in which every single human being can freely share in the sum of all knowledge", what could/would/should that look like?

## Approach

This project uses Claude Code as a research agent that:

- Applies structured fact-checking (SIFT framework) before any edit
- Records the full provenance chain (sources consulted, confidence levels, verification steps)
- Submits edits via pywikibot with proper references
- Evaluates unpatrolled Wikidata edits for correctness
- Compares multiple models' verdicts on the same edits via OpenRouter

All **write** operations target **test.wikidata.org** only. Read-only access to production Wikidata is used for fetching items, recent changes, and revision diffs.

## Experiments

### Multi-Model Verdict Fanout (active)

Runs the same enriched Wikidata edits through multiple LLMs via OpenRouter to compare verdict quality. Uses a self-hosted SearXNG instance for web search and a two-phase execution model (investigation loop + structured verdict extraction).

- **Design**: `docs/design-plans/2026-02-19-openrouter-verdict-fanout.md`
- **Runner**: `scripts/run_verdict_fanout.py` -- checkpoint/resume, per-verdict timeout, interleaved execution
- **Tools**: `scripts/tool_executor.py` -- `web_search()` via SearXNG, `web_fetch()` via httpx/trafilatura
- **Prompt**: `config/sift_prompt_openrouter.md` -- model-agnostic SIFT prompt
- **Models**: Nemotron, OLMo, DeepSeek V3.2, Claude 4.5 Haiku
- **Logs**: `logs/wikidata-patrol-experiment/verdicts-fanout/`

### SIFT-Patrol Experiment

Evaluates whether LLM-assisted SIFT verification can reliably assess unpatrolled Wikidata edits. Fetches recent statement edits, enriches them with full item context and resolved labels, then applies fact-checking methodology.

- **Design**: `docs/design-plans/2026-02-16-sift-patrol-experiment.md`
- **Script**: `scripts/fetch_patrol_edits.py` -- fetches unpatrolled + control edits with optional `--enrich` flag
- **50-edit run summary**: `logs/wikidata-patrol-experiment/2026-02-19-50-edit-run-summary.md`
- **Logs**: `logs/wikidata-patrol-experiment/`

### Methodology Testing

Tests SIFT methodology accuracy against known Wikidata entities. READ-ONLY (never writes).

- **Design**: `docs/design-plans/2026-01-20-wikidata-methodology-testing.md`
- **Skill**: `skills/wikidata-methodology-testing/SKILL.md`
- **Logs**: `logs/wikidata-methodology-testing/`

### Item Enhancement

Systematically verifies and adds claims to Wikidata test items with SIFT methodology and human approval gates.

- **Design**: `docs/design-plans/2026-01-19-wikidata-enhance-and-check.md`
- **Skill**: `skills/wikidata-enhance-and-check/SKILL.md`
- **Logs**: `logs/wikidata-enhance/`

## Setup

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) for dependency management
- A Wikidata test instance account (create at https://test.wikidata.org)
- Docker or Podman (for SearXNG, required by verdict fanout only)
- An [OpenRouter](https://openrouter.ai/) API key (for verdict fanout only)

### Installation

```bash
uv sync --dev
```

### Configuration

1. Create `user-config.py` in the project root (gitignored):

```python
family = 'wikidata'
mylang = 'test'
usernames['wikidata']['test'] = 'YourTestUsername'
usernames['wikidata']['wikidata'] = 'YourWikidataUsername'
user_agent_description = 'wikidata-SIFT/0.1 (https://github.com/louispotok/open-graph-next)'
```

The `usernames['wikidata']['wikidata']` line configures your production Wikidata account for read access. Logging in gives roughly 10x the anonymous rate limit for API reads -- no separate bot account is needed for read-only work. The `user_agent_description` is injected into the User-Agent header for all pywikibot requests, per [Wikimedia's UA policy](https://meta.wikimedia.org/wiki/User-Agent_policy).

2. Generate bot credentials at https://test.wikidata.org/wiki/Special:BotPasswords
   - Grant permissions: Edit existing pages, Create/edit/move pages, High-volume editing
   - Save the credentials securely
   - These are only needed for **write** operations on test.wikidata.org

3. Create `user-password.py` (gitignored):

```python
('YourTestUsername', BotPassword('YourBotName', 'YourBotPassword'))
```

4. Test the connection:

```bash
uv run python -c "import pywikibot; site = pywikibot.Site('test', 'wikidata'); print(site.logged_in())"
```

### SearXNG Setup (for verdict fanout)

```bash
# Generate settings with secret key
cp config/searxng/settings.yml.template config/searxng/settings.yml
sed -i "s/GENERATE_AND_REPLACE.*/$(openssl rand -hex 32)/" config/searxng/settings.yml

# Start containers
docker compose up -d

# Verify
curl -s 'http://localhost:8080/search?q=test&format=json' | python -m json.tool | head -5
```

## Usage

```bash
# Fetch patrol edits (read-only from production)
uv run python scripts/fetch_patrol_edits.py --dry-run          # preview without saving
uv run python scripts/fetch_patrol_edits.py -u 10 -c 10       # 10 unpatrolled + 10 control
uv run python scripts/fetch_patrol_edits.py -u 5 -c 5 --enrich  # with item enrichment

# Run verdict fanout (requires OPENROUTER_API_KEY and SearXNG running)
uv run python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --dry-run
uv run python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --limit 3
uv run python scripts/run_verdict_fanout.py --snapshot SNAPSHOT.yaml --models deepseek/deepseek-v3.2

# Run tests
uv run pytest                           # all tests (220)
uv run pytest tests/test_enrichment.py  # specific test file
uv run pytest -k "test_name"            # specific test by name
```

## Project Structure

```
├── README.md
├── CLAUDE.md                # Instructions for Claude Code
├── CHANGELOG.md             # Notable changes
├── pyproject.toml           # Project config, dependencies, pytest settings
├── docker-compose.yml       # SearXNG + Valkey containers
├── user-config.py           # pywikibot site configuration (gitignored)
├── user-password.py         # credentials (gitignored)
├── scripts/
│   ├── fetch_patrol_edits.py    # Patrol edit fetcher with enrichment pipeline
│   ├── run_verdict_fanout.py    # Multi-model verdict runner via OpenRouter
│   ├── tool_executor.py         # web_search + web_fetch for model tool calling
│   ├── sift_precheck.py         # Ontological consistency checks
│   ├── verify_qid.py            # Single-item verification
│   ├── analyze_test_results.py  # Test result analysis
│   ├── next_test_entity.py      # Test entity selector
│   └── check_redundancy.py      # Redundancy checker
├── config/
│   ├── blocked_domains.yaml       # Domains that return 403/block scrapers
│   ├── sift_prompt_openrouter.md  # Model-agnostic SIFT prompt
│   └── searxng/                   # SearXNG container config
├── tests/                   # pytest test suite (220 tests)
├── skills/                  # Claude Code skill definitions
├── docs/                    # Methodology, design plans, implementation plans
├── logs/                    # Experiment logs (YAML snapshots, verdicts)
└── prompts/                 # Prompt templates
```

## Status

Active research -- multi-model verdict fanout and patrol edit analysis in progress.

## License

CC0
