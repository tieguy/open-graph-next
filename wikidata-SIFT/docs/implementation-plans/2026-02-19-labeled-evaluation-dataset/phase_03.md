# Labeled Evaluation Dataset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a labeled evaluation dataset of ~500 historical Wikidata edits with ground truth labels derived from revert/patrol history.

**Architecture:** A new fetcher script queries pywikibot's RecentChanges API with dual-query strategy (mw-reverted tag + mw-rollback/mw-undo trace-back) for reverted edits, plus a survived pool. Self-revert and edit-war filtering cleans the labels. An `EditSource` protocol enables future Toolforge backends. The fetcher reuses enrichment functions from `fetch_patrol_edits.py`.

**Tech Stack:** Python 3.13, pywikibot, PyYAML, existing enrichment pipeline

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-02-19

**Testing patterns:** pytest with `pythonpath = ["scripts"]`; `unittest.mock` (MagicMock, patch); plain `assert`; `_make_*` helpers; classes grouping related tests; `tmp_path` for file I/O. See `tests/conftest.py` for shared fixtures. Run with `uv run pytest`.

---

## Phase 3: Evaluation Mode

**Goal:** Prevent label leakage during model evaluation runs by blocking wikidata.org from search/fetch and stripping ground truth before prompt construction.

**Key codebase facts (verified by investigation):**
- `config/blocked_domains.yaml` contains 9 domains (wikipedia.org, britannica.com, etc.) with `domains` list of `{domain, reason, note}` dicts
- `load_blocked_domains()` in `tool_executor.py:25` loads from `config/blocked_domains.yaml` relative to project root, returns `set[str]`
- `run_verdict_fanout.py:655` calls `load_blocked_domains()` from `tool_executor` (imported at line 18)
- `is_blocked_domain()` in `tool_executor.py:54` checks exact domain and subdomains
- `run_verdict_fanout.py` main() argparse at line 627 has: `--snapshot`, `--models`, `--limit`, `--dry-run`
- `run_single_verdict()` at line 422 receives the full `edit` dict and passes it to `build_edit_context()`
- Enriched snapshot YAML has top-level `{fetch_date, label, count, edits}` with per-edit `ground_truth` key from Phase 1

### Task 1: Create blocked_domains_eval.yaml config

**Files:**
- Create: `config/blocked_domains_eval.yaml`
- Modify: `tests/test_enrichment.py` (add test)

**Step 1: Write test for eval config loading**

Add to `tests/test_enrichment.py`:

```python
class TestBlockedDomainsEval:
    """Tests for evaluation-mode blocked domain config."""

    def test_eval_config_includes_wikidata(self):
        """Eval config blocks wikidata.org in addition to base domains."""
        from fetch_patrol_edits import load_blocked_domains
        from pathlib import Path

        config_path = Path(__file__).resolve().parent.parent / "config" / "blocked_domains_eval.yaml"
        domains = load_blocked_domains(config_path)

        assert "wikidata.org" in domains

    def test_eval_config_includes_base_domains(self):
        """Eval config still blocks all base domains."""
        from fetch_patrol_edits import load_blocked_domains
        from pathlib import Path

        config_path = Path(__file__).resolve().parent.parent / "config" / "blocked_domains_eval.yaml"
        domains = load_blocked_domains(config_path)

        assert "wikipedia.org" in domains

    def test_wikidata_subdomain_blocked(self):
        """www.wikidata.org is blocked by wikidata.org entry."""
        from fetch_patrol_edits import is_blocked_domain

        domains = {"wikidata.org"}

        assert is_blocked_domain("https://www.wikidata.org/wiki/Q42", domains)
        assert is_blocked_domain("https://wikidata.org/wiki/Q42", domains)
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_enrichment.py::TestBlockedDomainsEval -v`

Expected: FAIL — `config/blocked_domains_eval.yaml` doesn't exist.

**Step 3: Create the eval config file**

