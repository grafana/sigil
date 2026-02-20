---
owner: sigil-core
status: completed
last_reviewed: 2026-02-19
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: WAL + Compaction Hybrid Storage

## Goal

Deliver durable generation storage with hot WAL writes, background object-storage compaction, deterministic fan-out reads, and distributed compactor coordination.

## Scope

- service decomposition targets and runtime module wiring
- lean MySQL WAL and metadata schema
- object block format and block metadata catalog
- compaction, truncation, and lease coordination
- fan-out query union/dedupe policy
- instrumentation and performance test coverage

## Source design doc

- `docs/design-docs/2026-02-12-phase-2-hybrid-storage.md`

## Status note (2026-02-19)

All hybrid-storage implementation and documentation checklist items in this plan are complete. Remaining open work for Phase 2 is tracked in the umbrella plan (`2026-02-12-phase-2-delivery.md`) and tech debt tracker (CI scope expansion, ingestion-log backend evolution).

## Implementation phases

### Phase 0: Rename + service skeleton

- [x] Rename `api/` -> `sigil/`.
- [x] Update module path to `github.com/grafana/sigil/sigil` across `go.mod`, `go.work`, imports, compose wiring, and `mise` tasks.
- [x] Rename entrypoint `cmd/sigil-api/main.go` -> `cmd/sigil/main.go`.
- [x] Add `Sigil` runtime struct with dskit `modules.Manager` and `services.Service` lifecycle.
- [x] Register modules/targets: `server`, `querier`, `compactor`, `all`.
- [x] Add `-target` runtime flag (default `all`).
- [x] Extend config with target + compactor settings (intervals, retention, batch size, lease TTL).
- [x] Verify `-target all` behavior remains equivalent to current monolith behavior.
- [x] Update docs and references impacted by rename (`ARCHITECTURE.md`, docs index pages, this plan/doc pair).

### Phase A: Interfaces + MySQL WAL

- [x] Define storage interfaces in `internal/storage/{wal,block,metadata,types}.go`.
- [x] Add GORM dependency.
- [x] Define models for `generations`, `conversations`, `compaction_blocks`, `compactor_leases`.
- [x] Implement auto-migrations.
- [x] Implement MySQL WAL for `WALWriter`, `WALReader`, `WALCompactor`, `WALTruncator`.
- [x] Implement MySQL metadata store for `BlockMetadataStore` and `ConversationStore`.
- [x] Add Prometheus metrics and structured logging.
- [x] Replace `MemoryStore` wiring in generation ingest with MySQL WAL.
- [x] Update conversation projection writes as ingest side effects.
- [x] Add unit tests and WAL benchmarks.

### Phase B: Block format + object store

- [x] Add Thanos `objstore` dependency (`github.com/thanos-io/objstore`).
- [x] Implement seekable block encoding/decoding (`data.sigil` + `index.sigil`).
- [x] Implement object storage reader/writer with Thanos bucket wrapper.
- [x] Add metrics and structured logging for block operations.
- [x] Add round-trip, index-seek, and range-read tests.
- [x] Add block encode/read/write benchmarks.
- [x] Wire block reader/writer into querier and compactor modules.

### Phase C: Compactor service

- [x] Implement compactor `services.Service` with compact loop + truncate loop.
- [x] Implement tenant leaser using `compactor_leases`.
- [x] Implement compact flow: claim -> build -> upload -> metadata insert -> mark compacted.
- [x] Implement truncate flow: batched deletes for compacted rows older than retention.
- [x] Add compactor metrics and structured logging.
- [x] Add unit tests for lease expiry/reclaim and concurrency behavior.
- [x] Add integration tests for concurrent compactors and truncation safety.
- [x] Wire compactor into dskit module manager target graph.

### Phase D: Fan-out query path

Current status (2026-02-19): fan-out reads are handled by `storage.FanOutStore` with parallel hot+cold execution, deterministic merge semantics, Prometheus timing metrics, and benchmark coverage.

- [x] Implement `storage.FanOutStore` (`WALReader` + `BlockReader` + `BlockMetadataStore`).
- [x] Parallelize hot and cold reads.
- [x] Union and dedupe by `generation_id` with hot-row preference.
- [x] Sort merged results by `created_at`.
- [x] Replace placeholder query behavior with fan-out-backed path.
- [x] Add query fan-out metrics and logs.
- [x] Add explicit tests for hot-only and tenant-isolation fan-out cases (mixed overlap and cold fallback are covered).
- [x] Add fan-out benchmarks.

### Phase E: Docs, benchmarks, and cleanup

- [x] Add `mise run bench:storage` task.
- [x] Add local compose-backed E2E test for batch ingest + hot/cold query round-trip (`sigil/e2e/storage_hot_cold_local_test.go`, `mise run test:e2e:storage-local`).
- [x] Update `ARCHITECTURE.md` with finalized runtime/module/storage contracts.
- [x] Update `docs/design-docs/2026-02-12-phase-2-hybrid-storage.md` with implementation deltas.
- [x] Update `docs/generated/db-schema.md` from implemented migrations.
- [x] Capture baseline benchmark numbers in `docs/references/storage-benchmarks.md`.
- [x] Update this plan checkboxes as each phase lands.
- [x] Record deferred work in `docs/exec-plans/tech-debt-tracker.md` (ring sharding, Kafka WAL migration).

## Risks

- Incorrect hot+cold union semantics can cause dropped or duplicated generations.
- Compaction/truncation ordering bugs can create data loss.
- Lease edge cases can allow double-compaction without strong claim discipline.
- Overly coupled MySQL implementation details can block WAL backend swap.

## Exit criteria

- Storage interfaces are implemented and wired for all runtime targets.
- WAL writes, compaction, truncation, and fan-out reads are covered by tests.
- Deterministic overlap behavior (`generation_id` dedupe, hot-row preference) is enforced.
- Distributed compactor coordination is validated under concurrent instances.
- Benchmarks are runnable via `mise run bench:storage` with captured baselines.
- Tech debt and migration path (Kafka/WarpStream and ring leasing) are documented.

## Out of scope

- Kafka/WarpStream production backend implementation in this phase.
- Ring-based sharding implementation in this phase.
- Replacing Tempo for trace search and metric derivation.
