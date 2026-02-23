# Labeled Evaluation Dataset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a labeled evaluation dataset of ~500 historical Wikidata edits with ground truth labels derived from revert/patrol history.

**Architecture:** A new fetcher script queries pywikibot's RecentChanges API with dual-query strategy (mw-reverted tag + mw-rollback/mw-undo trace-back) for reverted edits, plus a survived pool. Self-revert and edit-war filtering cleans the labels. An `EditSource` protocol enables future Toolforge backends. The fetcher reuses enrichment functions from `fetch_patrol_edits.py`.

**Tech Stack:** Python 3.13, pywikibot, PyYAML, existing enrichment pipeline

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-02-19

**Testing patterns:** pytest with `pythonpath = ["scripts"]`; `unittest.mock` (MagicMock, patch); plain `assert`; `_make_*` helpers; classes grouping related tests; `tmp_path` for file I/O. See `tests/conftest.py` for shared fixtures. Run with `uv run pytest`.

---

## Phase 2: Enhanced Enrichment

**Goal:** Prefetch all item-wide citation URLs and inject `prefetched_references` and `edit_diff` into model messages via `build_edit_context()`.

**Key codebase facts (verified by investigation):**
- `build_edit_context()` is in `scripts/run_verdict_fanout.py` at line 121 (NOT in `fetch_patrol_edits.py`)
- Currently builds sections: "Edit to verify", "Parsed edit", "Item context", "Removed claim", "Verification question"
- Does NOT include `edit_diff` or `prefetched_references` despite the SIFT prompt describing them
- `extract_reference_urls()` at `fetch_patrol_edits.py:1038` only looks at edit_diff P854 entries
- `prefetch_reference_url()` at `fetch_patrol_edits.py:1098` fetches and extracts text via trafilatura
- `serialize_claims()` at `fetch_patrol_edits.py:447` serializes raw Wikibase claims with label resolution
- Claims in the serialized format nest references under each statement as `references: [{P854: {value: url, ...}}]`
- `CONTEXT_LIMITS` dict in `run_verdict_fanout.py:23-28` maps model IDs to context window sizes
- The `item` key in enriched edits contains `claims` (dict of property_label -> statements) with nested `references`

### Task 1: Item-wide citation extraction function

**Files:**
- Modify: `scripts/fetch_patrol_edits.py` (add new function next to `extract_reference_urls`)
- Modify: `tests/test_enrichment.py` (add tests)

This function walks all claims on an item (not just the edit diff) and extracts every P854 reference URL. This compensates for blocking Wikidata during evaluation — the models need broader citation context.

**Step 1: Write tests for extract_item_reference_urls**

Add to `tests/test_enrichment.py`, in a new class:

