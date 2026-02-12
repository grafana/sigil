---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Delivery Umbrella: SDK Parity, Tenant Boundaries, Query Proxy, and Hybrid Storage

**This doc is the Phase 2 coordinator** — it sequences workstreams, tracks dependencies, and links to the actual implementation plans. Do not execute from this file; use the linked workstream plans below for concrete tasks.

## Status at a Glance

| Track | Plan | Status |
|-------|------|--------|
| SDK parity (Python) | `exec-plans/completed/2026-02-12-phase-2-sdk-parity-python.md` | Done |
| SDK parity (TypeScript/JavaScript) | `exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md` | Done |
| Tenant boundary | `exec-plans/completed/2026-02-12-phase-2-tenant-boundary.md` | Done |
| Query proxy and envelope | `exec-plans/active/2026-02-12-phase-2-query-proxy.md` | Active |
| Hybrid storage and query | `exec-plans/active/2026-02-12-phase-2-hybrid-storage.md` | Active |

Execution order: (1) query proxy, then (2) hybrid storage, then (3) cross-track consistency and tech debt capture. Parallel planning remains allowed within that order.

## Goal

Coordinate decision-complete Phase 2 delivery across parallel workstreams:

- OTel-like SDK parity (Go baseline, Python and TypeScript/JavaScript delivery)
- plugin-proxy query contracts with Grafana-compatible response envelopes
- lightweight Loki-style tenant enforcement
- hot+cold generation storage with fan-out query semantics

## Scope

- Track-level execution coordination and dependency ordering.
- Cross-track consistency checks for contracts, docs, and indexes.
- Local test requirements and command contracts (`mise` only).

## Coordination Tasks

- [ ] Keep all workstream plans synchronized with:
  - `docs/design-docs/2026-02-12-phase-2-otel-sdk-query-storage.md`
  - `docs/design-docs/2026-02-12-phase-2-sdk-parity-python.md`
  - `docs/design-docs/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`
  - `docs/design-docs/2026-02-12-phase-2-tenant-boundary.md`
  - `docs/design-docs/2026-02-12-phase-2-query-proxy.md`
  - `docs/design-docs/2026-02-12-phase-2-hybrid-storage.md`
- [ ] Keep navigation indexes synchronized (`docs/index.md`, `docs/design-docs/index.md`, references indexes when contracts move).
- [ ] Ensure local test scenario coverage remains explicitly documented across all workstreams.
- [ ] Keep CI scope boundaries (quality gates live, test/e2e expansion deferred) and ingestion-log evolution tracked in `docs/exec-plans/tech-debt-tracker.md`.

## Dependency Order

1. Contracts and docs baseline
2. Query proxy/envelope and tenant boundary tracks
3. Hybrid storage/query behavior track
4. Tech debt capture and future path checkpoints

## Risks

- Cross-surface contract drift between plugin, API, and SDKs.
- Dual-store read correctness issues if fan-out and dedupe are not enforced consistently.
- CI currently enforces format/lint/typecheck only; test/e2e regressions can still escape until CI expansion lands.
- Tenant header propagation gaps can break isolation guarantees.

## Exit Criteria

- Each workstream plan has clear ownership and can execute independently in parallel.
- Shared contracts remain consistent across design docs, architecture docs, and execution plans.
- SDK parity expectations for Python and TypeScript/JavaScript are explicit and testable.
- Query/API/proxy contracts and response shapes are unambiguous and Grafana-compatible.
- Tenant/auth behavior is fully specified for HTTP and gRPC paths.
- Hybrid hot+cold storage/query behavior is fully specified, including dedupe policy.
- Kafka/WarpStream long-term direction is captured as explicit future work.

## Out of Scope

- CI expansion to full test/e2e pipeline coverage in this phase.
- Replacing Tempo for trace storage/metrics derivation.
- Full identity/authz platform beyond tenant header enforcement.

## Explicit Assumptions and Defaults

- `mise` is the only command/task system in this phase.
- Core SDK docs are explicit API first; provider docs are wrapper-first.
- Query transport is REST-only for this phase.
- Baseline CI quality gate is mandatory (`mise run ci` on pull requests and `main` pushes); test/e2e CI expansion remains tracked debt.
- Cost remains provider-reported only in this phase.
- Model cards use external source plus static fallback, but query/frame compatibility is higher priority.
- Modified docs must keep `last_reviewed` updated and indexes synchronized.
