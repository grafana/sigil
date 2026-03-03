---
owner: sigil-core
status: active
last_reviewed: 2026-03-03
source_of_truth: true
audience: both
---

# Execution Plan: Backend Operational Metrics Baseline

## Goal

Deliver a practical backend metrics baseline for Sigil with:

- consistent `/metrics` exposure across runtime roles,
- Prometheus scrape wiring in compose and Helm,
- domain-specialized metrics for ingest/read/compaction outcomes.

## Scope

- Sigil server route and middleware instrumentation.
- Generation ingest and score ingest metrics.
- Query read-path and compactor metric additions.
- Runtime dependency wiring for split-role metrics exposure.
- Prometheus scrape config updates (compose + Helm).
- Architecture/design doc updates.

## Checklist

- [x] Expose `GET /metrics` in core Sigil routes.
- [x] Add HTTP transport metrics (request count/duration and message-size histograms).
- [x] Add gRPC server request metrics (count + duration).
- [x] Add generation ingest metrics (batch + per-item outcomes).
- [x] Add score ingest metrics (batch + per-item outcomes).
- [x] Add query read-path resolution metrics.
- [x] Add compactor batch-size and block-size histograms.
- [x] Add auth failure counter by transport.
- [x] Ensure `compactor`, `eval-worker`, `catalog-sync` also start server module and expose `/metrics`.
- [x] Add compose Prometheus scrape for Sigil.
- [x] Add Helm scrape jobs for enabled Sigil components.
- [x] Add Helm component services for compactor/eval-worker/catalog-sync.
- [x] Update `ARCHITECTURE.md` and docs indexes.
- [ ] Run full project quality gates (`mise run format`, `mise run lint`, `mise run check`).

## Validation targets

- Unit tests for new metrics instrumentation paths.
- Existing ingest/query/auth tests remain green.
- Helm template renders with and without split roles enabled.
