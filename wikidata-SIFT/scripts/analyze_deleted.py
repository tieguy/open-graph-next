#!/usr/bin/env python3
"""Analyze deleted revisions from the fanout."""

import yaml
import collections
from pathlib import Path

snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/snapshot/2026-02-20-filtered-no-p18.yaml'))
gt_snap = yaml.safe_load(open('logs/wikidata-patrol-experiment/labeled/2026-02-20-retroactive-labels.yaml'))

gt_evidence = {e['revid']: e['ground_truth']['evidence'] for e in gt_snap['edits']}
edit_by_revid = {e['revid']: e for e in snap['edits']}

deleted_revids = set(r for r, ev in gt_evidence.items() if ev == 'revision-deleted')

# All items with deleted revisions
deleted_items = set()
for rid in deleted_revids:
    e = edit_by_revid.get(rid, {})
    deleted_items.add(e.get('title', '?'))

print("Deleted-revision items:")
for item in sorted(deleted_items):
    edits_for_item = [edit_by_revid[rid] for rid in deleted_revids
                      if edit_by_revid.get(rid, {}).get('title') == item]
    users = set(e.get('user', '?') for e in edits_for_item)
    print(f'  {item}: {len(edits_for_item)} edits by {users}')

all_q138 = all(i.startswith('Q138') for i in deleted_items if i != '?')
print(f'\nAll items are Q138* (newly created ~Feb 2026): {all_q138}')

# Model verdicts on deleted edits
vdir = Path('logs/wikidata-patrol-experiment/verdicts-fanout')
deleted_verdicts = []
for f in sorted(vdir.glob('*.yaml')):
    v = yaml.safe_load(open(f))
    if v and v.get('revid') in deleted_revids and 'nemotron' not in (v.get('model') or ''):
        deleted_verdicts.append(v)

print(f'\nModel verdicts on deleted edits: {len(deleted_verdicts)}')

def verdict_to_decision(v):
    if v in ('verified-high', 'verified-low', 'plausible'):
        return 'accept'
    elif v in ('incorrect', 'suspect'):
        return 'reject'
    return 'abstain'

verdict_dist = collections.Counter(v['verdict'] for v in deleted_verdicts)
decision_dist = collections.Counter(verdict_to_decision(v['verdict']) for v in deleted_verdicts)
print(f'Verdict distribution: {dict(verdict_dist)}')
print(f'Decision distribution: {dict(decision_dist)}')

# What do models say when they accept deleted edits?
accepted_deleted = [v for v in deleted_verdicts if verdict_to_decision(v['verdict']) == 'accept']
print(f'\nModels accepted {len(accepted_deleted)} verdicts on deleted edits')

# By property on accepted-but-deleted
prop_dist = collections.Counter(v.get('property_label', v.get('property', '?')) for v in accepted_deleted)
print(f'Accepted-deleted by property: {dict(prop_dist.most_common(10))}')

# Sample rationales
print('\nSample accepted-but-deleted rationales:')
seen_items = set()
for v in accepted_deleted:
    item = v.get('title', '?')
    if item in seen_items:
        continue
    seen_items.add(item)
    short_model = v['model'].split('/')[-1][:25]
    print(f'\n  [{short_model}] {item} {v.get("property_label", v.get("property","?"))} -> verdict={v["verdict"]}')
    rationale = v.get('rationale', '')[:200]
    print(f'    {rationale}')
    if len(seen_items) >= 5:
        break
