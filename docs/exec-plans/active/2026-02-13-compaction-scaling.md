---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Compaction Scaling Delivery

## Goal

Deliver sub-tenant sharded compaction so that a single hot tenant can scale across multiple compactor workers and instances. Replace long-transaction claim locks with schema-based durable claims. Add backlog-aware scheduling, parallel workers, and multi-batch drain loops.

## Scope

- schema migration for claim columns and shard-based leases
- schema-based claim/load/finalize flow replacing transactional `FOR UPDATE SKIP LOCKED`
- time-range shard assignment and shard predicate queries
- backlog-aware tenant/shard discovery
- parallel worker pool within each compactor instance
- multi-batch drain loop with time budget and lease renewal
- shard-aware truncation
- stale claim recovery sweep
- block size target accumulation
- instrumentation updates
- test and benchmark coverage

## Source design doc

- `docs/design-docs/2026-02-13-compaction-scaling.md`

## Completion policy

- A checkbox moves to `[x]` only when implementation code and automated tests for that item are merged to `main`.
- Design docs, architecture text, or branch-local changes are not sufficient to close checklist items.

## Implementation phases

### Phase A: Schema migration and claim refactor

- [x] Add `claimed_by VARCHAR(255) NULL` and `claimed_at TIMESTAMP(6) NULL` columns to `generations` table.
- [x] Add composite index `(tenant_id, compacted, claimed_by, created_at)` to `generations`.
- [x] Add `shard_id INT NOT NULL DEFAULT 0` to `compactor_leases` primary key (`tenant_id, shard_id`).
- [x] Update GORM models (`GenerationModel`, `CompactorLeaseModel`) with new fields.
- [x] Implement auto-migration for schema changes.
- [x] Define `Claimer` interface with `ClaimBatch`, `LoadClaimed`, `FinalizeClaimed` methods.
- [x] Implement MySQL `Claimer` using UPDATE-based claim flow (no `FOR UPDATE SKIP LOCKED`).
- [x] Implement stale claim recovery sweep method.
- [x] Add unit tests for claim/load/finalize round-trip correctness.
- [x] Add unit tests for stale claim recovery.
- [x] Replace backward-compat path with hard cutover migration reset for compaction lease/claim state.

### Phase B: Shard-based leasing and discovery

- [x] Define `ShardPredicate` type and shard assignment function (`FLOOR(UNIX_TIMESTAMP(created_at) / window) % count`).
- [x] Update `TenantLeaser` interface to accept `shardID` parameter.
- [x] Implement shard-aware `AcquireLease` and `RenewLease` in MySQL lease store.
- [x] Update `TenantDiscoverer` interface to `ListShardsForCompaction` / `ListShardsForTruncation`.
- [x] Implement backlog-aware discovery query returning `TenantShard` results ordered by backlog size.
- [x] Add configuration: `SIGIL_COMPACTOR_SHARD_COUNT`, `SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS`.
- [x] Add unit tests for shard predicate correctness (rows map to expected shards).
- [x] Add unit tests for backlog-aware discovery ordering.
- [x] Add unit tests for shard lease acquisition/renewal/expiry.

### Phase C: Worker pool and drain loop

- [x] Refactor `compactor.Service` to manage a pool of N worker goroutines.
- [x] Each worker: pick highest-backlog shard -> acquire lease -> drain loop -> move to next shard.
- [x] Implement multi-batch drain loop with configurable time budget (`SIGIL_COMPACTOR_CYCLE_BUDGET`).
- [x] Implement lease heartbeat renewal at `LeaseTTL / 2` intervals during drain.
- [x] Implement graceful shutdown: workers finish current batch then exit.
- [x] Add stale claim sweep as a periodic background task (interval = `claim_ttl / 2`).
- [x] Add configuration: `SIGIL_COMPACTOR_WORKERS`, `SIGIL_COMPACTOR_CYCLE_BUDGET`, `SIGIL_COMPACTOR_CLAIM_TTL`.
- [x] Add unit tests for worker pool lifecycle (start, drain, shutdown).
- [x] Add unit tests for lease renewal during multi-batch processing.
- [x] Add unit tests for budget exhaustion behavior.

### Phase D: Shard-aware truncation and block size

- [x] Update truncation query with shard predicate.
- [x] Workers truncate their shard after compaction drain.
- [x] Implement block size target accumulation: accumulate claimed rows until `target_block_bytes` reached or batch exhausted.
- [x] Add configuration: `SIGIL_COMPACTOR_TARGET_BLOCK_BYTES`.
- [x] Add unit tests for shard-isolated truncation.
- [x] Add unit tests for block size accumulation behavior.

### Phase E: Integration tests, benchmarks, and instrumentation

- [x] Add/update Prometheus metrics: `claim_batch_total`, `claim_stale_recovered_total`, `worker_active`, `shard_backlog`, `drain_duration_seconds`, `lease_held` with shard label.
- [x] Add integration test: multiple compactor instances compacting same tenant with `shard_count > 1`.
- [x] Add integration test: crash recovery (kill compactor mid-claim, verify stale sweep).
- [x] Add integration test: full lifecycle write -> sharded compact -> sharded truncate -> fan-out read.
- [x] Add `BenchmarkClaimBatch` for durable claim path throughput.
- [x] Add `BenchmarkParallelCompaction` with N workers on one hot tenant.
- [x] Add `BenchmarkBacklogDiscovery` with skewed tenant backlogs.
- [ ] Capture benchmark baselines.

### Phase F: Documentation and cleanup

- [x] Update `ARCHITECTURE.md` compactor topology, transaction flow, and scaling characteristics to reflect new design.
- [x] Update `docs/exec-plans/tech-debt-tracker.md`: mark compaction debt items as addressed.
- [x] Add level-2 block compaction (small block merging) as new tech debt item.
- [x] Update `docs/generated/db-schema.md` with schema changes.
- [x] Remove deprecated `TransactionalClaimer` interface and `WithClaimedUncompacted` implementation after migration.
- [x] Update this plan checkboxes as each phase lands.

## Risks

- Shard predicate adds query complexity; must verify MySQL query plan uses the new composite index efficiently.
- Stale claim TTL too short can cause unnecessary re-claims and double block writes. Must be conservative.
- More parallel workers creating more blocks can increase fan-out read amplification if block size target is set too low.
- Schema migration on a large `generations` table with `ALTER TABLE ADD COLUMN` may require online DDL tooling (gh-ost or pt-online-schema-change) in production.

## Rollout and rollback

Rollout:

1. Apply hard-cutover migration (includes `compactor_leases` reset and claim state cleanup).
2. Deploy new compactor binary with shard/worker defaults enabled.
3. Monitor compactor throughput, claim recovery, and block counts during alpha rollout.

Rollback:

1. Redeploy previous binary only if schema compatibility is confirmed for your environment.
2. If full rollback is needed, clear compactor lease/claim state and replay compaction cycles.

## Exit criteria

- A single hot tenant can be compacted by multiple workers across multiple compactor instances.
- Lock hold duration is reduced to single UPDATE statement scope (no transaction-held locks during I/O).
- Backlog-aware scheduling prioritizes hot tenant/shard pairs.
- All new behavior is covered by unit, integration, and benchmark tests.
- Default configuration uses scale-first alpha values (`shard_count=8`, `workers=4`).
- Documentation is updated to reflect the new compaction model.

## Out of scope

- Level-2 block compaction (merging small blocks into larger ones).
- dskit ring-based shard ownership (future evolution).
- Kafka/WarpStream WAL backend migration.
- Per-tenant shard count configuration (uniform shard count for all tenants in this phase).
