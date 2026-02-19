# OpenRouter Verdict Fanout — Phase 3: Adapted SIFT Prompt

**Goal:** Model-agnostic version of the SIFT-Patrol skill prompt for use by all four models via OpenRouter

**Architecture:** Copy `skills/sift-patrol/SKILL.md` to `config/sift_prompt_openrouter.md`, replace Claude Code tool names with generic tool names (`web_search`, `web_fetch`), remove file I/O instructions (Step 7: Save Log), remove Claude Code skill front matter, generalize model tier references.

**Tech Stack:** Markdown (prompt text only)

**Scope:** Phase 3 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This is an infrastructure phase (prompt text, no code). **Verifies: None** — verified by inspection.

---

<!-- START_TASK_1 -->
### Task 1: Create adapted SIFT prompt

**Files:**
- Create: `wikidata-SIFT/config/sift_prompt_openrouter.md`

**Step 1: Copy and adapt the prompt**

Create `wikidata-SIFT/config/sift_prompt_openrouter.md` by copying the content of `wikidata-SIFT/skills/sift-patrol/SKILL.md` with these specific changes:

1. **Remove YAML front matter** (lines 1-4 of original): Delete the `---name: sift-patrol...---` block entirely.

2. **Replace `WebFetch` with `web_fetch`** in all occurrences (6 locations in the original):
   - "use it directly instead of WebFetch" -> "use it directly instead of calling web_fetch"
   - "do NOT attempt WebFetch" -> "do NOT attempt web_fetch"
   - "do NOT retry with WebFetch" -> "do NOT retry with web_fetch"
   - "Only use WebFetch for URLs not present in" -> "Only use web_fetch for URLs not present in"
   - "Use WebFetch to read the most promising results" -> "Use web_fetch to read the most promising results"
   - "if you directly fetched and read it with WebFetch" -> "if you directly fetched and read it with web_fetch"

3. **Replace `WebSearch` with `web_search`** (1 location):
   - "Use WebSearch with the default query" -> "Use web_search with the default query"

4. **Remove Step 7 (Save Log)** entirely: Delete the "Step 7: Save Log" section and all its content. The runner handles YAML output, not the model.

5. **Remove the output format section** (Step 6) that specifies YAML file saving. Replace it with a simpler instruction telling the model that it will be asked for a structured JSON verdict after the investigation phase completes. The model does not need to format output during the investigation — the runner handles this in Phase B.

6. **Generalize model tier references** in Design Notes:
   - Change "(Haiku for parsing, Sonnet for search, Opus for synthesis)" to "(a lightweight model for parsing, a mid-tier model for search, a capable model for synthesis)"

7. **Add tool availability note** at the top (after the title, before "Purpose"):
   ```
   ## Available Tools

   You have two tools available during the investigation phase:

   - **web_search(query)** — Search the web. Returns a list of results, each with title, url, and snippet.
   - **web_fetch(url)** — Fetch and read a web page. Returns the extracted text content, or an error string.

   Call these tools as needed during Steps 2-4. You will be told when to provide your final verdict.
   ```

**Step 2: Verify no Claude-specific references remain**

Manually search the created file for:
- "WebSearch" (should not appear)
- "WebFetch" (should not appear)
- "Haiku", "Sonnet", "Opus" (should not appear)
- "Claude" (should not appear)
- "Save Log" or "Step 7" (should not appear)
- "skill:" (YAML front matter should be gone)

```bash
grep -iE "(WebSearch|WebFetch|Haiku|Sonnet|Opus|Claude|Save Log|Step 7|^---$|^name:|^description:)" wikidata-SIFT/config/sift_prompt_openrouter.md
```

Expected: No output (no matches).

**Step 3: Verify SIFT methodology retained**

Confirm these sections are present and unmodified:
- Step 1: Understand the Edit
- Step 2: Investigate the Source (SIFT: Investigate)
- Step 3: Find Independent Coverage (SIFT: Find)
- Step 4: Trace (SIFT: Trace) -- Conditional
- Step 5: Verdict (with full verdict table)
- Source provenance rules (verified vs reported)
- External identifier verification rules
- Design Notes

**Step 4: Commit**

```bash
git add wikidata-SIFT/config/sift_prompt_openrouter.md
git commit -m "config: add model-agnostic SIFT prompt for OpenRouter verdict fanout"
```
<!-- END_TASK_1 -->
