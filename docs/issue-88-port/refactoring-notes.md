# Refactoring notes — alex-o-748/citation-checker-script

Notes from a read-through of `main.js` (2,983 lines, single file, single
class) while building the issue #88 patch. Captured for an outside
perspective; not an attack on choices that were probably right at the
time. Take or leave as appropriate — the script works, has a real user
base, and was written for a deployment context (Wikipedia user script)
that constrains a lot of decisions.

## Headline observations

1. **One file, one class, ~3k lines.** `WikipediaSourceVerifier` carries
   provider configs, DOM rendering, citation extraction, source fetching,
   prompt construction, four LLM provider clients, the report writer,
   and the persistent state. The `CLAUDE.md` calls this out explicitly
   — "Single class pattern: `WikipediaSourceVerifier` in an IIFE" — so
   it's deliberate. But the next ~10 features (#86 split-and-reverify,
   #88 query-aware fetch, #89 lead-vs-body verification, #102 ERROR
   verdict, etc.) all feel like they're going to want to touch the same
   handful of methods and re-render the same handful of DOM nodes.
   Worth considering a split *before* those land, not after.

2. **Four near-identical provider clients.** `callPublicAIAPI`
   (line 2065), `callClaudeAPI` (2112), `callGeminiAPI` (2149),
   `callOpenAIAPI` (2190). Each one rebuilds the same system+user prompt,
   posts to a different URL with a different body shape, and parses a
   different response shape into the same `{ text, usage: { input, output } }`
   record. The differences fit in a small per-provider config object:

   ```js
   { url, headers(apiKey), buildBody(system, user, model), pickText(data),
     pickUsage(data) }
   ```

   Routing then becomes one `callProviderAPI(claim, sourceInfo)`
   method that looks up the config and runs it. Cuts ~120 LoC and makes
   the cross-provider benchmark code (the doc you have for the four-model
   comparison) easier to extend with a fifth or sixth model.

3. **Verdict parsing is regex-on-text.** Line 2041–2045:

   ```js
   const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                    [null, result.match(/\{[\s\S]*\}/)?.[0]];
   const parsed = JSON.parse(jsonMatch[1]);
   this.logVerification(parsed.verdict, parsed.confidence);
   ```

   Inside a `try { ... } catch (e) {}` that swallows everything. This is
   exactly the surface area where issue #102 (the ERROR-category
   ambiguity) lives. The parsing layer should:

   - Distinguish "model returned malformed JSON" from "model returned
     valid JSON but unexpected verdict string" from "model returned
     `SOURCE UNAVAILABLE` legitimately."
   - Surface those as distinct internal states so the UI / report can
     classify them consistently.
   - Not silently swallow parse errors — at least log the verdict as
     `MALFORMED` so the editor knows something happened.

   Anthropic, OpenAI, and Gemini all support a structured output
   mode (response_format=json_schema, JSON mode, responseSchema). Using
   it for the providers that support it would eliminate this entire
   regex layer.

