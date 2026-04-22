# Port for citation-checker-script issue #88

A bundle for [alex-o-748/citation-checker-script#88](https://github.com/alex-o-748/citation-checker-script/issues/88)
("Prioritize conclusion section when truncating long sources"). Two
real `git apply`-able patches, one per repo, plus the new module the
Worker imports and a self-contained test for the post-patch pipeline.

## Files

| File | Purpose |
|---|---|
| `extract-relevant-content.mjs` | Pure ESM port of `_extract_query_matches` + the lead/excerpts logic from `wikidata-SIFT/scripts/tool_executor.py:web_fetch`. No runtime dependencies. Goes into `src/` of the Worker repo. |
| `sanity-test.mjs` | 40 unit-style checks for the algorithm in isolation, covering the 'short', 'fallback', 'lead+matches', 'lead+head+tail', and 'lead-only' strategies, plus IDF weighting, proper-noun/numeric boost, and multi-hit scoring. Run with `node sanity-test.mjs`. |
| `main.js.patch` | Three-hunk diff against [`alex-o-748/citation-checker-script`](https://github.com/alex-o-748/citation-checker-script)'s `main.js`. Adds an optional `claim` arg to `fetchSourceContent`, forwards it to the proxy as `&query=…`. Apply with `git apply main.js.patch` from the repo root. |
| `index.js.patch` | Diff against [`alex-o-748/public-ai-proxy`](https://github.com/alex-o-748/public-ai-proxy)'s `src/index.js`. Reads the new `query` param, preserves paragraph breaks through extraction, routes both HTML and PDF paths through `extractRelevantContent`. Apply with `git apply index.js.patch` from that repo's root after copying `extract-relevant-content.mjs` into `src/`. |
| `worker-changes.md` | What `index.js.patch` does, hunk-by-hunk, plus a backward-compatibility matrix and a UI follow-up sketch. |
| `worker-pipeline-test.mjs` | End-to-end test exercising the post-patch HTML extraction + relevance extractor on the issue #88 case. 16 checks. Run with `node worker-pipeline-test.mjs`. |
| `refactoring-notes.md` | Side observations from reading 3k lines of `main.js`. Independent of issue #88 — read or ignore. |
| `main.js.upstream` | Snapshot of `citation-checker-script@main`'s `main.js` used as the patch base, so the diff is reviewable in-tree. |
| `index.js.upstream` | Snapshot of `public-ai-proxy@main`'s `src/index.js` used as the patch base. |

## Why two patches

The 12,000-character truncation that prompted issue #88 happens
**server-side in the Worker** (`public-ai-proxy/src/index.js:195` for
PDFs and `:291` for HTML — both `.substring(0, 12000)`). So a
client-only fix can't solve the user's problem: by the time the client
sees the bytes, the conclusion is already gone.

The server-only fix doesn't work either, because the server has no idea
what claim is being checked unless the client tells it. So the change
spans both:

- **Client-side (`main.js.patch`)**: pass the claim text as
  `&query=…`. Backward-compatible with today's Worker (it ignores
  unknown params).
- **Server-side (`index.js.patch`)**: read `query`, route through the
  new module, return claim-relevant excerpts within the same 12k
  budget. Backward-compatible with today's client (no `query` →
  `fallbackChars=12000` returns first-12k just like today).

Either side can ship first.

## Why generalize "conclusion" to "query-aware excerpts"

The user asked for the conclusion. The algorithm gives them the
conclusion *if* the conclusion is what mentions the claim — and also
gives them any other paragraph that mentions the claim. This is
strictly better because:

- News articles, court rulings, primary documents, and transcripts have
  no labeled conclusion, but they do have paragraphs that touch the
  claim.
- A research paper may have multiple conclusions; the algorithm
  surfaces only the relevant one.
- The conclusion paraphrases ("tens of thousands of casualties"); the
  body has the numbers ("between 40,000 and 120,000"). For
  fact-checking precise claims, the body matters more.
- If nothing in the body matches, the model is told explicitly that the
  fact may not appear in the source — useful negative signal vs.
  silent first-12k truncation.

This is the same algorithm we run today in
`wikidata-SIFT/scripts/tool_executor.py:227–322`.

## What this does NOT change

- The 12,000-character budget sent to the LLM is preserved.
- API costs and latency are unchanged.
- Older clients and older Workers both keep working unmodified.
- The system prompt and few-shot examples are untouched.
- The PDF page-extraction logic and the 10-MB PDF size guard are
  untouched.
- The verdict categories are untouched.
- Rate limiting, CORS, Neon logging, and the LLM-proxy path are
  untouched.

## Suggested rollout

1. **Apply `main.js.patch` to `citation-checker-script`.** Backward-
   compatible with the current Worker — safe to ship immediately.
2. **In `public-ai-proxy`:**
   - Copy `extract-relevant-content.mjs` to `src/`.
   - Apply `index.js.patch` from the repo root.
   - Run `node worker-pipeline-test.mjs` from this bundle for a
     deterministic check that the post-patch pipeline does the right
     thing on a constructed issue #88 case.
   - `npm run deploy` (wrangler).
3. **Optional follow-up:** surface `extractionStrategy` in the
   sidebar UI. See `worker-changes.md` for suggested copy.

## Testing

Six checks in the order you'd actually run them. The first three are
zero-setup. The last three require the upstream repos checked out and,
for the benchmark, some API credit.

**Prerequisites:** Node 14+ (18+ is the widely-available LTS; `.mjs`
files work on either). Everything in this bundle has zero npm
dependencies — `node <file>` is the whole command.

### 1. Algorithm unit checks

Exercises `extractRelevantContent` in isolation across all five
strategies (`short`, `fallback`, `lead+matches`, `lead+head+tail`,
`lead-only`) plus IDF weighting, proper-noun / numeric boost, and
multi-hit scoring.

```bash
cd docs/issue-88-port
node sanity-test.mjs
```

Expected tail of output:

```
PASS  fallback: at most one head-of-remainder section
PASS  fallback: head-tail overlap handled

All checks passed.
```

40 checks; exit code 0 on success.

### 2. Post-patch pipeline end-to-end

Exercises the *patched* `extractText()` (paragraph-preserving) piped
through `extractRelevantContent` against representative HTML including
the issue #88 case (long page with claim-relevant text in the
conclusion).

