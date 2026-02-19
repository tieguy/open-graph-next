---
name: sift-patrol
description: Verify an unpatrolled Wikidata edit using the SIFT methodology, producing a structured verdict
---

# SIFT-Patrol: Edit Verification

## Purpose

This skill exists to apply rigorous, critical scrutiny to every Wikidata edit, treating each claim as unverified until independent evidence confirms it.

Your role is that of a skeptical reviewer. A claim having a reference attached does not make it correct — the reference might not support the claim, might be unreliable, or might be fabricated. Every edit should get the same thorough treatment: investigate what's cited, search for independent corroboration, and only then render a verdict based on the evidence you actually found.

The process for evaluation is based on the SIFT (Stop, Investigate, Find, Trace) methodology. You will receive an enriched edit record, investigate sources, search for corroboration, and produce a structured assessment.

## Input

You receive:
1. An **enriched edit record**
2. A **verification question**, specifying which edit is to be verified

The edit record contains:
- `parsed_edit`: operation, property, property_label, value_raw, value_label
- `edit_diff`: type, old_value, new_value (if available)
- `item`: full current item state (label, description, all claims with resolved labels)
- `removed_claim`: for removal edits, the deleted claim
- `user`, `tags`, `timestamp`: editor context (for situational awareness only)
- `group_id`, `group_seq`, `group_size`: edit session context
- `prefetched_references`: pre-fetched reference URL content (dict mapping URL to `{status, extracted_text, error, fetch_date}`). Present when enrichment ran with prefetching enabled.

## Workflow

### Step 1: Understand the Edit

Read the enriched edit record carefully. Identify:

- **What changed:** Which property was modified, what value was added/removed/changed
- **Item context:** What kind of entity is this? (check P31/instance of) What other claims exist?
- **Edit context:** Is this part of a batch of edits (group_size > 1)? What do the tags suggest?

Formulate your understanding in one sentence before proceeding.

### Step 2: Investigate the Source (SIFT: Investigate)

Check whether the edit's claim has cited references. Look in `item.claims.[property].statements[].references` for the relevant statement.

**If references exist on the claim:**
1. Check `prefetched_references` first. For each reference URL:
   - If `prefetched_references[url].extracted_text` exists, use it directly instead of WebFetch
   - If `prefetched_references[url].error` is `"blocked_domain"`, do NOT attempt WebFetch — record as "unreachable (blocked domain)" and move on
   - If `prefetched_references[url].status` is an HTTP error (403, 404, etc.), do NOT retry with WebFetch
   - Only use WebFetch for URLs not present in `prefetched_references`
2. For each reference, determine:
   - Is the URL reachable?
   - Does the content actually support the specific claim being made?
   - Is the source authoritative for this type of claim?
3. Record your assessment for each reference

**Sources to avoid:**
- **Wikipedia** (`*.wikipedia.org`): NEVER use as a Wikidata reference source. Wikipedia cites Wikidata, so using it as a source is circular. If a claim's only reference is a Wikipedia URL, treat it as "no reference."
- **Known blocked domains**: Sites that block automated access (Britannica, IMDb, LinkedIn, social media). If a reference points to a blocked domain, record as "unreachable (blocked domain)" and do not waste time retrying.

**If no references exist:**
- Note the gap: "No references cited for this claim"

**If a URL is unreachable:**
- Record as: "Reference exists but content unverifiable (URL returned [status code])"
- Do not treat unreachable as evidence against the claim

**Regardless of what Step 2 finds, always proceed to Step 3.** Even well-referenced claims need independent corroboration — a cited source might not actually support the claim, might be unreliable, or might be the only source because the claim is wrong.

### Step 3: Find Independent Coverage (SIFT: Find)

Search for independent sources that confirm or deny the claim, whether or not the edit already cites references. A claim supported by its own reference but contradicted by independent sources is suspect. A claim with no references but confirmed by multiple independent sources is strong.

**Default search strategy:**
```
Search: "[item_label] [property_label] [value_label]"
```

1. Use WebSearch with the default query
2. If the default query returns poor results, try variations:
   - `"[item_label] [value_label]"` (drop property)
   - `"[value_label] [property_label]"` (drop item)
   - Translated terms if the entity is non-English
3. Use WebFetch to read the most promising results (up to 3)
4. For each source, classify:
   - **provenance**: `verified` (you fetched and read it) or `reported` (mentioned by another source)
   - **supports_claim**: `true`, `false`, or `unknown`
   - Brief summary of what the source says

**External identifier edits** (P2930 INSPIRE-HEP, P496 ORCID, P345 IMDb, P213 ISNI, etc.):
When the edit changes or adds an external identifier value, check the target service's API or lookup endpoint directly (e.g. `inspirehep.net/api/authors/...`, `orcid.org/...`). But confirming the ID exists is **necessary but not sufficient** — you must also cross-reference the API response against the Wikidata item's other claims to verify it's the same entity. Match on at least two independent facts (e.g. employer + dates, affiliation + advisor, birth year + nationality). A name match alone does not confirm identity.

**Source provenance rules:**
- Only mark a source as `provenance: verified` if you directly fetched and read it with WebFetch or it was in `prefetched_references`
- If source A mentions source B but you did not fetch source B, mark B as `provenance: reported` — do NOT treat B's claimed content as verified evidence
- Never propose a reference URL you haven't actually fetched and confirmed. Citing a URL from a secondary source's bibliography without reading it is citation laundering.
- If you can only find reported sources, say so in the rationale — this limits the verdict to `verified-low` at best

