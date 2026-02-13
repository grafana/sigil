---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Model Card Catalog Refresh and API

## Problem statement

Sigil needs a durable model-card catalog (name, provider, cost, capabilities, context window, and metadata) that stays fresh without manual updates.

Requirements:

- automatically refresh from an external source
- support static fallback when external fetch fails
- keep catalog in process memory
- expose a stable API for plugin/backend consumers

## External findings (validated 2026-02-12)

### Live endpoint checks

| Source | Public without key | Observed auth behavior | Data richness |
| --- | --- | --- | --- |
| OpenRouter `GET /api/v1/models` | yes | `200` without key | strong: `id`, `name`, `canonical_slug`, `pricing`, `top_provider`, `architecture`, `supported_parameters`, `context_length` |
| OpenRouter `GET /api/v1/models/user` | no | `401` without key | user-scoped model access |
| OpenRouter `POST /api/v1/chat/completions` | no | `401` with invalid key | generation requires API key |
| Hugging Face `GET /api/models` | yes | `200` without key | broad catalog metadata |
| Hugging Face `expand=inferenceProviderMapping` | yes | `200` without key | provider/performance details; pricing/context present but sparse in sample |
| LiteLLM cost map JSON (GitHub raw) | yes | `200` without key | very wide static metadata: cost + capabilities + provider hints |
| OpenAI `GET /v1/models` | no | `401` without key | limited model metadata, no native pricing fields |
| Anthropic `GET /v1/models` | no | `401` without key | limited model metadata, no native pricing fields |
| Together `GET /v1/models` | no | `401` without key | limited model metadata without auth |
| Groq `GET /openai/v1/models` | no | `401` without key | limited model metadata without auth |
| Replicate `GET /v1/models` | no | `401` without key | limited model metadata without auth |
| Google Gemini `GET /v1beta/models` | no | `403` without identity | catalog requires API identity |

### Data depth snapshot (same validation run)

- OpenRouter model count: `342`
- OpenRouter latest model `created`: `2026-02-12T15:01:42Z`
- OpenRouter free-tagged models (`:free`): `29`
- OpenRouter models with prompt price `0`: `33`
- Hugging Face sample (`limit=100`, `expand=inferenceProviderMapping`):
  - models with provider pricing present: `14`
  - models with provider context length present: `14`
- LiteLLM static entries: `2527`
- Exact OpenRouter/LiteLLM id overlap: low (`9` exact ids), so alias mapping is required

### Direct answer: is OpenRouter API free and does it need an API key?

- Catalog read (`GET /api/v1/models`) is publicly accessible without an API key.
- Generation/inference endpoints require an API key (Quickstart examples and runtime checks both show bearer-key usage).
- Free models exist in the catalog, but they are still subject to provider/OpenRouter limits and policies.

## Options

### Option A: OpenRouter primary + static fallback (recommended)

Description:

- Primary external source: OpenRouter models API (live, normalized, includes pricing/provider/context).
- Static fallback: versioned JSON snapshot committed in-repo.

Pros:

- no key required for catalog refresh
- complete pricing/provider fields for most entries
- low transform complexity
- fast time to production

Cons:

- tied to one aggregator taxonomy
- OpenRouter-specific model ids may differ from other ecosystems

### Option B: Hugging Face primary + custom pricing enrichment

Description:

- Primary external source: Hugging Face `/api/models` + `expand=inferenceProviderMapping`
- Supplemental enrichment from custom mappings for missing costs.

Pros:

- very broad model discovery
- public endpoint

Cons:

- pricing/context are sparse and provider-dependent
- significantly more normalization logic
- weaker consistency for cost fields

### Option C: Multi-vendor direct fan-in (OpenAI/Anthropic/Together/Groq/etc)

Description:

- Pull catalogs from each provider API and normalize into one schema.

Pros:

- first-party source fidelity for each provider
- no dependency on a single aggregator

Cons:

- many keys/secrets to manage
- heterogeneous schemas and release cadence
- most vendor endpoints do not provide consistent cost fields

### Option D: Static-first (LiteLLM map) + periodic optional live refresh

Description:

- Use LiteLLM cost map as base catalog; optionally patch with live source when available.

Pros:

- very large coverage
- simple bootstrap without live dependency

Cons:

- static file semantics, no strict freshness SLA
- naming mismatch against OpenRouter/vendor ids requires aliasing
- not a complete live catalog source

## Recommended architecture

Choose Option A now, keep Option D as secondary fallback input.

### Runtime topology

- Model-card catalog is an in-memory cache initialized from embedded snapshot JSON.
- `target=all` shares one model-card service instance between API routes and refresh loop.
- `target=server` runs the refresh loop inside the server module (per pod memory cache).
- `target=catalog-sync` remains available for refresh-only workloads, but does not share state across pods.

### Source priority

1. OpenRouter live API
2. Last known good static snapshot (repo)

### Refresh flow

1. Scheduler triggers every `30m` (configurable).
2. Fetch primary source with timeout/retry.
3. If primary fails, use embedded fallback snapshot.
4. Normalize into canonical model-card struct.
5. Upsert into in-memory cache.
6. Record refresh run status in memory.

### Freshness policy

- target freshness: <= `30m`
- soft-stale threshold: `2h`
- hard-stale threshold: `24h`
- API always returns `freshness` metadata including `source_path` (`memory_live`, `memory_stale`, `snapshot_fallback`)

## Canonical model-card shape

