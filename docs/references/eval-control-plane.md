---
owner: sigil-core
status: active
last_reviewed: 2026-03-05
source_of_truth: true
audience: both
---

# Online Evaluation Control Plane API

For end-to-end setup and usage flow, see `docs/references/online-evaluation-user-guide.md`.

## Auth and Error Semantics

All routes are protected tenant-scoped endpoints (`X-Scope-OrgID`).

Write-path status semantics:
- `400 Bad Request`: validation/config errors.
- `500 Internal Server Error`: storage/runtime failures.

Read-path status semantics:
- `404 Not Found`: missing evaluator/rule.
- `400 Bad Request`: invalid pagination/query params.

## Control-Plane Metrics

Evaluation control routes emit per-tenant HTTP usage metrics:

- `sigil_eval_control_requests_total{tenant_id,endpoint,method,status_class}`
- `sigil_eval_control_request_duration_seconds{tenant_id,endpoint,method,status_class}`

Label notes:
- `tenant_id`: request tenant, or `unknown` when auth context is missing.
- `endpoint`: bounded route group (`evaluators`, `rules`, `rule_by_id`, `templates`, `eval_test`, etc).
- `status_class`: HTTP class (`2xx`, `4xx`, `5xx`, ...).

## Evaluators

### `POST /api/v1/eval/evaluators`

Create or update an evaluator definition.

Request fields:
- `evaluator_id` (required)
- `version` (required)
- `kind` (`llm_judge|json_schema|regex|heuristic`)
- `config` (object)
- `output_keys` (exactly one key currently supported)

`output_keys[]`:
- `key` (required)
- `type` (`number|bool|string`)
- `unit` (optional)
- `pass_threshold` (optional)

Kind-specific output constraints:
- `json_schema`, `regex`, and `heuristic` require a `bool` output key.
- `pass_value` is only meaningful for `llm_judge` boolean outputs.

Response: evaluator object (`200 OK`).

### `GET /api/v1/eval/evaluators?limit=&cursor=`

List tenant evaluators with cursor pagination.

Response:
- `items`
- `next_cursor`

Notes:
- Returns tenant-configured evaluators only.
- Predefined templates are exposed via predefined endpoints.

### `GET /api/v1/eval/evaluators/{id}`

Get latest active version for an evaluator id.

Responses:
- `200 OK` evaluator object
- `404 Not Found`

### `DELETE /api/v1/eval/evaluators/{id}`

Soft-delete evaluator id across versions.

Responses:
- `204 No Content` on success (idempotent)
- `400 Bad Request` when referenced by enabled rules

## Predefined Evaluator Templates

### `GET /api/v1/eval/predefined/evaluators`

List built-in evaluator defaults shipped with Sigil.

Response:
- `items`: predefined evaluator definitions

Notes:
- These evaluators are loaded from the hardcoded predefined registry in Sigil, not from template-table rows.
- They are read-only; versioning and CRUD for tenant templates use `/api/v1/eval/templates*`.

### `POST /api/v1/eval/predefined/evaluators/{template_id}:fork`

Fork a built-in template into a tenant evaluator.

Request fields:
- `evaluator_id` (required)
- `version` (optional; defaults to template version)
- `config` (optional shallow override)
- `output_keys` (optional; replaces template output keys)

Response:
- created evaluator object (`200 OK`)

Notes:
- Forking preserves `source_template_id` and `source_template_version` lineage on the created tenant evaluator.

## Tenant Templates

### `GET /api/v1/eval/templates?limit=&cursor=&scope=`

List tenant-managed templates with cursor pagination.

Response:
- `items`
- `next_cursor`

Notes:
- Template storage and versioning are tenant-managed only.
- Predefined evaluator defaults also appear in template list/detail responses as read-only `scope=global` templates so the UI can present one shared catalog.
- Global predefined templates expose config and latest version metadata, but no version-history entries and no mutating operations.

## Rules

### `POST /api/v1/eval/rules`

Create or update a rule.

Request fields:
- `rule_id` (required)
- `enabled` (optional; default `true`)
- `selector` (`user_visible_turn|all_assistant_generations|tool_call_steps|errored_generations`, optional, default `user_visible_turn`)
- `match` (object; optional)
- `sample_rate` (optional, default `0.01`)
- `evaluator_ids` (required, non-empty)

Rule validation notes:
- `sample_rate` must be in `[0,1]`.
- `evaluator_ids` must all exist.
- `match` values must be a string or array of non-empty strings.
- Unsupported `match` keys are rejected.
- Invalid glob syntax is rejected for glob-capable keys.

Supported `match` keys:
- glob-capable: `agent_name`, `agent_version`, `operation_name`, `model.provider`, `model.name`
- exact: `mode`, `tags.<key>`, `error.type`, `error.category`

Response: rule object (`200 OK`).

### `GET /api/v1/eval/rules?limit=&cursor=`

List rules with cursor pagination.

Response:
- `items`
- `next_cursor`

### `GET /api/v1/eval/rules/{id}`

Get rule by id.

Responses:
- `200 OK` rule object
- `404 Not Found`

### `PATCH /api/v1/eval/rules/{id}`

Enable/disable rule.

Request body:

```json
{ "enabled": true }
```

Responses:
- `200 OK` updated rule
- `404 Not Found`
- `400 Bad Request` when enabling a rule that references missing evaluators

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

`provider` query param is required.

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

## Judge Provider Configuration

Discovery is opt-in per provider and only returns providers that are both:
- explicitly enabled
- initialized with valid credentials/config

Enable flag truthy values: `1`, `true`, `yes`, `on` (case-insensitive).

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
- `vertexai` is OAuth2-based (ADC/credentials), not API-key auth.
- `google` is the Gemini API-key provider mode.
- Credential file/json variants are mutually exclusive.

## YAML Seed Format

Seed file loading is optional and controlled by runtime config.

- `SIGIL_EVAL_SEED_FILE`: path to YAML seed file
- `SIGIL_EVAL_SEED_STRICT`: fail-fast (`true`) or best-effort (`false`, default)
- startup bootstrap target tenant: `SIGIL_FAKE_TENANT_ID`

Top-level keys:
- `evaluators`
- `rules`

Evaluator shape:
- `id`, `kind`, `version`
- evaluator config fields inline
- `output.keys[]` (`key`, `type`, `unit`)

Rule shape:
- `id`, `enabled`
- `select.selector`
- `match`
- `sample.rate` (defaults to `0.01` when omitted)
- `evaluators` (array of evaluator IDs)

Validation:
- duplicate IDs in the same file are rejected
- rules referencing missing evaluators are rejected

Example file: `sigil-eval-seed.example.yaml`.
