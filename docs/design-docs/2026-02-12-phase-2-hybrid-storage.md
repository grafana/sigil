---
owner: sigil-core
status: active
last_reviewed: 2026-02-19
source_of_truth: true
audience: both
---

# Phase 2 Workstream: WAL + Compaction Hybrid Storage

## Problem statement

Sigil needs durable, scalable generation storage with:

- hot WAL writes
- background compaction to object storage
- fan-out reads across hot and cold paths

The implementation must be multi-tenant, distributable across multiple processes, and allow WAL backend swaps (MySQL now, Kafka/WarpStream later).

## Current state

- `sigil/` is a single Go module (`github.com/grafana/sigil/sigil`) with `cmd/sigil/main.go`.
- Runtime targets `all`, `server`, `querier`, and `compactor` are wired via dskit modules.
- Generation ingest writes to MySQL WAL + conversation projections.
- Object block read/write is implemented with Thanos `objstore` and seekable block encoding (`data.sigil` + `index.sigil`).
- Query detail paths are backed by `storage.FanOutStore` with parallel hot/cold reads and deterministic dedupe.
- Compaction uses shard-aware worker pools with schema-based claim/finalize flow and shard leases.
- Docker compose includes MySQL + MinIO + Sigil service targets for local validation.

## Implementation deltas (2026-02-19)

- The original compaction claim plan (`FOR UPDATE SKIP LOCKED`) was superseded by schema-based claims (`claimed_by`, `claimed_at`) and shard-aware leasing. See `docs/design-docs/2026-02-13-compaction-scaling.md`.
- Fan-out read logic is implemented as a dedicated `storage.FanOutStore` abstraction (not inline query-service merge logic).
- Local compose-backed E2E coverage was added for ingest -> compact -> mixed hot/cold read -> cold-only read (`sigil/e2e/storage_hot_cold_local_test.go`).
- Benchmarks are runnable via `mise run bench:storage`; baseline capture is tracked in `docs/references/storage-benchmarks.md`.

## Proposed architecture

### Directory and module rename

Use `sigil/` as the service module root so the service name and module path represent the complete Sigil runtime, not only API handlers.

- module path: `github.com/grafana/sigil/sigil`
- binary: `sigil`
- runtime mode selection: `-target`

### Service architecture (dskit modules)

Follow Loki-style module wiring with `dskit/modules.Manager` and `dskit/services.Service`.

Target modes:

- `all` (default): monolith, all modules in one process
- `server`: HTTP/gRPC ingest and write path (no compactor loop)
- `querier`: fan-out WAL + block reads for query APIs
- `compactor`: compaction + truncation loops with distributed tenant leasing

In `all` mode, all modules run in-process. In split mode, targets scale independently.

Module dependency graph:

- `Server` depends on `WALWriter`, `ConversationStore`
- `Querier` depends on `WALReader`, `BlockReader`, `BlockMetadataStore`
- `Compactor` depends on `Claimer`, `WALTruncator`, `BlockWriter`, `BlockMetadataStore`

### Package layout

```text
sigil/
  cmd/sigil/main.go
  internal/
    sigil.go
    config/config.go
    storage/
      wal.go
      block.go
      metadata.go
      types.go
      fanout.go
      mysql/
        wal.go
        metadata.go
        models.go
        migrate.go
      object/
        store.go
        encoding.go
      compactor/
        compactor.go
        leaser.go
    generations/
    query/
    ingest/
    server/
    tenantauth/
```

Storage interfaces are defined in `internal/storage/*`; implementations depend on interfaces, not on each other.

## Storage contracts

### WAL interfaces

```go
type WALWriter interface {
    SaveBatch(ctx context.Context, tenantID string, gens []*sigilv1.Generation) []error
}

type WALReader interface {
    GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
    GetByConversationID(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error)
}

type WALTruncator interface {
    TruncateCompacted(ctx context.Context, tenantID string, shard ShardPredicate, olderThan time.Time, limit int) (int64, error)
}

type Claimer interface {
    ClaimBatch(ctx context.Context, tenantID, ownerID string, shard ShardPredicate, olderThan time.Time, limit int) (int, error)
    LoadClaimed(ctx context.Context, tenantID, ownerID string, shard ShardPredicate, limit int) ([]*sigilv1.Generation, []uint64, error)
    FinalizeClaimed(ctx context.Context, tenantID, ownerID string, ids []uint64) error
}
```

