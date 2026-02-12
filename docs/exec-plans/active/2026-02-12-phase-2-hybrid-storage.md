---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: Hybrid Storage and Query Behavior

## Goal

Deliver decision-complete hybrid generation persistence and retrieval semantics with hot MySQL, compacted object storage, and deterministic fan-out reads.

## Scope

- MySQL hot-store responsibilities for metadata, indexes, and payloads.
- Object storage compaction model and retrieval responsibilities.
- Fan-out read, union, dedupe, and overlap preference policy.
- Long-term ingestion-log abstraction evolution targets.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-hybrid-storage.md`

## Tasks

- [ ] Define MySQL hot metadata/index/payload responsibilities.
- [ ] Define compacted object payload responsibilities.
- [ ] Standardize object storage integration on Thanos `objstore` package contracts (`github.com/thanos-io/objstore`).
- [ ] Define compaction state model and pruning guarantees.
- [ ] Define query fan-out read algorithm:
  1. query hot MySQL
  2. query cold compacted object store
  3. union results
  4. dedupe by `generation_id`
  5. prefer hot MySQL on overlap
- [ ] Define query requirements for generation/conversation retrieval and time/model/agent/attribute filters.
- [ ] Define Tempo-first search/index behavior with Sigil payload hydration.
- [ ] Document required local test scenarios:
  - hot+cold fan-out union
  - dedupe by `generation_id`
  - overlap preference to hot row
  - no missing rows across hot/cold boundaries
- [ ] Record ingestion-log abstraction with Phase 2 backend MySQL and explicit future candidates Kafka/WarpStream.

## Risks

- Dual-store read correctness regressions (duplication, drop, stale overlap resolution).
- Compaction/pruning ordering bugs can cause data loss.
- MySQL-specific coupling increases migration difficulty if abstraction is delayed.

## Exit Criteria

- Storage/query responsibilities and fan-out semantics are fully specified and testable.
- Thanos `objstore` requirement is explicit for object storage integration.
- Tech debt and evolution path to Kafka/WarpStream are documented and linked.

## Out of Scope

- Replacing MySQL hot-store backend in this phase.
- Shipping Kafka/WarpStream runtime integration in this phase.