Read the existing config to get the base domains, then create the eval version:

Create `config/blocked_domains_eval.yaml`:

```yaml
# Blocked domains for evaluation mode.
# Extends the base blocked_domains.yaml with wikidata.org to prevent
# label leakage during model evaluation runs.
domains:
  - domain: wikidata.org
    reason: label-leakage
    note: >
      Blocked during evaluation to prevent models from reading Wikidata
      directly and discovering whether an edit was reverted or accepted.
  - domain: wikipedia.org
    reason: circular
    note: >
      Wikipedia is a mirror/sister of Wikidata. Information flows both ways,
      making it circular as a verification source.
  - domain: britannica.com
    reason: blocked
    note: Blocks automated access (403/captcha).
  - domain: museodelprado.es
    reason: blocked
    note: Blocks automated access.
  - domain: imdb.com
    reason: blocked
    note: Blocks automated access (requires JavaScript).
  - domain: linkedin.com
    reason: blocked
    note: Requires login for most content.
  - domain: facebook.com
    reason: blocked
    note: Requires login for most content.
  - domain: instagram.com
    reason: blocked
    note: Requires login for most content.
  - domain: twitter.com
    reason: blocked
    note: Blocks automated access.
  - domain: x.com
    reason: blocked
    note: Blocks automated access.
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_enrichment.py::TestBlockedDomainsEval -v`

Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add config/blocked_domains_eval.yaml tests/test_enrichment.py
git commit -m "feat: add blocked_domains_eval.yaml with wikidata.org for label leakage prevention"
```

---

### Task 2: Add --eval flag and ground truth stripping to run_verdict_fanout.py

**Files:**
- Modify: `scripts/run_verdict_fanout.py`
- Modify: `tests/test_verdict_runner.py`

**Step 1: Write tests for --eval mode**

Add to `tests/test_verdict_runner.py`:

```python
class TestEvalMode:
    """Tests for --eval flag behavior."""

    def test_eval_loads_eval_blocked_domains(self):
        """--eval flag loads blocked_domains_eval.yaml instead of base config."""
        from run_verdict_fanout import load_eval_blocked_domains

        domains = load_eval_blocked_domains()

        assert "wikidata.org" in domains
        assert "wikipedia.org" in domains

    def test_ground_truth_stripped_before_context(self):
        """ground_truth key is removed before building edit context."""
        from run_verdict_fanout import strip_ground_truth, build_edit_context

        edit = _make_enriched_edit()
        edit["ground_truth"] = {
            "label": "reverted",
            "evidence": "mw-reverted-tag",
        }

        stripped = strip_ground_truth(edit)

        assert "ground_truth" not in stripped
        # Original edit should still have ground_truth (no in-place mutation)
        assert "ground_truth" in edit

        # Context built from stripped edit should not contain ground truth
        context = build_edit_context(stripped)
        assert "reverted" not in context
        assert "ground_truth" not in context

    def test_strip_preserves_other_keys(self):
        """strip_ground_truth preserves all other edit keys."""
        from run_verdict_fanout import strip_ground_truth

        edit = _make_enriched_edit()
        edit["ground_truth"] = {"label": "reverted"}

        stripped = strip_ground_truth(edit)

        assert stripped["rcid"] == edit["rcid"]
        assert stripped["revid"] == edit["revid"]
        assert stripped["title"] == edit["title"]
        assert stripped["parsed_edit"] == edit["parsed_edit"]
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_verdict_runner.py::TestEvalMode -v`

Expected: FAIL — `load_eval_blocked_domains` and `strip_ground_truth` don't exist.

**Step 3: Implement eval mode functions**

Add to `scripts/run_verdict_fanout.py`:

Note: `load_blocked_domains` is imported from `tool_executor` (line 18 of `run_verdict_fanout.py`).
Verified: `tool_executor.load_blocked_domains(config_path=None)` accepts a `config_path` argument
(defined at `tool_executor.py:25`), so passing the eval config path works correctly.

```python
# Near the top, after the existing imports:
EVAL_BLOCKED_DOMAINS_PATH = Path("config/blocked_domains_eval.yaml")


