# Worker changes

`index.js.patch` is a real diff against
[alex-o-748/public-ai-proxy](https://github.com/alex-o-748/public-ai-proxy)'s
`src/index.js`. Apply with `git apply`. Two files end up changing:

1. `src/index.js` — modified by `index.js.patch`
2. `src/extract-relevant-content.mjs` — new file, copy from this bundle

That's it. No `package.json` change (the module has no dependencies).
No `wrangler.toml` change. ESM imports already work in this Worker
(it's how `unpdf` is loaded).

## What the patch does

| Change | Where | Why |
|---|---|---|
| Read `?query=` URL param | line 138 | Lets the client pass the claim text. |
| Preserve paragraph breaks in `extractText` | function body | The current `\s+` collapse removes every newline before truncation, leaving the relevance extractor with nothing to split on. |
| Stop truncating in `extractText` itself | end of function | Truncation moves to the relevance extractor, which has more context. |
| Route HTML extraction through `extractRelevantContent` | line 207 | This is the actual fix for issue #88. |
| Route PDF extraction through `extractRelevantContent` | line 194 | Same fix, applied symmetrically to the PDF path. |
| Add `truncated`, `extractionStrategy`, `fullLength` to response | both response paths | Gives the client meaningful state to render in the UI. |
| Add `EXTRACT_OPTS` constant | top of module | One place to tune the budget. `maxTotalChars: 12000` and `fallbackChars: 12000` mean per-call cost is unchanged and old clients see no behavior difference. |

## Backward compatibility

| Client | Worker | Behavior |
|---|---|---|
| Old `main.js` (no `query`) | Old Worker | first-12k truncation (today) |
| Old `main.js` (no `query`) | New Worker | first-12k truncation (`fallbackChars=12000` path) |
| New `main.js` (sends `query`) | Old Worker | first-12k truncation (`query` ignored) |
| New `main.js` (sends `query`) | New Worker | lead + claim-relevant excerpts |

Either side can ship first.

## Testing the patched pipeline

`worker-pipeline-test.mjs` exercises the post-patch HTML extraction +
relevance extractor end-to-end against the issue #88 case (long page
with claim-relevant text in the conclusion) plus five other scenarios.
Run with `node worker-pipeline-test.mjs`. All 16 checks should pass.

## Optional follow-up: surface `extractionStrategy` in the UI

Once the Worker returns `extractionStrategy`, the client can replace
the blanket "⚠ Source is long, only partially checked" warning with
something more specific:

| Strategy | Suggested message |
|---|---|
| `short` | (no message; whole page sent) |
| `fallback` | ⚠ Source is long; the model only saw the first ~12,000 characters. |
| `lead+matches` | ✓ Showing claim-relevant excerpts from a long source. |
| `lead+head+tail` | ⚠ Source is long; claim terms didn't match, showing intro + head + tail. |
| `lead-only` | ⚠ Source is long and the claim's terms didn't appear past the intro. |

Not in `main.js.patch` so the patch stays narrowly scoped; ship it as a
follow-up commit.