### Block interfaces

```go
type BlockWriter interface {
    WriteBlock(ctx context.Context, tenantID string, block *Block) error
}

type BlockReader interface {
    ReadIndex(ctx context.Context, tenantID, blockID string) (*BlockIndex, error)
    ReadGenerations(ctx context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error)
}
```

### Metadata interfaces

```go
type BlockMetadataStore interface {
    InsertBlock(ctx context.Context, meta BlockMeta) error
    ListBlocks(ctx context.Context, tenantID string, from, to time.Time) ([]BlockMeta, error)
}

type ConversationStore interface {
    ListConversations(ctx context.Context, tenantID string) ([]Conversation, error)
    GetConversation(ctx context.Context, tenantID, conversationID string) (*Conversation, error)
}
```

## MySQL schema (lean WAL)

Tempo handles rich filtering. MySQL WAL stores serialized generation payload plus minimal query/compaction indexes.

### `generations` (WAL)

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `tenant_id VARCHAR(128) NOT NULL`
- `generation_id VARCHAR(255) NOT NULL`
- `conversation_id VARCHAR(255) NULL`
- `created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`
- `payload MEDIUMBLOB NOT NULL`
- `payload_size_bytes INT NOT NULL`
- `compacted BOOLEAN DEFAULT FALSE`
- `compacted_at TIMESTAMP(6) NULL`
- `claimed_by VARCHAR(255) NULL`
- `claimed_at TIMESTAMP(6) NULL`

Indexes:

- unique: `(tenant_id, generation_id)`
- lookup: `(tenant_id, conversation_id, created_at)`
- compaction/claim cursor: `(tenant_id, compacted, claimed_by, created_at)`

### `conversations` (materialized projection)

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `tenant_id VARCHAR(128) NOT NULL`
- `conversation_id VARCHAR(255) NOT NULL`
- `last_generation_at TIMESTAMP(6) NOT NULL`
- `generation_count INT DEFAULT 0`
- `created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`
- `updated_at TIMESTAMP(6) NOT NULL`

Indexes:

- unique: `(tenant_id, conversation_id)`
- recent list: `(tenant_id, updated_at)`

### `compaction_blocks` (block catalog)

- `id BIGINT AUTO_INCREMENT PRIMARY KEY`
- `tenant_id VARCHAR(128) NOT NULL`
- `block_id VARCHAR(255) NOT NULL`
- `min_time TIMESTAMP(6) NOT NULL`
- `max_time TIMESTAMP(6) NOT NULL`
- `generation_count INT NOT NULL`
- `size_bytes BIGINT NOT NULL`
- `object_path VARCHAR(1024) NOT NULL`
- `index_path VARCHAR(1024) NOT NULL`
- `created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`
- `deleted BOOLEAN DEFAULT FALSE`

Indexes:

- unique: `(tenant_id, block_id)`
- overlap query: `(tenant_id, min_time, max_time)`

### `compactor_leases` (distributed coordination)

- `tenant_id VARCHAR(128) NOT NULL`
- `shard_id INT NOT NULL DEFAULT 0`
- `owner_id VARCHAR(255) NOT NULL`
- `leased_at TIMESTAMP(6) NOT NULL`
- `expires_at TIMESTAMP(6) NOT NULL`

Primary key: `(tenant_id, shard_id)`

## Seekable block format (object storage)

Each compacted block writes two objects:

- `<tenant_id>/blocks/<block_id>/data.sigil`
- `<tenant_id>/blocks/<block_id>/index.sigil`

Data object format:

- header: magic, version, generation count, index offset
- body: varint-length-prefixed proto-serialized `Generation` records
- footer: checksum

Index object format:

- sorted entries `(generation_id_hash, conversation_id_hash, timestamp, offset, length)`

This allows index-only reads, then object range reads for matching generation payload slices.

## Compaction and truncation flow

Compactor runs as one `services.Service` with shard-aware worker pools.

### Compact loop (implemented)