def load_eval_blocked_domains():
    """Load the evaluation-mode blocked domain config.

    Includes wikidata.org to prevent label leakage during evaluation.
    Uses load_blocked_domains from tool_executor (already imported).

    Returns:
        Set of domain strings.
    """
    config_path = EVAL_BLOCKED_DOMAINS_PATH
    if not config_path.is_absolute():
        script_dir = Path(__file__).resolve().parent
        candidate = script_dir.parent / EVAL_BLOCKED_DOMAINS_PATH
        if candidate.exists():
            config_path = candidate
    return load_blocked_domains(config_path)


def strip_ground_truth(edit):
    """Return a copy of the edit dict with ground_truth removed.

    Does NOT modify the original dict — returns a shallow copy with the
    ground_truth key removed so models never see the labels.

    Args:
        edit: Edit dict that may contain a ground_truth key.

    Returns:
        New dict with all keys except ground_truth.
    """
    return {k: v for k, v in edit.items() if k != "ground_truth"}
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_verdict_runner.py::TestEvalMode -v`

Expected: 3 tests PASS.

**Step 5: Add --eval flag to argparse and wire up**

In `main()` of `scripts/run_verdict_fanout.py`, add the `--eval` argument after the existing `--dry-run` argument:

```python
parser.add_argument(
    "--eval", action="store_true",
    help="Evaluation mode: block wikidata.org and strip ground_truth from edits",
)
```

Then modify the `main()` function to use eval mode:

```python
# Replace: blocked_domains = load_blocked_domains()
# With:
if args.eval:
    blocked_domains = load_eval_blocked_domains()
    print("Evaluation mode: wikidata.org blocked, ground_truth will be stripped")
else:
    blocked_domains = load_blocked_domains()
```

And in the main loop where `run_single_verdict` is called, strip ground truth in eval mode. Find the line that calls `run_single_verdict(client, model, edit, ...)` and add:

```python
# Before the run_single_verdict call:
verdict_edit = strip_ground_truth(edit) if args.eval else edit

# Then pass verdict_edit instead of edit to run_single_verdict:
verdict = run_single_verdict(client, model, verdict_edit, blocked_domains, api_key)
```

Note: The `save_verdict` call should still use the original `edit` (with ground_truth) for metadata like title and property. Only the model-facing call uses `verdict_edit`.

**Step 6: Write test for CLI --eval flag**

Add to `tests/test_verdict_runner.py`:

```python
class TestEvalCLI:
    """Tests for --eval CLI flag."""

    def test_eval_flag_accepted(self, capsys):
        """--eval flag is accepted by argparse."""
        from run_verdict_fanout import main
        import sys

        with patch.object(sys, "argv", ["prog", "--snapshot", "test.yaml", "--dry-run", "--eval"]):
            with patch("run_verdict_fanout.load_eval_blocked_domains", return_value={"wikidata.org"}):
                with patch("builtins.open", MagicMock(return_value=MagicMock(
                    __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value="edits: []"))),
                    __exit__=MagicMock(return_value=False),
                ))):
                    with patch("run_verdict_fanout.yaml.safe_load", return_value={"edits": []}):
                        main()

        captured = capsys.readouterr()
        assert "Evaluation mode" in captured.out
```

**Step 7: Run all tests**

Run: `uv run pytest tests/test_verdict_runner.py -v`

Expected: All tests PASS (existing + new).

Run: `uv run pytest`

Expected: Full suite passes.

**Step 8: Commit**

```bash
git add scripts/run_verdict_fanout.py config/blocked_domains_eval.yaml tests/test_verdict_runner.py tests/test_enrichment.py
git commit -m "feat: add --eval mode with wikidata.org blocking and ground truth stripping"
```
