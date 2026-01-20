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
chainlink tree
```

This shows the issue hierarchy. Select the first open subissue under the parent.

Set it as current work:
```bash
chainlink session work [subissue_id]
```

Announce: "Now verifying [property label] for [item label]."

## Source Discovery

### Step 6: Search for Sources

For the current property, search for reliable sources:

**Search strategy:**
1. Start with the item's official/primary sources (official website, government records)
2. Search for secondary sources (encyclopedias, news articles)
3. Check Wikipedia as a starting point, then trace to its sources

**Use WebSearch:**
```
WebSearch: "[Item label] [property] site:britannica.com OR site:wikipedia.org"
WebSearch: "[Item label] official biography"
WebSearch: "[Item label] [property] -wikipedia"
```

**For each promising result, use WebFetch:**
```
WebFetch: [URL]
Prompt: "Extract information about [item]'s [property]. Quote the exact text that states this information."
```

### Step 7: Log Sources to Chainlink

For each source consulted, log it as a comment on the current subissue:

```bash
chainlink comment [subissue_id] "Source: [URL]
Type: [primary|secondary|official|news|academic]
Reliability: [1-5]
Says: [what the source states about this property]
Useful for: [what claims this could support]"
```

**Reliability scale (from docs/wikidata-methodology.md):**
- 5: Government records, official registries, academic publications
- 4: Major news organizations, official organizational websites
- 3: Wikipedia (trace to sources), news aggregators
- 2: Press releases, social media (as leads only)
- 1: State-controlled media on political topics, unverified sources

## SIFT Verification

### Step 8: Apply SIFT Framework

For the claim you're verifying, apply each step of SIFT:

**Stop:**
- Don't accept the claim at face value
- Question: Is this what the sources actually say, or my interpretation?

**Investigate the source:**
- Who published this? What's their authority on this topic?
- Is this a primary source (official record) or secondary (reporting)?
- Log: `chainlink comment [id] "SIFT-Investigate: [source assessment]"`

**Find better coverage:**
- Do other reliable sources confirm this?
- Are there contradictions between sources?
- Log: `chainlink comment [id] "SIFT-Find: [cross-reference findings]"`

**Trace claims:**
- Can you find the original/primary source?
- If using Wikipedia, what sources does it cite?
- Log: `chainlink comment [id] "SIFT-Trace: [primary source found or not]"`

### Step 9: Wikidata-Specific Verification

Before accepting a claim, verify against Wikidata's data model (per docs/wikidata-methodology.md):

1. **Property check:** Is this the right property for this claim?
   - Search test.wikidata.org for the property
   - Check how similar items use this property

2. **Value type:** Does the property expect item, string, date, or quantity?
   - Dates need appropriate precision (year vs. day)
   - Items need Q-numbers

3. **Existing claims:** Does the item already have this property?
   - If yes, does our value conflict?
   - Consider: deprecated rank for superseded values

4. **Qualifiers:** Does this property typically have qualifiers?
   - Start time, end time for things that change
   - Applies to part for partial claims

Log the verification:
```bash
chainlink comment [subissue_id] "Wikidata verification:
Property: P[xxx] ([label])
Value type: [item|string|time|quantity]
Precision: [year|month|day]
Existing claims: [none|matches|conflicts]
Qualifiers needed: [none|list]"
```

### Step 10: Assess Confidence

Based on SIFT analysis and sources, assign confidence level:

- **High**: Primary source confirms, OR multiple reliable secondary sources agree
- **Medium**: Single reliable secondary source, OR primary with minor ambiguity
- **Low**: Source is less reliable, OR claim requires interpretation

Log the assessment:
```bash
chainlink comment [subissue_id] "Confidence: [high|medium|low]
Reasoning: [why this confidence level]
Evidence type: [documentation|reporting|analysis|etc per methodology]"
```

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

## Methodology Reference

For fact-checking methodology (SIFT framework, evidence types, source reliability), see:
`docs/wikidata-methodology.md`

## Session End

### Step 14: End Session with Handoff

After logging an approved claim, end the session:

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
