---
owner: sigil-core
status: active
last_reviewed: 2026-02-17
source_of_truth: true
audience: contributors
---

# Model Cards API

This reference defines the HTTP contract for Sigil model-card endpoints under `/api/v1`.

The effective read catalog is composed from:

- base OpenRouter snapshot (`internal/modelcards/fallback/openrouter_models.v1.json`)
- supplemental catalog (`internal/modelcards/fallback/supplemental_models.v1.json`) with additive models and targeted patch updates

## Endpoints

- `GET /api/v1/model-cards`
- `GET /api/v1/model-cards:lookup`
- `GET /api/v1/model-cards:sources`
- `POST /api/v1/model-cards:refresh`

## Model Card Object

```json
{
  "model_key": "openrouter:openai/gpt-5",
  "source": "openrouter",
  "source_model_id": "openai/gpt-5",
  "canonical_slug": "openai/gpt-5",
  "name": "OpenAI: GPT-5",
  "provider": "openai",
  "description": "Optional human-readable description.",
  "context_length": 200000,
  "modality": "text",
  "input_modalities": ["text"],
  "output_modalities": ["text"],
  "supported_parameters": ["tools", "response_format"],
  "tokenizer": "cl100k_base",
  "pricing": {
    "prompt_usd_per_token": 0.00000125,
    "completion_usd_per_token": 0.00001,
    "request_usd": 0,
    "image_usd": 0,
    "web_search_usd": 0,
    "input_cache_read_usd_per_token": 0,
    "input_cache_write_usd_per_token": 0
  },
  "is_free": false,
  "top_provider": {
    "context_length": 200000,
    "max_completion_tokens": 16384,
    "is_moderated": true
  },
  "expires_at": null,
  "first_seen_at": "2026-02-13T10:00:00Z",
  "last_seen_at": "2026-02-13T10:00:00Z",
  "refreshed_at": "2026-02-13T10:00:00Z"
}
```

## Freshness Object

```json
{
  "catalog_last_refreshed_at": "2026-02-13T10:00:00Z",
  "stale": false,
  "soft_stale": false,
  "hard_stale": false,
  "source_path": "memory_live"
}
```

Allowed `source_path` values:

- `memory_live`
- `memory_stale`
- `snapshot_fallback`

Model card `source` values currently emitted:

- `openrouter`
- `supplemental`

## Catalog Maintenance

- `mise run model-cards:snapshot:update`: refresh base OpenRouter snapshot.
- `mise run model-cards:snapshot:check`: validate base snapshot schema/checksum/canonical formatting.
- `mise run model-cards:supplemental:update`: additive/update refresh of supplemental models from current OpenRouter live entries missing in the base snapshot.
- `mise run model-cards:supplemental:check`: validate supplemental canonical formatting and strict preflight merge compatibility with the base snapshot.

## GET /api/v1/model-cards

Dual-mode endpoint:

- list mode: filtering, sorting, and cursor pagination
- resolve mode: deterministic provider+model resolution for pricing joins

### Query Parameters

List mode parameters:

- `q`: case-insensitive substring search across `name`, `provider`, `source_model_id`
- `regex`: RE2 regex over `model_key`, `source_model_id`, `name`, `provider`, `canonical_slug`
- `source`: exact source filter (for example `openrouter`)
- `provider`: exact provider filter (for example `openai`)
- `free_only`: boolean (`true` or `false`)
- `min_context_length`: integer
- `max_prompt_price_usd_per_token`: float
- `max_completion_price_usd_per_token`: float
- `sort`: one of `name|provider|prompt_price|context_length|last_seen_at`
- `order`: one of `asc|desc`
- `limit`: integer (`1..200`, default `50`)
- `cursor`: opaque cursor from prior response

Resolve mode parameters:

- `resolve_pair`: repeated parameter in the form `provider:model`
  - example: `?resolve_pair=openai:gpt-4o&resolve_pair=anthropic:claude-sonnet-4.5`
  - max 100 values
  - when present, no other query parameters are allowed