1. Discover `(tenant_id, shard_id)` backlog candidates.
2. Acquire/renew shard lease in `compactor_leases`.
3. `ClaimBatch` rows via UPDATE-based schema claim (`claimed_by`, `claimed_at`) using shard predicates.
4. `LoadClaimed` payload rows for block build.
5. Build/upload block(s) via `BlockWriter` and insert metadata via `BlockMetadataStore.InsertBlock`.
6. `FinalizeClaimed` source rows (`compacted=true`, `compacted_at=NOW()`, clear claim columns).
7. Continue draining until shard backlog exhausted or worker cycle budget reached.

### Truncate loop (implemented)

1. For owned shards, delete compacted rows older than retention using shard predicates and batched limits.
2. Use batched deletes to avoid large lock windows.

Compacted-row retention remains configurable as an overlap-safety window.

## Distributed compaction

Compactor instances coordinate through shard leases in `compactor_leases`.

- each instance has unique `owner_id` (`hostname + random suffix`)
- leases are keyed by `(tenant_id, shard_id)`
- expired shard leases are reclaimable
- discovery returns hot shard backlogs first (not just tenant-level distinct selection)
- stale claim rows are periodically recovered using claim TTL policy

Future evolution path: replace MySQL lease table with dskit ring-based shard ownership.

## Fan-out read algorithm

For retrieval by `generation_id` or `conversation_id`:

1. Query WAL via `WALReader`.
2. In parallel, query `BlockMetadataStore` for overlapping block time windows and read matching ranges through `BlockReader`.
3. Union hot + cold results.
4. Dedupe by `generation_id`; hot (WAL) row wins conflicts.
5. Sort by `created_at`.

## Instrumentation contract

Storage operations include structured logging and Prometheus metrics.

Metrics:

- `sigil_wal_operations_total{op,status}`
- `sigil_wal_operation_duration_seconds{op}`
- `sigil_wal_rows_total{op}`
- `sigil_block_operations_total{op,status}`
- `sigil_block_operation_duration_seconds{op}`
- `sigil_block_bytes_total{direction}`
- `sigil_compactor_runs_total{status}`
- `sigil_compactor_blocks_created_total`
- `sigil_compactor_generations_compacted_total`
- `sigil_compactor_truncated_total`
- `sigil_compactor_duration_seconds{phase}` (`phase=compact|truncate`)
- `sigil_query_fanout_duration_seconds{source}`
- `sigil_compactor_lease_held{tenant_id}`

## Testing strategy

### Unit tests

- `mysql/`: writer/reader/compactor/truncator behaviors (SQLite or MySQL testcontainer)
- `object/`: block encode/decode/index/range-read logic (Thanos in-memory bucket)
- `compactor/`: lease behavior, claim/mark flow, truncate safety
- `storage/`: fan-out merge + dedupe semantics

### Integration tests

Run MySQL + MinIO compose integration for full write -> compact -> truncate -> read lifecycle.

Local compose-backed E2E:

- `sigil/e2e/storage_hot_cold_local_test.go` validates batch export, hot reads, mixed hot+cold reads, and cold-only fallback.
- Task contract: `mise run test:e2e:storage-local`.

### Benchmarks

- `mysql/`: `BenchmarkWALStoreSaveBatchSingle`, `BenchmarkWALStoreSaveBatch100`, `BenchmarkClaimBatch`, `BenchmarkBacklogDiscovery`
- `object/`: `BenchmarkEncodeBlock`, `BenchmarkDecodeBlock`, `BenchmarkWriteBlock`, `BenchmarkReadIndex`, `BenchmarkReadGenerations`
- `compactor/`: `BenchmarkParallelCompaction`
- `storage/`: `BenchmarkFanOutQuery`

Task contract: `mise run bench:storage`.

### Required correctness scenarios

- hot-only read
- cold-only read
- hot+cold overlap with dedupe (`generation_id`) and hot preference
- compaction mark correctness and round-trip block decode
- truncation deletes only compacted rows older than retention
- concurrent compactor safety (shard lease + schema-based claim/finalize)
- strict tenant isolation
- index range-seek correctness
- metrics increments for all major operations
- module manager start/stop dependency correctness

## Consequences

- Runtime can start in monolith mode while enabling later service decomposition by `-target`.
- WAL backend is abstracted for MySQL now and Kafka/WarpStream migration later.
- Query correctness is deterministic across hot+cold overlap windows.
