---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Model Card Catalog Refresh and API

## Problem statement

Sigil needs a durable model-card catalog (name, provider, cost, capabilities, context window, and metadata) that stays fresh without manual updates.

Requirements:

- automatically refresh from an external source
- support static fallback when external fetch fails
- store catalog in MySQL
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

### Source priority

1. OpenRouter live API
2. Last known good static snapshot (repo)
3. Existing MySQL state (serve stale-but-annotated data instead of failing hard)

### Refresh flow

1. Scheduler triggers every `30m` (configurable).
2. Acquire MySQL advisory lock (`model_cards_refresh`) to prevent concurrent refresh.
3. Fetch primary source with timeout/retry.
4. If primary fails, load static fallback JSON from disk.
5. Normalize into canonical model-card struct.
6. Upsert rows into MySQL.
7. Mark unseen rows as stale only after a grace window (avoid accidental mass-delete).
8. Record refresh run metrics and status.

### Freshness policy

- target freshness: <= `30m`
- soft-stale threshold: `2h`
- hard-stale threshold: `24h`
- API always returns `freshness` metadata so UI can show staleness state

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

## MySQL schema

### `model_cards`

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `model_key VARCHAR(255) NOT NULL` (for example `openrouter:openai/gpt-5`)
- `source VARCHAR(32) NOT NULL`
- `source_model_id VARCHAR(255) NOT NULL`
- `canonical_slug VARCHAR(255) NULL`
- `name VARCHAR(255) NOT NULL`
- `provider VARCHAR(128) NULL`
- `description TEXT NULL`
- `context_length INT NULL`
- `modality VARCHAR(64) NULL`
- `input_modalities JSON NULL`
- `output_modalities JSON NULL`
- `supported_parameters JSON NULL`
- `tokenizer VARCHAR(128) NULL`
- `prompt_price_usd_per_token DECIMAL(20,12) NULL`
- `completion_price_usd_per_token DECIMAL(20,12) NULL`
- `request_price_usd DECIMAL(20,12) NULL`
- `image_price_usd DECIMAL(20,12) NULL`
- `web_search_price_usd DECIMAL(20,12) NULL`
- `input_cache_read_price_usd_per_token DECIMAL(20,12) NULL`
- `input_cache_write_price_usd_per_token DECIMAL(20,12) NULL`
- `is_free BOOLEAN NOT NULL DEFAULT FALSE`
- `top_provider JSON NULL`
- `expires_at DATE NULL`
- `first_seen_at TIMESTAMP(6) NOT NULL`
- `last_seen_at TIMESTAMP(6) NOT NULL`
- `deprecated_at TIMESTAMP(6) NULL`
- `raw_payload JSON NOT NULL`
- `refreshed_at TIMESTAMP(6) NOT NULL`
- `created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`
- `updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`

Indexes:

- unique: `uq_model_key (model_key)`
- lookup: `idx_source_model (source, source_model_id)`
- filtering: `idx_provider (provider)`, `idx_is_free (is_free)`, `idx_prompt_price (prompt_price_usd_per_token)`
- freshness: `idx_last_seen (last_seen_at)`

### `model_card_aliases`

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `model_key VARCHAR(255) NOT NULL`
- `alias_source VARCHAR(32) NOT NULL`
- `alias_value VARCHAR(255) NOT NULL`
- `created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`

Indexes:

- unique: `uq_alias (alias_source, alias_value)`
- lookup: `idx_alias_model_key (model_key)`

### `model_card_refresh_runs`

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `source VARCHAR(32) NOT NULL`
- `run_mode ENUM('primary', 'fallback') NOT NULL`
- `status ENUM('success', 'partial', 'failed') NOT NULL`
- `started_at TIMESTAMP(6) NOT NULL`
- `finished_at TIMESTAMP(6) NOT NULL`
- `fetched_count INT NOT NULL DEFAULT 0`
- `upserted_count INT NOT NULL DEFAULT 0`
- `stale_marked_count INT NOT NULL DEFAULT 0`
- `error_summary TEXT NULL`
- `details JSON NULL`

Indexes:

- `idx_source_started (source, started_at)`
- `idx_status_started (status, started_at)`

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
    "stale": false
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
4. Add optional enrichment source(s) only after baseline stability.

## References

- OpenRouter Models guide: [https://openrouter.ai/docs/overview/models](https://openrouter.ai/docs/overview/models)
- OpenRouter get models reference: [https://openrouter.ai/docs/api-reference/models/get-models](https://openrouter.ai/docs/api-reference/models/get-models)
- OpenRouter quickstart (auth examples): [https://openrouter.ai/docs/quickstart](https://openrouter.ai/docs/quickstart)
- OpenRouter models endpoint: [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models)
- Hugging Face Hub API docs: [https://huggingface.co/docs/hub/en/api](https://huggingface.co/docs/hub/en/api)
- Hugging Face models endpoint: [https://huggingface.co/api/models](https://huggingface.co/api/models)
- LiteLLM model cost map (static JSON): [https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
