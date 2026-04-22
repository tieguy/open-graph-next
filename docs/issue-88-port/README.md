# Port for citation-checker-script issue #88

A bundle for [alex-o-748/citation-checker-script#88](https://github.com/alex-o-748/citation-checker-script/issues/88)
("Prioritize conclusion section when truncating long sources"). Two
real `git apply`-able patches, one per repo, plus the new module the
Worker imports and a self-contained test for the post-patch pipeline.

## Files

| File | Purpose |
|---|---|
| `extract-relevant-content.mjs` | Pure ESM port of `_extract_query_matches` + the lead/excerpts logic from `wikidata-SIFT/scripts/tool_executor.py:web_fetch`. No runtime dependencies. Goes into `src/` of the Worker repo. |
| `sanity-test.mjs` | 25 unit-style checks for the algorithm in isolation. Run with `node sanity-test.mjs`. |
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

## Verifying the patches before applying

```bash
cd docs/issue-88-port

# Algorithm unit checks
node sanity-test.mjs              # 25 checks

# End-to-end pipeline check (post-patch HTML + relevance extractor)
node worker-pipeline-test.mjs     # 16 checks

# Patch round-trip checks (apply to fresh copies of the upstream snapshots)
cp main.js.upstream main.js   && git apply --check main.js.patch  && rm main.js
cp index.js.upstream index.js && git apply --check index.js.patch && rm index.js
```

## Acknowledgments

The algorithm in `extract-relevant-content.mjs` is a port of work in
`wikidata-SIFT`, which is itself motivated by the fact that LLMs are
much better at fact-checking when they're handed the relevant slice of
a source rather than the first ~10k characters of arbitrary text. The
Wikipedia-citation use case mirrors the Wikidata-edit use case closely
enough that the algorithm transfers without modification.