```bash
node worker-pipeline-test.mjs
```

Expected: `All checks passed.` (16 checks). If this fails after you've
applied `index.js.patch`, `extractText()` in your working copy has
drifted from the patched version; the test inlines a copy at the top
of the file to catch that drift.

### 3. Patch round-trip

Confirms both patches apply cleanly to fresh copies of the upstream
snapshots. Run before sending the patches anywhere.

```bash
cp main.js.upstream main.js   && git apply --check main.js.patch  && rm main.js
cp index.js.upstream index.js && git apply --check index.js.patch && rm index.js
```

Both commands should exit 0 silently. Any output from `git apply
--check` is a failure — likely means the upstream has drifted since
this bundle was generated and the patches need refreshing against the
current `main`.

### 4. Local Worker dev smoke test

After applying `index.js.patch` and dropping
`extract-relevant-content.mjs` into `src/`, make sure the Worker
actually routes the `query` parameter through the new pipeline.

```bash
# In the public-ai-proxy repo
cp <this-bundle>/extract-relevant-content.mjs src/
git apply <this-bundle>/index.js.patch
wrangler dev
```

In another shell, hit the dev Worker with a known-long source and a
claim-like query:

```bash
# Pick any article whose body exceeds ~12k chars. A long Wikipedia
# article, a multi-page paper, or a news feature all work.
CLAIM="Brandenburg was decided in 1969"
URL="https://en.wikipedia.org/wiki/Brandenburg_v._Ohio"
curl -s "http://localhost:8787/?fetch=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$URL'))")&query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CLAIM'))")" | python3 -m json.tool | head -40
```

Expected response shape:

```json
{
    "content": "## Page lead\n...\n## Excerpts matching claim\n### [match: \"1969\"]\n...",
    "truncated": true,
    "extractionStrategy": "lead+matches",
    "fullLength": 45328
}
```

Key things to verify:

