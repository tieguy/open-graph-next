# Wikidata Enhance and Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add pywikibot execution to apply approved claims to test.wikidata.org

**Architecture:** When resuming a session with an approved-but-not-executed claim, execute it via pywikibot before continuing. Update the YAML log and chainlink to reflect execution status.

**Tech Stack:** Claude Code skill (Markdown), pywikibot, chainlink CLI

**Scope:** Phase 5 of 6 from original design

**Codebase verified:** 2026-01-19

**Dependencies:** Phase 4 (approval and logging exists)

---

## Phase 5: Claim Execution

**Goal:** Skill executes approved claims from previous session

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

---

### Task 1: Add Claim Execution Section to Skill

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Add execution workflow section**

Add the following section after "## Session Resume" in the skill file:

```markdown
## Claim Execution

### Executing Approved Claims

When resuming a session, check for approved-but-not-executed claims:

1. Parse the previous handoff notes for "Status: APPROVED, awaiting execution"
2. Read the referenced log file to get claim details
3. Execute the claim via pywikibot

### Pre-Execution Safety Check

**CRITICAL: Verify target is test.wikidata.org before ANY write operation.**

```python
import pywikibot

# MUST use 'test' - this targets test.wikidata.org
site = pywikibot.Site('test', 'wikidata')
repo = site.data_repository()

# Double-check we're on test
assert 'test' in str(site), "SAFETY CHECK FAILED: Not on test.wikidata.org!"
```

If the safety check fails, STOP immediately and alert the user.

### Execution by Value Type

**For item values (Q-numbers):**

```python
import pywikibot

site = pywikibot.Site('test', 'wikidata')
repo = site.data_repository()

# Get the item to modify
item = pywikibot.ItemPage(repo, '[ITEM_ID]')  # e.g., 'Q42'
item.get()

# Create the claim
claim = pywikibot.Claim(repo, '[PROPERTY_ID]')  # e.g., 'P31'
target = pywikibot.ItemPage(repo, '[VALUE_ITEM_ID]')  # e.g., 'Q5'
claim.setTarget(target)

# Add reference
ref_url = pywikibot.Claim(repo, 'P854')  # reference URL
ref_url.setTarget('[SOURCE_URL]')

retrieved = pywikibot.Claim(repo, 'P813')  # retrieved date
retrieved.setTarget(pywikibot.WbTime(year=[YEAR], month=[MONTH], day=[DAY]))

claim.addSources([ref_url, retrieved])

# Add the claim to the item
item.addClaim(claim, summary='Adding [property label] with reference (via wikidata-enhance-and-check)')

print(f"Successfully added claim to {item.id}")
```

**For date values:**

```python
# Create date with appropriate precision
# precision: 9 = year, 10 = month, 11 = day
date_value = pywikibot.WbTime(
    year=[YEAR],
    month=[MONTH],  # optional, omit for year precision
    day=[DAY],       # optional, omit for month precision
    precision=[PRECISION]
)
claim.setTarget(date_value)
```

**For string values:**

```python
claim.setTarget('[STRING_VALUE]')
```

**For quantity values:**

```python
quantity = pywikibot.WbQuantity(
    amount=[AMOUNT],
    unit='http://www.wikidata.org/entity/[UNIT_ITEM]'  # e.g., Q11573 for meters
)
claim.setTarget(quantity)
```

### Post-Execution Updates

After successful execution:

1. **Update the YAML log file:**
   - Set `executed: true`
   - Add `execution_date: [YYYY-MM-DD]`

2. **Update chainlink:**
   ```bash
   chainlink comment [subissue_id] "EXECUTED: Claim added to test.wikidata.org"
   chainlink close [subissue_id]
   ```

3. **Announce to user:**
   ```
   Executed claim: [Property Label] = [Value]
   Item: [Item Label] ([Q-id]) on test.wikidata.org

   Continuing with next property...
   ```

### Handling Execution Errors

If pywikibot execution fails:

1. Log the error:
   ```bash
   chainlink comment [subissue_id] "EXECUTION FAILED: [error message]"
   ```

2. Ask user how to proceed:
   ```
   AskUserQuestion:
     Question: "Claim execution failed. How should we proceed?"
     Header: "Error"
     Options:
       - "Retry execution" (Try again)
       - "Skip and continue" (Move to next property)
       - "End session" (Stop and investigate manually)
   ```

3. If skipping, do NOT mark subissue as closed - leave it for later retry
```

**Step 2: Verify the skill file was updated**

Run: `grep -n "Claim Execution" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing "## Claim Execution" section exists

**Step 3: Commit the execution addition**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): add pywikibot claim execution

Added to wikidata-enhance-and-check skill:
- Pre-execution safety check for test.wikidata.org
- Execution code for all value types (item, date, string, quantity)
- Reference addition with URL and retrieved date
- Post-execution YAML and chainlink updates
- Error handling with user choice

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Update Session Resume Logic

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Update the Session Resume section**

Replace the existing "## Session Resume" section with a more complete version:

```markdown
## Session Resume

When invoked without an item ID (`/wikidata-enhance-and-check`):

### Step 1: Start Session and Check History

```bash
chainlink session start
```

Check for recent sessions with pending work. Look at the last session's handoff notes.

### Step 2: Check for Pending Execution

Parse the handoff notes. If they contain "Status: APPROVED, awaiting execution":

1. Extract the log file path from handoff notes
2. Read the log file to get claim details:
   ```bash
   cat logs/wikidata-enhance/[filename].yaml
   ```
3. Proceed to Claim Execution section

### Step 3: Continue with Verification

If no pending execution:

1. Find the parent issue for the current item
2. List open subissues (unverified properties):
   ```bash
   chainlink list --parent [parent_id] --status open
   ```
3. If open subissues exist, select the first one and continue from Step 6 (Source Discovery)
4. If all subissues closed, the item is complete:
   ```bash
   chainlink close [parent_id]
   chainlink session end --notes "Item [Q-id] enhancement complete. All properties verified."
   ```

### Step 4: No Active Work

If no chainlink session history or no open work:

Ask user what to do:
```
AskUserQuestion:
  Question: "No active enhancement session found. What would you like to do?"
  Header: "Start"
  Options:
    - "Start new item" (Provide a Q-id to enhance)
    - "List recent issues" (Show chainlink issues to resume)
```
```

**Step 2: Verify the update**

Run: `grep -n "Check for Pending Execution" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing the updated resume logic

**Step 3: Commit the resume logic update**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): enhance session resume with execution check

Updated session resume to:
- Check handoff notes for pending execution
- Read log file for claim details
- Continue to next property after execution
- Handle completed items
- Prompt user when no active work

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5 Verification

**Done when:**
- Skill has pywikibot execution logic for all value types
- Skill has pre-execution safety check for test.wikidata.org
- Skill updates YAML log with execution status
- Skill closes chainlink subissue after execution
- Session resume checks for pending execution
- Changes committed to git
