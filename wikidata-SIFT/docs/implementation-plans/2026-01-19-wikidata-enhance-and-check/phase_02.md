# Wikidata Enhance and Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Create minimal skill that can be invoked and interacts with chainlink

**Architecture:** Claude Code skills are markdown files (SKILL.md) containing workflow instructions. The skill will be placed in `skills/wikidata-enhance-and-check/SKILL.md`. This phase creates the scaffold: session start, item identification, chainlink issue creation, and asking human for properties to verify.

**Tech Stack:** Claude Code skill (Markdown), chainlink CLI

**Scope:** Phase 2 of 6 from original design

**Codebase verified:** 2026-01-19

**Dependencies:** Phase 1 (methodology document exists)

---

## Phase 2: Skill Scaffold

**Goal:** Create minimal skill that can be invoked and interacts with chainlink

**Files:**
- Create: `skills/wikidata-enhance-and-check/SKILL.md`

---

### Task 1: Create the Skills Directory Structure

**Files:**
- Create: `skills/wikidata-enhance-and-check/` directory

**Step 1: Create the directory**

```bash
mkdir -p skills/wikidata-enhance-and-check
```

**Step 2: Verify the directory exists**

Run: `ls -la skills/`

Expected: `wikidata-enhance-and-check/` directory exists

---

### Task 2: Create the Skill File with Session Management

**Files:**
- Create: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Create the skill file**

Create `skills/wikidata-enhance-and-check/SKILL.md` with the following content:

```markdown
---
name: wikidata-enhance-and-check
description: Systematically enhance Wikidata items with fact-checked claims using SIFT methodology, human approval, and chainlink session tracking
---

# Wikidata Enhance and Check

Systematically verify and add claims to Wikidata test items with rigorous fact-checking.

**Announce at start:** "I'm using the wikidata-enhance-and-check skill to systematically verify claims for this Wikidata item."

## Safety

**CRITICAL: All operations target test.wikidata.org only. Never write to production Wikidata.**

Before any pywikibot write operation, verify:
```python
site = pywikibot.Site('test', 'wikidata')  # Must be 'test', never 'wikidata' alone
```

## Invocation

```
/wikidata-enhance-and-check Q42
```

Or to resume an existing session:
```
/wikidata-enhance-and-check
```

## Session Lifecycle

### Step 1: Session Start

Start a chainlink session:

```bash
chainlink session start
```

### Step 2: Item Identification

If an item ID was provided (e.g., Q42):
1. Verify the item exists on test.wikidata.org
2. Fetch the item's current label and description
3. Check for existing chainlink issue for this item

If no item ID provided:
1. Check `chainlink session status` for previous handoff notes
2. Resume from where the last session ended

### Step 3: Chainlink Issue Management

**If new item (no existing issue):**

Create a chainlink issue for the item:
```bash
chainlink create "Enhance [Item Label] (Q[id])" -p medium
chainlink label [issue_id] enhancement
```

**If resuming (issue exists):**

Find the existing issue:
```bash
chainlink search "[Item ID]"
```

Set it as current work:
```bash
chainlink session work [issue_id]
```

### Step 4: Property Selection

**For new enhancement session:**

Use AskUserQuestion to ask the human what properties to verify:

```
Question: "What properties should we verify for [Item Label] ([Item ID])?"
Header: "Properties"
Options:
  - "Biographical basics" (birth date, death date, nationality, occupation)
  - "Works and achievements" (notable works, awards, positions)
  - "Relationships" (family, affiliations, employers)
  - "Let me specify" (freeform input)
```

**After human responds:**

Create a subissue for each property to verify:
```bash
chainlink subissue [parent_id] "Verify P[xxx] ([property label])"
```

Log the property list as a comment:
```bash
chainlink comment [parent_id] "Properties to verify: [list]"
```

### Step 5: Select Current Property

Pick the first open subissue (property) to work on:
```bash
chainlink list --parent [parent_id]
```

Set it as current work:
```bash
chainlink session work [subissue_id]
```

Announce: "Now verifying [property label] for [item label]."

## Methodology Reference

For fact-checking methodology (SIFT framework, evidence types, source reliability), see:
`docs/wikidata-methodology.md`

## Next Steps

After property selection, proceed to source discovery and verification (not yet implemented in this scaffold).

For now, announce: "Skill scaffold complete. Source discovery and verification will be added in Phase 3."

End the session with handoff notes:
```bash
chainlink session end --notes "Item: [Q-id]. Properties queued: [list]. Next: verify first property."
```
```

**Step 2: Verify the skill file exists**

Run: `head -30 skills/wikidata-enhance-and-check/SKILL.md`

Expected: Skill file with frontmatter (name, description) and initial sections

**Step 3: Commit the skill scaffold**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat: add wikidata-enhance-and-check skill scaffold

Initial skill structure with:
- Session lifecycle (start, resume)
- Item identification
- Chainlink issue management
- Property selection via AskUserQuestion
- Safety checks for test.wikidata.org

Source discovery and verification to be added in Phase 3.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Test Skill Invocation

**Step 1: Verify skill can be discovered**

The skill should be discoverable by Claude Code. Test by checking the file structure:

```bash
find skills -name "SKILL.md" -type f
```

Expected: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 2: Manual verification checklist**

Verify these manually:
- [ ] Skill frontmatter has `name` and `description`
- [ ] Safety section prominently warns about test.wikidata.org
- [ ] Chainlink commands use correct syntax
- [ ] AskUserQuestion format matches Claude Code conventions
- [ ] Methodology reference points to correct file path

---

## Phase 2 Verification

**Done when:**
- `skills/wikidata-enhance-and-check/SKILL.md` exists
- Skill has session management (start, resume)
- Skill creates chainlink issues for items
- Skill asks human for properties to verify via AskUserQuestion
- Skill creates subissues for each property
- Changes committed to git
