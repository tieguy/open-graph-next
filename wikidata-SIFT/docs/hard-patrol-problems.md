# Hard Patrol Problems

Cases from the 500-edit multi-model verdict fanout (Feb 2026) where models genuinely disagree — and where human patrollers would likely struggle too. These aren't bugs in the models; they represent real ambiguity in Wikidata editing.

72 of 279 complete edits (26%) produced split decisions where at least one model said "verified" and another said "problematic."

## Categories of Hard Problems

### 1. Same Name, Different Person

**Q110811463 — official website: ranbirsidhu.com**

The website belongs to Ranbir Sidhu the writer (novels "Night in Delhi" and "Dark Star"). The Wikidata item is for Ranbir Sidhu the Toronto-based sculptor. Claude Haiku and Mistral caught the disambiguation problem; DeepSeek found the Art Gallery of Ontario listing the same URL for the artist and verified it.

Who's right? Possibly both — if two people share a name and one has an active website, confirming which Ranbir Sidhu the URL belongs to requires cross-referencing the AGO exhibition records against the website content. The website's content is literary, which strongly suggests it's the writer's site, but the AGO link in the sculptor's Instagram bio points to the same domain.

**Why it's hard**: Name disambiguation requires understanding which entity a source is *about*, not just whether the source exists.

### 2. Holding Company vs Subsidiary

**Q134650702 — SIREN number: 810825547**

SIREN 810825547 belongs to "GROUPE FURNOTEL" (a holding company created in 2015). The Wikidata item is labeled "FURNOTEL" (a commerce company with inception 1992, SIREN 388842148). DeepSeek and OLMo caught that these are two distinct legal entities; Claude and Mistral verified the SIREN as correct because it matches the headquarters address.

**Why it's hard**: Corporate structures create legitimate ambiguity. The holding company and the operating company share a name, address, and leadership. A patroller needs to understand French business registry conventions to know these are separate entities.

### 3. Property Semantics Disagreement

**Q60744597 — website account on: "social media" vs "social media account"**

The edit changed P553 from Q102345381 ("social media account") to Q202833 ("social media"). Claude flagged this as a semantic model violation — P553 should reference specific platforms, not the abstract concept. Mistral verified it because the company does have social media presence. OLMo was suspicious for different reasons.

**Why it's hard**: This requires understanding Wikidata's data model at a level beyond "is this fact true?" The fact (company uses social media) is true, but the *modeling* (which Q-item goes in which property) is wrong. This is an ontological error, not a factual one.

**Q21708200 — API endpoint URL: OpenAI documentation page**

Is `https://developers.openai.com/api/reference/overview` an "API endpoint URL"? Claude and Mistral said no — P6269 is for operational endpoints like `api.openai.com/v1/`, not documentation pages. DeepSeek and OLMo said yes — it's OpenAI's official API reference page. Both readings are defensible depending on how strictly you interpret "endpoint URL."

**Q138349857 — product or material produced: "felling"**

Is "felling" a product that a tree service produces? Claude and OLMo said no — felling is an activity, not a product. DeepSeek gave verified-low acknowledging the awkward fit. Mistral verified it because the company does perform felling.

**Why it's hard**: P1056 (product or material produced) has ambiguous scope for service businesses. The company *performs* felling, but does it *produce* felling? This requires a community consensus on how to model services.

### 4. Historical Precision Disputes

**Q1708321 — date of death: Joseph ha-Kohen, 1575**

Claude flagged this as suspect: scholarly sources distinguish between "his chronicle reaches 1575" and "he died in 1575 or shortly after." The Jewish Encyclopedia says 1575; other scholars say 1577-1578. Mistral verified it; OLMo gave verified-low noting the uncertainty.

**Q2871304 — date of birth: Auguste Marceau, 1 May vs 1 March 1806**

FamilySearch (via WikiTree) says May 1. GeneaStar and a Clairval biography say March 1. Without access to the original civil registration record, this can't be resolved. Claude called it incorrect (favoring the biography), DeepSeek said unverifiable, Mistral verified it (favoring FamilySearch), OLMo said plausible.

**Why it's hard**: Historical dates often have conflicting sources with no clear hierarchy. A patroller would need to evaluate source provenance — is a digitized civil record more authoritative than a published biography? Reasonable people disagree.

### 5. Chronological "Follows" vs Thematic "Follows"

**Nox Arcana discography (Q860827, Q7729016, Q8026171, Q17181150)**

Multiple edits to the "follows/followed by" properties for this dark ambient music project. The core dispute: does P155/P156 mean "next release chronologically" or "next in the same album series"? Buzz-Works is a side project of Nox Arcana members — should their releases be interleaved in the Nox Arcana sequence?

