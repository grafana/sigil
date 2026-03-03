---
owner: sigil-core
status: active
last_reviewed: 2026-03-03
source_of_truth: true
audience: both
---

# Backend Operational Metrics Baseline

## Context

Sigil already emitted backend internals metrics (WAL, object-store, compactor, evaluation workers), but deployments did not consistently expose/scrape `/metrics`, and generation/score ingest plus query read-path resolution lacked domain-focused counters.

This design defines a pragmatic baseline:

- Keep SDK metrics flow unchanged (`SDK -> Alloy -> Prometheus`).
- Expose Sigil backend operational metrics directly via `/metrics`.
- Add low-cardinality, domain-specialized metrics for ingest and read-path outcomes.

## Decisions

1. **Metrics endpoint**
   - Expose `GET /metrics` as a core route on Sigil HTTP server.
   - Keep endpoint unauthenticated (operational endpoint).

2. **Split-role metrics exposure**
   - Reuse server module for `compactor`, `eval-worker`, and `catalog-sync` targets so these roles also expose `/metrics`/`/healthz`.
   - Guard gRPC listener startup: server binds OTLP gRPC only when at least one gRPC service registrar is present, avoiding `:4317` conflicts for worker-only roles.

3. **Transport metrics**
   - Add Sigil HTTP request metrics (`sigil_requests_total`, `sigil_request_duration_seconds`, `sigil_request_message_bytes`, `sigil_response_message_bytes`) with route-template and area labels.
   - Add Sigil gRPC server metrics (`sigil_grpc_server_requests_total`, `sigil_grpc_server_request_duration_seconds`).

4. **Domain metrics**
   - Generation ingest:
     - `sigil_ingest_generation_batch_size`
     - `sigil_ingest_generation_items_total{tenant_id,mode,status,reason,transport}`
   - Score ingest:
     - `sigil_ingest_scores_batch_size`
     - `sigil_ingest_scores_items_total{tenant_id,status,reason,transport}`
   - Query read-path:
     - `sigil_query_resolution_total{operation,result}`
     - `sigil_query_returned_items{operation}`
   - Compactor:
     - `sigil_compactor_compacted_batch_rows`
     - `sigil_compactor_block_size_bytes`

5. **Scraping**
   - Local compose Prometheus scrapes Sigil service.
   - Helm Prometheus config is template-rendered and conditionally scrapes enabled Sigil components (api/ingester/querier/compactor/eval-worker/catalog-sync).

## Cardinality policy

- Preserve selective `tenant_id` only for ingest outcome counters where tenant debugging matters most.
- Keep bounded label enums for `reason`, `status`, and read-path `result`.
- Do not use raw request paths; use route templates (or `unmatched`).

## Compatibility

- Additive rollout only: no removal/rename of existing `sigil_*` series.
- Existing dashboards using prior backend metric families remain valid.
