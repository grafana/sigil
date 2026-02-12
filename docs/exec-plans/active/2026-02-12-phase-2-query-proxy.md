---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: Query Proxy and Envelope

## Goal

Deliver plugin-proxy-only query routing with Grafana-compatible query envelopes and frame contracts.

## Scope

- Sigil API query endpoint contract.
- Plugin backend resource proxy contract.
- Query response envelope and frame compatibility requirements for metrics and traces.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-query-proxy.md`

## Tasks

- [ ] Define Sigil query API contract: `POST /api/v1/query`.
- [ ] Define plugin resource proxy contract: `POST /api/plugins/grafana-sigil-app/resources/query`.
- [ ] Require frontend query calls to use plugin proxy only.
- [ ] Require `QueryDataResponse` envelope with `results.<refId>.frames`.
- [ ] Define metrics frame compatibility requirements (time/value + metadata for graph/table).
- [ ] Define trace detail frame compatibility requirements (`preferredVisualisationType: trace` + trace fields/meta shape).
- [ ] Define trace search frame compatibility requirements (Tempo/Grafana table conventions).
- [ ] Anchor compatibility requirements to `docs/references/grafana-query-response-shapes.md`.
- [ ] Document required local test scenarios:
  - response serialization as `QueryDataResponse`
  - frame compatibility for metrics and traces
  - plugin frontend path enforcement through resource proxy only

## Risks

- Frontend bypass of plugin proxy breaks tenant and deployment boundaries.
- Envelope/frame mismatch causes Grafana panel incompatibility.
- Contract drift between plugin backend and API query handlers.

## Exit Criteria

- Query access path is plugin-proxy-only by contract.
- Query responses are explicitly Grafana-compatible for metrics and trace workflows.
- Local tests assert proxy-path and envelope/frame compatibility requirements.

## Out of Scope

- Non-REST query transport in this phase.
