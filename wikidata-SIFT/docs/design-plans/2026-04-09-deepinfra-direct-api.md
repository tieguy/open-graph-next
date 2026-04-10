# DeepInfra Direct API for Nemotron 3 Nano

## Summary

Route Nemotron 3 Nano through DeepInfra's OpenAI-compatible API instead of OpenRouter, bypassing the infinite tool-calling loop caused by OpenRouter's middleware. Uses a per-model provider map to select API endpoint and credentials, with token-based cost computation for DeepInfra models.

## Definition of Done
- `run_verdict_fanout.py` supports routing specific models to DeepInfra's API (`api.deepinfra.com/v1/openai/chat/completions`) instead of OpenRouter, controlled by configuration (not hardcoded)
- `DEEPINFRA_API_KEY` loaded from `.env` alongside `OPENROUTER_API_KEY`
- Cost tracking computes dollar costs from DeepInfra's token counts + published pricing
- Nemotron 3 Nano is configured to use DeepInfra by default
- Existing OpenRouter models are unaffected
- Checkpoint/resume works across providers (same revid-keyed state)
- Tests updated for the new code paths
- 5-edit smoke test passes with Nemotron via DeepInfra (manual, not automated)

Out of scope: supporting arbitrary providers beyond OpenRouter + DeepInfra.

## Glossary

- **OpenRouter**: API aggregator that proxies requests to multiple model providers. Current default backend.
- **DeepInfra**: Model hosting provider with OpenAI-compatible API. Hypothesized to avoid the Nemotron tool-calling loop seen on OpenRouter.
- **Provider map**: Configuration dict mapping model IDs to their API endpoint and credentials.

## Architecture

### Per-model provider routing

A new `MODEL_PROVIDERS` dict maps model IDs to provider config. Models not in the map default to OpenRouter (preserving current behavior).

```python
MODEL_PROVIDERS = {
    "nvidia/nemotron-3-nano-30b-a3b": {
        "base_url": "https://api.deepinfra.com/v1/openai",
        "api_key_env": "DEEPINFRA_API_KEY",
        "model_id": "nvidia/Nemotron-3-Nano-30B-A3B-v1",  # DeepInfra's model ID
    },
}
```

The `model_id` field handles the case where DeepInfra uses a different model string than OpenRouter. The key in `MODEL_PROVIDERS` (and in `MODELS`, `MODELS_NO_RESPONSE_FORMAT`, etc.) remains the OpenRouter-style ID for consistency across checkpoint state and verdict records.

### Client creation

At startup, create one `OpenAI` client per unique provider:

```python
def build_clients(models):
    """Create OpenAI clients for each unique provider needed by the model list."""
    clients = {}  # model_id -> OpenAI client
    for model in models:
        provider = MODEL_PROVIDERS.get(model)
        if provider:
            base_url = provider["base_url"]
            api_key = os.environ[provider["api_key_env"]]
        else:
            base_url = "https://openrouter.ai/api/v1"
            api_key = os.environ["OPENROUTER_API_KEY"]
        # Reuse client if same base_url already created
        if base_url not in clients:
            clients[base_url] = OpenAI(
                base_url=base_url, api_key=api_key,
                max_retries=3, timeout=120.0,
            )
    return clients
```

A helper `get_client(model)` returns the right client + resolved model ID for any model string.

### Cost tracking for DeepInfra

DeepInfra returns standard `usage.prompt_tokens` and `usage.completion_tokens`. Add a pricing dict:

```python
DEEPINFRA_PRICING = {
    "nvidia/nemotron-3-nano-30b-a3b": {
        "input_per_mtok": 0.13,   # $/M input tokens
        "output_per_mtok": 0.20,  # $/M output tokens
    },
}
```

When a model is in `DEEPINFRA_PRICING`, compute cost from tokens instead of using OpenRouter's generation endpoint. The existing `inline_cost` path (from `usage.cost`) is tried first as a fallback.

### What stays the same

- **Checkpoint/resume**: Already keyed on `(revid, model)` — model ID stays the same regardless of provider, so no change needed.
- **Verdict records**: `model` field continues to use the OpenRouter-style ID.
- **`MODELS_NO_RESPONSE_FORMAT` and `MODEL_EXTRA_BODY`**: May need adjustment for DeepInfra (DeepInfra may handle `response_format` and reasoning differently). Determined during smoke test.
- **Phase A / Phase B flow**: Unchanged — only the client and model_id passed to `chat.completions.create()` differ.

## Existing Patterns

- `MODEL_EXTRA_BODY` already handles per-model API quirks — `MODEL_PROVIDERS` follows the same pattern of "config dict keyed by model ID".
- `MODELS_NO_RESPONSE_FORMAT` already handles provider-specific capability gaps.
- The script already uses the OpenAI SDK's standard interface, so DeepInfra (which is OpenAI-compatible) requires no SDK changes.

## Implementation Phases

### Phase 1: Provider routing infrastructure
Add `MODEL_PROVIDERS`, `DEEPINFRA_PRICING`, `build_clients()`, and `get_client()` to the constants/setup section. Modify `main()` to create clients via `build_clients()` instead of the single hardcoded client. Thread the correct `(client, model_id)` pair through to `run_single_verdict`.

### Phase 2: Cost tracking
Add token-based cost computation for DeepInfra models. Modify the cost aggregation in `run_single_verdict` to use `DEEPINFRA_PRICING` when the model is a DeepInfra model and no `inline_cost` is available.

### Phase 3: Tests
Unit tests for `build_clients()`, `get_client()`, and the cost computation path. Mock-based — no real API calls.

### Phase 4: Smoke test and tuning
Run 5-edit smoke test with Nemotron via DeepInfra. Adjust `MODELS_NO_RESPONSE_FORMAT` and `MODEL_EXTRA_BODY` based on actual DeepInfra behavior.

## Additional Considerations

- **API key validation**: `main()` should check `DEEPINFRA_API_KEY` is set if any model in the lineup needs it, and fail fast with a clear message.
- **DeepInfra model ID lookup**: The exact model ID on DeepInfra needs to be confirmed at implementation time (likely `nvidia/Nemotron-3-Nano-30B-A3B-v1` but may vary).
- **Pricing updates**: DeepInfra pricing changes over time. The hardcoded dict is fine for an experiment; if this becomes long-lived, consider fetching from their API.
