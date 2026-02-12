---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: Hybrid Storage and Retrieval

## Scope

This workstream isolates generation storage, compaction, and hot+cold read semantics from SDK and proxy tracks.

## Storage roles

MySQL is not only a write log. In Phase 2 it is the hot store for:

- generation metadata and retrieval indexes
- conversation metadata
- hot payload rows needed for low-latency reads and recent data correctness

Object storage holds compacted long-term payload segments.

Object storage integration standardizes on the Thanos `objstore` Go package:

- `github.com/thanos-io/objstore`

## Compaction and lifecycle

- Accepted generations are written to MySQL hot tables.
- A background compactor batches and compresses eligible rows to object storage.
- Compaction state is tracked in MySQL.
- Hot payload pruning occurs only after successful durable object write and state update.
- Object reads/writes for compaction and retrieval use the Thanos `objstore` abstraction layer.

## Query read policy (fixed)

Generation/conversation retrieval fans out across hot and cold stores:

1. query hot MySQL rows for the requested filter/range
2. query compacted object segments for the same filter/range
3. union results
4. dedupe by `generation_id`
5. on overlap conflict, prefer hot MySQL row

## Tempo-first search and hydration

Search and metrics derivation remain Tempo-first.

- Tempo is queried first for traces and metrics-oriented filtering.
- Sigil storage hydrates generation and conversation payloads by IDs returned from Tempo-driven workflows.

Initial filter allowlist for generation search/hydration paths:

- `conversation_id`
- `model.provider`
- `model.name`
- `agent.id`
- `agent.version`
- `error.type`
- `env`
- curated custom tags

## Long-term event log evolution

Sigil defines an ingestion-log abstraction with pluggable backends.

- Phase 2 backend: MySQL
- future candidates: Kafka, WarpStream

Migration intent is explicitly documented to avoid coupling business logic to a MySQL-specific queue/log implementation.

## Additional Product Constraints

- Cost fields are provider-reported only in this phase.
- Model cards use external source plus fallback static catalog, but query/frame compatibility work is higher priority for this phase.

## Required Local Test Scenarios

- Hybrid hot+cold read tests with fan-out, dedupe by `generation_id`, overlap preference, and no-loss expectations.

## Consequences

- Storage and compaction work can proceed in parallel while keeping retrieval semantics stable.
