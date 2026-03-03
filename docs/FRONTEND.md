---
owner: sigil-core
status: active
last_reviewed: 2026-02-17
source_of_truth: true
audience: contributors
---

# Frontend

Purpose: define plugin UI architecture, proxy boundaries, and frame-compatibility contracts for Sigil in Grafana.

## Core Rules

- Keep plugin code under `apps/plugin/src`.
- Frontend query calls must go through plugin backend resources only.
- Frontend must not call Sigil API query endpoints directly.
- Use `getBackendSrv().fetch()` for plugin-to-backend calls.

## Proxy Contract

Current plugin query contract:

- Frontend query entrypoints:
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/generations/{generation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tags`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tag/{tag}/values`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/model-cards`
  - `GET /api/plugins/grafana-sigil-app/resources/query/model-cards/lookup`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/prometheus/...`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/...`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/evaluators`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/evaluators`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/evaluators/{evaluator_id}`
  - `DELETE /api/plugins/grafana-sigil-app/resources/eval/evaluators/{evaluator_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/predefined/evaluators`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/predefined/evaluators/{template_id}:fork`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/rules`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/rules`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `PATCH /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `DELETE /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/rules:preview`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/judge/providers`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/judge/models?provider={id}`
- Plugin backend forwards to Sigil API query endpoints:
  - `POST /api/v1/conversations/search`
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/generations/{generation_id}`
  - `GET /api/v1/search/tags`
  - `GET /api/v1/search/tag/{tag}/values`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `POST /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/model-cards` (list mode and `resolve_pair` mode)
  - `GET /api/v1/model-cards:lookup`
  - `/api/v1/proxy/prometheus/...`
  - `/api/v1/proxy/tempo/...`
  - `GET /api/v1/eval/evaluators`
  - `POST /api/v1/eval/evaluators`
  - `GET /api/v1/eval/evaluators/{evaluator_id}`
  - `DELETE /api/v1/eval/evaluators/{evaluator_id}`
  - `GET /api/v1/eval/predefined/evaluators`
  - `POST /api/v1/eval/predefined/evaluators/{template_id}:fork`
  - `GET /api/v1/eval/rules`
  - `POST /api/v1/eval/rules`
  - `GET /api/v1/eval/rules/{rule_id}`
  - `PATCH /api/v1/eval/rules/{rule_id}`
  - `DELETE /api/v1/eval/rules/{rule_id}`
  - `POST /api/v1/eval/rules:preview`
  - `GET /api/v1/eval/judge/providers`
  - `GET /api/v1/eval/judge/models?provider={id}`

Legacy placeholders removed:

- `/api/v1/completions`
- `/api/v1/traces/{trace_id}`

Tenant headers are applied/forwarded by plugin backend proxy logic, not by page components.

## Plugin RBAC

Sigil plugin routes enforce action-based RBAC in the plugin backend:

- `grafana-sigil-app.data:read`
  - `GET /query/conversations`
  - `POST /query/conversations/search`
  - `GET /query/conversations/{conversation_id}`
  - `GET /query/conversations/{conversation_id}/ratings`
  - `GET /query/conversations/{conversation_id}/annotations`
  - `GET /query/generations/{generation_id}`
  - `GET /query/search/tags`
  - `GET /query/search/tag/{tag}/values`
  - `GET /query/model-cards`
  - `GET /query/model-cards/lookup`
  - `GET /query/settings`
  - `GET|POST /query/proxy/prometheus/...`
  - `GET /query/proxy/tempo/...`
- `grafana-sigil-app.feedback:write`
  - `POST /query/conversations/{conversation_id}/ratings`
  - `POST /query/conversations/{conversation_id}/annotations`
- `grafana-sigil-app.settings:write`
  - `PUT /query/settings/datasources`

Default role grants in `apps/plugin/src/plugin.json`:

- `Sigil Reader` (granted to `Editor`, `Admin`)
- `Sigil Feedback Writer` (manual assignment)
- `Sigil Admin` (granted to `Admin`)

Current plugin backend tenant header precedence:

1. Preserve inbound `X-Scope-OrgID` when present.
2. Otherwise use plugin connection fallback tenant ID (default `fake`).

## Response Shape Contract

Sigil query responses consumed by frontend must follow Grafana datasource query envelope semantics:

- `QueryDataResponse` with `results.<refId>.frames`

Frame compatibility requirements:

- metrics frames must render in graph/table panels
- trace detail frames must support Grafana trace view conventions
- trace search frames must support Tempo-style table/drilldown patterns

See `docs/references/grafana-query-response-shapes.md`.

## Page Responsibilities

- Dashboard:
  - run metrics panels from Prometheus proxy endpoints only
  - support fuzzy filters for provider/model/agent and arbitrary label-key/value matchers
  - allow advanced raw matcher clauses for resource labels injected by Alloy/OTel pipelines
  - estimate cost from token metrics plus model-card resolve mode (`resolve_pair=provider:model`)
  - use strict provider+model pricing joins; unresolved pairs remain explicit (no fallback guessing)
- Conversations:
  - query conversations with expression filters and selectable attributes
  - support cursor pagination in list view
  - open conversation detail with hydrated generations, ratings, and annotations
  - open generation detail with trace/span identifiers
- Evaluation:
  - manage evaluators: browse predefined templates, fork/customize, create custom, list and delete tenant evaluators
  - manage rules: create with selector/match/sample-rate/evaluator config, enable/disable, list and delete
  - visualize evaluation pipeline: render each rule as a horizontal flow (selector → match → sample → evaluators)
  - preview rule matching: dry-run rule criteria against recent traffic to show matching generation counts and samples
  - support two-level navigation: overview, evaluators, and rules sub-pages under a single Evaluation nav entry
- Traces:
  - use Tempo proxy links for trace drilldown from generation/conversation views
- Settings: connection and runtime preferences, including query/tenant validation visibility.

## UX Direction

- Prioritize debugging workflows over broad dashboard chrome.
- Keep high information density with progressive disclosure.
- Show linked navigation between conversation, generation, and trace contexts.
- Avoid loading all details at once; use expandable sections and targeted detail panes.

## Testing Expectations (Local Phase)

- route rendering and navigation tests
- plugin configuration tests
- proxy request/response contract tests
- frame-shape compatibility tests for metrics/traces responses
- tenant header behavior tests at proxy boundary

## Update Cadence

- Update when plugin proxy contracts, query/frame shapes, or core page behavior changes.
