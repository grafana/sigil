---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Phase 2 Workstream: Query Proxy and Response Envelope

## Scope

This workstream isolates plugin-proxy query contracts and frame shape compatibility from SDK and storage tracks.

## Access path

All query operations must go through plugin backend proxy handlers.

- Sigil API query contract: `POST /api/v1/query`
- Plugin resource proxy contract: `POST /api/plugins/grafana-sigil-app/resources/query`

Plugin frontend must not call Sigil API query endpoints directly.

### Incremental implementation (2026-02-14)

Sigil now exposes pass-through proxy routes for Prometheus/Mimir and Tempo query APIs:

- prefix routes:
  - `/api/v1/proxy/prometheus/...`
  - `/api/v1/proxy/tempo/...`
- behavior:
  - allowlisted read/query endpoints only
  - raw downstream response pass-through (no envelope transformation yet)
  - downstream `X-Scope-OrgID` is always sourced from Sigil tenant context (real tenant or fake tenant mode)
  - safe request-header allowlist forwarding with hop-by-hop stripping

Plugin backend integration to consume these Sigil proxy routes remains tracked separately as tech debt.

## Envelope contract

Public query responses for metrics and traces follow Grafana datasource envelope shape:

- `QueryDataResponse` with `results.<refId>.frames`

This allows direct compatibility with panel pipelines and existing data frame consumers.

## Frame compatibility requirements

- Metrics: Grafana-compatible metric frames (time/value/labels with valid frame metadata for graph/table).
- Trace detail: Grafana/Tempo trace frame shape (`preferredVisualisationType: trace` and trace fields/meta).
- Trace search: Tempo/Grafana table shape (trace id, start time, service, name, duration, nested span frames where applicable).

Reference:

- `docs/references/grafana-query-response-shapes.md`

## Required Local Test Scenarios

- Query envelope tests asserting `QueryDataResponse` and frame metadata compatibility.
- Plugin proxy tests asserting frontend query traffic only uses plugin resource paths.

## Consequences

- Query integration can advance in parallel with tenant and storage work while preserving Grafana compatibility.
