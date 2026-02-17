---
owner: sigil-core
status: active
last_reviewed: 2026-02-17
source_of_truth: true
audience: both
---

# Online Evaluation Control Plane API

## Auth

All endpoints are tenant-scoped protected routes and require tenant context (`X-Scope-OrgID`).

## Evaluators

### `POST /api/v1/eval/evaluators`

Create or update an evaluator definition.

Request body:
- `evaluator_id` (string, required)
- `version` (string, required)
- `kind` (enum string: `llm_judge|json_schema|regex|heuristic`)
- `config` (object)
- `output_keys` (array, at least one):
  - `key` (required)
  - `type` (`number|bool|string`)
  - `unit` (optional)
  - `pass_threshold` (optional)

Response: evaluator object (`200 OK`).

### `GET /api/v1/eval/evaluators?limit=&cursor=`

List evaluators with cursor pagination.

Response:
- `items`: evaluator array
- `next_cursor`: string cursor (empty when exhausted)

Notes:
- Predefined templates are seeded per tenant when listing evaluators for the first time.

### `GET /api/v1/eval/evaluators/{id}`

Get latest active version for an evaluator id.

Response:
- `200 OK` evaluator object
- `404 Not Found` if missing

### `DELETE /api/v1/eval/evaluators/{id}`

Soft-delete evaluator id across versions.

Response:
- `204 No Content` (idempotent)

## Rules

### `POST /api/v1/eval/rules`

Create or update a rule.

Request body:
- `rule_id` (required)
- `enabled` (bool)
- `selector` (`user_visible_turn|all_assistant_generations|tool_call_steps|errored_generations`)
- `match` (object of filter keys)
- `sample_rate` (0..1)
- `evaluator_ids` (non-empty array)

Response: rule object (`200 OK`).

### `GET /api/v1/eval/rules?limit=&cursor=`

List rules with cursor pagination.

Response:
- `items`: rule array
- `next_cursor`: string cursor

### `GET /api/v1/eval/rules/{id}`

Get rule by id.

Response:
- `200 OK` rule object
- `404 Not Found`

### `PATCH /api/v1/eval/rules/{id}`

Enable/disable rule.

Request body:
```json
{ "enabled": true }
```

Response:
- `200 OK` updated rule
- `404 Not Found`

### `DELETE /api/v1/eval/rules/{id}`

Soft-delete rule.

Response:
- `204 No Content` (idempotent)

## Judge Provider Discovery

### `GET /api/v1/eval/judge/providers`

Response:
```json
{
  "providers": [
    { "id": "openai", "name": "OpenAI", "type": "direct" }
  ]
}
```

### `GET /api/v1/eval/judge/models?provider={id}`

Response:
```json
{
  "models": [
    {
      "id": "gpt-4o-mini",
      "name": "gpt-4o-mini",
      "provider": "openai",
      "context_window": 0
    }
  ]
}
```

`provider` query param is required.

## YAML Seed Format

Optional seed file is loaded at startup when `SIGIL_EVAL_SEED_FILE` is set.

Top-level keys:
- `evaluators`
- `rules`

Evaluator YAML shape:
- `id`, `kind`, `version`
- evaluator config fields inline (for example `system_prompt`, `model`, `schema`, `patterns`)
- `output.keys[]` with `key`, `type`, `unit`

Rule YAML shape:
- `id`, `enabled`
- `select.selector`
- `match`
- `sample.rate`
- `evaluators` (array of evaluator IDs)

Duplicate evaluator IDs or rule IDs in the same file are rejected.

See `sigil-eval-seed.example.yaml`.
