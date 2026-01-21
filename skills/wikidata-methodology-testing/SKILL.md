---
name: wikidata-methodology-testing
description: Test SIFT methodology accuracy by reading production Wikidata, proposing claims, and logging for human verification (no execution)
---

# Wikidata Methodology Testing

## Purpose

Measure SIFT methodology accuracy by:
1. Reading entities from production Wikidata
2. Running full SIFT verification pipeline
3. Proposing claims (WITHOUT executing)
4. Logging for human verification

**This skill does NOT write to Wikidata.** All proposed claims are logged only.

## Safety

**READ-ONLY:** This skill reads from production Wikidata but never writes.

```python
# Read from production Wikidata
site = pywikibot.Site('wikidata', 'wikidata')  # Production for reading
repo = site.data_repository()
# NO write operations - logging only
```

## Workflow

### Step 1: Select Test Entity

Load entity from `docs/test-entities.yaml` or accept Q-id as argument.

```
/wikidata-methodology-testing Q42
```

### Step 2: Fetch Entity from Production Wikidata

```python
import pywikibot

site = pywikibot.Site('wikidata', 'wikidata')
repo = site.data_repository()
item = pywikibot.ItemPage(repo, '[Q-id]')
item.get()

# Extract current claims, labels, descriptions
```

### Step 3: System Selects Properties

Based on entity type (detected from P31), propose properties to verify:

**For humans (P31 = Q5):**
- P569 (date of birth)
- P570 (date of death)
- P27 (country of citizenship)
- P106 (occupation)
- P21 (sex or gender)

**For organizations (P31 = Q43229 or subclasses):**
- P571 (inception)
- P576 (dissolved/abolished)
- P17 (country)
- P159 (headquarters location)
- P112 (founded by)

**For creative works (P31 = Q7725634 or subclasses):**
- P577 (publication date)
- P50 (author)
- P123 (publisher)
- P495 (country of origin)
- P136 (genre)

Log which properties were selected and why.

### Step 4: Run SIFT Verification

For each selected property, follow the full SIFT methodology from `docs/wikidata-methodology.md`:

1. **Source Discovery:** Use WebSearch to find sources
2. **Stop:** Question assumptions
3. **Investigate:** Assess source authority
4. **Find:** Cross-reference multiple sources
5. **Trace:** Locate primary sources

### Step 4b: Check for Redundancy

**BEFORE proposing any claim, check if the information already exists:**

```bash
python scripts/check_redundancy.py Q42 P512
```

**Output if redundant (exit code 2):**
```
⚠ REDUNDANT: P512 already exists on Douglas Adams (Q42)

  • Qualifier on P69 (St John's College): P512 = Bachelor of Arts
```

**Output if not redundant (exit code 0):**
```
✓ OK: P512 not found on Douglas Adams (Q42)
  Property can be added as a new claim.
```

**If redundant:**
- Set `claim_status: redundant` in the log
- Set `quickstatements: null`
- Add comment explaining where the data already exists (copy from script output)
- Skip to next property

### Step 5: Propose Claim (No Execution)

For each verified property, create a proposed claim.

**CRITICAL: Verify ALL Q-ids via lookup.** LLMs hallucinate plausible-looking Q-ids. Never trust a Q-id from memory.

**For every Q-id in your claim (values, qualifiers, references), you MUST verify using:**

```bash
# Verify a Q-id matches expected label
python scripts/verify_qid.py Q1765120 "Bachelor of Arts"
# Output: ✓ MATCH or ✗ MISMATCH

# Search for the correct Q-id by label
python scripts/verify_qid.py --search "Bachelor of Arts"
# Output: List of matching Q-ids with descriptions

# Just check what a Q-id is
python scripts/verify_qid.py Q4917336
# Output: Q4917336: Bishangarh (City in Rajasthan, India)
```

**Example of catching a hallucinated Q-id:**
```
$ python scripts/verify_qid.py Q4917336 "Bachelor of Arts"
Q4917336: Bishangarh
  Description: City in Rajasthan, India
  ✗ MISMATCH: Expected 'Bachelor of Arts', got 'Bishangarh'
```

**Proposed claim format:**

