---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
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

Current bootstrap contract on `main`:

- Frontend query entrypoints:
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/completions`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/prometheus/...`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/...`
- Plugin backend forwards to Sigil API query endpoints:
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `POST /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/completions`
  - `/api/v1/proxy/prometheus/...`
  - `/api/v1/proxy/tempo/...`

Phase 2 target contract (tracked in `docs/exec-plans/active/2026-02-12-phase-2-query-proxy.md`):

- Frontend query entrypoint:
  - `POST /api/plugins/grafana-sigil-app/resources/query`
- Plugin backend forwards to Sigil API query endpoint:
  - `POST /api/v1/query`

Tenant headers are applied/forwarded by plugin backend proxy logic, not by page components.

## Response Shape Contract

Sigil query responses consumed by frontend must follow Grafana datasource query envelope semantics:

- `QueryDataResponse` with `results.<refId>.frames`

Frame compatibility requirements:

- metrics frames must render in graph/table panels
- trace detail frames must support Grafana trace view conventions
- trace search frames must support Tempo-style table/drilldown patterns

See `docs/references/grafana-query-response-shapes.md`.

## Page Responsibilities

- Conversations:
  - list conversations with `rating_summary` and `annotation_summary`
  - apply list filters `has_bad_rating` and `has_annotations`
  - open details with ratings timeline, annotations timeline, and merged event timeline
- Completions/Generations: list/search generations with model/agent/time/attribute filters.
- Traces: trace search and trace detail drilldown with generation links.
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
