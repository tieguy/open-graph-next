# OpenRouter Verdict Fanout — Phase 6: Enrichment Run and End-to-End Test

**Goal:** Fetch 500 fresh enriched edits as the shared sample, then validate the full pipeline end-to-end with a small sample across all 4 models

**Architecture:** Uses existing `scripts/fetch_patrol_edits.py` with `--enrich` flag to create the shared sample. End-to-end test runs the full pipeline (SearXNG + tool executor + verdict runner) on 2-3 edits across all 4 models via real OpenRouter API calls. Validates verdict YAML output, cost capture, and checkpoint behavior.

**Tech Stack:** Existing fetch_patrol_edits.py pipeline, live SearXNG, live OpenRouter API

**Scope:** Phase 6 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-verdict-fanout.AC4: Full pipeline produces 2000 verdicts
- **openrouter-verdict-fanout.AC4.1 Success:** 500-edit enriched snapshot fetched and saved via existing pipeline
- **openrouter-verdict-fanout.AC4.2 Success:** All 4 models produce verdicts for a small sample (2-3 edits) in end-to-end test
- **openrouter-verdict-fanout.AC4.3 Success:** Verdict YAML files match the trimmed schema with all required fields

---

<!-- START_TASK_1 -->
### Task 1: Fetch 500-edit enriched snapshot

**Verifies:** openrouter-verdict-fanout.AC4.1

**Prerequisites:** This task requires a running pywikibot session with production read access. Ensure `user-config.py` is present and the bot can connect to production Wikidata (read-only).

**Step 1: Fetch and enrich 500 unpatrolled edits**

```bash
cd wikidata-SIFT && uv run python scripts/fetch_patrol_edits.py -u 500 --enrich
```

This will:
- Fetch 500 unpatrolled edits from production Wikidata's RecentChanges API
- Enrich each with item context, parsed edit summaries, resolved labels
- Save to `logs/wikidata-patrol-experiment/snapshot/YYYY-MM-DD-HHMMSS-unpatrolled.yaml`

Expected runtime: 15-30 minutes (due to enrichment HTTP requests).

**Step 2: Verify the snapshot**

```bash
cd wikidata-SIFT && uv run python -c "
import yaml
from pathlib import Path

# Find the most recent snapshot
snapshots = sorted(Path('logs/wikidata-patrol-experiment/snapshot').glob('*-unpatrolled.yaml'))
latest = snapshots[-1]
print(f'Latest snapshot: {latest}')

with open(latest) as f:
    edits = yaml.safe_load(f)

print(f'Edit count: {len(edits)}')
enriched = sum(1 for e in edits if 'parsed_edit' in e)
print(f'Enriched: {enriched}')
print(f'Sample edit keys: {list(edits[0].keys())}')
"
```

Expected: 500 edits, all enriched (have `parsed_edit` key).

**Step 3: Note the snapshot path for the end-to-end test**

Record the exact filename output from Step 2 — it will be passed to the runner in Task 2.

No commit — this is a data artifact, not code.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: End-to-end test with all 4 models

**Verifies:** openrouter-verdict-fanout.AC4.2, openrouter-verdict-fanout.AC4.3

**Prerequisites:**
- SearXNG running (`cd wikidata-SIFT && podman-compose up -d`)
- `OPENROUTER_API_KEY` environment variable set
- 500-edit enriched snapshot from Task 1

**Step 1: Start SearXNG**

```bash
cd wikidata-SIFT && podman-compose up -d
```

Verify with:
```bash
curl -s 'http://localhost:8080/search?q=test&format=json' | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('results',[])),'results')"
```

Expected: Some number of results (> 0).

**Step 2: Run the verdict runner on 2 edits across all 4 models**

```bash
cd wikidata-SIFT && OPENROUTER_API_KEY="$OPENROUTER_API_KEY" uv run python scripts/run_verdict_fanout.py \
  --snapshot logs/wikidata-patrol-experiment/snapshot/[SNAPSHOT_FILENAME] \
  --limit 2
```

Replace `[SNAPSHOT_FILENAME]` with the actual filename from Task 1.

Expected: Runner processes 8 verdict pairs (2 edits x 4 models) with interleaved execution. Each verdict prints progress and result.

**Step 3: Validate verdict YAML files**

```bash
cd wikidata-SIFT && uv run python -c "
import yaml
from pathlib import Path

verdict_dir = Path('logs/wikidata-patrol-experiment/verdicts-fanout')
files = sorted(verdict_dir.glob('*.yaml'))
print(f'Verdict files: {len(files)}')

required_fields = ['rcid', 'title', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'verdict', 'rationale', 'sources', 'model', 'timestamp', 'finish_status', 'turns']

for f in files:
    with open(f) as fh:
        v = yaml.safe_load(fh)
    missing = [field for field in required_fields if field not in v]
    status = 'OK' if not missing else f'MISSING: {missing}'
    print(f'  {f.name}: {v.get(\"verdict\", \"?\")} [{v.get(\"model\", \"?\")}] {status}')
"
```

Expected: 8 verdict files (or fewer if some timed out), each containing all required fields from the trimmed schema.

**Step 4: Validate checkpoint**

```bash
cd wikidata-SIFT && uv run python -c "
import yaml
with open('logs/wikidata-patrol-experiment/fanout-state.yaml') as f:
    state = yaml.safe_load(f)
print(f'Completed pairs: {len(state.get(\"completed\", []))}')
for entry in state.get('completed', []):
    print(f'  rcid={entry[\"rcid\"]} model={entry[\"model\"]}')
"
```

Expected: 8 completed pairs matching the 2 edits x 4 models.

**Step 5: Test resume behavior**

Re-run the same command from Step 2:
```bash
cd wikidata-SIFT && OPENROUTER_API_KEY="$OPENROUTER_API_KEY" uv run python scripts/run_verdict_fanout.py \
  --snapshot logs/wikidata-patrol-experiment/snapshot/[SNAPSHOT_FILENAME] \
  --limit 2
```

Expected: All 8 pairs are skipped (already in checkpoint). Runner completes almost instantly.

**Step 6: Validate model coverage**

```bash
cd wikidata-SIFT && uv run python -c "
import yaml
from pathlib import Path
from collections import Counter

verdict_dir = Path('logs/wikidata-patrol-experiment/verdicts-fanout')
models = Counter()
for f in verdict_dir.glob('*.yaml'):
    with open(f) as fh:
        v = yaml.safe_load(fh)
    models[v.get('model', 'unknown')] += 1

print('Verdicts per model:')
for model, count in sorted(models.items()):
    print(f'  {model}: {count}')
"
```

Expected: Each of the 4 models has 2 verdicts (8 total).

**Step 7: Stop SearXNG**

```bash
cd wikidata-SIFT && podman-compose down
```

**Step 8: Commit any test infrastructure changes**

If any adjustments were needed during end-to-end testing (bug fixes, parameter tweaks), commit them:

```bash
git add -A wikidata-SIFT/scripts/ wikidata-SIFT/tests/
git commit -m "fix: adjustments from end-to-end testing"
```

No commit if no changes were needed.
<!-- END_TASK_2 -->