```python
class TestExtractItemReferenceUrls:
    """Tests for item-wide citation URL extraction."""

    def test_extracts_p854_from_all_claims(self):
        """Extracts reference URLs from multiple claims across properties."""
        from fetch_patrol_edits import extract_item_reference_urls

        item = {
            "claims": {
                "occupation": {
                    "property_label": "occupation",
                    "statements": [
                        {
                            "value": "Q901",
                            "value_label": "scientist",
                            "rank": "normal",
                            "qualifiers": {},
                            "references": [
                                {
                                    "P854": {
                                        "property_label": "reference URL",
                                        "value": "https://example.com/source1",
                                        "value_label": None,
                                    }
                                }
                            ],
                        }
                    ],
                },
                "employer": {
                    "property_label": "employer",
                    "statements": [
                        {
                            "value": "Q42",
                            "value_label": "Uni",
                            "rank": "normal",
                            "qualifiers": {},
                            "references": [
                                {
                                    "P854": {
                                        "property_label": "reference URL",
                                        "value": "https://example.com/source2",
                                        "value_label": None,
                                    }
                                }
                            ],
                        }
                    ],
                },
            }
        }

        urls = extract_item_reference_urls(item)

        assert urls == {"https://example.com/source1", "https://example.com/source2"}

    def test_returns_empty_set_for_no_references(self):
        """Returns empty set when no claims have P854 references."""
        from fetch_patrol_edits import extract_item_reference_urls

        item = {
            "claims": {
                "occupation": {
                    "property_label": "occupation",
                    "statements": [
                        {
                            "value": "Q901",
                            "value_label": "scientist",
                            "rank": "normal",
                            "qualifiers": {},
                            "references": [],
                        }
                    ],
                }
            }
        }

        urls = extract_item_reference_urls(item)

        assert urls == set()

    def test_deduplicates_urls(self):
        """Same URL referenced by multiple claims is returned once."""
        from fetch_patrol_edits import extract_item_reference_urls

        item = {
            "claims": {
                "occupation": {
                    "property_label": "occupation",
                    "statements": [
                        {
                            "value": "Q901", "value_label": "scientist",
                            "rank": "normal", "qualifiers": {},
                            "references": [{"P854": {"property_label": "reference URL", "value": "https://example.com/dup", "value_label": None}}],
                        }
                    ],
                },
                "employer": {
                    "property_label": "employer",
                    "statements": [
                        {
                            "value": "Q42", "value_label": "Uni",
                            "rank": "normal", "qualifiers": {},
                            "references": [{"P854": {"property_label": "reference URL", "value": "https://example.com/dup", "value_label": None}}],
                        }
                    ],
                },
            }
        }

        urls = extract_item_reference_urls(item)

        assert urls == {"https://example.com/dup"}

    def test_handles_missing_item(self):
        """Returns empty set when item is None."""
        from fetch_patrol_edits import extract_item_reference_urls

        assert extract_item_reference_urls(None) == set()
        assert extract_item_reference_urls({}) == set()

    def test_handles_multiple_ref_blocks(self):
        """Handles statements with multiple reference blocks."""
        from fetch_patrol_edits import extract_item_reference_urls

        item = {
            "claims": {
                "occupation": {
                    "property_label": "occupation",
                    "statements": [
                        {
                            "value": "Q901", "value_label": "scientist",
                            "rank": "normal", "qualifiers": {},
                            "references": [
                                {"P854": {"property_label": "reference URL", "value": "https://example.com/a", "value_label": None}},
                                {"P854": {"property_label": "reference URL", "value": "https://example.com/b", "value_label": None}},
                            ],
                        }
                    ],
                }
            }
        }

        urls = extract_item_reference_urls(item)

        assert urls == {"https://example.com/a", "https://example.com/b"}
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_enrichment.py::TestExtractItemReferenceUrls -v`

Expected: FAIL — `extract_item_reference_urls` not defined.

**Step 3: Implement extract_item_reference_urls**

Add to `scripts/fetch_patrol_edits.py`, near `extract_reference_urls()` (around line 1065):