```json
{
  "model_key": "openrouter:openai/gpt-5",
  "source": "openrouter",
  "source_model_id": "openai/gpt-5",
  "name": "OpenAI: GPT-5",
  "provider": "openai",
  "description": "string",
  "context_length": 200000,
  "modality": "text",
  "input_modalities": ["text"],
  "output_modalities": ["text"],
  "supported_parameters": ["tools", "response_format"],
  "pricing": {
    "prompt_usd_per_token": "0.00000125",
    "completion_usd_per_token": "0.00001000",
    "request_usd": "0",
    "image_usd": "0",
    "web_search_usd": "0",
    "input_cache_read_usd_per_token": "0",
    "input_cache_write_usd_per_token": "0"
  },
  "is_free": false,
  "top_provider": {
    "context_length": 200000,
    "max_completion_tokens": 16384,
    "is_moderated": true
  },
  "first_seen_at": "2026-02-12T20:00:00Z",
  "last_seen_at": "2026-02-12T23:30:00Z",
  "expires_at": null,
  "status": "active",
  "raw_payload": {}
}
```

## Storage model

- The model-card catalog is stored in process memory (`modelcards.MemoryStore`).
- The embedded fallback snapshot is compiled into the binary with `go:embed`.
- No MySQL schema is required for model-card refresh/read paths.

## API design

All endpoints follow existing Sigil style under `/api/v1/*`.

### `GET /api/v1/model-cards`

Query params:

- `q` (search on `name`, `provider`, `source_model_id`)
- `source` (for example `openrouter`)
- `provider` (for example `openai`, `anthropic`)
- `free_only` (`true|false`)
- `min_context_length` (int)
- `max_prompt_price_usd_per_token` (decimal string)
- `max_completion_price_usd_per_token` (decimal string)
- `regex` (RE2 expression against `model_key`, `source_model_id`, `name`, `provider`, `canonical_slug`)
- `sort` (`name|provider|prompt_price|context_length|last_seen_at`)
- `order` (`asc|desc`)
- `limit` (default `50`, max `200`)
- `cursor` (opaque pagination token)

Response:

```json
{
  "data": [
    {
      "model_key": "openrouter:openai/gpt-5",
      "source": "openrouter",
      "source_model_id": "openai/gpt-5",
      "name": "OpenAI: GPT-5",
      "provider": "openai",
      "context_length": 200000,
      "is_free": false,
      "pricing": {
        "prompt_usd_per_token": "0.00000125",
        "completion_usd_per_token": "0.00001000"
      },
      "last_seen_at": "2026-02-12T23:30:00Z"
    }
  ],
  "next_cursor": "eyJsYXN0X2lkIjoyMzQ1fQ==",
  "freshness": {
    "catalog_last_refreshed_at": "2026-02-12T23:30:00Z",
    "stale": false,
    "source_path": "memory_live"
  }
}
```

### `GET /api/v1/model-cards:lookup`

Query params:

- either `model_key`
- or pair `source` + `source_model_id`

Response:

- full canonical model-card object (including description, capabilities, top_provider, raw source metadata)

### `GET /api/v1/model-cards:sources`

Response:

- per-source refresh health:
  - `source`
  - `last_success_at`
  - `last_run_status`
  - `last_run_mode` (`primary|fallback`)
  - `stale`

### `POST /api/v1/model-cards:refresh` (protected/admin)

Request:

```json
{
  "source": "openrouter",
  "mode": "primary"
}
```

Behavior:

- triggers immediate refresh run
- returns run summary and status

## Static fallback contract

Fallback file path:

- `sigil/internal/modelcards/fallback/openrouter_models.v1.json`

Format:

```json
{
  "source": "openrouter",
  "captured_at": "2026-02-12T23:30:00Z",
  "schema_version": 1,
  "models": []
}
```

Refresh tooling should include:

- command to update snapshot from live source
- deterministic output (stable sort) for diff-friendly reviews
- checksum written in refresh-run details for traceability

## Operational concerns

- Metrics:
  - `model_cards_refresh_duration_seconds`
  - `model_cards_refresh_success_total`
  - `model_cards_refresh_failure_total`
  - `model_cards_catalog_age_seconds`
  - `model_cards_rows_total`
- Alerts:
  - no successful refresh in `>2h`
  - fallback mode used continuously for `>24h`
  - row count drops by `>30%` in one run

## Risks

- Source schema drift can break normalization.
- Incorrect stale-marking policy can hide valid models.
- Mixed-source aliasing can produce duplicate cards if mapping is weak.
- Returning stale pricing without freshness metadata can mislead users.

## Rollout plan (high-level)

1. Land schema + read API behind feature flag.
2. Land refresh tooling with OpenRouter source + static fallback.
3. Enable scheduled refresh in non-prod, then prod.
4. Add optional split deployment mode in Helm (`catalogSync.enabled=true`) for singleton refresh.
5. Add optional enrichment source(s) only after baseline stability.

## References

- OpenRouter Models guide: [https://openrouter.ai/docs/overview/models](https://openrouter.ai/docs/overview/models)
- OpenRouter get models reference: [https://openrouter.ai/docs/api-reference/models/get-models](https://openrouter.ai/docs/api-reference/models/get-models)
- OpenRouter quickstart (auth examples): [https://openrouter.ai/docs/quickstart](https://openrouter.ai/docs/quickstart)
- OpenRouter models endpoint: [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models)
- Hugging Face Hub API docs: [https://huggingface.co/docs/hub/en/api](https://huggingface.co/docs/hub/en/api)
- Hugging Face models endpoint: [https://huggingface.co/api/models](https://huggingface.co/api/models)
- LiteLLM model cost map (static JSON): [https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