- `extractionStrategy` is `"lead+matches"` (not `"fallback"` — if
  you see `"fallback"`, the query parameter isn't making it through).
- `content` contains both a `## Page lead` section and
  `## Excerpts matching claim`.
- A re-run *without* `&query=...` returns `extractionStrategy:
  "fallback"` and the first 12k chars only — confirms the backward-
  compat path still works.

### 5. Browser smoke test for the user script

After applying `main.js.patch`, verify the client actually sends the
`query` parameter.

```bash
# In the citation-checker-script repo
git apply <this-bundle>/main.js.patch
```

Deploy the patched `main.js` via USync (or point your personal
`common.js` at a local copy during development). Then:

1. Open a Wikipedia article with a citation whose source is clearly
   >12k chars. Most featured articles with scholarly citations work;
   a good test case is any article citing a journal paper with an
   explicit "Conclusions" section.
2. Open devtools → Network tab.
3. Click the citation marker. You'll see a request go out to
   `publicai-proxy.alaexis.workers.dev`.
4. Inspect the request URL. It should now include
   `&query=<URL-encoded claim text>`.
5. Inspect the response body. If the Worker has been updated too, you
   should see the `extractionStrategy`, `truncated`, and `fullLength`
   fields. If the Worker hasn't been updated yet, the response shape
   is identical to today — confirms backward-compat.

### 6. Benchmark comparison — the actual answer

This is the test that settles whether the algorithm is better than
first-12k on Wikipedia prose (not just on the synthetic examples in
this bundle). Runs against the existing labeled dataset in
`citation-checker-script/benchmark/dataset.json` (76 claim / source
pairs). Two phases, cheap first, expensive second.

**Phase A — deterministic retention check (no API cost):**

Filter the dataset to pairs where the extracted source exceeds 12k
chars (the only cases where truncation matters). For each, extract
the snippet two ways and check whether claim-relevant terms survive.

```js
// sketch — ~60 lines in benchmark/compare-extraction.mjs
import { extractRelevantContent } from '../../extract-relevant-content.mjs';
import dataset from './dataset.json' assert { type: 'json' };

// Inline the patched extractText from index.js; or import if you
// split it into its own module as part of applying the patch.
function extractText(html) { /* same as worker-pipeline-test.mjs */ }

// Token-retention predicate: do the claim's high-information tokens
// (proper nouns, years, numbers) appear in the extracted snippet?
function claimTermsSurvive(snippet, claim) {
    const tokens = claim.match(/\b(?:[A-Z][a-z]+|\d{3,})\b/g) || [];
    return tokens.filter(t => snippet.includes(t)).length;
}

let firstKLTwelveK = 0, queryAware = 0, bothMatch = 0, longOnly = 0;
for (const { claim, sourceHtml, expectedVerdict } of dataset) {
    const fullText = extractText(sourceHtml);
    if (fullText.length < 12000) continue; // truncation doesn't apply
    longOnly += 1;

    const firstK = fullText.slice(0, 12000);
    const qAware = extractRelevantContent(fullText, claim, {
        leadChars: 2500, matchWindow: 600, maxMatches: 8,
        maxTotalChars: 12000, fallbackChars: 12000,
    }).text;

    const a = claimTermsSurvive(firstK, claim);
    const b = claimTermsSurvive(qAware, claim);
    if (a > 0) firstKLTwelveK += 1;
    if (b > 0) queryAware += 1;
    if (a > 0 && b > 0) bothMatch += 1;
}

console.log(`Long sources: ${longOnly}`);
console.log(`Claim tokens retained by first-12k:    ${firstKLTwelveK} / ${longOnly}`);
console.log(`Claim tokens retained by query-aware:  ${queryAware}   / ${longOnly}`);
console.log(`Both retained:                          ${bothMatch}`);
```

What to expect:

- On most pairs, both retain claim tokens — the relevant paragraph
  often happens to be in the first 12k anyway.
- The interesting number is `queryAware - firstKLTwelveK` on the
  long-source subset: pairs where the current first-12k truncation
  drops the relevant evidence but query-aware keeps it. If that
  difference is zero or negative, the algorithm isn't helping on
  your corpus. If it's meaningfully positive, Phase B is worth
  running.
- Don't over-read a small sample. 76 pairs is small; the long-source
  subset may be under 20. Treat this as directional signal.

**Phase B — LLM accuracy check (costs API budget):**

Run each of the 2× snippets through the existing
`generateSystemPrompt` + provider call. Compute the same metrics the
existing benchmark already computes (exact accuracy, lenient
accuracy, confusion matrix). The relevant headline number is
**lenient accuracy on the long-source subset**: if it beats the
current baseline by more than the small-sample noise floor, the
algorithm is a real win.

Both phases should run side-by-side against the *same* dataset, so
swap the extraction function in `benchmark/extract_dataset.js` rather
than re-fetching sources. Caching matters for reproducibility;
`benchmark/` already has the fetched source content committed, which
means Phase B is a pure-API-call comparison.

## Acknowledgments

The algorithm in `extract-relevant-content.mjs` is a port of work in
`wikidata-SIFT`, which is itself motivated by the fact that LLMs are
much better at fact-checking when they're handed the relevant slice of
a source rather than the first ~10k characters of arbitrary text. The
Wikipedia-citation use case mirrors the Wikidata-edit use case closely
enough that the algorithm transfers without modification.
