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
- `output_keys` (array, exactly one key is currently supported):
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
- This endpoint only returns tenant-configured evaluators. Predefined templates are listed via dedicated predefined endpoints.

### `GET /api/v1/eval/evaluators/{id}`

Get latest active version for an evaluator id.

Response:
- `200 OK` evaluator object
- `404 Not Found` if missing

### `DELETE /api/v1/eval/evaluators/{id}`

Soft-delete evaluator id across versions.

Response:
- `204 No Content` (idempotent)

## Predefined Evaluator Templates

### `GET /api/v1/eval/predefined/evaluators`

List built-in evaluator templates that can be forked into tenant evaluators.

Response:
- `items`: predefined evaluator definitions (template metadata + default config)

### `POST /api/v1/eval/predefined/evaluators/{template_id}:fork`

Create a tenant evaluator by forking a predefined template.

Request body:
- `evaluator_id` (required, new tenant evaluator id)
- `version` (optional, defaults to template version)
- `config` (optional, shallow override map merged on top of template config)
- `output_keys` (optional, replaces template output keys when provided)

Response:
- created evaluator object (`200 OK`)

## Rules

### `POST /api/v1/eval/rules`

Create or update a rule.

Request body:
- `rule_id` (required)
- `enabled` (bool)
- `selector` (`user_visible_turn|all_assistant_generations|tool_call_steps|errored_generations`)
- `match` (object of filter keys)
- `sample_rate` (0..1, defaults to `0.01` when omitted)
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

## Judge Provider Configuration

Discovery is opt-in per provider and only returns providers that are both:
- explicitly enabled
- fully initialized with valid credentials/config

Enable flag values accepted: `1`, `true`, `yes`, `on` (case-insensitive).

Provider matrix:

| Provider ID | Enable flag | Required auth/config | Optional auth/config |
| --- | --- | --- | --- |
| `openai` | `SIGIL_EVAL_OPENAI_ENABLED` | `SIGIL_EVAL_OPENAI_API_KEY` | `SIGIL_EVAL_OPENAI_BASE_URL` |
| `azure` | `SIGIL_EVAL_AZURE_OPENAI_ENABLED` | `SIGIL_EVAL_AZURE_OPENAI_ENDPOINT`, `SIGIL_EVAL_AZURE_OPENAI_API_KEY` | -- |
| `anthropic` | `SIGIL_EVAL_ANTHROPIC_ENABLED` | one of `SIGIL_EVAL_ANTHROPIC_API_KEY`, `SIGIL_EVAL_ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | `SIGIL_EVAL_ANTHROPIC_BASE_URL` |
| `bedrock` | `SIGIL_EVAL_BEDROCK_ENABLED` | AWS default credentials/role or `SIGIL_EVAL_BEDROCK_BEARER_TOKEN` | `SIGIL_EVAL_BEDROCK_REGION`, `AWS_REGION`, `SIGIL_EVAL_BEDROCK_BASE_URL` |
| `google` | `SIGIL_EVAL_GOOGLE_ENABLED` | one of `SIGIL_EVAL_GOOGLE_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` | `SIGIL_EVAL_GOOGLE_BASE_URL` |
| `vertexai` | `SIGIL_EVAL_VERTEXAI_ENABLED` | `SIGIL_EVAL_VERTEXAI_PROJECT` + ADC or credentials file/json | `SIGIL_EVAL_VERTEXAI_LOCATION`, `SIGIL_EVAL_VERTEXAI_CREDENTIALS_FILE`, `SIGIL_EVAL_VERTEXAI_CREDENTIALS_JSON`, `SIGIL_EVAL_VERTEXAI_BASE_URL` |
| `anthropic-vertex` | `SIGIL_EVAL_ANTHROPIC_VERTEX_ENABLED` | `SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT` + ADC or credentials file/json | `SIGIL_EVAL_ANTHROPIC_VERTEX_LOCATION`, `SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_FILE`, `SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_JSON`, `SIGIL_EVAL_ANTHROPIC_VERTEX_BASE_URL` |
| `openai-compat` (default) | `SIGIL_EVAL_OPENAI_COMPAT_ENABLED` | `SIGIL_EVAL_OPENAI_COMPAT_BASE_URL` | `SIGIL_EVAL_OPENAI_COMPAT_API_KEY`, `SIGIL_EVAL_OPENAI_COMPAT_NAME` |
| `openai-compat-N` (indexed) | `SIGIL_EVAL_OPENAI_COMPAT_<N>_ENABLED` | `SIGIL_EVAL_OPENAI_COMPAT_<N>_BASE_URL` | `SIGIL_EVAL_OPENAI_COMPAT_<N>_API_KEY`, `SIGIL_EVAL_OPENAI_COMPAT_<N>_NAME` |

Notes:
- `vertexai` is OAuth2-based and does not use API-key auth in this provider mode. Use `google` for Gemini API-key auth.
- For credential file/json variants, file and JSON are mutually exclusive.

## YAML Seed Format

Optional seed file is loaded at startup when `SIGIL_EVAL_SEED_FILE` is set.

Default seed behavior is best-effort:
- invalid evaluator/rule entries are skipped and logged
- valid entries in the same file are still applied

Set `SIGIL_EVAL_SEED_STRICT=true` to fail startup on the first seed error.

Top-level keys:
- `evaluators`
- `rules`

Evaluator YAML shape:
- `id`, `kind`, `version`
- evaluator config fields inline (for example `system_prompt`, `model`, `schema`, `patterns`)
- `output.keys[]` with `key`, `type`, `unit` (exactly one key is currently supported)

Rule YAML shape:
- `id`, `enabled`
- `select.selector`
- `match`
- `sample.rate`
  - defaults to `0.01` when omitted
- `evaluators` (array of evaluator IDs)

Duplicate evaluator IDs or rule IDs in the same file are rejected.

See `sigil-eval-seed.example.yaml`.
