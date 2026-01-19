# TODO: Wikidata Fact-Checking Experiment

## Superprompt Refinements Needed

### Output Format
- [ ] Test the YAML output schema with actual fact-checking sessions
- [ ] Determine if JSON would be better than YAML for parsing
- [ ] Add schema validation (JSON Schema or similar)
- [ ] Create example log files showing expected output
- [ ] Consider adding a "compact" vs "verbose" output mode

### Wikidata-Specific Adaptations
- [ ] Expand property mapping examples (current list is minimal)
- [ ] Add guidance for quantity values (units, precision)
- [ ] Add guidance for coordinate/geographic values
- [ ] Document common qualifier patterns (start time, end time, point in time, etc.)
- [ ] Add section on handling deprecated claims vs. adding competing claims
- [ ] Document when to use `unknown value` vs. leaving claim absent

### Evidence Type Refinements
- [ ] Test whether the 6-type taxonomy is sufficient or needs expansion
- [ ] Add more Wikidata-specific examples for each evidence type
- [ ] Clarify handling of sources that don't fit neatly (e.g., Wayback Machine captures)
- [ ] Add guidance on self-published sources (when acceptable for Wikidata, when not)

### Missing from Current Superprompt
- [ ] Image/photo analysis sections from original (not relevant for initial Wikidata work?)
- [ ] Template hotkeys (`context report`, `cnote`) - decide if these apply
- [ ] Multi-language source handling
- [ ] Handling of sources behind paywalls

## Chainlink Integration

### Workflow Questions
- [ ] Test actual chainlink CLI with this workflow
- [ ] Determine best granularity for issues (one per claim? per item? per session?)
- [ ] Design labels/tags for tracking claim status (verified, rejected, pending)
- [ ] Consider whether chainlink comments should mirror the YAML log format

### Session Management
- [ ] Create a session initialization checklist
- [ ] Document how to handle interrupted sessions
- [ ] Design handoff note format for maximum usefulness

## Logging Infrastructure

### Directory Structure
- [ ] Create `logs/` directory structure (by date? by item? by session?)
- [ ] Decide on log file naming convention
- [ ] Create `.gitignore` rules for logs (or should they be committed?)

### Log Analysis
- [ ] Design queries/scripts for analyzing logged sessions
- [ ] Track metrics: claims verified per session, confidence distribution, source types used
- [ ] Create summary report format

## Testing and Validation

### Superprompt Testing
- [ ] Run fact-checking sessions on known-good claims (should verify)
- [ ] Run on known-bad claims (should reject)
- [ ] Run on ambiguous claims (should flag appropriately)
- [ ] Test with different claim types (dates, items, quantities, strings)

### Wikidata Integration Testing
- [ ] Verify pywikibot connection to test.wikidata.org
- [ ] Test creating a claim from logged output
- [ ] Test full workflow: fact-check -> log -> human review -> pywikibot edit

## Documentation

- [ ] Add examples of complete fact-checking sessions
- [ ] Document failure modes observed during testing
- [ ] Create "quick start" guide for new sessions
- [ ] Add troubleshooting section for common issues

## Open Questions

1. **Scope boundaries**: When does a single fact-checking session become too large? What's the right granularity?

2. **Human-in-the-loop timing**: Should human review happen after each claim, after each session, or in batches?

3. **Confidence thresholds**: At what confidence level should claims be auto-queued for Wikidata vs. flagged for extra review?

4. **Conflict resolution**: When existing Wikidata claims conflict with verified sources, what's the escalation path?

5. **Source archiving**: Should we archive sources (Wayback Machine) as part of the workflow to prevent link rot?

6. **Multi-claim efficiency**: For items with many potential claims, what's the most efficient verification order?
