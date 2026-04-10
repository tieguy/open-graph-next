<!--
Lightning talk — WikiCredCon 2026
Audience: Wikipedians, Wikidatans, and adjacent communities focused on
citation quality and source credibility.
Format: ~5 minutes, 3 slides (hard limit).
Thesis: "You may not believe it, but the hallucination machines can help with
credibility."

Companion web page with all numbers, tables, and comparisons:
docs/wikicredcon-lightning-talk-companion.md

Source data: docs/preliminary-results-2026-04.md (500-edit Wikidata patrol
evaluation, April 2026).
Comparison baselines: Sarabadani et al. 2017 (Wikidata vandalism detection,
WWW Companion); Halfaker et al. 2018 (ORES, CSCW).

Design principle for these slides: ONE idea per slide, very little text,
speaker notes carry the weight.

Use with Marp: `marp docs/wikicredcon-lightning-talk-2026.md -o talk.pdf`
-->

---
marp: true
title: "The hallucination machines, on credibility duty"
paginate: false
---

# The hallucination machines
# can help with credibility.

### *(You're allowed to not believe me yet.)*

<br>

500 Wikidata edits · three cheap open LLMs · six weeks of ground truth

<br>

<small>all numbers, code, verdict logs → *wikicredcon companion page URL*</small>

<!--
Speaker notes — slide 1

Open by acknowledging the room. This is WikiCredCon. You care about
citation quality and source credibility. The premise that ML models —
known liars, known to confidently assert things that are not true —
could be useful for credibility work should sound suspicious. I am
here to make that case anyway.

Setup in one breath:
- 500 unpatrolled statement edits sampled from Wikidata RecentChanges
  in February 2026.
- Three cheap open-weight models: Mistral Small 3.2, OLMo 3.1, DeepSeek v3.2.
  All under a cent per verdict.
- Six weeks later we asked Wikidata what happened to each revision —
  reverted, deleted, or still live. That's our ground truth.

