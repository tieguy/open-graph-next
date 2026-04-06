# LLM-Assisted Wikidata Patrol: Preliminary Results

April 2026

## Summary

We ran four LLMs against 500 unpatrolled Wikidata edits to evaluate whether cheap, open-weight models can reliably triage the patrol queue. Six weeks later, we retroactively labeled the edits by checking which revisions had been reverted or deleted by human patrollers.

**Headline finding:** An ensemble of three cheap open models (Mistral Small 3.2, OLMo 3.1, DeepSeek v3.2) can auto-accept over half the patrol queue at 97% precision for ~2 cents per edit. The models catch 87-93% of bad edits, depending on the confidence threshold.

## Method

### Data collection

We sampled 500 unpatrolled statement edits from Wikidata's RecentChanges API on February 19-20, 2026. Image (P18) edits were excluded. Each edit was enriched with:

- Full item context (labels, descriptions, all claims)
- Parsed edit diff (old value vs new value, property labels)
- Pre-fetched reference URLs from the item

### Model evaluation

Each edit was evaluated by four models via OpenRouter, using a two-phase protocol:

1. **Investigation phase**: The model receives the edit context and can call `web_search()` (via local SearXNG) and `web_fetch()` (via httpx/trafilatura) to gather evidence. Maximum 15 tool-calling turns, 180-second wall-clock timeout per edit.

2. **Verdict phase**: The model produces a structured JSON verdict with one of six categories: `verified-high`, `verified-low`, `plausible`, `unverifiable`, `suspect`, `incorrect`.

Models used:
- Mistral Small 3.2 24B (via `mistral/mistral-small-3.2-24b-instruct`)
- OLMo 3.1 32B (via `allenai/olmo-3.1-32b-instruct`)
- DeepSeek v3.2 (via `deepseek/deepseek-v3.2`)
- Claude Haiku 4.5 (via `anthropic/claude-4.5-haiku-20251001`)

The SIFT (Stop, Investigate, Find, Trace) framework structures the verification prompt. The full prompt is model-agnostic with no Claude-specific features.

### Ground truth labeling

On April 5, 2026 — six weeks after the edits were made — we queried the Wikidata API to check each revision's status:

- **Survived** (338 edits, 68%): Revision still live, no `mw-reverted` tag.
- **Reverted via mw-reverted** (52 edits, 10%): Tagged as reverted by a human patroller.
- **Revision deleted** (110 edits, 22%): Revision content suppressed/oversighted by admins.

## Results

### The deleted-revision problem

All 110 deleted revisions were on Q138\* items — newly created in February 2026 by 17 users. These are promotional or non-notable items (SEO firms, consulting companies, software tools) that were later deleted by Wikidata administrators for failing notability criteria.

The claims on these items are **factually correct** — the company does exist, the website is real, the business registration number checks out. The models accepted 64% of these edits because they were asked "is this edit correct?" and it was. The problem is that the *item shouldn't exist on Wikidata*, which is a community governance judgment (analogous to Wikipedia's Articles for Deletion), not a fact-checking task.

**We exclude deleted revisions from the main evaluation.** This is methodologically correct — no amount of fact-checking will catch notability violations — but it defines a clear boundary: LLM patrol assistance handles verification of claims on existing items, not notability assessment of new items. New-item review (particularly Q-ids in recently allocated ranges) should be a separate queue with different criteria.

### Main evaluation (excluding deleted revisions)

**216 edits** with complete verdicts from all models: 185 survived (85.6%), 31 reverted (14.4%).

#### Cheap open models only (no Claude Haiku)

| Strategy | Auto-accept | Precision | Bad edits caught |
|---|---|---|---|
| 2+ of 3 models accept | 55.1% of edits | 96.6% | 87.1% |
| Unanimous (all 3) | 31.5% of edits | 97.1% | 93.5% |

#### Single model performance

| Model | Precision | Auto-accept rate | Bad edits missed | Catch rate |
|---|---|---|---|---|
| DeepSeek v3.2 | 96.9% | 59.3% | 4/31 | 87.1% |
| OLMo 3.1 32B | 96.7% | 42.6% | 3/31 | 90.3% |
| Mistral Small 3.2 | 95.3% | 58.8% | 6/31 | 80.6% |

#### Cost

| Model | Total cost | Per verdict | Verdicts |
|---|---|---|---|
| Mistral Small 3.2 | $1.58 | $0.006 | 280 |
| OLMo 3.1 32B | $1.77 | $0.006 | 285 |
| DeepSeek v3.2 | $5.96 | $0.022 | 276 |
| Claude Haiku 4.5 | $29.94 | $0.105 | 286 |
| **3 cheap models** | **$9.32** | **~$0.02/edit** | |
| All 4 models | $39.27 | ~$0.08/edit | |

Claude Haiku was 76% of the total cost and did not improve ensemble precision when added to the three cheap models.

### False positive analysis

At the 2+ accept threshold, 4 bad edits slipped through. None were factual errors the models missed:

1. **Qualifier metadata** (Q105705907): Embassy headquarters location was correct; the revert was about qualifier details (start date or precision), not the fact.

