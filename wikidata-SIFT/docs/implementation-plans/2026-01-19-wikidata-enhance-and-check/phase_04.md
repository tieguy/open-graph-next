# Wikidata Enhance and Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add human approval workflow and YAML logging to the skill

**Architecture:** After verification, present findings to human for approval via AskUserQuestion. Log approved claims to YAML files in `logs/wikidata-enhance/`. End session with chainlink handoff notes pointing to approved claim.

**Tech Stack:** Claude Code skill (Markdown), AskUserQuestion, YAML, chainlink CLI

**Scope:** Phase 4 of 6 from original design

**Codebase verified:** 2026-01-19

**Dependencies:** Phase 3 (source discovery and verification exists)

---

## Phase 4: Human Approval and Logging

**Goal:** Skill presents findings to human and logs approved claims

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`
- Create: `logs/wikidata-enhance/` directory (created on first log)

---

### Task 1: Add Human Approval Section to Skill

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Add approval workflow after Step 10**

Add the following section after "Step 10: Assess Confidence" in the skill file:

```markdown
## Human Approval

### Step 11: Present Verification Results

Present the verification findings to the human for approval using AskUserQuestion:

**First, summarize the finding:**

```
## Verification Result for [Property Label]

**Item:** [Item Label] ([Q-id])
**Property:** [Property Label] (P[xxx])
**Proposed Value:** [value]
**Value Type:** [item|string|time|quantity]

### Sources Consulted
1. [Source 1 name] - [reliability rating] - [what it says]
2. [Source 2 name] - [reliability rating] - [what it says]

### SIFT Analysis
- **Investigate:** [source assessment summary]
- **Find:** [cross-reference summary]
- **Trace:** [primary source status]

### Confidence: [HIGH|MEDIUM|LOW]
[Reasoning for confidence level]

### Proposed Wikidata Claim
- Property: P[xxx]
- Value: [value]
- References:
  - Reference URL: [primary source URL]
  - Retrieved: [today's date]
```

**Then ask for approval:**

```
AskUserQuestion:
  Question: "Do you approve adding this claim to test.wikidata.org?"
  Header: "Approval"
  Options:
    - "Approve" (Claim is verified and ready to add)
    - "Reject" (Claim should not be added - explain why)
    - "Need more research" (Verification incomplete - specify what's needed)
```

### Step 12: Handle Approval Decision

**If Approved:**
1. Log the approved claim to YAML (see Step 13)
2. End the session with handoff notes (see Step 14)
3. Next session will execute the claim

**If Rejected:**
1. Ask for rejection reason via text input
2. Log rejection to chainlink:
   ```bash
   chainlink comment [subissue_id] "REJECTED: [reason]"
   ```
3. Close the subissue:
   ```bash
   chainlink close [subissue_id] --no-changelog
   ```
4. Continue to next property (if any) or end session

**If Need More Research:**
1. Ask what additional research is needed
2. Log the blocker:
   ```bash
   chainlink comment [subissue_id] "BLOCKED: Need more research - [specifics]"
   ```
3. End session with notes about what's needed
```

**Step 2: Verify the skill file was updated**

Run: `grep -n "Human Approval" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing "## Human Approval" section exists

**Step 3: Commit the approval workflow**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): add human approval workflow

Added to wikidata-enhance-and-check skill:
- Verification result presentation format
- AskUserQuestion for approval decision
- Handling for approve/reject/need-more-research
- Chainlink logging for rejections and blockers

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Add YAML Logging Section to Skill

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Add YAML logging instructions after Step 12**

Add the following section:

```markdown
## Logging

### Step 13: Log Approved Claim to YAML

When a claim is approved, create a YAML log file:

**File path:** `logs/wikidata-enhance/[date]-[item_id]-[property_id].yaml`

Example: `logs/wikidata-enhance/2026-01-19-Q42-P569.yaml`

**Create the logs directory if it doesn't exist:**
```bash
mkdir -p logs/wikidata-enhance
```

**YAML format:**

```yaml
session_date: [YYYY-MM-DD]
item: [Q-id]
item_label: [Item Label]
property: [P-id]
property_label: [Property Label]
chainlink_issue: [issue_id]
chainlink_subissue: [subissue_id]