The headline numbers (I'll say these out loud, they are NOT on the slide):
- At 2-of-3 model agreement we auto-accept 55% of the queue at 96.6%
  precision while catching 87% of bad edits.
- ROC-AUC 0.826 on a content-only signal — comparable to the
  Sarabadani 2017 Wikidata vandalism model's content-only score of
  0.813, and we get there WITHOUT ever seeing who made the edit.

That last clause is the one I want you to remember. The 2017 baseline
achieves its impressive numbers by heavily weighting user-status
features — is this an anon, how old is the account, are they in a
curator group — and the authors themselves say in the paper's
conclusion that this is "not fair to anonymous and new editors." We
spend more compute per edit and in exchange we don't profile editors.

The rest of this talk is about HOW you get an LLM to do that without
hallucinating. That's slide 2.
-->

---

# No fetch, no verdict.

<br>

### Every "verified" source must be a URL the model actually fetched **in this session.**

<br>
<br>

<small>*— config/sift_prompt_openrouter.md, line 100*</small>

<!--
Speaker notes — slide 2

This slide is the whole trick. Six words on the slide, but they are
load-bearing. Let me unpack them.

An LLM hallucinates because it treats its parametric memory — the
stuff baked into the weights during training — as evidence. "I
remember a Wikipedia article that said Belgium" becomes, in the
model's output, "according to Wikipedia, Belgium." The Wikipedia URL
is made up. The model is confidently wrong.

Our prompt closes that path with two rules. First, the model is
forbidden from reaching a conclusion without calling tools. It MUST
run web_search. It MUST run web_fetch. That's in the prompt as a MUST
— instruction-tuned models obey MUST language.

Second — and this is the load-bearing rule — the verdict schema has
a "sources" field, and every source must be marked "verified" or
"reported." "Verified" is only legal if the model actually called
web_fetch on that URL during this session. The runner checks the
session log. If the model hand-waves with a URL it remembers from
training, we mark the source as "reported" and the schema caps the
verdict at verified-LOW, never verified-high, never incorrect. The
prompt file calls hand-waving "citation laundering" and tells the
model that mismarking provenance invalidates the verdict.

What this buys you: every verdict in our system is a **replayable
audit trail**. For every edit, we have the exact URLs the model
fetched and what content came back. If you want to verify that the
model's verdict is justified, you don't need to trust the model —
you re-run its fetches and read the sources yourself. It's the same
thing Wikipedia editors already do when they audit each other.

And because the constraint is on the prompt — not on the model —
this works with any cheap open model. We're not relying on a
particular Anthropic or OpenAI feature. Mistral Small and OLMo and
DeepSeek all obey it the same way. Because the constraint is
structural, not behavioral.

Companion page has the full prompt, the quote I'm pointing at, and
the audit trail format.

Transition to slide 3: this is how we keep the model out of its
parametric memory. Now — when it gets things wrong, and it does —
what does it get wrong?
-->

---

# When they're wrong, they don't hallucinate.
# They get **Wikidata** wrong.

<br>

qualifier precision &nbsp;·&nbsp; ambiguous dates
missing accent marks &nbsp;·&nbsp; wrong Q-id mapping

<br>

### The hard problems stay human.
### They are also the interesting problems.

<br>

<small>*numbers · comparison with Sarabadani 2017 · full failure taxonomy →*
*companion page URL*</small>

<!--
Speaker notes — slide 3

The closer.

We ran this ensemble on 500 edits. At the 2-of-3 accept threshold we
had 4 false positives — edits the ensemble accepted that were later
reverted by humans. Four is a small number. What matters is WHAT
kind of mistakes they are.

Let me walk them because they are the whole point:

1. Embassy headquarters — qualifier precision. The fact was right,
   the revert was about a start-date qualifier. LLMs don't have a
   strong model of Wikidata qualifier semantics.

2. French naval officer born 1806 — ambiguous historical date. Real
   biographical sources genuinely disagree on May 1 vs March 1. The
   ensemble accepted the edit. This is a source-hierarchy dispute,
   not a factual error.

3. "Tascon" vs "Tascón" — missing accent mark. LLMs are
   tokenizer-level fuzzy at character precision. One of the three
   models caught this, two did not.

4. Wrong Q-id mapping — the editor linked to the wrong Wikidata item
   for a cyclist's team. The fact checked out. The ontological
   mapping didn't. No amount of web fetching fixes this because the
   web doesn't know Wikidata's Q-id namespace the way the editor
   community does.

Notice what is NOT on this list. There is no row that says "the model
invented a source." There is no row that says "the model asserted a
fake birth date." Every single miss is in the category of
Wikidata-specific editorial judgment that seasoned editors catch in
seconds and LLMs are structurally bad at.

So the deal is this: these tools can take the VOLUME of routine
factual verification off your queue, so that scarce human attention
reaches exactly the problems you are the best people in the world
at — qualifier semantics, ontological modeling, source-hierarchy
disputes, notability assessment, character-level fidelity. The
failure mode maps perfectly onto the value of your expertise. That
is not an accident — it's a consequence of using LLMs for what
they're actually good at (lateral reading at scale) and nothing
else.

And for those of you who are already thinking "but is this fair to
editors the way ORES and the 2017 baseline aren't" — the answer is
that our prompt includes one line in the design notes that says "No
editor identity signals. We assess the edit on its merits, not the
editor's reputation." We don't see who made the edit. By design.
That's the fairness pivot this room cares about, and it's on the
companion page with the Sarabadani 2017 comparison.

Last thirty seconds:

- Preliminary results, full numbers, Sarabadani comparison, the
  prompt, the code, every verdict log — all on the companion page.
- 2000-edit replication is in progress.
- Open weights, open code, runnable on community infrastructure. No
  dependency on a frontier vendor for credibility tooling.
- Come find me after if you want to argue about any of it. I want
  you to argue about it.

Thank you.
-->
