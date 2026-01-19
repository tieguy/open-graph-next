# Wikidata Enhance and Check Skill Design

## Summary

This design introduces a Claude Code skill (`wikidata-enhance-and-check`) that enables systematic, fact-checked enhancements to Wikidata test items through a human-in-the-loop workflow. The skill orchestrates a multi-session process where Claude discovers and evaluates sources using the SIFT framework, presents findings for human approval, logs verified claims in structured YAML format for research analysis, and executes approved edits to test.wikidata.org via pywikibot. Each session is deliberately scoped to verify one claim, with chainlink tracking progress across sessions through issues (per item) and subissues (per property), ensuring clean handoff points and full provenance chains.

The implementation extracts the existing fact-checking methodology from the superprompt into reusable documentation, then builds the skill incrementally: scaffolding the session lifecycle, adding source discovery and SIFT verification, enabling human approval and logging, implementing claim execution, and finally verifying end-to-end functionality. This architecture balances research goals (understanding what rigorous fact-checking requires) with practical constraints (context limits, session continuity, human oversight), while maintaining strict safety boundaries by only targeting Wikidata's test instance.

## Definition of Done

- Skill `wikidata-enhance-and-check` exists and can be invoked with a Wikidata item ID
- Given an item ID, skill asks human what properties to verify
- For each property, skill discovers sources via WebSearch/WebFetch
- Skill applies SIFT framework to verify claims
- Human approves or rejects each verified claim via AskUserQuestion
- Approved claims are logged to `logs/wikidata-enhance/` in YAML format
- Chainlink tracks the enhancement session (issue per item, subissue per property)
- Session ends after one claim is verified and approved
- Next session executes the approved claim to test.wikidata.org via pywikibot
- All operations target test.wikidata.org only (never production)

## Glossary

- **Chainlink**: Session management tool used by this project to track fact-checking tasks across conversations, creating issues for work items and subissues for discrete verification steps
- **Claim**: In Wikidata's data model, a statement asserting a property-value relationship about an item (e.g., "Douglas Adams" → "date of birth" → "1952-03-11")
- **pywikibot**: Python library for programmatic interaction with Wikimedia projects, used here to read Wikidata items and execute verified edits to test.wikidata.org
- **Property**: In Wikidata, a defined relationship type (e.g., P569 for "date of birth") that can be asserted about items, with each property having specific constraints and expected value types
- **SIFT framework**: Fact-checking methodology (Stop, Investigate the source, Find better coverage, Trace claims) that structures verification of information before accepting it as reliable
- **Skill**: Claude Code's extension mechanism, defined in SKILL.md files, providing specialized workflows that can be invoked via slash commands (e.g., `/wikidata-enhance-and-check`)
- **SPARQL**: Query language for Wikidata's knowledge graph, enabling structured queries like "find all humans without occupation statements"
- **Superprompt**: Large instructional prompt (here: `prompts/wikidata-fact-check.md`) that guides LLM behavior for specific tasks, being refactored into modular methodology documentation
- **test.wikidata.org**: Wikidata's test instance for development and experimentation, isolated from production data—the only write target permitted by this project's safety constraints
- **Wikidata item**: Uniquely identified entity in Wikidata (e.g., Q42 for Douglas Adams) consisting of labels, descriptions, and claims with supporting references
- **YAML logging**: Structured machine-readable output format used to capture verification provenance (sources consulted, reasoning applied, confidence levels) for research analysis

## Architecture

Claude Code skill orchestrating fact-checked Wikidata enhancements with human approval and chainlink session tracking.

**Components:**

1. **Skill** (`skills/wikidata-enhance-and-check/SKILL.md`)
   - Entry point for the workflow
   - Orchestrates verification phases
   - Handles human interaction via AskUserQuestion
   - Manages chainlink session lifecycle

2. **Methodology Reference** (`docs/wikidata-methodology.md`)
   - SIFT framework details
   - Evidence type taxonomy
   - Source reliability guidelines
   - Extracted from existing superprompt, shared across future skills

3. **pywikibot** (existing, external)
   - Reads item data from Wikidata
   - Executes verified claims to test.wikidata.org
   - Queries property definitions

4. **Chainlink** (existing, external)
   - Issue per item being enhanced
   - Subissue per property being verified
   - Comments store discovered sources and verification reasoning
   - Session handoff notes for continuity

5. **Log files** (`logs/wikidata-enhance/`)
   - YAML files per verified claim
   - Research provenance for analysis