Claude distinguished between the main series and side projects. DeepSeek treated all releases by the same people as one chronological sequence. OLMo was consistently suspicious because it couldn't find explicit "follows" statements in sources.

**Why it's hard**: P155/P156 semantics are underdefined for creative works with side projects, simultaneous releases, and shared personnel.

### 6. Reference Doesn't Support Claim (But Claim Is True)

**Q41535671 — instance of: human (reference: Zenodo paper about Wikipedia governance)**

The Zenodo paper has nothing to do with Christian Bois being human. But Christian Bois *is* human — other sources confirm this. Claude and DeepSeek flagged the reference as wrong; OLMo verified the claim while noting the bad reference.

**Q138349103 — father: Muhammad Rashid (reference: P21 sex/gender)**

The reference cites the subject's own sex/gender property as evidence for who his father is — logically nonsensical. But MusicBrainz independently confirms the father relationship.

**Why it's hard**: The edit is partially correct (the claim) and partially wrong (the reference). A patroller must decide: reject the whole edit because the reference is bad, or accept the claim and flag the reference for improvement? Different models (and patrollers) handle this differently.

### 7. Self-Published Sources

**Suchfokus (Q138349990) — multiple properties**

Five edits to this SEO company all cite the company's own website. Claude and Mistral verified them; OLMo consistently marked them suspect because "Wikidata requires non-self-referential sources." DeepSeek was mixed.

**Why it's hard**: For small companies, the official website may be the *only* source. Wikidata policy says self-published sources are acceptable for non-controversial claims about the publisher. But where's the line between "our office is in Cologne" (seems fine) and "our field of work is SEO" (self-serving)?

### 8. Art Dealer vs Art Collector

**Q16194655 — occupation: art collector**

Claude flagged this as suspect: sources say "art dealer," and Wikidata's WikiProject Provenance explicitly distinguishes dealers from collectors. DeepSeek verified it because Lindsay's personal website says "art collector." Both occupations may be true simultaneously.

**Why it's hard**: Occupation modeling requires understanding professional nuance. Many art dealers are also collectors. The question isn't "is this true?" but "is this the *right* Wikidata property value?" — a modeling question, not a factual one.

### 9. Nickname vs Legal Given Name

**Q310315 — given name: Ving (Rhames)**

His legal name is Irving Rameses Rhames. "Ving" is a nickname from college. Claude and OLMo said P735 (given name) should be "Irving." DeepSeek verified "Ving" because it's the name he's universally known by. Mistral verified "Irving" while saying the edit was to update it.

**Why it's hard**: P735 is defined as "first name or given name of this person." Is a universally-used nickname a "given name"? Wikidata has P1449 (nickname) for this, but common usage blurs the line.

### 10. URL Format Precision

**Q138354585 — Spotify artist ID with tracking parameter**

The submitted ID was `7BdNAO2RTQfDWiRJkrrsHE?si=I9cJUuYDSEKebAV0uVHPRA`. Claude caught that the `?si=` parameter violates P1902's format constraint (exactly 22 characters). DeepSeek said Wikidata's pattern matching auto-strips query parameters. Mistral and OLMo verified without noticing the format issue.

**Q11597903 — Japanese school website: tachikawa.ed.jp vs tachikawa-edu.jp**

The old domain (tachikawa.ed.jp) no longer resolves. The new domain (tachikawa-edu.jp) works. But the edit submitted the wrong one. Claude caught the hyphen discrepancy by actually fetching both URLs.

**Why it's hard**: These require character-level precision checking — something LLMs are notoriously inconsistent at.

## Patterns Across Hard Problems

1. **Ontological modeling questions** (categories 3, 5, 8, 9) — "Is the fact modeled correctly?" is harder than "Is the fact true?" These need Wikidata domain expertise, not just source verification.

2. **Disambiguation** (categories 1, 2) — Matching sources to the correct entity when names are shared. Requires cross-referencing multiple identifiers.

3. **Source hierarchy** (categories 4, 6, 7) — When sources conflict, which wins? When a source is bad but the claim is true, what's the verdict? Community norms vary.

4. **Precision vs truth** (category 10) — The claim is approximately right but technically wrong at the character level. Format constraints catch some of these, but not all.

5. **Simultaneity and sequence** (category 5) — Temporal relationships are underdefined when events overlap or exist in parallel streams.

## Implications for Automation

These 72 split-decision edits represent the **floor of useful automation**. Below this line, deterministic rules and confident LLM agreement handle the work. Above it, you need either:

- Clearer Wikidata property definitions (reduces category 3, 5)
- Better disambiguation tooling (reduces category 1, 2)
- Community-agreed source hierarchies (reduces category 4, 7)
- Or simply: human judgment, which is what patrol is for

The goal isn't to eliminate human patrol — it's to make sure human patrollers spend their time on *these* problems, not on checking whether "olive oil" is a valid family name.
