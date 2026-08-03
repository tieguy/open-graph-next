---
name: wikied-checker
title: WikiEd citation and sourcing checker
description: Reviews Wikipedia edits for citation quality, source reliability, close paraphrasing, and policy compliance. Use when a student or instructor submits an edit or draft for review before publishing. Designed for the Wiki Education Foundation's student editing program.
presentation:
  order:
    - basic-checks
    - advanced-checks
---

This is an *accord*: an orientation document that gives humans and LLM agents common language and expectations for achieving goals together. Accords are packaged as Agent Skills for agents, and quick-reference guides for humans.

This accord is a **checker** — it reviews work a student has already done (or is drafting) and provides structured feedback. It does not generate article text, and it does not make edits on the student's behalf.

## What this checker can and cannot do

This tool uses an LLM to review your Wikipedia edits against Wikipedia's sourcing policies. It can catch many common problems, but it has real limitations you must understand:

**What it can check:**
- Whether claims have inline citations
- Whether source types are appropriate (blog vs. newspaper vs. peer-reviewed journal)
- Whether citation formatting follows Wikipedia conventions
- Whether the text shows signs of close paraphrasing
- Whether claims about living persons are properly sourced
- Whether the edit introduces original research by synthesizing sources

**What it cannot reliably do:**
- Verify that a source actually says what the article claims it says. The checker may not have access to paywalled or offline sources, and even for accessible sources, it may misread or hallucinate content.
- Guarantee that a source is reliable. It can flag obvious problems (personal blogs, press releases used as independent sources) but cannot fully evaluate a publication's editorial standards.
- Detect all close paraphrasing. It can flag suspicious patterns, but only a human comparing the article text against the source text can make a definitive judgment.

**Your responsibility:** Review all checker output before acting on it. The checker flags potential problems for your attention — it does not make final judgments. When it says "this may be an issue," go check the source yourself.

## How checks are organized

The checker runs two tiers of review:

### Basic checks

These correspond to what Wiki Education's training emphasizes. Every edit should pass these:

- **Verifiability** — "Says who?" (WP:V)
- **Neutral point of view** — "Just the facts" (WP:NPOV)
- **Reliable sources** — Are these the kind of sources Wikipedia trusts? (WP:RS)
- **When to cite** — At minimum, one citation per paragraph contributed
- **Close paraphrasing** — "Copy key ideas, not key passages" 
- **No original research** — "How do you know this?" (WP:NOR)
- **Biographies of living persons** — Strict sourcing, immediate removal of unsourced contentious claims (WP:BLP)
- **Knowledge equity** — Source strength is contextual; underrepresented topics may have different sourcing landscapes
- **Notability** — Does the topic have enough independent sourcing to warrant an article? (WP:N)
- **Conflict of interest** — Is the editor connected to the subject? (WP:COI)
- **Consensus and talk page** — Were major changes discussed? Are there active disputes? (WP:CONSENSUS)

See [Basic checks](references/basic-checks.md).

### Advanced checks

These cover deeper Wikipedia policy that experienced editors enforce. The checker flags these when relevant, but they are less likely to apply to typical student edits:

- **Exceptional claims** — Surprising or contentious claims need stronger sourcing (WP:REDFLAG)
- **Circular sourcing** — Wikipedia and its mirrors cannot source Wikipedia (WP:CIRCULAR)
- **Citation style consistency** — An article should not mix citation styles
- **Citation template completeness** — Missing parameters (access-date, identifiers, archive links)

See [Advanced checks](references/advanced-checks.md).

## Output format

When reviewing an edit, structure feedback as:

1. **Summary** — One-sentence overall assessment.
2. **Basic check results** — Flag each issue found, citing the relevant policy. Lead with the WikiEd framing ("Says who?"), then the policy shorthand (WP:V). Explain *why* it matters and *what the student should do*.
3. **Advanced check results** — If any apply, flag them separately and note that these are deeper policy issues.
4. **What the checker could not verify** — Explicitly list anything the checker lacked access to or confidence about. Never silently skip a check.