```python
def extract_item_reference_urls(item):
    """Extract all P854 (reference URL) values from all claims on an item.

    Walks the serialized claims structure (from serialize_claims output)
    and collects every P854 reference URL across all properties.

    Args:
        item: The item context dict (with "claims" key from enrichment).
            The claims are in serialized format (from serialize_claims).

    Returns:
        Set of URL strings.
    """
    if not item:
        return set()

    claims = item.get("claims", {})
    urls = set()

    for prop_data in claims.values():
        if not isinstance(prop_data, dict):
            continue
        for stmt in prop_data.get("statements", []):
            for ref_block in stmt.get("references", []):
                p854 = ref_block.get("P854")
                if p854 and isinstance(p854, dict):
                    url = p854.get("value")
                    if url and isinstance(url, str) and url.startswith("http"):
                        urls.add(url)

    return urls
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_enrichment.py::TestExtractItemReferenceUrls -v`

Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add scripts/fetch_patrol_edits.py tests/test_enrichment.py
git commit -m "feat: add extract_item_reference_urls for item-wide citation extraction"
```

---

### Task 2: Add edit_diff and prefetched_references sections to build_edit_context

**Files:**
- Modify: `scripts/run_verdict_fanout.py` (modify `build_edit_context` at line 121)
- Modify: `tests/test_verdict_runner.py` (add tests)

This task fixes the gap where `build_edit_context()` omits `edit_diff` and `prefetched_references` despite the SIFT prompt describing them.

**Step 1: Write tests**

Add to `tests/test_verdict_runner.py`, in a new class:

```python
class TestBuildEditContextEnhanced:
    """Tests for edit_diff and prefetched_references in build_edit_context."""

    def test_includes_edit_diff_section(self):
        """build_edit_context includes edit_diff when present."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit(
            edit_diff={
                "type": "value_changed",
                "property": "P108",
                "property_label": "employer",
                "old_value": {"value": "Q42", "value_label": "Old Corp"},
                "new_value": {"value": "Q99", "value_label": "New Corp"},
            }
        )

        result = build_edit_context(edit)

        assert "## Edit diff" in result
        assert "value_changed" in result
        assert "employer" in result

    def test_includes_prefetched_references_section(self):
        """build_edit_context includes prefetched_references when present."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit(
            prefetched_references={
                "https://example.com/source": {
                    "url": "https://example.com/source",
                    "status": 200,
                    "extracted_text": "This is the article content about the claim.",
                    "error": None,
                }
            }
        )

        result = build_edit_context(edit)

        assert "## Prefetched references" in result
        assert "https://example.com/source" in result
        assert "This is the article content about the claim." in result

    def test_omits_edit_diff_when_missing(self):
        """build_edit_context omits edit_diff section when not present."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit()

        result = build_edit_context(edit)

        assert "## Edit diff" not in result

    def test_omits_prefetched_references_when_empty(self):
        """build_edit_context omits prefetched_references when empty."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit(prefetched_references={})

        result = build_edit_context(edit)

        assert "## Prefetched references" not in result

    def test_skips_failed_prefetches(self):
        """Prefetched references with errors are summarized, not included."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit(
            prefetched_references={
                "https://example.com/ok": {
                    "url": "https://example.com/ok",
                    "status": 200,
                    "extracted_text": "Good content here.",
                    "error": None,
                },
                "https://example.com/fail": {
                    "url": "https://example.com/fail",
                    "status": 403,
                    "extracted_text": None,
                    "error": "HTTP 403",
                },
            }
        )

        result = build_edit_context(edit)

        assert "Good content here." in result
        assert "HTTP 403" in result or "failed" in result.lower()
```

Note: The `_make_enriched_edit` helper in `test_verdict_runner.py` needs to accept `edit_diff` and `prefetched_references` keyword arguments. Check the existing helper and add the parameters if they're not already present. The helper is at the top of the file — it constructs an edit dict with all the standard keys.

**Step 2: Update _make_enriched_edit helper if needed**

Check the existing `_make_enriched_edit` function in `tests/test_verdict_runner.py`. If it doesn't accept `edit_diff` and `prefetched_references`, add them:

```python
def _make_enriched_edit(**overrides):
    """Build a minimal enriched edit dict for testing."""
    edit = {
        "rcid": 123,
        "revid": 456,
        "old_revid": 455,
        "title": "Q42",
        "user": "TestUser",
        "timestamp": "2026-02-17T12:00:00Z",
        "comment": "/* wbsetclaim-update:2||1 */ [[Property:P31]]: [[Q5]]",
        "tags": ["new editor changing statement"],
        "parsed_edit": {
            "operation": "wbsetclaim-update",
            "property": "P31",
            "property_label": "instance of",
            "value_raw": "Q5",
            "value_label": "human",
            "value_description": "any member of Homo sapiens",
        },
        "item": {
            "label_en": "Douglas Adams",
            "description_en": "English author and humourist",
            "claims": {},
        },
        "removed_claim": None,
        "edit_diff": None,
        "prefetched_references": {},
    }
    edit.update(overrides)
    return edit
```

If the existing helper doesn't have `edit_diff` and `prefetched_references` defaults, add them. Do NOT remove any existing keys.

**Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_verdict_runner.py::TestBuildEditContextEnhanced -v`

Expected: FAIL — `build_edit_context` doesn't include the new sections.

**Step 4: Modify build_edit_context in run_verdict_fanout.py**

Edit `scripts/run_verdict_fanout.py`, function `build_edit_context` (lines 121-175). Add the new sections after "Removed claim" and before "Verification question":

```python
def build_edit_context(edit):
    """Build the user message string for the investigation phase.

    Calls make_verification_question() and check_ontological_consistency()
    from sift_precheck. Returns a string with YAML-formatted item context,
    parsed edit, and the verification question with any ontological warnings.
    """
    verification_question = make_verification_question(edit)
    warnings = check_ontological_consistency(edit)

    # Build the context message
    parts = []

    # Include key edit metadata
    parts.append("## Edit to verify\n")
    edit_meta = {
        "rcid": edit.get("rcid"),
        "revid": edit.get("revid"),
        "title": edit.get("title"),
        "user": edit.get("user"),
        "timestamp": edit.get("timestamp"),
        "tags": edit.get("tags", []),
    }
    parts.append(yaml.safe_dump(edit_meta, default_flow_style=False, allow_unicode=True))

    # Include parsed edit if available
    parsed_edit = edit.get("parsed_edit")
    if parsed_edit:
        parts.append("\n## Parsed edit\n")
        parts.append(yaml.safe_dump(parsed_edit, default_flow_style=False, allow_unicode=True))

    # Include item context if available
    item = edit.get("item")
    if item:
        parts.append("\n## Item context\n")
        parts.append(yaml.safe_dump(item, default_flow_style=False, allow_unicode=True))

    # Include removed claim if available
    removed_claim = edit.get("removed_claim")
    if removed_claim:
        parts.append("\n## Removed claim\n")
        parts.append(yaml.safe_dump(removed_claim, default_flow_style=False, allow_unicode=True))

    # Include edit diff if available
    edit_diff = edit.get("edit_diff")
    if edit_diff and "error" not in edit_diff:
        parts.append("\n## Edit diff\n")
        parts.append(yaml.safe_dump(edit_diff, default_flow_style=False, allow_unicode=True))

    # Include prefetched references if available
    prefetched = edit.get("prefetched_references")
    if prefetched:
        parts.append("\n## Prefetched references\n")
        for url, ref_data in prefetched.items():
            text = ref_data.get("extracted_text") if isinstance(ref_data, dict) else None
            error = ref_data.get("error") if isinstance(ref_data, dict) else None
            if text:
                parts.append(f"### {url}\n")
                parts.append(text[:5000])  # Truncate long articles
                parts.append("\n")
            elif error:
                parts.append(f"### {url}\n")
                parts.append(f"(Fetch failed: {error})\n")

    # Add verification question
    parts.append("\n## Verification question\n")
    if verification_question:
        parts.append(verification_question)
    else:
        parts.append("(No verification question generated — parsed_edit may be missing.)")

    # Append ontological warnings if any
    if warnings:
        parts.append("\n\n" + "\n".join(warnings))

    return "\n".join(parts)
```

**Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_verdict_runner.py::TestBuildEditContextEnhanced -v`

Expected: All 5 tests PASS.

**Step 6: Run full test suite**

Run: `uv run pytest`

Expected: All existing tests still pass. The new sections are only included when keys are present, so existing tests with edits lacking these keys should be unaffected.

**Step 7: Commit**

```bash
git add scripts/run_verdict_fanout.py tests/test_verdict_runner.py
git commit -m "feat: inject edit_diff and prefetched_references into build_edit_context"
```

---

### Task 3: Context-aware truncation with context_budget

**Files:**
- Modify: `scripts/run_verdict_fanout.py` (modify `build_edit_context`)
- Modify: `tests/test_verdict_runner.py` (add tests)

This adds a `context_budget` parameter that controls how much of the enriched item data is included before truncation. The truncation priority (from design):
1. Edit metadata, parsed edit, verification question, edit diff — always included
2. Claims on the edited property with citations
3. Claims on related properties with citations
4. Remaining claims and citations
5. External-id claims (already skipped by `serialize_claims`)

The budget is expressed in approximate tokens (chars / 4 as a rough estimate).

**Step 1: Write tests for context-aware truncation**

Add to `tests/test_verdict_runner.py`:

```python
class TestContextBudget:
    """Tests for context-aware truncation in build_edit_context."""

    def test_no_truncation_within_budget(self):
        """When content fits within budget, nothing is truncated."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit()
        result = build_edit_context(edit, context_budget=100_000)

        assert "## Item context" in result

    def test_truncates_item_context_when_over_budget(self):
        """When content exceeds budget, item context is truncated."""
        from run_verdict_fanout import build_edit_context

        # Create an edit with very large item context
        big_claims = {}
        for i in range(50):
            big_claims[f"prop_{i}"] = {
                "property_label": f"property {i}",
                "statements": [
                    {
                        "value": f"Q{i}",
                        "value_label": f"value {i}" * 100,
                        "rank": "normal",
                        "qualifiers": {},
                        "references": [],
                    }
                ],
            }
        edit = _make_enriched_edit(
            item={
                "label_en": "Test Item",
                "description_en": "A test",
                "claims": big_claims,
            }
        )

        # Very tight budget
        result = build_edit_context(edit, context_budget=2000)

        # Essential sections still present
        assert "## Edit to verify" in result
        assert "## Verification question" in result
        # Item context is truncated or reduced
        assert len(result) < 20000

    def test_prioritizes_edited_property_claims(self):
        """Edited property claims are kept even with tight budget."""
        from run_verdict_fanout import build_edit_context

        claims = {
            "instance of": {
                "property_label": "instance of",
                "statements": [{"value": "Q5", "value_label": "human", "rank": "normal", "qualifiers": {}, "references": []}],
            },
            "occupation": {
                "property_label": "occupation",
                "statements": [{"value": "Q1", "value_label": "writer " * 200, "rank": "normal", "qualifiers": {}, "references": []}],
            },
        }
        edit = _make_enriched_edit(
            parsed_edit={
                "operation": "wbsetclaim-update",
                "property": "P31",
                "property_label": "instance of",
                "value_raw": "Q5",
                "value_label": "human",
            },
            item={"label_en": "Test", "description_en": "Test", "claims": claims},
        )

        result = build_edit_context(edit, context_budget=3000)

        # The edited property (instance of) should be present
        assert "instance of" in result

    def test_default_budget_is_none(self):
        """When context_budget is None, no truncation occurs."""
        from run_verdict_fanout import build_edit_context

        edit = _make_enriched_edit()
        result_default = build_edit_context(edit)
        result_none = build_edit_context(edit, context_budget=None)

        assert result_default == result_none
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_verdict_runner.py::TestContextBudget -v`

Expected: FAIL — `build_edit_context` doesn't accept `context_budget` parameter.

**Step 3: Implement context_budget truncation**

Modify `build_edit_context` in `scripts/run_verdict_fanout.py` to accept a `context_budget` parameter and implement truncation:

```python
def build_edit_context(edit, context_budget=None):
    """Build the user message string for the investigation phase.

    Args:
        edit: Enriched edit dict.
        context_budget: Optional approximate character budget for the message.
            If set, item context is truncated to fit. Prioritizes the edited
            property's claims over other claims. If None, no truncation.
    """
    verification_question = make_verification_question(edit)
    warnings = check_ontological_consistency(edit)

    # Build essential sections (always included regardless of budget)
    parts = []

    parts.append("## Edit to verify\n")
    edit_meta = {
        "rcid": edit.get("rcid"),
        "revid": edit.get("revid"),
        "title": edit.get("title"),
        "user": edit.get("user"),
        "timestamp": edit.get("timestamp"),
        "tags": edit.get("tags", []),
    }
    parts.append(yaml.safe_dump(edit_meta, default_flow_style=False, allow_unicode=True))

    parsed_edit = edit.get("parsed_edit")
    if parsed_edit:
        parts.append("\n## Parsed edit\n")
        parts.append(yaml.safe_dump(parsed_edit, default_flow_style=False, allow_unicode=True))

    edit_diff = edit.get("edit_diff")
    if edit_diff and "error" not in edit_diff:
        parts.append("\n## Edit diff\n")
        parts.append(yaml.safe_dump(edit_diff, default_flow_style=False, allow_unicode=True))

    removed_claim = edit.get("removed_claim")
    if removed_claim:
        parts.append("\n## Removed claim\n")
        parts.append(yaml.safe_dump(removed_claim, default_flow_style=False, allow_unicode=True))

    # Verification question section
    vq_parts = []
    vq_parts.append("\n## Verification question\n")
    if verification_question:
        vq_parts.append(verification_question)
    else:
        vq_parts.append("(No verification question generated — parsed_edit may be missing.)")
    if warnings:
        vq_parts.append("\n\n" + "\n".join(warnings))

    # Calculate essential size (parts + vq_parts)
    essential = "\n".join(parts) + "\n".join(vq_parts)
    essential_len = len(essential)

    # Budget for optional sections (item context + prefetched references)
    if context_budget is not None:
        remaining_budget = max(0, context_budget - essential_len)
    else:
        remaining_budget = None

    # Build item context with truncation
    item = edit.get("item")
    if item:
        item_section = _build_item_context_section(item, parsed_edit, remaining_budget)
        if item_section:
            parts.append(item_section)
            if remaining_budget is not None:
                remaining_budget = max(0, remaining_budget - len(item_section))

    # Prefetched references
    prefetched = edit.get("prefetched_references")
    if prefetched:
        ref_section = _build_prefetched_section(prefetched, remaining_budget)
        if ref_section:
            parts.append(ref_section)

    # Append verification question at the end
    parts.extend(vq_parts)

    return "\n".join(parts)


