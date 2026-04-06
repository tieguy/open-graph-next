#!/usr/bin/env python3
"""Evaluation using only cheap open models (no Claude)."""

import yaml
import collections
from pathlib import Path

gt_snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml'))
gt = {}
gt_evidence = {}
for e in gt_snap['edits']:
    gt[e['revid']] = e['ground_truth']['label']
    gt_evidence[e['revid']] = e['ground_truth']['evidence']

vdir = Path('logs/wikidata-patrol-experiment/verdicts-fanout')
verdicts = []
for f in sorted(vdir.glob('*.yaml')):
    v = yaml.safe_load(open(f))
    if not v:
        continue
    model = v.get('model') or ''
    if 'nemotron' in model or 'claude' in model:
        continue
    verdicts.append(v)


def verdict_to_decision(v):
    if v in ('verified-high', 'verified-low', 'plausible'):
        return 'accept'
    elif v in ('incorrect', 'suspect'):
        return 'reject'
    return 'abstain'


by_revid = collections.defaultdict(list)
for v in verdicts:
    by_revid[v['revid']].append(v)

# Exclude deleted revisions, require all 3 cheap models
complete = {}
for rid, vs in by_revid.items():
    not_deleted = gt_evidence.get(rid) != 'revision-deleted'
    if len(vs) == 3 and rid in gt and not_deleted:
        complete[rid] = vs

gt_dist = collections.Counter(gt[rid] for rid in complete)
print(f'Edits (3 cheap models, excluding deleted): {len(complete)}')
print(f'Ground truth: {dict(gt_dist)}')
print(f'Base rate: {gt_dist["reverted"]}/{len(complete)} = {gt_dist["reverted"]/len(complete):.1%} bad')

# Cost info
cost_by_model = collections.defaultdict(float)
count_by_model = collections.defaultdict(int)
for f in sorted(vdir.glob('*.yaml')):
    v = yaml.safe_load(open(f))
    if v and v.get('cost_usd'):
        model = v.get('model', '')
        short = model.split('/')[-1][:35]
        cost_by_model[short] += v['cost_usd']
        count_by_model[short] += 1

print('\n=== Cost breakdown (full run) ===')
total = 0
for m, c in sorted(cost_by_model.items()):
    n = count_by_model[m]
    print(f'  {m:35s} ${c:6.2f}  ({n} verdicts, ${c/n:.4f}/verdict)')
    total += c
print(f'  {"TOTAL":35s} ${total:6.2f}')
cheap_total = sum(c for m, c in cost_by_model.items() if 'claude' not in m and 'nemotron' not in m)
claude_total = sum(c for m, c in cost_by_model.items() if 'claude' in m)
print(f'  {"CHEAP MODELS ONLY":35s} ${cheap_total:6.2f}  ({cheap_total/total:.0%} of total)')
print(f'  {"CLAUDE ONLY":35s} ${claude_total:6.2f}  ({claude_total/total:.0%} of total)')

# Ensemble strategies
for name, threshold in [('Unanimous accept (all 3)', 3), ('2+ accept', 2)]:
    tp = fp = tn = fn = unc_good = unc_bad = 0
    for rid, vs in complete.items():
        decisions = [verdict_to_decision(v['verdict']) for v in vs]
        n_accept = sum(1 for d in decisions if d == 'accept')
        n_reject = sum(1 for d in decisions if d == 'reject')

        if n_accept >= threshold:
            decision = 'accept'
        elif n_reject >= 1:
            decision = 'reject'
        else:
            decision = 'uncertain'

        actual = gt[rid]
        if decision == 'accept' and actual == 'survived':
            tp += 1
        elif decision == 'accept' and actual == 'reverted':
            fp += 1
        elif decision == 'reject' and actual == 'reverted':
            tn += 1
        elif decision == 'reject' and actual == 'survived':
            fn += 1
        elif actual == 'survived':
            unc_good += 1
        elif actual == 'reverted':
            unc_bad += 1

    total_bad = sum(1 for r in complete if gt[r] == 'reverted')
    auto_accepted = tp + fp
    prec = tp / auto_accepted if auto_accepted > 0 else 0
    human_review = fn + unc_good + tn + unc_bad

    print(f'\n=== {name} ===')
    print(f'  Auto-accept: {auto_accepted}/{len(complete)} ({auto_accepted/len(complete):.1%} of edits)')
    print(f'  Precision: {prec:.1%} ({fp} bad edits slip through out of {total_bad})')
    print(f'  Bad edits caught: {total_bad - fp}/{total_bad} ({(total_bad-fp)/total_bad:.1%})')
    print(f'  Human review queue: {human_review} edits ({human_review/len(complete):.1%})')

# Single model
print('\n=== Single model performance (cheap only) ===')
models = sorted(set(v['model'] for v in verdicts))
for model in models:
    tp = fp = tn = fn = ab_g = ab_b = 0
    for rid, vs in complete.items():
        mv = [v for v in vs if v['model'] == model]
        if not mv:
            continue
        d = verdict_to_decision(mv[0]['verdict'])
        actual = gt[rid]
        if d == 'accept' and actual == 'survived':
            tp += 1
        elif d == 'accept' and actual == 'reverted':
            fp += 1
        elif d == 'reject' and actual == 'reverted':
            tn += 1
        elif d == 'reject' and actual == 'survived':
            fn += 1
        elif actual == 'survived':
            ab_g += 1
        else:
            ab_b += 1
    total_bad = tn + fp + ab_b
    if total_bad:
        prec = tp / (tp + fp) if (tp + fp) else 0
        short = model.split('/')[-1][:30]
        print(f'  {short:30s} prec={prec:.1%}  auto-accept={tp+fp}/{len(complete)}  FP={fp}/{total_bad}  catch={1-fp/total_bad:.1%}')
