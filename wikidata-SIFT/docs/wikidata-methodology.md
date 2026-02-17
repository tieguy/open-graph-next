# Wikidata Fact-Checking Methodology

Reference document for fact-checking methodology used by Wikidata enhancement skills.

Based on Mike Caulfield's SIFT framework, adapted for Wikidata contributions.

## SIFT Framework

Apply to every claim before proposing it for Wikidata:

- **Stop** - Don't accept claims at face value; don't rush to add them
- **Investigate the source** - Who published this? What's their authority?
- **Find better coverage** - What do other reliable sources say?
- **Trace claims** - Find the original/primary source

## Evidence Types

| Evidence Type | Credibility Basis | Wikidata Reference Pattern |
|---------------|-------------------|---------------------------|
| Documentation | Direct artifacts (official records, certificates) | P854 (reference URL) + P813 (retrieved) |
| Primary Source Publication | Official organizational output | P248 (stated in) + P854 + P813 |
| Reporting | Professional journalistic standards | P248 (stated in) + P854 + P813 |
| Statistics | Method appropriateness, representativeness | P248 + P304 (page) if specific |
| Expert Analysis | Speaker expertise, careful history | P248 + P304, note expert in log |
| Personal Testimony | Direct experience, but verify when possible | Generally insufficient alone for Wikidata |
| Common Knowledge | Existing agreement | Still needs a citable source for Wikidata |

### Credibility Questions by Evidence Type

- **Documentation**: Is this real and unaltered? Is it the authoritative version?
- **Testimony**: Was this person there? Are they reliable? Consistent with behavior?
- **Statistics**: Are these accurate? Appropriate methodology?
- **Analysis**: Does this person have relevant expertise? Careful with truth?
- **Reporting**: Does source follow professional standards? Verification expertise?

## Source Reliability Guidelines

### Generally Reliable for Wikidata
- Government records, official registries
- Academic publications, encyclopedias (Britannica, subject-specific)
- Major news organizations with editorial standards
- Official organizational websites (for facts about that organization)

### Use with Caution
- Wikipedia (starting point only; trace to its sources)
- News aggregators
- Press releases (reliable for announcements, not independent verification)

### Special Handling Required
- **State-controlled media**: Not reliable on anything intersecting national interests. May be acceptable for purely domestic non-political facts (e.g., athlete birth dates) with corroboration.
- **Social media**: Bad for factual backing, but useful to characterize discourse or as leads

## Wikidata-Specific Checks

Before proposing any claim, verify:

1. **Property exists**: Search Wikidata for the property. Is it the right one?
2. **Modeling conventions**: How do similar items model this relationship?
3. **Existing claims**: Does the item already have this property? Conflicting values?
4. **Value type**: Does the property expect an item (Qxxx), string, date, quantity?
5. **Required qualifiers**: Some properties expect qualifiers (start time, applies to part, etc.)
6. **Precision**: Don't claim false precision. Year-only dates should be year precision.

## Handling Contradictions

When sources contradict:
1. Prioritize primary sources over secondary
2. Consider temporal proximity to the event
3. Evaluate potential biases
4. Acknowledge contradictions explicitly
5. For Wikidata: multiple claims with different references may both be valid (deprecated rank for superseded values)

## Expert Disagreement Terminology

Use these terms precisely when characterizing expert opinion:

- **Consensus**: Question effectively closed; overwhelming expert agreement
- **Majority/minority**: Widely accepted view with respected alternatives
- **Competing theories**: Multiple explanations, no dominant view
- **Uncertainty**: Experts haven't invested deeply in any hypothesis
- **Fringe**: Views outside scholarly dialogue, not just minority positions

## Linguistic Red Flags

Watch for:
- Totalizing language ("everything," "all," "never")
- Causative claims assuming direct relationships
- Emotional/evaluative terms smuggling in judgments
- Hedging that obscures the actual claim

## Confidence Levels

When logging verified claims, use these confidence levels:

- **High**: Primary source confirms, or multiple reliable secondary sources agree
- **Medium**: Single reliable secondary source, or primary with minor ambiguity
- **Low**: Source is less reliable, or claim requires interpretation

## Discovering New Items

During fact-checking, you may discover entities that should exist in Wikidata but don't:
- Organizations the subject belongs to
- Awards that don't have items
- Publications, works, places

Log these as separate potential tasks. Each may require its own fact-checking session.
