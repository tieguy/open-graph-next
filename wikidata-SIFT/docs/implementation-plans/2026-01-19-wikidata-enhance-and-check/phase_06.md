# Wikidata Enhance and Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Verify complete workflow works across multiple sessions

**Architecture:** End-to-end testing of the full workflow: invoke skill with test item, verify a claim, approve it, end session, resume, execute claim, verify Wikidata was updated. This is manual verification, not automated tests.

**Tech Stack:** Claude Code skill invocation, chainlink CLI, pywikibot, test.wikidata.org

**Scope:** Phase 6 of 6 from original design

**Codebase verified:** 2026-01-19

**Dependencies:** Phase 5 (all skill functionality complete)

---

## Phase 6: End-to-End Verification

**Goal:** Verify complete workflow works across multiple sessions

**Prerequisites:**
- pywikibot must be installed and configured
- Must have credentials for test.wikidata.org
- Chainlink must be initialized

---

### Task 1: Verify Prerequisites

**Step 1: Check pywikibot installation**

```bash
python -c "import pywikibot; print('pywikibot installed')"
```

Expected: "pywikibot installed" (no ModuleNotFoundError)

**If pywikibot not installed:**

```bash
pip install pywikibot
```

**Step 2: Check pywikibot configuration**

Create `user-config.py` if it doesn't exist (this file is gitignored):

```python
# user-config.py
family = 'wikidata'
mylang = 'test'

usernames['wikidata']['test'] = 'YourTestUsername'
```

**Step 3: Test pywikibot connection**

```bash
python -c "import pywikibot; site = pywikibot.Site('test', 'wikidata'); print(f'Connected to: {site}')"
```

Expected: "Connected to: wikidata:test"

**Step 4: Check chainlink is initialized**

```bash
chainlink list
```

Expected: Either "No issues found" or a list of issues (not an initialization error)

---

### Task 2: Session 1 - Initial Verification

**Step 1: Invoke the skill with a test item**

Choose a test item on test.wikidata.org. For this verification, use an item you have permission to edit.

```
/wikidata-enhance-and-check Q[test-item-id]
```

**Step 2: Follow the skill workflow**

The skill should:
1. Start a chainlink session
2. Create an issue for the item
3. Ask what properties to verify

**Respond to AskUserQuestion:** Select one simple property to verify (e.g., "Let me specify" → "instance of")

**Step 3: Verify source discovery**

The skill should:
1. Search for sources
2. Log sources to chainlink comments
3. Apply SIFT framework
4. Assess confidence

**Step 4: Approve the claim**

When asked for approval:
1. Review the verification summary
2. Select "Approve"

**Step 5: Verify session end**

The skill should:
1. Log the claim to `logs/wikidata-enhance/`
2. End session with handoff notes
3. Announce next steps

**Verification checks:**
```bash
# Check chainlink issue was created
chainlink list

# Check log file was created
ls logs/wikidata-enhance/

# Check log file contents
cat logs/wikidata-enhance/[latest-file].yaml
```

Expected:
- Chainlink issue exists with subissue for verified property
- YAML log file exists with `executed: false`
- Handoff notes mention "APPROVED, awaiting execution"

---

### Task 3: Session 2 - Execution and Continuation

**Step 1: Resume the session**

```
/wikidata-enhance-and-check
```

(No item ID - should resume from handoff)

**Step 2: Verify claim execution**

The skill should:
1. Detect pending execution from handoff notes
2. Read the log file
3. Execute the claim via pywikibot
4. Announce successful execution

**Step 3: Verify Wikidata was updated**

Check test.wikidata.org for the item:

```python
import pywikibot

site = pywikibot.Site('test', 'wikidata')
repo = site.data_repository()
item = pywikibot.ItemPage(repo, 'Q[test-item-id]')
item.get()

# Check if the claim was added
print(item.claims)
```

**Step 4: Verify log file was updated**

```bash
cat logs/wikidata-enhance/[log-file].yaml
```

Expected: `executed: true` and `execution_date: [today]`

**Step 5: Verify chainlink was updated**

```bash
chainlink show [subissue-id]
```

Expected: Subissue is closed with "EXECUTED" comment

---

### Task 4: Document Verification Results

**Step 1: Create verification log**

Create a verification record in the chainlink issue:

```bash
chainlink comment [parent-issue-id] "End-to-end verification completed:
- Session 1: Verified claim, approved, logged
- Session 2: Executed claim to test.wikidata.org
- Wikidata item updated successfully
- Log file reflects execution
- Chainlink state correct throughout"
```

**Step 2: Close verification issue (if this was a test item)**

If you created a test item specifically for verification:

```bash
chainlink close [parent-issue-id] --no-changelog
```

**Step 3: Commit any final adjustments**

If verification revealed any issues that required skill file changes, commit them:

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "fix(skill): [description of any fixes from verification]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

If no changes needed:

```bash
echo "No changes needed - skill works as designed"
```

---

## Phase 6 Verification

**Done when:**
- pywikibot is installed and configured
- Full workflow tested across two sessions:
  - Session 1: Verify claim → Approve → Log → End
  - Session 2: Resume → Execute → Update Wikidata
- Chainlink state is correct at each step
- YAML log files are created and updated correctly
- test.wikidata.org has the verified claim
- Any issues discovered are fixed and committed

---

## Implementation Complete

After Phase 6 verification passes:

1. **Update CLAUDE.md** if needed to reference the new skill
2. **Create a summary comment** in the design plan issue (if tracking in chainlink)
3. **Announce to user:**

```
The wikidata-enhance-and-check skill is complete and verified.

To use:
  /wikidata-enhance-and-check Q[item-id]  # Start new enhancement
  /wikidata-enhance-and-check             # Resume previous session

Files created:
  - skills/wikidata-enhance-and-check/SKILL.md (the skill)
  - docs/wikidata-methodology.md (SIFT reference)
  - logs/wikidata-enhance/ (verification logs)

All operations target test.wikidata.org only.
```
