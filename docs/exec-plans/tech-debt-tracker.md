---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Tech Debt Tracker

## Goal

Track deferred cross-cutting debt, unresolved architecture choices, and post-phase work.

## Scope

- Deferred implementation items not in current phase scope.
- Future architecture evolution items that should not block Phase 2 delivery.

## Tasks

Status rule:

- Do not mark an item as addressed (`[x]`) until the implementation code and automated tests are merged to `main`.

- [x] Add CI workflow baseline for format/lint/typecheck quality gates (`mise run ci` in `.github/workflows/ci.yml`).
- [ ] Expand CI workflows to run test and e2e suites.
- [x] Add Go OTLP ingest integration coverage (gRPC ingest path baseline exists).
- [x] Add Python and TypeScript/JavaScript OTLP ingest integration coverage.
- [x] Add integration tests for ingest forwarding to Tempo.
- [x] Add benchmark and payload-size guardrail tests.
- [x] Expand SDK end-to-end examples for Python and TypeScript/JavaScript.
- [x] Wire plugin backend resource proxy routes to consume Sigil `/api/v1/proxy/prometheus/...` and `/api/v1/proxy/tempo/...` endpoints for end-to-end Grafana usage.
- [ ] Define retention and pruning policies for hot MySQL payloads vs compacted object storage.
- [x] Replace long-transaction `SKIP LOCKED` compaction claims with schema-based durable claim state to reduce lock windows and improve recovery semantics. Implemented with `claimed_by`/`claimed_at` claim lifecycle and shard workers.
- [x] Improve single-large-tenant compaction throughput (multi-batch per cycle, shard/partition strategy, and/or parallelized claim workers under one tenant lease). Implemented via shard-aware leases, backlog discovery, and worker-pool draining.
- [ ] Implement level-2 block compaction (merging small blocks into larger ones) to reduce read amplification from parallel shard compaction.
- [ ] Reduce protobuf allocation churn in generation write/compaction paths by evaluating message/object reuse, buffer pooling, and marshal/unmarshal hot-path optimization.
- [x] Define ingestion-log abstraction interface and implementation migration plan.
- [ ] Evaluate Kafka as next backend for ingestion-log abstraction.
- [ ] Evaluate WarpStream as a lower-ops-cost Kafka-compatible backend option.
- [ ] Add automated model-card catalog refresh tooling (external source + static fallback).

## Risks

- CI currently enforces format/lint/typecheck only; test and e2e regressions remain local-only until CI expansion lands.
- Delay on ingestion-log abstraction can increase MySQL-specific coupling.
- Benchmark baselines exist for SDK hot paths; regression thresholds still need CI policy wiring.

## Exit Criteria

- Deferred items are either completed or moved into scoped active execution plans.
- Open architecture decisions have written outcomes linked from design docs.
- Reliability and CI guardrails exist for critical ingest/query/proxy paths.