```yaml
proposed_claim:
  property: P569
  property_label: date of birth
  proposed_value: "1952-03-11"
  value_type: time
  precision: day
  references:
    - url: "https://example.com/source"
      retrieved: 2026-01-20
  confidence: high
  confidence_reasoning: "Primary source confirmed"
```

**DO NOT EXECUTE.** This is proposal only.

### Step 6: Log for Human Verification

Write to `logs/wikidata-methodology-testing/[date]-[Q-id]-[P-id].yaml`:

```yaml
test_date: [YYYY-MM-DD]
entity: [Q-id]
entity_label: [label]
entity_type: [human|organization|creative_work]

property: [P-id]
property_label: [label]
property_selected_by: system
claim_status: [existing|new|redundant]  # existing=verifying, new=proposing, redundant=info exists elsewhere (e.g., as qualifier)

sources_consulted:
  - source_name: "[human-readable name]"
    source_type: [encyclopedia|official_website|news|academic|database|other]
    reliability: [1-5]
    useful_for: "[what this source provides]"
    wikidata_ref:  # How this would be cited in Wikidata
      P248: [Q-id]        # stated in (for known publications)
      P854: "[url]"       # reference URL
      P813: [YYYY-MM-DD]  # retrieved date
      P1476: "[title]"    # title (optional)
    human_readable:
      stated_in: "[publication name or null]"
      url: "[url]"
      retrieved: [YYYY-MM-DD]

sift_verification:
  stop: "[what was questioned]"
  investigate: "[source assessment]"
  find_better: "[cross-reference findings]"
  trace: "[primary source status]"

proposed_claim:
  value: "[proposed value]"
  value_type: [item|string|time|quantity]
  value_qid: [Q-id if item type, null otherwise]
  precision: [if applicable for dates: year|month|day]
  qualifiers:  # Optional additional context
    # P580: start_time
    # P582: end_time
    # etc.
  confidence: [high|medium|low]
  confidence_reasoning: "[reasoning]"
  primary_reference:  # The best reference for this claim
    wikidata_ref:
      P248: [Q-id]        # stated in
      P854: "[url]"       # reference URL
      P813: [YYYY-MM-DD]  # retrieved
    human_readable:
      stated_in: "[publication name]"
      url: "[url]"
      retrieved: [YYYY-MM-DD]

# QuickStatements format for easy Wikidata entry (pipe-separated)
# Paste into https://quickstatements.toolforge.org/
quickstatements: "[entity]|[property]|[value]|[qualifiers...]|[references...]"

# HUMAN FILLS IN AFTER REVIEW:
human_verification:
  reviewed_by: null
  review_date: null
  sift_correct: null  # true/false - Was the SIFT methodology correctly applied?
  proposed_value_correct: null  # true/false - Is the proposed value accurate?
  actual_value: null  # if different from proposed
  failure_mode: null  # hallucinated_source|hallucinated_qid|misread_source|wrong_property|incorrect_value|insufficient_precision|other
  notes: null
```

**Reference Property Quick Reference:**
- P248 (stated in): For known publications (encyclopedias, books, databases) - use the Q-id
- P854 (reference URL): The actual URL of the source
- P813 (retrieved): Date the source was accessed
- P1476 (title): Title of the webpage/article (optional)
- P123 (publisher): Who published it (optional)
- P577 (publication date): When the source was published (optional)

### Step 7: Present for Human Verification

After logging, present the proposed claim to human:

```
Proposed claim for [Entity Label] ([Q-id]):

Property: [P-id] ([Property Label])
Proposed Value: [value]
Confidence: [high/medium/low]

Sources consulted:
1. [source 1] (reliability: X/5)
2. [source 2] (reliability: X/5)

SIFT Analysis:
- Stop: [what was questioned]
- Investigate: [source assessment]
- Find: [cross-references]
- Trace: [primary source]

Log file: logs/wikidata-methodology-testing/[filename].yaml

Please verify and update the human_verification section of the log file.
```

## Metrics Tracked

After testing completes, analyze logs for:
- **Property selection appropriateness:** Did system select sensible properties?
- **Source fetchability rate:** What % of sources were accessible?
- **SIFT accuracy rate:** What % of proposed claims were correct?
- **Failure mode distribution:** Which error types are most common?
- **Accuracy by entity type:** Do humans/orgs/works differ?
- **Accuracy by property type:** Which properties are harder?
