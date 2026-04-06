#!/usr/bin/env python3
"""Quick evaluation of existing verdicts against retroactive ground truth."""

import yaml
import collections
from pathlib import Path

# Load ground truth
gt_snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml'))
gt = {}
gt_evidence = {}
for e in gt_snap['edits']:
    gt[e['revid']] = e['ground_truth']['label']
    gt_evidence[e['revid']] = e['ground_truth']['evidence']

# Load verdicts (exclude nemotron - only 9 edits)
vdir = Path('logs/wikidata-patrol-experiment/verdicts-fanout')
verdicts = []
for f in sorted(vdir.glob('*.yaml')):
    v = yaml.safe_load(open(f))
    if v and 'nemotron' not in (v.get('model') or ''):
        verdicts.append(v)


def verdict_to_decision(v):
    if v in ('verified-high', 'verified-low', 'plausible'):
        return 'accept'
    elif v in ('incorrect', 'suspect'):
        return 'reject'
    return 'abstain'


# Group by revid
by_revid = collections.defaultdict(list)
for v in verdicts:
    by_revid[v['revid']].append(v)

# EXCLUDE deleted revisions - models can't assess policy deletions
complete = {}
for rid, vs in by_revid.items():
    if len(vs) == 4 and rid in gt:
        if gt_evidence.get(rid) != 'revision-deleted':
            complete[rid] = vs

gt_dist = collections.Counter(gt[rid] for rid in complete)
print(f'Edits (excluding deleted): {len(complete)}')
print(f'Ground truth: {dict(gt_dist)}')
print(f'Base rate: {gt_dist["reverted"]}/{len(complete)} = {gt_dist["reverted"]/len(complete):.1%} bad')

# Ensemble strategies
for name, threshold in [('Unanimous accept (all 4)', 4), ('3+ accept', 3), ('2+ accept', 2)]:
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

# Single model performance
print('\n=== Single model performance ===')
models = sorted(set(v['model'] for v in verdicts if 'nemotron' not in v['model']))
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

# Also: including deleted (for completeness)
print('\n=== INCLUDING deleted revisions (for reference) ===')
complete_all = {}
for rid, vs in by_revid.items():
    if len(vs) == 4 and rid in gt:
        complete_all[rid] = vs

gt_dist_all = collections.Counter(gt[rid] for rid in complete_all)
total_bad_all = gt_dist_all['reverted']
print(f'Edits: {len(complete_all)}, bad: {total_bad_all} ({total_bad_all/len(complete_all):.1%})')

# Unanimous accept including deleted
tp = fp = 0
for rid, vs in complete_all.items():
    decisions = [verdict_to_decision(v['verdict']) for v in vs]
    if all(d == 'accept' for d in decisions):
        if gt[rid] == 'survived':
            tp += 1
        else:
            fp += 1
prec = tp / (tp + fp) if (tp + fp) else 0
print(f'  Unanimous accept: {tp+fp} edits, precision={prec:.1%}, FP={fp}')
print(f'  Of {fp} false positives: {sum(1 for r in complete_all if gt[r]=="reverted" and gt_evidence[r]=="revision-deleted" and all(verdict_to_decision(v["verdict"])=="accept" for v in complete_all[r]))} are deleted revisions')
