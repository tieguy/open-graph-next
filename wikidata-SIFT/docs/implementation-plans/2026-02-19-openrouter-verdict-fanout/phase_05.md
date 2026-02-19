# OpenRouter Verdict Fanout — Phase 5: Checkpoint/Resume and Timeout

**Goal:** Unattended execution with resilience to interruption, per-verdict timeouts, and interleaved model execution order

**Architecture:** Adds checkpoint/resume to `run_verdict_fanout.py` via a `fanout-state.yaml` file tracking completed `(edit_rcid, model)` pairs. Adds a 3-minute wall-clock timeout per verdict using `threading.Timer`. Implements interleaved execution order (edit 1 x model A, edit 1 x model B, ...) for comparable model coverage on partial runs.

**Tech Stack:** Python stdlib (`threading`, `signal`), PyYAML

**Scope:** Phase 5 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-verdict-fanout.AC3: Unattended execution with checkpoint/resume
- **openrouter-verdict-fanout.AC3.1 Success:** Runner resumes from checkpoint, skipping completed (edit_rcid, model) pairs
- **openrouter-verdict-fanout.AC3.2 Success:** Checkpoint file updated after each successful verdict
- **openrouter-verdict-fanout.AC3.3 Success:** Per-verdict timeout at 180s logs timeout: true and continues to next
- **openrouter-verdict-fanout.AC3.4 Success:** Interleaved execution order gives comparable model coverage on partial runs

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add checkpoint, timeout, and interleaved execution to run_verdict_fanout.py

**Verifies:** openrouter-verdict-fanout.AC3.1, openrouter-verdict-fanout.AC3.2, openrouter-verdict-fanout.AC3.3, openrouter-verdict-fanout.AC3.4

**Files:**
- Modify: `wikidata-SIFT/scripts/run_verdict_fanout.py`

**Implementation:**

Add the following functions and modify `main()`:

**`STATE_PATH`** — Module-level constant:
```python
STATE_PATH = Path("logs/wikidata-patrol-experiment/fanout-state.yaml")
```

**`load_checkpoint(state_path=None)`** — Load completed pairs:
```python
def load_checkpoint(state_path=None):
    """Load checkpoint state from YAML.

    Returns:
        set of (edit_rcid, model) tuples that have been completed.
    """
    path = state_path or STATE_PATH
    if not path.exists():
        return set()
    with open(path) as f:
        data = yaml.safe_load(f)
    if not data or "completed" not in data:
        return set()
    return {(entry["rcid"], entry["model"]) for entry in data["completed"]}
```

**`save_checkpoint(completed, state_path=None)`** — Save checkpoint after each verdict:
```python
def save_checkpoint(completed, state_path=None):
    """Save checkpoint state to YAML.

    Args:
        completed: set of (edit_rcid, model) tuples.
    """
    path = state_path or STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    entries = [{"rcid": rcid, "model": model} for rcid, model in sorted(completed)]
    with open(path, "w") as f:
        yaml.safe_dump({"completed": entries}, f, default_flow_style=False)
```

**`run_with_timeout(func, args, timeout_secs=180)`** — Per-verdict timeout:
```python
import threading

def run_with_timeout(func, args, timeout_secs=180):
    """Run func(*args) with a wall-clock timeout.

    Returns:
        (result, timed_out) tuple. If timed out, result is None.
    """
    result = [None]
    exception = [None]

    def target():
        try:
            result[0] = func(*args)
        except Exception as e:
            exception[0] = e

    thread = threading.Thread(target=target)
    thread.daemon = True
    thread.start()
    thread.join(timeout=timeout_secs)

    if thread.is_alive():
        # Thread still running — timed out.
        # NOTE: The daemon thread continues running in the background
        # (making API calls, consuming tokens) until it completes naturally
        # or the process exits. This is a "move on" mechanism, not a
        # cancellation mechanism. For long investigation loops, multiple
        # timed-out threads could run in parallel. A more robust approach
        # would check a threading.Event flag between turns in the
        # investigation loop, but the simple approach is sufficient for
        # the initial experiment.
        return None, True

    if exception[0]:
        raise exception[0]

    return result[0], False
```

**`build_execution_order(edits, models)`** — Interleaved ordering:
```python
def build_execution_order(edits, models):
    """Build interleaved (edit, model) pairs for comparable model coverage.

    Returns list of (edit, model) tuples ordered as:
    (edit_1, model_A), (edit_1, model_B), ..., (edit_2, model_A), ...
    """
    pairs = []
    for edit in edits:
        for model in models:
            pairs.append((edit, model))
    return pairs
```

**Modify `main()`** to integrate these:

1. Load checkpoint at startup
2. Build interleaved execution order from edits x models
3. For each (edit, model) pair:
   - Check if `(edit["rcid"], model)` is in completed set → skip if so
   - Print progress: `f"[{i+1}/{total}] {edit['title']} {model_slug(model)}... "`
   - Run `run_single_verdict` wrapped in `run_with_timeout`
   - If timed out: create a minimal verdict dict with `timeout: true`
   - Save verdict YAML
   - Add to completed set, save checkpoint
   - Print result: verdict classification or "TIMEOUT"
4. Wrap each per-verdict block in try/except: log the error, continue to next pair
5. At end, print summary: completed count, skipped count, timeout count, error count

**Verification:**
```bash
cd wikidata-SIFT && uv run python run_verdict_fanout.py --help
```

Expected: Help text showing --snapshot, --models, --limit, --dry-run options.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for checkpoint, timeout, and interleaved execution

**Verifies:** openrouter-verdict-fanout.AC3.1, openrouter-verdict-fanout.AC3.2, openrouter-verdict-fanout.AC3.3, openrouter-verdict-fanout.AC3.4

**Files:**
- Modify: `wikidata-SIFT/tests/test_verdict_runner.py` (append new test classes)

**Testing:**

Add test classes to the existing test file:

**`TestCheckpoint`:**
- openrouter-verdict-fanout.AC3.1: Create a checkpoint file with some completed pairs using `save_checkpoint`. Call `load_checkpoint`. Assert the loaded set matches. Then simulate `main()` logic that skips completed pairs.
- openrouter-verdict-fanout.AC3.2: Start with empty checkpoint. Call `save_checkpoint` with one pair. Read the YAML file. Assert it contains the pair. Add a second pair. Assert file now contains both.
- Test empty/missing checkpoint file: `load_checkpoint` on nonexistent path returns empty set.
- Use `tmp_path` fixture for all file operations.

**`TestTimeout`:**
- openrouter-verdict-fanout.AC3.3: Create a function that sleeps for 5 seconds. Call `run_with_timeout` with `timeout_secs=1`. Assert `timed_out` is `True` and result is `None`.
- Test successful execution within timeout: function returns immediately. Assert `timed_out` is `False` and result matches.
- Test exception propagation: function raises ValueError. Assert `run_with_timeout` re-raises it.

**`TestBuildExecutionOrder`:**
- openrouter-verdict-fanout.AC3.4: Pass 2 edits and 3 models. Assert result is [(edit1, modelA), (edit1, modelB), (edit1, modelC), (edit2, modelA), (edit2, modelB), (edit2, modelC)] — edits interleaved by model, not all models for one edit first.

**Verification:**

Run: `cd wikidata-SIFT && uv run pytest tests/test_verdict_runner.py -v`

Expected: All tests pass (both Phase 4 and Phase 5 tests).

**Commit:**

```bash
git add wikidata-SIFT/scripts/run_verdict_fanout.py wikidata-SIFT/tests/test_verdict_runner.py
git commit -m "feat: add checkpoint/resume, per-verdict timeout, and interleaved execution"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