### Step 4: Trace (SIFT: Trace) -- Conditional

**Run this step only if:**
- Step 2 and Step 3 produced contradictory evidence
- Only secondary sources were found (no primary/official source)

**If triggered:**
1. Identify the most authoritative possible source for this type of claim
2. Search specifically for that source
3. Attempt to resolve contradictions by finding the original/primary source

**If Step 3 found clear, consistent corroboration from reliable sources, skip this step.**

### Step 5: Verdict

Synthesize all evidence gathered above. Do NOT use any web tools in this step.

**Classify the edit with one of these verdicts:**

| Verdict | Meaning |
|---------|---------|
| `verified-high` | Strong evidence supports the claim (primary source or multiple independent sources) |
| `verified-low` | Some evidence supports, but sources are weak or indirect |
| `plausible` | Claim is consistent with available information but no direct confirmation found |
| `unverifiable` | Cannot find sufficient evidence to confirm or deny. Use this when a cited source cannot be located or accessed — failing to find a source is not the same as the source not existing. |
| `suspect` | Evidence suggests the claim may be incorrect |
| `incorrect` | Clear evidence **directly contradicts** the claim. Do not use this merely because a cited source could not be found — that is `unverifiable`, not `incorrect`. |

**For removal edits**, the question is whether the removal was justified:

| Verdict | Meaning for removals |
|---------|---------------------|
| `verified-high` | Strong evidence that the removed value was wrong |
| `verified-low` | Some evidence the removal was warranted |
| `suspect` | The removed value actually appears correct |
| `incorrect` | Clear evidence the removed value was correct (removal was wrong) |

**Propose improvements** where applicable:
- Missing qualifiers that sources support (e.g., start time, end time)
- Better references than what's cited
- Related claims that should be updated for consistency
- Precision improvements (e.g., year -> day for dates)

### Step 6: Output

Produce the verdict as a YAML block. This is the primary output of the skill.

```yaml
edit:
  qid: QXXXXX
  property: PXXX
  property_label: "..."
  value: QXXXXX            # or a literal value
  value_label: "..."
  diff_type: value_changed  # or statement_added, statement_removed, etc.

verification_question: >
  The natural-language question from Phase 1 pre-processing,
  included for debugging and traceability.

sources:
  # Every source consulted, whether it helped or not
  - url: https://example.com/primary-source
    provenance: verified    # fetched and read by tool
    source_type: primary    # primary, secondary, or tertiary
    supports_claim: true
    summary: "One sentence describing what this source says about the claim"
  - url: https://example.com/aggregator
    provenance: verified
    source_type: tertiary
    supports_claim: unknown
    summary: "Page exists but doesn't mention the subject"
  - citation: "Title of source mentioned by another source"
    provenance: reported    # mentioned by another source, not directly read
    source_type: secondary
    supports_claim: unknown

verdict: verified-high
rationale: >
  2-4 sentences explaining why this verdict was chosen,
  citing specific sources and their evidence.

trace_triggered: false

improvements:
  - "Describe a specific improvement with property IDs where applicable"
```

**Output schema fields:**

- `edit`: Structured summary of what was changed
  - `qid`: Item Q-id (from `title`)
  - `property`: Property P-id
  - `property_label`: Resolved property name
  - `value`: Raw value (Q-id or literal)
  - `value_label`: Resolved value name
  - `diff_type`: Type of change (from `edit_diff.type` or inferred from operation)
- `verification_question`: The natural-language question from Phase 1, for debugging/traceability
- `sources`: List of all sources consulted
  - `url` or `citation`: How to find the source
  - `provenance`: `verified` (fetched) or `reported` (heard about)
  - `source_type`: `primary` (official/original record), `secondary` (reporting on primary), or `tertiary` (aggregator/database compiling from other sources)
  - `supports_claim`: `true`, `false`, or `unknown`
  - `summary`: One sentence about what the source says
- `verdict`: One of: `verified-high`, `verified-low`, `plausible`, `unverifiable`, `suspect`, `incorrect`
- `rationale`: 2-4 sentences explaining the verdict
- `trace_triggered`: Whether Step 4 was needed
- `improvements`: List of suggested improvements (may be empty)

### Step 7: Save Log

Save the full verdict YAML to:
```
logs/wikidata-patrol-experiment/verdicts/[date]-[qid]-[property].yaml
```

Include a metadata header:
```yaml
---
skill: sift-patrol
date: 2026-02-18
edit_rcid: 2540426022
edit_revid: 2464238434
model: [model used]
---
# verdict YAML follows
```

## Design Notes

- **One edit at a time.** Group metadata provides context but each edit gets its own verdict.
- **No editor identity signals.** We assess the edit on its merits, not the editor's reputation.
- **Generic search strategy first.** If the default search fails for a property class, that's valuable data -- note it in the verdict rather than adding special-case logic prematurely.
- **Source provenance is mandatory.** Every source must be marked `verified` or `reported`. This is the core quality signal.
- **Phases are designed to be splittable.** Each step has clear inputs and outputs so it can later be routed to a different model tier (Haiku for parsing, Sonnet for search, Opus for synthesis).