4. **47 `getElementById` calls and 15 `innerHTML` writes.** Imperative
   DOM updates scattered across many methods. State changes (e.g.
   `verifier-active`, `claim-highlight`, `verifier-truncation-warning`)
   propagate by walking the DOM rather than re-rendering from a single
   source of truth. With multi-citation reports and split-and-reverify
   (issue #86) coming, a small render function that takes
   `state → HTML` would scale better. Even a tiny helper like
   `setSidebar({ status, claim, source, verdict })` that owns the
   sidebar's DOM would consolidate the moving parts.

5. **State lives in three places.** Class instance fields
   (`this.activeClaim`, `this.activeSource`, `this.reportResults`),
   `localStorage` (16 distinct keys: API keys per provider, sidebar
   width, visibility, current provider, report filters), and DOM
   attributes (`verifier-active` class, `data-*` not used but the
   `.reference` selector implies state-on-elements). Plus a migration
   step at line 42 (`apertus` → `publicai`) that lives in the
   constructor. A small `Settings` object with explicit `get`/`set`
   methods would make the migration story easier as more providers /
   fields land.

6. **System prompt has 9 inline few-shot examples** (line 1872–1962).
   The benchmark doc explicitly says "changes affect benchmark accuracy"
   — i.e. this is a fragile asset, hand-tuned, with no test that pins
   it down. A dedicated file (`prompts/verify.md` or similar) plus a
   per-prompt-version field in the benchmark output would make it
   easier to A/B prompt revisions without losing track of which
   benchmark numbers correspond to which prompt.

7. **The CSS-in-JS string is ~600 lines** (around line 200–800,
   `createStyles`). Works but is very hard to grep / reason about, and
   the night-mode rules at line 757 have to be maintained alongside the
   light-mode rules. A separate `.css` file loaded via
   `mw.loader.addStyleTag` would be more maintainable, and the comment
   says it's CSS-in-JS for a reason — presumably to keep the user
   script single-file. Worth re-evaluating whether that constraint is
   real. If yes, extract the styles into a const at the top of the
   file rather than threading through a method.

8. **Script-tag-only deployment cuts off testing.** No build, no
   modules, no tests — only the benchmark suite under `benchmark/`
   exercises the code, and that's a copy of the prompt + provider
   clients re-implemented in Node. Drift between the production
   `main.js` system prompt and the benchmark's system prompt is a real
   risk. A single shared prompt file (`prompts/verify.md`) + a build
   step that inlines it for the user script would let the benchmark
   import the same source of truth.

9. **No abort signal for in-flight fetches.** The fetch + verify
   cancellation logic uses a counter (`currentFetchId`,
   `currentVerifyId`) that you check after `await` completes. This
   wastes the bandwidth and the API call when the user clicks a new
   citation mid-fetch. Switching to `AbortController` would give a
   clean cancel and reclaim the inflight call.

## Things to leave alone

These all looked considered and intentional:

- **OOUI lazy load** (line 87) — correct pattern for a user script
  that should not block page render.
- **`'anthropic-dangerous-direct-browser-access': 'true'`** (line 2129)
  — the only way to do direct-from-browser Claude calls; the warning
  in the header name is the API's, not yours.
- **Citation cache keyed on `url + page`** (line 2769) — sensible.
- **Between-citations claim extraction** (line 1424–1503) — the
  CLAUDE.md correctly identifies this as "by design (not full
  sentences) for precision," and the implementation is careful (Range
  API, walks back through siblings, has a fallback). This is one of
  the strongest parts of the script.
- **PDF page extraction routing** — the PDF page-num override is a
  concrete win for journal citations and is well-handled in both
  `fetchSourceContent` and the report path.

## Suggested order if any of this lands

1. **Extract the prompt to `prompts/verify.md`** and have both the user
   script and the benchmark read it at build time. Lowest risk, highest
   leverage for everything that follows. Probably 50 LoC of changes
   plus a tiny build step.

2. **Collapse the four provider methods into a config-driven dispatch.**
   Pure refactor, no behavior change, easy to review side-by-side
   against the benchmark output for regressions. Cuts ~120 LoC.

3. **Address #102 (ERROR verdict category) by reworking the verdict
   parser** to distinguish parse-failure from category-failure from
   legitimate `SOURCE UNAVAILABLE`. Tied to (1) and (2) — once the
   prompt is shared and the dispatch is unified, the parse layer is the
   obvious next bottleneck.

4. **Move CSS to a separate string at the top of `main.js`** (or a
   built-in `<style>` tag loaded via `mw.loader`). Mechanical, large
   diff, no behavior change.

5. **Switch fetch cancellation to `AbortController`.** Small,
   self-contained, real win for users on slow connections.

6. **Then split the file** into `verifier.js`, `providers.js`,
   `claim-extraction.js`, `report.js`, `ui.js`. By this point the
   seams are visible and the split mostly draws itself.

None of these is urgent. The script works and has users. But they're the
kinds of changes that get cheaper to do now and steeply more expensive
once five more features have stretched across the same 3k lines.
