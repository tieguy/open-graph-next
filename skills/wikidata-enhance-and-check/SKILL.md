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
