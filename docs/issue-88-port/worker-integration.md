# Worker integration — query-aware excerpt extraction

The client-side patch (`main.js.patch`) already lands without any Worker
change: a Worker that ignores the new `?query=...` parameter behaves
exactly as before. To actually fix issue #88, the Worker has to do the
extraction. This doc describes the minimal Worker change and includes a
ready-to-use module.

## What the Worker does today (inferred)

From the client side we can see that the Worker:

- Accepts `?fetch=<url>&page=<n>` (PDF page extraction).
- Returns JSON `{ content, truncated, pdf, totalPages, page, error }`.
- Caps `content` at roughly 12,000 characters and sets `truncated: true`
  when the source was longer than that.
- Currently truncates by taking the first ~12k chars after extraction,
  which is the behavior the Wikipedia talk-page user wanted to fix.

We don't have the Worker source in the repo, so the snippet below assumes
a typical Cloudflare Worker shape. Map it onto whatever the actual
extractor pipeline looks like.

## Recommended change

Read the new optional `query` parameter. After the Worker extracts plain
text from the upstream page, route through `extractRelevantContent` from
`extract-relevant-content.js` instead of doing a blind first-N-chars cut.
Keep the existing return shape — the field that already exists
(`truncated`) remains meaningful.

```js
// At the top of your Worker (ESM Worker syntax)
import { extractRelevantContent } from './extract-relevant-content.js';

// Inside fetch handler, after you have `extractedText`
const url = new URL(request.url);
const query = url.searchParams.get('query');  // may be null

// Replace the existing first-12k truncation with this:
const out = extractRelevantContent(extractedText, query, {
    leadChars: 2500,
    matchWindow: 600,
    maxMatches: 8,
    maxTotalChars: 12000,   // match the existing budget
    fallbackChars: 12000,   // when no query, behave like today
});

return new Response(JSON.stringify({
    content: out.text,
    truncated: out.truncated,
    extractionStrategy: out.strategy,   // optional: 'short' | 'fallback' |
                                         // 'lead-only' | 'lead+matches'
    fullLength: out.fullLength,         // optional: full extracted length
    // ... pdf / totalPages / page / error fields unchanged
}), { headers: { 'Content-Type': 'application/json' } });
```

Notes on the budget choice:

- `maxTotalChars: 12000` keeps the model-input budget exactly where it
  was, so latency and per-call cost are unchanged.
- `fallbackChars: 12000` means callers that don't pass a `query`
  parameter — e.g. older versions of `main.js`, or any other consumer of
  the proxy — see no behavior change at all.
- `leadChars: 2500` always reserves ~2.5k chars for the page lead
  (intro / abstract / infobox), with the remaining ~9.5k available for
  query-relevant excerpts.

## How the algorithm answers the original talk-page request

The user asked: "prioritize including the conclusion section (if present)
rather than just taking the first 12k characters." The algorithm
generalizes that: it always includes the lead, and then surfaces the
paragraphs that mention the claim's terms — wherever those paragraphs
sit. If the conclusion mentions the claim (which it usually does for the
research-paper case the user had in mind) it gets surfaced. If a middle
section mentions it, that gets surfaced too. If nothing in the body
matches, the algorithm explicitly tells the model that the fact may not
appear in the source — which is itself useful signal.

This is meaningfully better than a "find the conclusion section" heuristic
because:

- It works on sources that don't have a clearly labeled conclusion (news
  articles, blog posts, transcripts, primary documents).
- It avoids surfacing a conclusion that's about a different topic (the
  paper may have multiple conclusions, or a conclusion that summarizes
  unrelated parts of the work).
- It returns evidence the model can actually use: paragraphs containing
  the claim's named entities, dates, and numbers.

## What you can drop entirely

The current proxy needs no other algorithmic changes. The PDF page
extraction logic, the upstream fetch, and the error handling all stay the
same. The only swap is the truncation step.

If you want, you can also remove `truncated` from `data.truncated === true
|| data.content.length >= 12000` in main.js (line 1612 of the upstream),
since `extractionStrategy` makes the meaning explicit. That's an
optional follow-up — see `refactoring-notes.md`.

## Backward compatibility matrix

|                               | Old Worker             | New Worker                     |
| ----------------------------- | ---------------------- | ------------------------------ |
| Old `main.js` (no `query`)    | first-12k (today)      | first-12k (fallback path)      |
| New `main.js` (sends `query`) | first-12k (`query` ignored) | lead + claim-relevant excerpts |

The "new client + old Worker" case is the deploy-the-client-first scenario
and is fully supported. The "old client + new Worker" case is the
deploy-the-worker-first scenario and is also fully supported.

## Testing

`sanity-test.js` exercises the algorithm against the issue #88 case
(conclusion at the end of a long page) plus eight other scenarios.
Run it with `node sanity-test.js`. Adapting it to a Worker test runner
(e.g. Miniflare / Vitest) is straightforward — the module has no
runtime dependencies.

## Optional: surface the strategy in the UI

Once the Worker returns `extractionStrategy`, the client can render
better copy than the current "⚠ The source is long and can only be
checked partially":

| Strategy        | Suggested message                                                              |
| --------------- | ------------------------------------------------------------------------------ |
| `short`         | (no message; whole page sent)                                                  |
| `fallback`      | ⚠ The source is long; the model only saw the first ~12,000 characters.        |
| `lead+matches`  | ✓ Showing claim-relevant excerpts from a long source.                          |
| `lead-only`     | ⚠ Source is long and the claim's terms didn't appear past the intro.          |

This is intentionally not in `main.js.patch` so the patch is reviewable
in a single sitting; ship it as a follow-up after the Worker is updated.