2. **Genuinely ambiguous historical date** (Q2871304): Birth date of Auguste Marceau — May 1 vs March 1, 1806. Sources genuinely conflict. One model abstained, one hedged.

3. **Character-level precision** (Q20013182): "Tascon" vs "Tascón" (missing accent mark). One model caught this; two did not. LLMs are known to be inconsistent at character-level checks.

4. **Wikidata data model mapping** (Q5993198): The cyclist did ride for a Seat team, but the edit pointed to the wrong Q-id. Models verified the fact without catching the ontological mismatch.

These map to categories previously identified in our taxonomy of hard patrol problems: ontological modeling, source hierarchy disputes, and character-level precision. The models succeed at fact-checking and fail at Wikidata-specific data modeling — exactly the boundary you'd expect.

### What the models catch well

Of 31 reverted edits (excluding deleted):

- 25-28 are flagged by at least one model (81-90%)
- Models are strongest on: factually wrong claims, value type mismatches, unsupported references
- Models correctly identify conflicting sources even when they can't resolve the conflict

### What the models miss

- Qualifier and rank errors (the claim is right, the metadata is wrong)
- Character-level precision (accent marks, URL parameters, ID format violations)
- Data model mapping (correct fact, wrong Q-id)
- These are Wikidata-expertise problems, not fact-checking problems

## Limitations

- **Sample size**: 216 evaluable edits (31 reverted) is small. Confidence intervals on precision are wide.
- **Ground truth quality**: "Not reverted after 6 weeks" is a proxy for correctness, not a guarantee. Some bad edits may survive undetected. Conversely, some reverts may be disputed.
- **Single snapshot**: All edits are from a ~24-hour window in February 2026. Edit patterns may vary by time of day, day of week, or seasonal editing campaigns.
- **Selection bias**: Only statement edits were included. Label, description, sitelink, and merge edits are excluded.
- **No cost optimization**: Models received full item context. Truncating context for simple edits could reduce cost significantly.
- **SearXNG dependency**: Web search quality depends on the local SearXNG instance's configuration and upstream search engine availability.

## Planned: larger re-run (April 2026)

A second run is prepared to address sample size and model selection:

- **2,000 edits** (up from 500) to tighten confidence intervals on precision/recall
- **Exclude newly-created items** via `--max-qid 130000000` at fetch time
- **Drop expensive models**: no Claude Haiku ($0.10/verdict, 76% of prior cost), no DeepSeek ($0.02/verdict)
- **New lineup** (4 cheap models, all under $0.01/verdict):
  - Mistral Small 3.2 24B (~$0.006/verdict)
  - OLMo 3.1 32B (~$0.006/verdict)
  - Nemotron 3 Nano 30B (~$0.005/verdict)
  - Gemma 3 4B (~$0.003/verdict, stress test — is 4B sufficient?)
- **Pre-labeled historical edits**: uses `fetch_labeled_edits.py` to collect edits 14-30 days old with ground truth already attached (reverted vs survived). No waiting period needed after fanout.
- **Eval mode**: `--eval` flag strips ground truth before sending to models and blocks wikidata.org to prevent label leakage.
- **Estimated cost**: ~$0.02/edit, ~$40 total for 2,000 edits
- **Estimated runtime**: ~52 hours

Commands to execute:

```bash
# 1. Fetch pre-labeled historical edits (14-30 days old, with ground truth)
#    Excludes newly-created items. Enriches with item context.
WITH_EXTENSION=0 uv run python scripts/fetch_labeled_edits.py \
  --reverted 1000 --survived 1000 --enrich --max-qid 130000000

# 2. Run verdict fanout in eval mode (blocks wikidata.org, strips ground truth)
export $(cat .env | xargs)
podman compose up -d
nohup WITH_EXTENSION=0 uv run python scripts/run_verdict_fanout.py \
  --snapshot logs/wikidata-patrol-experiment/labeled/SNAPSHOT.yaml \
  --eval > fanout-run-2.log 2>&1 &

# 3. Analyze immediately after fanout completes (ground truth already in snapshot)
WITH_EXTENSION=0 uv run python scripts/analyze_verdicts.py \
  --verdicts-dir logs/wikidata-patrol-experiment/verdicts-fanout/ \
  --ground-truth logs/wikidata-patrol-experiment/labeled/SNAPSHOT.yaml
```

## Other next steps

- Test whether a single strong model matches ensemble performance
- Measure the marginal value of web search (some edits may not need it)
- Explore deterministic pre-filters (value type checks, format validation) as a first pass before LLM evaluation

## Reproduction

All code, prompts, verdict logs, and analysis scripts are in the `wikidata-SIFT` directory of the [open-graph-next](https://github.com/tieguy/open-graph-next) repository. Key entry points:

- `scripts/fetch_patrol_edits.py` — snapshot collection
- `scripts/run_verdict_fanout.py` — model evaluation
- `scripts/label_existing_edits.py` — retroactive ground truth labeling
- `config/sift_prompt_openrouter.md` — the verification prompt
