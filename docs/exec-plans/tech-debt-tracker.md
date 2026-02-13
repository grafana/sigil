---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
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

- [x] Add CI workflow baseline for format/lint/typecheck quality gates (`mise run ci` in `.github/workflows/ci.yml`).
- [ ] Expand CI workflows to run test and e2e suites.
- [x] Add Go OTLP ingest integration coverage (gRPC ingest path baseline exists).
- [x] Add Python and TypeScript/JavaScript OTLP ingest integration coverage.
- [x] Add integration tests for ingest forwarding to Tempo.
- [ ] Add benchmark and payload-size guardrail tests.
- [x] Expand SDK end-to-end examples for Python and TypeScript/JavaScript.
- [ ] Define retention and pruning policies for hot MySQL payloads vs compacted object storage.
- [x] Define ingestion-log abstraction interface and implementation migration plan.
- [ ] Evaluate Kafka as next backend for ingestion-log abstraction.
- [ ] Evaluate WarpStream as a lower-ops-cost Kafka-compatible backend option.
- [ ] Add automated model-card catalog refresh tooling (external source + static fallback).

## Risks

- CI currently enforces format/lint/typecheck only; test and e2e regressions remain local-only until CI expansion lands.
- Delay on ingestion-log abstraction can increase MySQL-specific coupling.
- Deferred benchmark work can hide scale bottlenecks until later phases.

## Exit Criteria

- Deferred items are either completed or moved into scoped active execution plans.
- Open architecture decisions have written outcomes linked from design docs.
- Reliability and CI guardrails exist for critical ingest/query/proxy paths.
