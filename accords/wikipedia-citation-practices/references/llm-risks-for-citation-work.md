---
title: LLM risks for citation work
---

Large language models introduce specific failure modes into citation work on Wikimedia projects. Each failure mode maps to a Wikipedia policy or guideline that it risks violating. Understanding these mappings helps human-agent teams catch problems before they reach the encyclopedia.

## Hallucinated sources

LLMs can generate plausible-looking citations — complete with authors, titles, publication dates, and DOIs — for sources that do not exist. A hallucinated source violates **verifiability (WP:V)** at the most basic level: the reader cannot check the claim because the cited work is not real.

Hallucination risk is highest when:

- The model is asked to find a source for a specific claim rather than reporting what sources it has seen.
- The topic is obscure enough that the model has limited training data.
- The citation includes very specific details (volume numbers, page ranges, DOIs) that lend false confidence.

**Mitigation:** Every source an LLM proposes must be independently verified to exist before it is added to any Wikimedia project. Verify the publication, the author, the date, and ideally access the source itself. A retrieval failure (403, timeout, or any other access error) is never confirmation that a source exists — the agent must find another way to access the actual source document.

## Source reconstruction and confabulation

Even when an LLM correctly identifies a real source, it may misrepresent what the source says. The model may reconstruct content from fragmentary training data, blend multiple sources together, or fill gaps with plausible-sounding material. This violates **verifiability (WP:V)** because the citation does not actually support the claim as stated.

This is distinct from hallucination: the source exists, but the model's account of its contents is unreliable. The risk is especially acute for:

- Direct quotations attributed to a source.
- Specific data points, statistics, or numerical claims.
- Paraphrases that subtly shift the meaning of the original.

**Mitigation:** The actual source must be read — not just confirmed to exist — before its contents are represented in a Wikipedia article or Wikidata statement.

## Inadvertent synthesis

LLMs process and combine information across their entire context. When asked to support a claim, a model may draw on multiple sources to construct an argument that no single source makes. This violates **no original research (WP:NOR)**, specifically the prohibition on synthesis.

The risk is subtle because the model's output reads as a natural summary. But if Source A says "X happened" and Source B says "Y happened," and the model writes "X caused Y," that is synthesis — even if the model presents it as a straightforward reading of the sources.

**Mitigation:** For each claim, verify that a single source supports it. When multiple sources are cited together, confirm that the connection between them is made explicitly by at least one of the sources, not inferred by the model.

## Reliability assessment failures

LLMs cannot reliably evaluate whether a source meets Wikipedia's **reliable sources (WP:RS)** standards. A model may:

- Treat a self-published blog as equivalent to a peer-reviewed journal.
- Fail to recognize predatory open-access journals.
- Miss conflicts of interest between a source and its subject.
- Be unaware of a publication's reputation changes over time (e.g., a formerly reputable outlet that has declined in quality).

**Mitigation:** Source reliability assessment requires human judgment informed by Wikipedia's specific criteria: editorial oversight, reputation for accuracy, and independence from the subject. Do not delegate this judgment entirely to an LLM.

## Training data as circular source

LLMs are trained on web-scraped data that includes Wikipedia itself and its mirrors. When a model appears to "know" something, that knowledge may originate from Wikipedia content — creating a **circular sourcing** problem analogous to citing Wikipedia as a source for Wikipedia. This risk is highest for:

- Well-known facts that Wikipedia covers prominently.
- Specific phrasings or framings that match existing Wikipedia articles.
- Claims the model presents with high confidence but without citing an independent source.

**Mitigation:** Treat LLM output as unsourced until independently verified. The model's confidence in a claim is not evidence of the claim's verifiability.

## BLP sensitivity

Biographies of living persons (**WP:BLP**) require the highest sourcing standards on Wikipedia. LLM-generated content about living people carries compounded risk: hallucinated negative claims, synthesized inferences about personal life, or poorly sourced contentious material can cause real-world harm and policy violations that are enforced aggressively.

**Mitigation:** Exercise heightened scrutiny for any LLM-generated content about living people. Every contentious claim must be traceable to a high-quality, independent, reliable source that has been directly accessed and read.

## Practical checklist

When using LLM assistance for citation work on Wikimedia projects:

1. **Does the source exist?** Verify independently — do not trust the model's citation.
2. **Does the source say what the model claims?** Read the actual source.
3. **Is the source reliable for this claim?** Apply Wikipedia's RS criteria with human judgment.
4. **Is there synthesis?** Check that each claim is supported by a single source, not assembled from multiple sources by the model.
5. **Could this be circular?** Consider whether the model's "knowledge" might originate from Wikipedia itself.
6. **Is a living person involved?** Apply BLP standards with extra care.
