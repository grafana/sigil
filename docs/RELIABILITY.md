---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Reliability

Purpose: define reliability expectations for ingest, hybrid storage reads, and plugin-facing query behavior.

## Reliability Principles

- no silent data loss during generation ingest, buffering, or compaction
- deterministic partial-failure signaling at ingest boundaries
- stable query semantics under hot+cold storage overlap
- graceful degradation when downstream systems are unavailable

## Ingest Reliability

- SDK export is asynchronous with bounded queues and retry/backoff.
- `shutdown` flush is required for clean process termination.
- ingest services must preserve per-item acceptance/rejection semantics.
- HTTP and gRPC transport parity must be maintained.

## Storage Reliability (Hot + Cold)

- MySQL is the hot metadata/index/payload source.
- Object storage holds compacted long-term payload segments.
- Object storage access standardizes on Thanos `objstore` interfaces (`github.com/thanos-io/objstore`).
- compaction must be idempotent and retry-safe.
- hot payload rows are not removed until durable compaction write succeeds.

## Query Reliability

Fan-out read contract:

1. query hot MySQL
2. query cold compacted storage
3. union results
4. dedupe by `generation_id`
5. prefer hot MySQL row on overlap conflict

Tempo-first search/query workflows must degrade predictably when Tempo is unavailable.

## Plugin Response Reliability

- query responses must serialize as Grafana-compatible `QueryDataResponse`
- metrics and trace frames must remain schema-stable
- plugin proxy failures must return actionable error surfaces

## Required Local Reliability Tests

- SDK lifecycle and retry behavior under transient export failures
- ingest transport parity tests (HTTP/gRPC)
- compaction idempotency and no-loss checks
- hot+cold fan-out read dedupe correctness
- proxy query response shape validation for metrics and traces

Current status:

- Go OTLP ingest integration coverage exists for gRPC ingest path.
- Python and TypeScript/JavaScript OTLP ingest integration coverage is still missing.
- Tempo forwarding integration coverage now exists for HTTP and gRPC ingest paths.

## Deferred Reliability Work

- Baseline CI enforcement exists for formatting, linting, and type checks (`mise run ci`).
- CI expansion for automated test/e2e enforcement remains tracked in tech debt.
- benchmark and payload-size guardrails remain tracked until implemented.

## Update Cadence

- Update when failure handling, compaction semantics, or query consistency contracts change.
