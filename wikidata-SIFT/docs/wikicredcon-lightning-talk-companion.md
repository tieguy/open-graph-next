# The hallucination machines can help with credibility

**Companion to the WikiCredCon 2026 lightning talk.**
All the numbers, comparisons, failure analysis, and prompt details that
didn't fit on three slides.

**Project:** SIFT-Patrol, part of the [open-graph-next](https://github.com/tieguy/open-graph-next) research project.
**Full preliminary report:** [`docs/preliminary-results-2026-04.md`](preliminary-results-2026-04.md)
**Prompt:** [`config/sift_prompt_openrouter.md`](../config/sift_prompt_openrouter.md)
**Code:** [`scripts/run_verdict_fanout.py`](../scripts/run_verdict_fanout.py)
**Verdict logs:** [`logs/wikidata-patrol-experiment/verdicts-fanout/`](../logs/wikidata-patrol-experiment/verdicts-fanout/)

---

## The 60-second version

We ran three cheap open LLMs (Mistral Small 3.2, OLMo 3.1, DeepSeek v3.2)
on 500 unpatrolled Wikidata statement edits. Six weeks later we
retroactively labeled each edit as reverted or surviving by querying the
Wikidata API. At a 2-of-3 ensemble accept threshold the ensemble
auto-accepts 55% of the patrol queue at 96.6% precision while catching
87% of bad edits, at ~$0.02 per edit.

**The trick**: the prompt forbids the model from reaching any
non-unverifiable verdict based on training data alone. Every source
marked `verified` in the verdict schema must be a URL the model actually
fetched during that session's investigation. The runner verifies this
against the session log. Hand-waving is explicitly called
"citation laundering" and invalidates the verdict.

**The payoff**: when the ensemble is wrong, the errors are not
hallucinations. Every one of the four false positives at the 2-of-3
threshold was a Wikidata-specific editorial judgment problem —
qualifier precision, ambiguous historical dates, missing accent marks,
wrong Q-id mapping — and none of them involved the model inventing a
fact or fabricating a source.

**The fairness pivot**: the 2017 state of the art (Sarabadani et al.,
Building Automated Vandalism Detection Tools for Wikidata) reports a
98% workload reduction at 89% recall, but only because it leans
heavily on user-status features (anonymous, account age, group
memberships). The paper itself concedes this is "not fair to
anonymous and new editors." Strip those features out and the
baseline's PR-AUC collapses from 0.403 to 0.014 — essentially random.
Our system achieves comparable ROC-AUC (0.826 vs 0.813 content-only)
without ever seeing who made the edit, by paying ~$0.02 and ~30
seconds of compute per edit.

---

## Method in one paragraph

500 statement edits were sampled from Wikidata's RecentChanges API on
February 19–20, 2026, excluding P18 (image) edits. Each edit was
enriched with full item context, parsed diff, and pre-fetched reference
URLs. Every edit was then evaluated by four models via OpenRouter
(Mistral Small 3.2, OLMo 3.1, DeepSeek v3.2, and Claude Haiku 4.5 for
comparison) in a two-phase protocol: Phase A is a tool-calling
investigation loop (up to 15 turns of `web_search` via local SearXNG
plus `web_fetch` via httpx/trafilatura, 180s wall-clock timeout), Phase
B produces a structured JSON verdict without any further tool access.
On April 5, 2026 — six weeks after the edits were made — each
revision's status was queried from the Wikidata API: 338 survived
(68%), 52 were reverted via `mw-reverted` (10%), and 110 were deleted
by administrators (22%). All 110 deleted revisions were on items with
Q-ids above Q138000000 — newly created promotional items that were
deleted for failing notability criteria. These are excluded from the
main evaluation because no amount of fact-checking can catch a
notability violation: the claims are factually correct, the items just
shouldn't exist. The main evaluation runs on the remaining 216 edits
(185 survived, 31 reverted) after requiring complete verdicts from all
three cheap open models.

---

## Headline numbers — the 3-model ensemble

### At 2-of-3 accept threshold (the default operating point)

| Metric | Value |
|---|---|
| Auto-accept rate | **55.1%** of the queue |
| Precision on the auto-accepted lane | **96.6%** |
| Recall on bad edits (caught in held-back lane) | **87.1%** |
| False positives (bad edits slipped through) | 4 of 31 |
| Cost per verdict, all 3 models | ~$0.020 |

### At unanimous accept threshold (cautious mode)

| Metric | Value |
|---|---|
| Auto-accept rate | **31.5%** of the queue |
| Precision on the auto-accepted lane | **97.1%** |
| Recall on bad edits (caught in held-back lane) | **93.5%** |

### Per-model fitness on the main eval (216 edits)

| Model | Precision | Auto-accept rate | Catch rate | Cost/verdict |
|---|---|---|---|---|
| DeepSeek v3.2 | 96.9% | 59.3% | 87.1% | $0.022 |
| OLMo 3.1 32B | 96.7% | 42.6% | 90.3% | $0.006 |
| Mistral Small 3.2 | 95.3% | 58.8% | 80.6% | $0.006 |
| Claude Haiku 4.5 | *not shown* | — | — | $0.105 |

Claude Haiku was 76% of the total cost of a 4-model run and added no
measurable precision or recall to the 3-model ensemble. Dropped for
the 2000-edit replication.

---

## Recall at multiple decision rules

Computed from 148 edits (118 survived, 30 reverted) after excluding
deleted-revision items from the main eval. Slightly different from the
prelim doc's 216-edit count because the Q138* filter is a
title-prefix proxy, not the doc's exact deleted-status filter.

| Decision rule | Flagged as bad | Recall on bad | Precision on flagged |
|---|---|---|---|
| Held back from unanimous accept | 74.3% | **93.3%** | 25.5% |
| Any model rejects | 54.1% | 90.0% | 33.8% |
| Not auto-accepted at 2-of-3 *(doc's catch rate)* | 55.4% | **86.7%** | 31.7% |
| 2-of-3 models actively reject | 33.8% | 83.3% | **50.0%** |
| Unanimous reject (all 3) | 16.9% | 46.7% | 56.0% |

**The whole point of this table: recall is tunable.** Pick your
tolerance. Patrol-lane "must catch everything" → held-back lane with
93% recall. Auto-revert bot "must never misfire" → unanimous reject
with 56% precision. Two very different operating envelopes, same
underlying ensemble.

---

## False positives — the 4 edits the ensemble accepted that were reverted

**None were hallucinations. None were factual errors the models missed.
All were Wikidata-modeling judgments that seasoned editors catch in
seconds.**

1. **Q105705907 — embassy headquarters location.** Fact correct; the
   revert was about a qualifier detail (start date or precision), not
   the main claim. LLMs don't have a strong working model of Wikidata
   qualifier semantics.

2. **Q2871304 — Auguste Marceau, French naval officer, b. 1806.**
   Different biographical sources give May 1 and March 1. Both are
   reputable. One model abstained, one hedged, one accepted. The
   ensemble accepted. This is a source-hierarchy dispute, not an
   LLM bug.

3. **Q20013182 — "Tascon" vs "Tascón".** Missing accent mark. LLMs
   are tokenizer-level fuzzy at character precision. One of the three
   models caught this; two did not. Well-studied LLM weakness.

4. **Q5993198 — cyclist's Seat team.** The cyclist did race for a
   Seat team. But the editor linked to the wrong Q-id — almost
   certainly a disambiguation slip. The fact verified cleanly; the
   ontological mapping didn't. The web doesn't know Wikidata's Q-id
   namespace the way the editor community does.

These map to four categories we had already named in
[`docs/hard-patrol-problems.md`](hard-patrol-problems.md): ontological
modeling, source-hierarchy disputes, character-level precision, and
Q-id disambiguation. The models' weaknesses fall exactly on our
existing taxonomy of hard problems.

---

## False negatives — the good edits the ensemble flagged as bad

At the 2-of-3 accept threshold, about **21% of good edits** get
explicitly rejected by the ensemble, plus another **26% land in
uncertain** (mostly "unverifiable" — the model couldn't find a
confirming source). Combined, roughly half of good edits don't get
auto-accepted.

| Edit disposition | Count | Rate |
|---|---|---|
| Bad edits accepted (false positives) | 4/30 | 13.3% |
| Bad edits rejected | 25/30 | 83.3% |
| Bad edits uncertain | 1/30 | 3.3% |
| Good edits accepted | 62/118 | 52.5% |
| **Good edits rejected (false negatives)** | **25/118** | **21.2%** |
| Good edits uncertain | 31/118 | 26.3% |

**What kind of edits get false-negatived?** A quick profile of the 25
false-negative edits:

- 23 of 25 are routine `value_changed` edits — no concentration in a
  weird edit type.
- Properties are scattered: place of birth, place of death, SIREN
  number, TikTok username, official website, employer, languages
  spoken, Google Books ID.
- **No clustering on a specific property class.** It doesn't look like
  "the models are bad at X kind of fact." It looks like "the models
  couldn't find a confirming source within 15 turns."

This is consistent with the infrastructure limitation: SearXNG's
upstream engines are rate-limited by Brave, DuckDuckGo, and Google in
ways we don't fully control. A non-trivial fraction of these false
negatives are likely cases where the search engine returned nothing
useful and the model honestly answered "unverifiable" or "incorrect."
**We probably understate model competence** on the honest-error side.

**Framing for the credibility audience**: in a triage workflow, a
false negative is a cost (more reviewer time), not a harm (no good
edit gets destroyed). The tradeoff is: auto-accept 55% of the queue at
97% precision, and push 45% to human review — including ~21% of good
edits that get unfairly scrutinized. That is still a substantial
workload reduction relative to "review everything," and it's a
tradeoff the community can tune.

---

## Comparison with Sarabadani et al. 2017

[Sarabadani, Halfaker & Taraborelli, *Building Automated Vandalism
Detection Tools for Wikidata*, WWW Companion 2017](https://wikiworkshop.org/2017/papers/p1647-sarabadani.pdf)
is the canonical Wikidata-specific vandalism detection paper. Their
Random Forest classifier achieves a 98% workload reduction at 89%
recall. This is an impressive number. **The paper itself identifies
the catch.**

### Sarabadani 2017 — fitness by feature subset

(Reproduced from Table 3 of the paper, test set: 99,222 revisions,
positive class rate ~2.77%.)

| Feature set | ROC-AUC | PR-AUC | Filter rate at recall |
|---|---|---|---|
| general only | 0.777 | 0.010 | 0.936 @ 0.62 |
| general + context | 0.803 | 0.013 | 0.937 @ 0.67 |
| general + type + context | 0.813 | **0.014** | 0.940 @ 0.68 |
| general + user | 0.927 | 0.387 | 0.985 @ 0.86 |
| **all (with user features)** | **0.941** | **0.403** | **0.982 @ 0.89** |

**The collapse on the content-only row is the story.** Without
user-status features (anonymous? account age? advanced rights group?
bot?), the Wikidata RF baseline's PR-AUC is 0.014 — essentially
random on a 2.77% positive class. The authors' own conclusion:

> *"Our classification model is strongly weighted against edits by
> anonymous and new contributors to Wikidata, regardless of the
> quality of their work. While this may be an effective way to reduce
> patrollers' workload, **it is likely not fair to these users** that
> their edits be so carefully scrutinized."*
> — Sarabadani et al. 2017, §8 Conclusion

### SIFT-Patrol Cheap-3 ensemble — fitness

Computed from our 500-edit run, cleaned to exclude Q138* deleted items.
139 edits with complete 3-model verdicts, positive class rate 20.1%.
PR-AUC is computed from an ordinal scale over the six verdict classes
(`verified-high=0, verified-low=1, plausible=2, unverifiable=3,
suspect=4, incorrect=5`) normalized to [0,1]. Ensemble PR-AUC uses
sum-of-ordinals across the three models as the score (16 discrete levels).

| Model | PR-AUC | ROC-AUC |
|---|---|---|
| Mistral Small 3.2 | 0.381 | 0.739 |
| DeepSeek v3.2 | 0.458 | 0.809 |
| OLMo 3.1 32B | 0.478 | 0.814 |
| **Ensemble (sum of ordinals)** | **0.510** | **0.826** |

### The fair comparison: ROC-AUC on content-only signal

PR-AUC is sensitive to class balance (our 20% positive vs Sarabadani's
2.77% positive) and quantization (our 6-class ordinal vs their
continuous RF probabilities), so raw PR-AUC comparison is misleading.
**ROC-AUC is much less sensitive to base rate** and is the right
single-number comparison across the two datasets.

| System | Signal used | ROC-AUC |
|---|---|---|
| Sarabadani 2017, **all features** (with user profiling) | content + user status | **0.941** |
| Sarabadani 2017, **content-only** (no user features) | content only | **0.813** |
| **SIFT-Patrol Cheap-3 ensemble (this work)** | content only | **0.826** |

**Read the last two rows.** On content-only signal — no editor
profiling — our ensemble slightly beats the 2017 Wikidata vandalism
RF (0.826 vs 0.813). With user-status features added, the 2017 model
jumps to 0.941. We pay compute (~$0.02 per edit, ~30 seconds of
tool-calling) to match the content-only baseline **without ever
seeing who made the edit**.

### Filter-rate framing (the ORES/Sarabadani vocabulary)

| System | Filter rate | Recall | Editor identity |
|---|---|---|---|
| Sarabadani 2017 all-features | 0.982 | 0.89 | Heavy reliance |
| SIFT-Patrol Cheap-3, 2-of-3 accept | 0.551 | 0.87 | **None** |
| SIFT-Patrol Cheap-3, unanimous accept | 0.315 | 0.93 | **None** |

On filter rate alone, Sarabadani wins dramatically. The difference
isn't architectural capability — it's the base rate of the test set
and the user-status crutch. When we strip that crutch, the 2017
baseline is below random and ours is where it is.

---

## Label noise — your ground truth is also wrong

From the same Sarabadani paper, §3.1:

> *"Their qualitative analysis shows that 86% of rollbacked edits
> and 62% of edits reverted using the restore feature were vandalism."*
> — Sarabadani et al. 2017, §3.1 Building a corpus

So **14% to 38% of "human-revert" labels are noise**: good-faith
disagreements, edit wars, content disputes, or good edits misjudged
by the reverter. The Graph2Text 2025 paper [arXiv:2505.18136] reports
an even higher figure: 57.7% of initially-reverted edits were noise
once you filter out self-reverts and edit wars.

**Our 96.6% precision is measured against a label set that is itself
only 62–86% reliable.** A perfect classifier could not achieve 100%
precision on this kind of ground truth. Sarabadani's manual 10k-edit
validation found 99% filter rate at 100% recall against clean human
labels — substantially better than their 89% recall against revert
labels — and attributes the gap entirely to label noise.

For any LLM patrol research in this area, **the ceiling isn't model
capability, it's label quality**. The ceiling is low enough that
cheap open models already bump into it.

---

## How the prompt closes the parametric path

Full prompt: [`config/sift_prompt_openrouter.md`](../config/sift_prompt_openrouter.md)

### Rule 1 — no verdicts from training memory

> *"You MUST call these tools during Steps 2-4. Do not skip
> investigation — never render a verdict based solely on your
> training data. Every claim must be checked against live web
> sources before you assess it."*

### Rule 2 — provenance discipline (the load-bearing constraint)

> *"Only mark a source as `provenance: verified` if you called
> `web_fetch` on that URL during this investigation, or it was in
> `prefetched_references`. If you know about a URL from your training
> data but did not fetch it in this session, mark it as
> `provenance: reported`. Citing a URL from a secondary source's
> bibliography without reading it is **citation laundering**.
> Mismarking provenance invalidates the verdict."*

### Rule 3 — the fairness commitment

> *"**No editor identity signals. We assess the edit on its merits,
> not the editor's reputation.**"*
> — from the Design Notes section of the prompt file

### The SIFT methodology

[Mike Caulfield's](https://www.notion.so/The-Full-SIFT-Method-for-Evaluating-Sources-f0a3e017fb7142609ba92c31cd1fb6b9) four-step lateral-reading heuristic,
originally built for college media literacy. Every step has a
concrete external action attached to it — none of them is "decide
based on what you already know" — which is exactly the property we
need to keep an LLM out of its parametric memory.

- **Stop.** Don't react. Don't render judgment yet.
- **Investigate the source.** Who is saying this? Look at publisher,
  author, venue. Credibility comes from origin, not surface
  plausibility.
- **Find better coverage.** What do other sources say? Independent
  corroboration matters more than any single source.
- **Trace claims, quotes, and media to original context.** Get back
  to the primary source. Reporting on reporting introduces drift.

Our prompt maps Steps 2–4 of the workflow to these four SIFT moves.
Step 5 is the verdict synthesis, which by construction cannot use
web tools — the model writes YAML based only on what was actually
fetched in the investigation phase.

### The verdict scale (six classes)

| Verdict | Meaning |
|---|---|
| `verified-high` | Strong evidence supports the claim (primary source or multiple independent sources) |
| `verified-low` | Some evidence supports, but sources are weak or indirect |
| `plausible` | Claim is consistent with available information but no direct confirmation found |
| `unverifiable` | Cannot find sufficient evidence to confirm or deny. Distinct from "incorrect." |
| `suspect` | Evidence suggests the claim may be incorrect |
| `incorrect` | Clear evidence **directly contradicts** the claim. Not a fallback for "couldn't find a source." |

Any verdict higher than `unverifiable` or `verified-low` requires at
least one source marked `provenance: verified`. No fetch, no verdict.

---

## What this tooling is for — and what it isn't

### It is for

- **Triage volume**, so that scarce reviewer attention reaches the
  citations and edits that actually need human judgment.
- **Source-grounded decisions**, where every verdict carries a
  replayable audit trail of URLs the model actually read.
- **Open, community-runnable infrastructure.** Mistral Small, OLMo,
  and DeepSeek are all open-weight. SearXNG is open source. The code,
  prompts, and verdict logs are all in an open repo. No dependency
  on a frontier API vendor for credibility infrastructure.
- **Reducing the editor-profiling footprint of patrol automation.**
  Existing patrol ML (ORES, Sarabadani) gets most of its signal from
  user-status features that the research community has repeatedly
  flagged as unfair to anonymous and new editors. This approach
  doesn't look at who made the edit.

### It is NOT for

- **Autonomous auto-reverting.** The precision/recall numbers are
  good enough for semi-automated triage with a human in the loop,
  not good enough to bypass human review for disputed edits.
- **Notability assessment.** Whether an item *should* exist on
  Wikidata is a community governance question, not a fact-checking
  question. LLMs happily verified factually-correct claims on 110
  deleted promotional items in our corpus because the facts were
  right — the items just shouldn't have existed.
- **Qualifier semantics, ontological modeling, or character-level
  precision.** These are Wikidata-expertise problems and the failure
  analysis shows LLMs are bad at them. Keep humans on these.
- **Black-box trust.** Every verdict is auditable against the URLs
  the model fetched. The tooling is only useful to the extent that
  the community runs the audit and trusts what they see, not because
  the model is authoritative.

---

## Limitations and caveats

- **Sample size.** 216 evaluable edits (31 reverted) after exclusions.
  Confidence intervals on precision are wide. A 2000-edit replication
  is in progress at the time of this talk.
- **Selection bias.** Statement edits only. Label, description,
  sitelink, and merge edits are excluded.
- **Single time window.** All edits are from a ~24-hour window in
  February 2026. Edit patterns may vary by time of day, day of week,
  or seasonal editing campaigns.
- **Notability blind spot.** The deleted-revision exclusion is
  methodologically correct (LLM fact-checking can't catch notability
  violations) but it defines a clear boundary. New-item review needs
  a separate queue with different criteria.
- **SearXNG dependency.** Web search quality depends on the local
  SearXNG instance's configuration and upstream search engine
  availability. We have observed engine suspensions from Brave,
  DuckDuckGo, and Google during heavy testing that likely depress
  the false-negative numbers in the main eval.
- **Ordinal PR-AUC is quantized.** Our PR-AUC is computed on a 6-class
  ordinal scale normalized to [0,1], not a continuous probability.
  This understates achievable PR-AUC relative to models that emit
  continuous scores. Comparison with Sarabadani's RF PR-AUC (0.403)
  is approximate; ROC-AUC comparison is cleaner.
- **Label noise.** The ground truth (14-day survival vs reverted) is
  itself only 62–86% reliable per Sarabadani 2017 and 42.3% per the
  Graph2Text 2025 paper. A perfect classifier cannot achieve 100%
  precision against this kind of label.

---

## Reproducibility

All of the following are in the [`open-graph-next` repo](https://github.com/tieguy/open-graph-next):

- **Prompt**: [`wikidata-SIFT/config/sift_prompt_openrouter.md`](../config/sift_prompt_openrouter.md)
- **Fanout runner**: [`wikidata-SIFT/scripts/run_verdict_fanout.py`](../scripts/run_verdict_fanout.py)
- **Analysis script**: [`wikidata-SIFT/scripts/analyze_verdicts.py`](../scripts/analyze_verdicts.py)
- **Labeled snapshot**: [`wikidata-SIFT/logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml`](../logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml)
- **Verdict logs**: [`wikidata-SIFT/logs/wikidata-patrol-experiment/verdicts-fanout/`](../logs/wikidata-patrol-experiment/verdicts-fanout/)
- **Preliminary results writeup**: [`wikidata-SIFT/docs/preliminary-results-2026-04.md`](preliminary-results-2026-04.md)
- **Hard-patrol-problems taxonomy**: [`wikidata-SIFT/docs/hard-patrol-problems.md`](hard-patrol-problems.md)

### Required environment

- `uv` for Python dependency management
- SearXNG (via Docker/podman compose) for web search
- OpenRouter API key in `.env`
- scikit-learn, numpy, yaml, httpx, trafilatura

### To reproduce a verdict

```bash
podman compose up -d  # start SearXNG
export $(cat .env | xargs)  # load OPENROUTER_API_KEY

# Run the fanout on a labeled snapshot in eval mode
# (blocks wikidata.org to prevent label leakage, strips ground truth)
WITH_EXTENSION=0 uv run python scripts/run_verdict_fanout.py \
  --snapshot logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml \
  --eval

# Analyze against ground truth
WITH_EXTENSION=0 uv run python scripts/analyze_verdicts.py \
  --verdicts-dir logs/wikidata-patrol-experiment/verdicts-fanout/ \
  --ground-truth logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml
```

Every verdict file records: which URLs the model fetched, what text
came back, which sources it marked verified vs reported, its
rationale, and its final verdict. You can re-read any one of them and
check the reasoning against the retrieved content yourself.

---

## Prior art and lineage

- **Halfaker, Geiger, Morgan & Riedl (2013)** — *The Rise and Decline
  of an Open Collaboration System.* The paper that framed Wikipedia's
  quality control as a socio-technical system and showed the cost of
  efficiency-first design.
- **Geiger & Halfaker (2013)** — *When the Levee Breaks.* Quantified
  how long vandalism lives when automated tools go offline; motivated
  the continued investment in ML patrol assist.
- **Halfaker et al. (2018)** — [*ORES: Lowering Barriers with
  Participatory Machine Learning for Wikipedia*](https://meta.wikimedia.org/wiki/Research:ORES_paper), CSCW.
  The canonical "build an open ML service for Wikipedia" paper.
  Introduced filter-rate-at-recall as the operational metric we use
  in this talk.
- **Sarabadani, Halfaker & Taraborelli (2017)** — [*Building
  Automated Vandalism Detection Tools for Wikidata*](https://wikiworkshop.org/2017/papers/p1647-sarabadani.pdf),
  WWW Companion. The Wikidata-specific predecessor. Honest
  acknowledgment of the user-profiling fairness problem we built
  against.
- **Heindorf, Potthast, Stein & Engels (2015)** — *Towards Vandalism
  Detection in Knowledge Bases.* The WDVC corpus methodology that
  established label-noise as a known limitation of revert-based
  ground truth in Wikidata.
- **Caulfield** — *SIFT: The Four Moves.* The media-literacy heuristic
  we adopted directly as the investigation workflow.

This work is an attempt to continue the open-ML-for-Wikimedia lineage
with a different tradeoff: more compute per edit, no user profiling,
full source auditability.

---

*Preliminary results. A 2000-edit replication is in progress. Critique
welcome — open an issue on the repo or find me at the conference.*
