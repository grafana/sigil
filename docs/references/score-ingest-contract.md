---
owner: sigil-core
status: active
last_reviewed: 2026-02-18
source_of_truth: true
audience: both
---

# Score Ingest Contract (`/api/v1/scores:export`)

For control-plane setup and full online-eval usage flow, see `docs/references/online-evaluation-user-guide.md`.

## Endpoint

- Method: `POST`
- Path: `/api/v1/scores:export`
- Auth: protected route, tenant required via `X-Scope-OrgID`
- Response status: `202 Accepted`

## Request Shape

```json
{
  "scores": [
    {
      "score_id": "sc_01K...",
      "generation_id": "gen_01K...",
      "conversation_id": "conv-123",
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id": "00f067aa0ba902b7",
      "evaluator_id": "my-evaluator",
      "evaluator_version": "1.0.0",
      "rule_id": "online.helpfulness",
      "run_id": "run_01K...",
      "score_key": "helpfulness",
      "value": { "number": 0.82 },
      "passed": true,
      "explanation": "good response",
      "metadata": { "runtime_ms": 12 },
      "created_at": "2026-02-17T10:00:00Z",
      "source": { "kind": "external_api", "id": "my-service" }
    }
  ]
}
```

`value` supports exactly one of:
- `number`
- `bool`
- `string`

## Validation Rules

Per score item, required:
- `score_id`
- `generation_id`
- `evaluator_id`
- `evaluator_version`
- `score_key`
- `value` (exactly one typed field)

Behavior:
- Validation is per-item (partial success is expected).
- Unknown JSON fields are rejected.
- `created_at` defaults to server UTC time when omitted.
- Generation existence check is configurable in service wiring:
  - strict mode: reject with `generation_id was not found`
  - permissive mode: accept missing generation IDs
- Current server wiring uses strict lookup with hot+cold generation readers.

## Idempotency

- Uniqueness key: `(tenant_id, score_id)`.
- Re-sending an existing `score_id` is accepted (`accepted=true`) and treated as idempotent.
- Existing rows are not overwritten.

## Response Shape

```json
{
  "results": [
    {
      "score_id": "sc_01K...",
      "accepted": true,
      "error": ""
    }
  ]
}
```

Each item returns:
- `accepted=true` on success (including duplicate/idempotent submit)
- `accepted=false` with deterministic `error` on validation or persistence failure

## Metrics

Ingest path emits:
- `sigil_eval_score_ingest_total{tenant_id,source}`
- `sigil_eval_score_ingest_errors_total{tenant_id,error_type}`

## Related Score Read APIs

### `GET /api/v1/generations/{generation_id}/scores`

- Tenant-scoped protected endpoint.
- Query params:
  - `limit` (default `50`, max `500`)
  - `cursor` (opaque numeric cursor)
- Response:
  - `items`: score objects
  - `next_cursor`: empty string when exhausted

### `GET /api/v1/generations/{generation_id}`

Generation detail includes `latest_scores` enrichment when score lookup succeeds:

```json
{
  "generation_id": "gen_01K...",
  "latest_scores": {
    "helpfulness": {
      "value": { "number": 0.82 },
      "passed": true,
      "evaluator_id": "sigil.helpfulness",
      "evaluator_version": "2026-02-17",
      "created_at": "2026-02-18T10:00:00Z"
    }
  }
}
```
