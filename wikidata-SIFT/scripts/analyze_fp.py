#!/usr/bin/env python3
"""Analyze false positives from cheap-model ensemble."""

import yaml
import collections
from pathlib import Path

gt_snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml'))
gt = {e['revid']: e['ground_truth'] for e in gt_snap['edits']}

snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/snapshot/2026-02-20-filtered-no-p18.yaml'))
edit_by_revid = {e['revid']: e for e in snap['edits']}

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

complete = {}
for rid, vs in by_revid.items():
    is_deleted = gt.get(rid, {}).get('evidence') == 'revision-deleted'
    if len(vs) == 3 and rid in gt and not is_deleted:
        complete[rid] = vs

# FPs at 2+ threshold
print("=== FALSE POSITIVES (2+ cheap models accept, actually reverted) ===\n")
fps = []
for rid, vs in sorted(complete.items()):
    if gt[rid]['label'] != 'reverted':
        continue
    decisions = [verdict_to_decision(v['verdict']) for v in vs]
    n_accept = sum(1 for d in decisions if d == 'accept')
    if n_accept >= 2:
        fps.append((rid, vs))

print(f"Total FPs at 2+ threshold: {len(fps)}\n")

for rid, vs in fps:
    e = edit_by_revid.get(rid, {})
    diff = e.get('edit_diff', {})
    print(f"--- revid {rid} ({e.get('title', '?')}) ---")
    print(f"  User: {e.get('user', '?')}")
    print(f"  Property: {diff.get('property_label', diff.get('property', '?'))}")
    print(f"  Diff type: {diff.get('type', '?')}")
    if diff.get('type') == 'value_changed':
        old_label = diff.get('old_value', {}).get('value_label', diff.get('old_value', {}).get('value', '?'))
        new_label = diff.get('new_value', {}).get('value_label', diff.get('new_value', {}).get('value', '?'))
        print(f"  Old: {old_label}")
        print(f"  New: {new_label}")
    elif diff.get('new_value'):
        nv = diff['new_value']
        print(f"  Value: {nv.get('value_label', nv.get('value', '?'))}")
    print(f"  Ground truth: {gt[rid]}")
    print(f"  Comment: {e.get('comment', '?')[:100]}")
    print(f"  Model verdicts:")
    for v in sorted(vs, key=lambda x: x['model']):
        short = v['model'].split('/')[-1][:25]
        dec = verdict_to_decision(v['verdict'])
        print(f"    {short}: {v['verdict']} ({dec})")
        rationale = v.get('rationale', '')[:300]
        print(f"      {rationale}")
    print()
