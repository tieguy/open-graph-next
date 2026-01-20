# Wikidata Methodology Testing Plan

## Summary

This design establishes a systematic testing framework to validate whether LLM-assisted fact-checking can reliably support Wikidata contributions without constant human oversight. The core question being answered is: "Can the SIFT methodology (Stop, Investigate, Find better coverage, Trace claims) achieve accuracy high enough to justify removing human approval gates from the fact-checking pipeline?"

The approach uses staged autonomy testing: the existing `wikidata-enhance-and-check` skill will run against production Wikidata entities (read-only, requiring no permissions), propose claims based on SIFT verification, and log those proposals without executing them. A human reviewer then verifies whether each proposed claim would have been correct. After 200+ claims across diverse entity types (people, organizations, creative works), the resulting accuracy metrics will determine whether autonomous operation is viable (≥99% accuracy), needs iteration (<95%), or requires hybrid human oversight (95-99%). All results are logged in machine-readable YAML format to support analysis of failure modes, confidence calibration, and documentation for eventual bot approval requests.

## Definition of Done

- SIFT accuracy measured across 200+ claims on mixed entity types (humans, organizations, creative works)
- Failure modes categorized and documented
- Confidence threshold calibrated (if accuracy supports staged autonomy)
- Methodology essay drafted for bot user page
- Go/no-go decision documented for production bot approval
- All test results logged in machine-readable format

## Glossary

