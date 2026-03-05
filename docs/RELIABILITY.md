---
owner: sigil-core
status: active
last_reviewed: 2026-03-05
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
- finalize-retry semantics: if block upload and metadata insert succeed but row finalize fails, retry must treat duplicate block metadata as idempotent and continue finalization instead of failing permanently.

## Query Reliability

Fan-out read contract:

1. query hot MySQL
2. if hot rows already satisfy expected conversation generation count, skip cold reads
3. otherwise query cold compacted storage within bounded conversation time window
4. enforce bounded cold-read policies (request budget, per-index timeout/retry, bounded worker concurrency, bounded in-flight reads)
5. cache block index reads (`index.sigil`) in-process with TTL/LRU and in-flight dedupe
6. union results
7. dedupe by `generation_id`
8. prefer hot MySQL row on overlap conflict

Cold-read failures remain strict for conversation detail: when cold data is required and unavailable, the request fails (no silent partial success).

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
- Python and TypeScript/JavaScript OTLP ingest integration coverage exists.
- Tempo forwarding integration coverage now exists for HTTP and gRPC ingest paths.

## Deferred Reliability Work

- Baseline CI enforcement exists for formatting, linting, and type checks (`mise run ci`).
- CI expansion for automated test/e2e enforcement remains tracked in tech debt.
- ingest benchmark and payload-size guardrail tests are in place; CI regression policy wiring remains tracked in tech debt.

## Update Cadence

- Update when failure handling, compaction semantics, or query consistency contracts change.