Resolve behavior notes:

- Bedrock provider-family heuristics normalize AWS model identifier variants (for example regional/profile IDs like `us.anthropic.claude-haiku-4-5-20251001-v1:0`, and ARN/resource forms containing `foundation-model/` or `inference-profile/`).
- Matching remains strict for pricing joins: resolver normalizes format but does not guess nearest model versions when the exact target model is absent.

### Response 200 (list mode)

```json
{
  "data": [
    {
      "model_key": "openrouter:openai/gpt-5",
      "source": "openrouter",
      "source_model_id": "openai/gpt-5",
      "name": "OpenAI: GPT-5"
    }
  ],
  "next_cursor": "NTA=",
  "freshness": {
    "catalog_last_refreshed_at": "2026-02-13T10:00:00Z",
    "stale": false,
    "soft_stale": false,
    "hard_stale": false,
    "source_path": "memory_live"
  }
}
```

### Response 200 (resolve mode)

```json
{
  "resolved": [
    {
      "provider": "openai",
      "model": "gpt-4o",
      "status": "resolved",
      "match_strategy": "exact",
      "card": {
        "model_key": "openrouter:openai/gpt-4o",
        "source_model_id": "openai/gpt-4o",
        "pricing": {
          "prompt_usd_per_token": 0.00000125,
          "completion_usd_per_token": 0.00001
        }
      }
    },
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "status": "unresolved",
      "reason": "not_found"
    }
  ],
  "freshness": {
    "catalog_last_refreshed_at": "2026-02-13T10:00:00Z",
    "stale": false,
    "soft_stale": false,
    "hard_stale": false,
    "source_path": "memory_live"
  }
}
```

Resolve item fields:

- `status`: `resolved|unresolved`
- `match_strategy` (resolved only): `exact|normalized`
- `reason` (unresolved only): `not_found|ambiguous|invalid_input`

### Error Responses

- `400`: invalid query params (for example invalid `regex`, invalid `limit`, invalid floats, malformed `resolve_pair`, or mixed resolve/list params)
- `500`: internal failure while reading catalog

## GET /api/v1/model-cards:lookup

Lookup one model card by identity.

### Query Parameters

Use either:

- `model_key`

Or both:

- `source`
- `source_model_id`

### Response 200

```json
{
  "data": {
    "model_key": "openrouter:openai/gpt-5",
    "source": "openrouter",
    "source_model_id": "openai/gpt-5",
    "name": "OpenAI: GPT-5"
  },
  "freshness": {
    "catalog_last_refreshed_at": "2026-02-13T10:00:00Z",
    "stale": false,
    "soft_stale": false,
    "hard_stale": false,
    "source_path": "memory_live"
  }
}
```

### Error Responses

- `400`: missing identifier (`model_key` or `source+source_model_id`)
- `404`: model card not found
- `500`: internal failure while reading catalog

## GET /api/v1/model-cards:sources

Source health and last-refresh metadata.

### Response 200

```json
{
  "data": [
    {
      "source": "openrouter",
      "last_success_at": "2026-02-13T10:00:00Z",
      "last_run_status": "success",
      "last_run_mode": "primary",
      "stale": false
    }
  ]
}
```

### Error Responses

- `500`: internal failure while reading source status

## POST /api/v1/model-cards:refresh

Trigger immediate refresh.

### Request Body

```json
{
  "source": "openrouter",
  "mode": "primary"
}
```

`source` may be omitted; if provided, only `openrouter` is accepted.

### Response 200

```json
{
  "run": {
    "source": "openrouter",
    "run_mode": "primary",
    "status": "success",
    "started_at": "2026-02-13T10:00:00Z",
    "finished_at": "2026-02-13T10:00:00Z",
    "fetched_count": 342,
    "upserted_count": 342,
    "stale_marked_count": 0
  }
}
```

### Error Responses

- `400`: invalid request body or unsupported `source`
- `500`: refresh failure (response includes `run` and `error`)