- **SIFT methodology**: A fact-checking framework consisting of four steps: Stop (don't accept claims at face value), Investigate the source (assess authority), Find better coverage (cross-reference multiple sources), and Trace claims (locate primary sources). Used to verify Wikidata claims before adding them.
- **Wikidata**: A free, collaborative knowledge base maintained by the Wikimedia Foundation that stores structured data in the form of items, properties, and claims. Acts as central storage for Wikipedia and other Wikimedia projects.
- **Wikidata claim**: A statement about an entity in Wikidata, consisting of a property (e.g., "date of birth") and a value (e.g., "1952-03-11"). Claims require references to be considered complete.
- **pywikibot**: The Python library and framework for interacting with Wikimedia projects, including reading and writing Wikidata items.
- **test.wikidata.org**: A sandboxed testing instance of Wikidata where edits can be made without affecting production data. Used for development and testing.
- **Staged autonomy**: A progressive testing approach where automation control increases as confidence in accuracy grows. Early stages require human verification of every decision; later stages may operate autonomously if accuracy thresholds are met.
- **Chainlink**: A session management tool used in this project to track fact-checking work across conversations, preserving context and creating audit trails.
- **Bot approval**: The Wikidata community process for authorizing automated tools to make edits. Requires demonstrating methodology, transparency, and compliance with community standards.
- **YAML logging**: Structured machine-readable logging format used to record fact-checking provenance, including sources consulted, confidence scores, and verification results.
- **Failure mode**: A categorization of why a proposed claim would have been incorrect (e.g., hallucinated source, misread source, wrong property selection, insufficient precision).
- **Entity types**: Categories of Wikidata items being tested. This design uses three types: humans (people), organizations (companies, institutions), and creative works (books, films, songs).

## Architecture

Staged autonomy testing framework that progressively measures whether human approval gates can be removed from the `wikidata-enhance-and-check` skill.

**Testing Flow:**
```
Read entity from production Wikidata (no approval needed)
    → System selects properties to verify
    → SIFT methodology runs (fetch real sources)
    → Proposed claim logged (NOT executed)
    → Human verifies: would this claim be correct?
    → Log result with failure mode if applicable
```

**Staged Autonomy Progression:**

| Stage | Human Role | What We Measure |
|-------|-----------|-----------------|
| 1 | Verifies every SIFT conclusion | Baseline accuracy, property selection quality |
| 2 | Reviews only low-confidence claims | Confidence threshold calibration |
| 3+ | Trust SIFT if accuracy ≥99% | Go/no-go for autonomous operation |

**Key Insight:** The critical question is whether SIFT accuracy is high enough to remove human approval. Stage 1 measures this directly. If accuracy is below 95%, fundamental methodology issues exist. If above 99%, autonomous operation may be feasible.

**Data Flow:**
- **Input:** Production Wikidata entities (read-only, no approval required)
- **Processing:** Existing SIFT skill pipeline with execution disabled
- **Output:** YAML logs with accuracy metrics and failure mode categorization

## Existing Patterns

This design builds on the existing `wikidata-enhance-and-check` skill implemented in `skills/wikidata-enhance-and-check/SKILL.md`.

**Patterns followed from existing skill:**
- SIFT methodology for source verification (Steps 8-10 of existing skill)
- YAML structured logging to `logs/wikidata-enhance/` (Step 13)
- Chainlink session tracking for audit trail
- Human approval gates via `AskUserQuestion`

**Patterns extended for testing:**
- Existing skill targets test.wikidata.org for writes; testing reads from production Wikidata
- Existing skill executes approved claims; testing logs proposed claims without execution
- Existing logging schema extended with `human_verification` and `failure_mode` fields

**Configuration change:** pywikibot reads pointed at production (`wikidata`) instead of test, but all write operations remain disabled or pointed at test.wikidata.org.

## Implementation Phases

### Phase 1: Testing Infrastructure
**Goal:** Extend skill and logging to support methodology validation

**Components:**
- Modified skill variant in `skills/wikidata-enhance-and-check/` that reads production Wikidata
- Extended YAML logging schema with verification result fields
- Entity selection list (60 entities: 20 humans, 20 orgs, 20 creative works)

**Dependencies:** None (existing skill is complete)

**Done when:** Can read production Wikidata entity, run SIFT pipeline, log proposed claim with human verification fields

### Phase 2: Stage 1 Testing Execution
**Goal:** Measure baseline SIFT accuracy with human verification of every claim

**Components:**
- Test execution script or manual process for running 200+ verifications
- Human verification workflow (review each SIFT conclusion, log correctness)
- Failure mode taxonomy (hallucinated source, misread source, wrong property, etc.)

**Dependencies:** Phase 1 (testing infrastructure)

**Done when:** 200+ claims verified, accuracy metrics calculated, failure modes categorized

### Phase 3: Analysis and Calibration
**Goal:** Analyze results, calibrate confidence thresholds, make go/no-go decision

**Components:**
- Accuracy analysis by entity type and property type
- Confidence threshold analysis (if applicable)
- Failure mode report with examples
- Go/no-go recommendation document

**Dependencies:** Phase 2 (test execution complete)

**Done when:** Analysis complete, decision documented on whether to proceed to Stage 2 or iterate methodology

### Phase 4: Transparency Documentation
**Goal:** Prepare methodology essay and edit summary format for bot approval

**Components:**
- Methodology essay for bot user page (explains SIFT, sources, oversight)
- Edit summary format with LLM disclosure
- Link structure between edit summaries and detailed logs

**Dependencies:** Phase 3 (methodology validated or iterated)

**Done when:** Documentation ready for community review

### Phase 5: Production Readiness (Conditional)
**Goal:** Prepare for bot approval request if methodology passes validation

**Components:**
- Bot account setup on production Wikidata
- Bot user page with methodology essay and `{{bot}}` template
- Approval request draft for Wikidata:Requests for permissions/Bot
- 50-250 test edit evidence (may use test.wikidata.org per policy)

**Dependencies:** Phase 4 (documentation complete), Phase 3 go decision

**Done when:** Ready to file bot approval request

## Additional Considerations

**Testing uses read-only access:** Production Wikidata reads require no approval. This allows thorough methodology validation before entering the bot approval process.

**Wikidata community concerns addressed:**
- Hallucinated references: Primary community concern. SIFT accuracy measurement directly tests this.
- LLM disclosure: Edit summaries will include "LLM-assisted" per community expectations (no formal mandate, but strong preference).
- Transparency: Three-tier stack (edit summary → methodology essay → YAML logs) provides full audit trail.

**Success threshold:** 99% SIFT accuracy required for autonomous operation. Below 95% indicates fundamental issues requiring methodology iteration. Between 95-99% may support partial autonomy (human spot-checks on low-confidence claims only).

**Policy alignment:** Wikidata bot policy requires sources for all statements. The existing SIFT methodology already enforces this. The testing plan validates that SIFT's source selection is reliable.