**Data flow:**
```
User invokes: /wikidata-enhance-and-check Q42
    |
    v
Skill creates/resumes chainlink issue for Q42
    |
    v
If approved claim exists from previous session:
    -> Execute it via pywikibot
    -> Close that subissue
    |
    v
AskUserQuestion: "What properties to verify?"
    -> Create subissues for each property
    |
    v
Pick first open subissue (property to verify)
    -> chainlink session work <subissue_id>
    |
    v
Source discovery (WebSearch/WebFetch)
    -> Log sources as chainlink comments
    |
    v
Apply SIFT framework
    -> Log reasoning as chainlink comment
    |
    v
AskUserQuestion: Present finding for human approval
    |
    +-- If approved: Log to YAML, end session
    |                (next session executes)
    |
    +-- If rejected: Log reason, close subissue, continue
```

## Existing Patterns

**Chainlink usage:** The project's CLAUDE.md already documents chainlink workflow patterns for fact-checking sessions. This design follows those patterns:
- Issue per item/task
- Subissues for discrete work units
- Comments for progress and context
- Session start/end with handoff notes

**Superprompt structure:** `prompts/wikidata-fact-check.md` provides the SIFT methodology and YAML output schema. This design extracts reusable methodology into `docs/wikidata-methodology.md` while the skill handles workflow orchestration.

**pywikibot patterns:** The project's CLAUDE.md documents pywikibot usage patterns for reading items and adding claims with references. The skill will use these patterns.

**No existing skill patterns:** This is the first Claude Code skill in this project. The skill structure follows ed3d-plugins conventions (SKILL.md with workflow instructions referencing methodology docs).

## Implementation Phases

### Phase 1: Methodology Documentation
**Goal:** Extract reusable fact-checking methodology from superprompt into reference document

**Components:**
- `docs/wikidata-methodology.md` - SIFT framework, evidence types, source reliability guidelines
- Update or archive `prompts/wikidata-fact-check.md`

**Dependencies:** None

**Done when:** Methodology document exists with SIFT framework, evidence type taxonomy, and source reliability guidelines clearly documented

### Phase 2: Skill Scaffold
**Goal:** Create minimal skill that can be invoked and interacts with chainlink

**Components:**
- `skills/wikidata-enhance-and-check/SKILL.md` - skill workflow instructions
- Skill handles: session start, item identification, chainlink issue creation

**Dependencies:** Phase 1 (skill references methodology doc)

**Done when:** `/wikidata-enhance-and-check Q42` can be invoked, creates chainlink issue, asks human for properties to verify

### Phase 3: Source Discovery and Verification
**Goal:** Skill performs source discovery and SIFT verification for a single claim

**Components:**
- Extend skill with source discovery workflow (WebSearch/WebFetch)
- Add SIFT framework application instructions
- Add chainlink comment logging for sources and reasoning

**Dependencies:** Phase 2

**Done when:** Given a property to verify, skill finds sources, applies SIFT, logs reasoning to chainlink comments

### Phase 4: Human Approval and Logging
**Goal:** Skill presents findings to human and logs approved claims

**Components:**
- Add AskUserQuestion for claim approval
- Add YAML logging to `logs/wikidata-enhance/`
- Add session end with handoff notes

**Dependencies:** Phase 3

**Done when:** Skill presents verification results, human can approve/reject, approved claims logged to YAML, session ends cleanly with handoff

### Phase 5: Claim Execution
**Goal:** Skill executes approved claims from previous session

**Components:**
- Add pywikibot execution logic to skill
- Add resume-from-handoff logic (check for approved-but-not-executed claims)
- Add execution confirmation and subissue closure

**Dependencies:** Phase 4

**Done when:** On session start, skill detects approved claim from handoff, executes via pywikibot to test.wikidata.org, closes subissue, continues to next property

### Phase 6: End-to-End Verification
**Goal:** Verify complete workflow works across multiple sessions

**Components:**
- Test full cycle: invoke -> verify claim -> approve -> end session -> resume -> execute -> next claim
- Verify chainlink state is correct at each step
- Verify logs are written correctly

**Dependencies:** Phase 5

**Done when:** Multi-session workflow completes successfully, chainlink shows correct issue/subissue state, logs contain expected YAML output, test.wikidata.org has the verified claim

## Additional Considerations

**Safety:** All pywikibot operations target test.wikidata.org only. The skill must explicitly verify the target before any write operation. This is already enforced in pywikibot config but the skill should double-check.

**Evolution path:** MVP uses human-specified properties. Future versions will add:
- SPARQL-based gap analysis CLI tool (cached, invoked by skill)
- Subagent architecture (separate verify/execute agents)
- Multiple entry points (source-first, batch processing)
- Confidence threshold automation

**Session atomicity:** Each session verifies one claim. This is intentional - it keeps sessions short, reduces context pressure, and provides clean handoff points. If this proves too granular, future versions could batch multiple claims per session.
