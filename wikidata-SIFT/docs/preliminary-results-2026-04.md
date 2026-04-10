# LLM-Assisted Wikidata Patrol: Preliminary Results

April 2026 · updated 2026-04-08 with PR-AUC/ROC-AUC analysis and Sarabadani 2017 head-to-head

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

## Addendum 2026-04-08: PR-AUC / ROC-AUC analysis

Computed from the 500-edit run, cleaned subset of 139 edits with complete 3-model verdicts (Q138* deleted/promotional items excluded via title-prefix proxy, positive class rate 20.1%).

PR-AUC is computed over the six-class verdict ordinal (verified-high=0, verified-low=1, plausible=2, unverifiable=3, suspect=4, incorrect=5) normalized to [0,1] as "P(bad)". The ensemble score is the sum of per-model ordinals (16 discrete levels).

### Per-model fitness

| Model | PR-AUC | ROC-AUC |
|---|---|---|
| Mistral Small 3.2 | 0.381 | 0.739 |
| DeepSeek v3.2 | 0.458 | 0.809 |
| OLMo 3.1 32B | 0.478 | 0.814 |
| **Ensemble (sum of ordinals)** | **0.510** | **0.826** |

### Head-to-head with Sarabadani et al. 2017

[Sarabadani, Halfaker & Taraborelli, *Building Automated Vandalism Detection Tools for Wikidata*, WWW Companion 2017](https://wikiworkshop.org/2017/papers/p1647-sarabadani.pdf) is the canonical Wikidata-specific vandalism detection baseline. Their Random Forest classifier's reported fitness by feature subset (from their Table 3, test set: 99,222 revisions, positive class rate ~2.77%):

| Feature set | ROC-AUC | PR-AUC |
|---|---|---|
| general only | 0.777 | 0.010 |
| general + context | 0.803 | 0.013 |
| general + type + context *(content-only)* | **0.813** | **0.014** |
| general + user | 0.927 | 0.387 |
| all (with user features) | **0.941** | **0.403** |

The most striking finding in Sarabadani is the collapse of PR-AUC from 0.403 → 0.014 when user-status features (anonymous? account age? advanced rights group? bot?) are removed. The paper's conclusion explicitly acknowledges this:

> *"Our classification model is strongly weighted against edits by anonymous and new contributors to Wikidata, regardless of the quality of their work. While this may be an effective way to reduce patrollers' workload, it is likely not fair to these users that their edits be so carefully scrutinized."*
> — Sarabadani et al. 2017, §8 Conclusion

### The fair single-number comparison: ROC-AUC on content-only signal

PR-AUC is sensitive to class balance (our 20.1% positive vs Sarabadani's 2.77%) and quantization (our 6-class ordinal vs their continuous RF probabilities), so raw PR-AUC comparison is misleading. **ROC-AUC is much less sensitive to base rate** and is the right single-number comparison.

| System | Signal used | ROC-AUC |
|---|---|---|
| Sarabadani 2017, all features (user profiling) | content + user status | **0.941** |
| Sarabadani 2017, content-only | content only | **0.813** |
| **SIFT-Patrol Cheap-3 ensemble** | **content only** | **0.826** |

On content-only signal — no editor profiling — the Cheap-3 ensemble slightly edges the 2017 Wikidata vandalism RF (0.826 vs 0.813). With user-status features added, the 2017 model jumps to 0.941. We pay compute (~$0.02 per edit, ~30 seconds of tool-calling) to match the content-only baseline **without ever seeing who made the edit**.

### Label-noise context (from the same paper)

Sarabadani's §3.1 reports label reliability for Wikidata revert-based ground truth:

- **86% of rollback-reverted edits** are actually vandalism (14% label noise)
- **62% of restore-reverted edits** are actually vandalism (38% label noise)

A more recent finding from the Graph2Text 2025 paper (arXiv:2505.18136): **42.3% of initially-reverted edits are actually clean** once you filter out self-reverts, edit wars, and reverted reverts.

Our 96.6% precision is measured against a label set that is itself only ~60–90% reliable depending on filtering. A perfect classifier cannot achieve 100% precision against this kind of ground truth. Sarabadani's own §7 manual validation on a 10k-edit random sample found 99% filter rate at 100% recall against clean human labels — substantially better than their 89% recall against revert labels — and attributes the gap entirely to label noise.

**The ceiling of this research direction isn't model capability, it's label quality.**

---

## 2000-edit re-run: in progress, with lessons (updated 2026-04-08)

A larger replication is prepared and partially executed. Status and lessons:

### Dataset: `logs/wikidata-patrol-experiment/labeled/2026-04-06-071054-labeled-eval.yaml`

- 2000 labeled edits (1000 reverted, 1000 survived), `--max-qid 130000000` to exclude newly-created items.
- Fetched via `fetch_labeled_edits.py` with dual-query strategy: Pool A (mw-reverted tag) + Pool B (trace-back from mw-rollback/mw-undo).
- **Gotcha**: 421 edits (21%) have `rcid=None` — all from Pool B. Pool B fetches via revision-history API, not RecentChanges, so there's no rcid. The fanout script now keys state on `revid` (always populated) instead.

### Model-selection journey and the final lineup

The April 5 plan was to drop Claude Haiku + DeepSeek (too expensive for the reliability they added) and replace them with Nemotron 3 Nano + Gemma 3 4B as "cheaper, newer open models." **Both replacements failed under load testing:**

- **Gemma 3 4B**: No Gemma 3 variant on OpenRouter supports tool calling at all. Unusable for this two-phase protocol. Dropped.
- **Nemotron 3 Nano**: Multiple problems stacked. (1) DeepInfra (the only provider) rejects `response_format=json_object` at runtime despite advertising it — worked around by skipping response_format for Nemotron in Phase B. (2) It's a hybrid-thinking model — Phase A returns empty `content` unless `reasoning:{enabled:false}` is set in extra_body. (3) Even with both fixes, at scale Nemotron produces **78% MAX_TURNS exhaustion and 89% unverifiable verdicts** — essentially no ensemble signal. Unclear whether reasoning-disabled mode gives the model enough direction to converge within 15 turns. Kept in the script for experimentation but **not recommended for production runs.**
- **Qwen small-variants tested** (2.5 7B, 3 8B, 3.5 9B): all either broke on `tool_choice="required"` routing, are hybrid-thinking and fail Phase B silently, or require workarounds comparable to Nemotron's.
- **Llama 3.1 8B**: hallucinates sources, ignores `tool_choice="required"` — unsafe.
- **Gemma 4 31B** (released 2026-04-02): technically supports tool calling, but the Novita provider returns `choices=None` mid-investigation on longer tool loops. Worked in isolated smoke tests, failed 4/5 in the fanout. Not yet usable.

**Recommended lineup: Mistral Small 3.2 + OLMo 3.1 + DeepSeek V3.2** — the original Cheap-3 from the 500-edit run. Known-good, analyzed in the main body of this report, no runtime quirks.

### Script improvements that landed during the re-run work

All in `scripts/run_verdict_fanout.py` and `scripts/tool_executor.py`:

1. **State key change: `rcid` → `revid`** (fixes 21% silent dedup on Pool B edits).
2. **Query-aware `web_fetch(url, query)`**: returns page lead + paragraphs matching query terms (e.g. "Belgium" for a place-of-birth verification). Replaces the blind 15000-char truncation with 2500-char lead + up to ~6500 chars of relevant excerpts, capped at ~9000 chars total. Reduces per-fetch token cost while preserving buried facts.
3. **Item context budget: 40% → 15%** of context window. Mistral was hitting >100% of its 131k window on edits with large item claim sets.
4. **`MODELS_NO_RESPONSE_FORMAT` set**: Phase B skips `response_format=json_object` for providers that reject it at runtime.
5. **`MODEL_EXTRA_BODY` map**: per-model extra_body for reasoning-disable and provider routing. Currently configured for Nemotron and Gemma 4.
6. **Defensive guard on empty `response.choices`**: cleanly exits investigation loop with `finish_status="empty_response"` instead of crashing. Mitigates Novita provider flakiness.
7. **None-safe sort in `save_checkpoint`**: handles None state keys gracefully.

### New script: `prefetch_search_refs.py`

Eager pre-enrichment: runs one `web_search` + top-3 `web_fetch` per edit to populate `prefetched_references` before the fanout. Intended to reduce per-edit turn counts (average 7.4 turns on Mistral, with 14% MAX_TURNS rate) by front-loading the work that every model otherwise repeats. **Not yet validated at scale** — the initial 10-edit test returned zero results because SearXNG's upstream engines (Brave, DuckDuckGo, Google) were all rate-limit-suspended after heavy debugging. Worth retrying when SearXNG is fresh.

### Process lesson: validation gate before long runs

One failed launch of this re-run produced ~628 Nemotron verdicts before the signal-quality problem was caught. The mistake: after fixing Nemotron's config errors, a 3-edit smoke test was used to validate ("reasoning disabled, returns valid JSON, no crashes"). That sample was too small to notice the 2/3 MAX_TURNS rate that became the 78% MAX_TURNS rate at scale. **Treat the first 20-50 edits of any multi-model batch run as a mandatory inspection window**: look at per-model verdict distributions, MAX_TURNS rate, null-result rate, rationale quality on a few samples. Only launch the long run after explicitly confirming "this looks like signal," not just "no errors thrown."

### Commands to execute (updated for current recommended lineup)

```bash
# 1. Fetch pre-labeled historical edits (already done; snapshot committed)
# WITH_EXTENSION=0 uv run python scripts/fetch_labeled_edits.py \
#   --reverted 1000 --survived 1000 --enrich --max-qid 130000000

# 2. Start SearXNG (podman, not docker)
podman compose up -d
# Verify engines are responsive: curl -s 'http://127.0.0.1:8080/search?q=test&format=json' | jq .unresponsive_engines
# If engines are suspended, wait or restart containers.

# 3. Run verdict fanout in eval mode with the Cheap-3 lineup
export $(cat .env | xargs)
nohup WITH_EXTENSION=0 uv run python scripts/run_verdict_fanout.py \
  --snapshot logs/wikidata-patrol-experiment/labeled/2026-04-06-071054-labeled-eval.yaml \
  --models mistralai/mistral-small-3.2-24b-instruct allenai/olmo-3.1-32b-instruct deepseek/deepseek-v3.2 \
  --eval > fanout-run-2.log 2>&1 &

# 4. Inspect the first ~50 verdicts before trusting the long run
tail -f fanout-run-2.log
# Check per-model distribution and MAX_TURNS rate:
# python3 -c "..." (see memory: feedback_validation_gate_before_long_runs.md for the pattern)

# 5. Analyze against ground truth (labels already in snapshot)
WITH_EXTENSION=0 uv run python scripts/analyze_verdicts.py \
  --verdicts-dir logs/wikidata-patrol-experiment/verdicts-fanout/ \
  --ground-truth logs/wikidata-patrol-experiment/labeled/2026-04-06-071054-labeled-eval.yaml
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