def _build_item_context_section(item, parsed_edit, budget):
    """Build the item context section with optional truncation.

    Priority order:
    1. Item label and description (always)
    2. Claims on the edited property
    3. Other claims (truncated if over budget)
    """
    claims = item.get("claims", {})
    edited_prop_label = parsed_edit.get("property_label") if parsed_edit else None

    header = "\n## Item context\n"
    meta = {}
    if item.get("label_en"):
        meta["label_en"] = item["label_en"]
    if item.get("description_en"):
        meta["description_en"] = item["description_en"]

    meta_str = yaml.safe_dump(meta, default_flow_style=False, allow_unicode=True) if meta else ""

    if not claims:
        return header + meta_str

    # Split claims by priority
    edited_prop_claims = {}
    other_claims = {}
    for prop_key, prop_data in claims.items():
        if edited_prop_label and prop_key == edited_prop_label:
            edited_prop_claims[prop_key] = prop_data
        else:
            other_claims[prop_key] = prop_data

    # Serialize priority groups
    edited_str = yaml.safe_dump(
        {"claims": edited_prop_claims}, default_flow_style=False, allow_unicode=True
    ) if edited_prop_claims else ""
    other_str = yaml.safe_dump(
        {"claims": other_claims}, default_flow_style=False, allow_unicode=True
    ) if other_claims else ""

    if budget is None:
        # No truncation
        all_claims_str = yaml.safe_dump(
            {"claims": claims}, default_flow_style=False, allow_unicode=True
        )
        return header + meta_str + all_claims_str

    # Truncation logic
    used = len(header) + len(meta_str)
    result = header + meta_str

    if used + len(edited_str) <= budget:
        result += edited_str
        used += len(edited_str)
    elif edited_str:
        # Truncate edited property claims
        result += edited_str[:max(0, budget - used)] + "\n...(truncated)\n"
        return result

    if used + len(other_str) <= budget:
        result += other_str
    elif other_str:
        result += other_str[:max(0, budget - used)] + "\n...(truncated)\n"

    return result


