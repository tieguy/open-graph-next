# Port for citation-checker-script issue #88

A bundle for [alex-o-748/citation-checker-script#88](https://github.com/alex-o-748/citation-checker-script/issues/88)
("Prioritize conclusion section when truncating long sources"). Ports
the query-aware fetch logic from `wikidata-SIFT/scripts/tool_executor.py`
into a self-contained JavaScript module that can drop into the existing
Cloudflare Worker proxy, plus the matching client-side change to
`main.js`.

## Files

| File | Purpose |
|---|---|
| `extract-relevant-content.js` | Pure-JS port of `_extract_query_matches` + the lead/excerpts logic from `web_fetch`. Runs in browser, Cloudflare Worker, or Node. No runtime dependencies. |
| `sanity-test.js` | 25 representative checks for the algorithm. Includes the issue #88 case (long page with conclusion at the end). Run with `node sanity-test.js`. |
| `main.js.patch` | Three-hunk unified diff against `main.js` (commit at the time of writing). Adds an optional `claim` arg to `fetchSourceContent`, forwards it to the proxy as `&query=…`. Apply with `git apply main.js.patch` from the repo root. |
| `worker-integration.md` | What the Cloudflare Worker needs to do to actually use the new `query` parameter. Includes a 12-line code snippet and a backward-compatibility matrix. |
| `refactoring-notes.md` | Side observations from reading 3k lines of `main.js`. Independent of the issue #88 work — read or ignore. |
| `main.js.upstream` | Snapshot of `alex-o-748/citation-checker-script@main` `main.js` used as the patch base. Kept in the bundle so the diff is reviewable without leaving the repo. |

## Why this design

The 12,000-character truncation that prompted issue #88 happens
**server-side in the Cloudflare Worker**, not in `main.js`. The client
just receives `data.content` already truncated. So a fix that only
touches the client cannot solve the user's problem — by the time the
client sees the bytes, the conclusion is already gone.

The right answer is a server-side change. But a server-only change
requires the client to send the additional context (the claim text) so
the Worker has something to extract against. The two changes are
co-dependent:

- **Client-side (`main.js.patch`)**: pass the claim as `&query=…`. Fully
  backward-compatible — a Worker that ignores the parameter behaves
  exactly as before.
- **Server-side (`worker-integration.md` + `extract-relevant-content.js`)**:
  read the `query`, route through the new module, return claim-relevant
  excerpts within the existing 12k budget.

Either side can ship first without breaking the other.

## Why generalize "conclusion" to "query-aware excerpts"

The user asked for the conclusion. The algorithm gives them the
conclusion *if* the conclusion is what mentions the claim — and also
gives them any other paragraph that mentions the claim. This is
strictly better because:

- News articles, primary documents, and transcripts usually have no
  labeled conclusion, but they do have specific paragraphs that touch
  the claim.
- A research paper may have multiple conclusions; the algorithm
  surfaces only the relevant one.
- If nothing in the body matches, the model is told explicitly that the
  fact may not appear in the source — a useful negative signal.

This is the same algorithm we run today in
`wikidata-SIFT/scripts/tool_executor.py:227–322`.

## What this does NOT change

- The 12,000-character budget sent to the LLM is preserved.
- API costs and latency are unchanged.
- Older client versions and older Worker versions both keep working.
- The "Truncated: true" flag in the proxy response stays meaningful.
- The system prompt and few-shot examples are untouched.
- The PDF page-extraction logic is untouched.
- The verdict categories are untouched.

## Suggested rollout

1. Apply `main.js.patch` to `main.js`. Test in the browser; the proxy
   ignores the unknown `query` parameter so behavior is identical to
   today.
2. Update the Cloudflare Worker per `worker-integration.md`. Test with
   a long source (a journal paper with a conclusion at the end is the
   canonical example).
3. Optionally surface `extractionStrategy` in the UI to replace the
   blanket "⚠ Source is long" warning with more specific copy when
   query-aware excerpts were used. See the table at the end of
   `worker-integration.md`.

## Re-running the sanity check

```bash
cd docs/issue-88-port  # in this repo
node sanity-test.js
```

Expected: `All checks passed.` (25 checks).

## Acknowledgments

The algorithm in `extract-relevant-content.js` is a port of work in
`wikidata-SIFT`, which is itself motivated by the fact that LLMs are
much better at fact-checking when they're handed the relevant slice of
the source rather than the first ~10k characters of arbitrary text.
The Wikipedia-citation use case mirrors the Wikidata-edit use case
closely enough that the algorithm transfers without modification.