sources_consulted:
  - url: "[source URL]"
    name: "[source name]"
    type: [primary|secondary|official|news|academic]
    reliability: [1-5]
    useful_for: "[what claims this supports]"
  # ... additional sources

verification:
  sift_steps:
    stop: "[what you questioned before accepting]"
    investigate: "[source assessment]"
    find_better: "[cross-reference findings]"
    trace: "[primary source status]"
  evidence_type: [documentation|reporting|analysis|statistics|testimony]
  confidence: [high|medium|low]
  confidence_reasoning: "[why this confidence level]"

result:
  status: verified
  value: "[the value to add]"
  value_type: [item|string|time|quantity]
  precision: [year|month|day]  # for dates
  references:
    - reference_url: "[primary source URL]"
      retrieved: [YYYY-MM-DD]
    - stated_in: [Q-id]  # if applicable
      page: "[page number]"  # if applicable

human_approval: true
approved_by: human
approval_date: [YYYY-MM-DD]
executed: false
```

**Write the file using the Write tool or bash:**
```bash
cat > logs/wikidata-enhance/[filename].yaml << 'EOF'
[YAML content]
EOF
```

Log the file creation to chainlink:
```bash
chainlink comment [subissue_id] "Logged to: logs/wikidata-enhance/[filename].yaml"
```
```

**Step 2: Verify the skill file was updated**

Run: `grep -n "Step 13: Log Approved Claim" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing logging step exists

**Step 3: Commit the logging addition**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): add YAML logging for approved claims

Added to wikidata-enhance-and-check skill:
- YAML log file format specification
- File naming convention (date-item-property.yaml)
- Directory creation instruction
- Chainlink comment for log file reference

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Add Session End and Handoff

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Add session end workflow after Step 13**

Add the following section:

```markdown
## Session End

### Step 14: End Session with Handoff

After logging an approved claim, end the session:

**Update the "Next Steps" section to remove the scaffold placeholder and add:**

```bash
chainlink session end --notes "Item: [Q-id] ([Item Label])
Approved: P[xxx] ([Property Label]) = [value]
Status: APPROVED, awaiting execution
Log file: logs/wikidata-enhance/[filename].yaml
Next session: Execute approved claim, then continue to next property
Remaining properties: [list of unverified properties]"
```

Announce to user:

```
Session complete.

**Approved claim:** [Property Label] = [Value]
**Confidence:** [level]
**Log file:** logs/wikidata-enhance/[filename].yaml

Next session will execute this claim to test.wikidata.org and continue with remaining properties.

To resume: `/wikidata-enhance-and-check`
```

## Session Resume

When resuming a session (no item ID provided):

1. Check chainlink session status:
   ```bash
   chainlink session start
   ```

2. Look for approved-but-not-executed claims in recent handoff notes

3. If found, proceed to claim execution (Phase 5)

4. If no pending execution, continue with next unverified property
```

**Step 2: Remove the scaffold placeholder**

Find and remove or update the section that says "For now, announce: 'Skill scaffold complete. Source discovery and verification will be added in Phase 3.'"

**Step 3: Verify the skill file was updated**

Run: `grep -n "Session End" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing "## Session End" section exists

**Step 4: Commit the session end addition**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): add session end and handoff workflow

Added to wikidata-enhance-and-check skill:
- Session end with chainlink handoff notes
- User-facing session completion message
- Session resume instructions
- Removed scaffold placeholder

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4 Verification

**Done when:**
- Skill presents verification results to human
- Skill uses AskUserQuestion for approval decision
- Skill handles approve/reject/need-more-research paths
- Skill logs approved claims to YAML in `logs/wikidata-enhance/`
- Skill ends session with chainlink handoff notes
- Changes committed to git