def _build_prefetched_section(prefetched, budget):
    """Build the prefetched references section with optional truncation."""
    if not prefetched:
        return ""

    parts = ["\n## Prefetched references\n"]
    current_len = len(parts[0])

    for url, ref_data in prefetched.items():
        text = ref_data.get("extracted_text") if isinstance(ref_data, dict) else None
        error = ref_data.get("error") if isinstance(ref_data, dict) else None

        entry = ""
        if text:
            truncated_text = text[:5000]
            entry = f"### {url}\n{truncated_text}\n"
        elif error:
            entry = f"### {url}\n(Fetch failed: {error})\n"

        if budget is not None and current_len + len(entry) > budget:
            break
        parts.append(entry)
        current_len += len(entry)

    return "\n".join(parts) if len(parts) > 1 else ""
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_verdict_runner.py::TestContextBudget -v`

Expected: All 4 tests PASS.

**Step 5: Run full test suite**

Run: `uv run pytest`

Expected: All tests PASS. Existing `build_edit_context` callers don't pass `context_budget` so they get the default `None` (no truncation) behavior.

**Step 6: Wire context_budget into run_single_verdict**

In `run_single_verdict` (line 422), update the `build_edit_context` call to pass a model-specific budget. Modify `run_single_verdict` to accept the model's context limit:

```python
# In run_single_verdict, after line 438:
edit_context = build_edit_context(edit)

# Change to:
context_limit = CONTEXT_LIMITS.get(model, 100_000)
# Allocate ~40% of context for the prompt (system + user message)
# Conservative: chars ≈ tokens * 4, so budget = limit * 4 * 0.4
context_budget = int(context_limit * 4 * 0.4)
edit_context = build_edit_context(edit, context_budget=context_budget)
```

**Step 7: Run full test suite again**

Run: `uv run pytest`

Expected: All tests PASS.

**Step 8: Commit**

```bash
git add scripts/run_verdict_fanout.py tests/test_verdict_runner.py
git commit -m "feat: add context-aware truncation with context_budget to build_edit_context"
```
