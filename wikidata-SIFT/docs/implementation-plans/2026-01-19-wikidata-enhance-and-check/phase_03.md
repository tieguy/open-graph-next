# Wikidata Enhance and Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add source discovery and SIFT verification to the skill

**Architecture:** Extend the skill to perform WebSearch/WebFetch for sources, apply SIFT framework from methodology doc, and log sources and reasoning to chainlink comments.

**Tech Stack:** Claude Code skill (Markdown), WebSearch, WebFetch, chainlink CLI

**Scope:** Phase 3 of 6 from original design

**Codebase verified:** 2026-01-19

**Dependencies:** Phase 2 (skill scaffold exists)

---

## Phase 3: Source Discovery and Verification

**Goal:** Skill performs source discovery and SIFT verification for a single claim

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

---

### Task 1: Add Source Discovery Section to Skill

**Files:**
- Modify: `skills/wikidata-enhance-and-check/SKILL.md`

**Step 1: Add source discovery workflow after Step 5**

Add the following section after "Step 5: Select Current Property" in the skill file:

```markdown
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
```

**Step 2: Verify the skill file was updated**

Run: `grep -n "Source Discovery" skills/wikidata-enhance-and-check/SKILL.md`

Expected: Line number showing "## Source Discovery" section exists

**Step 3: Commit the source discovery addition**

```bash
git add skills/wikidata-enhance-and-check/SKILL.md
git commit -m "feat(skill): add source discovery and SIFT verification

Added to wikidata-enhance-and-check skill:
- Source discovery workflow (WebSearch/WebFetch)
- Source logging to chainlink comments
- SIFT framework application (Stop, Investigate, Find, Trace)
- Wikidata-specific verification checks
- Confidence level assessment

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3 Verification

**Done when:**
- Skill has source discovery section with WebSearch/WebFetch workflow
- Skill has SIFT framework application instructions
- Skill logs sources and reasoning to chainlink comments
- Skill assesses confidence levels
- Changes committed to git
