---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: agents
---

# Bootstrap Phase 1

## Goal

Replace placeholder behavior with end-to-end ingest, query, and plugin flows.

## Scope

- Sigil API data access and storage abstractions.
- Plugin pages backed by real query APIs.
- Tenant/auth boundaries for API and proxy paths.
- MySQL schema evolution for generations and conversation metadata.

## Relationship to Current Phase Work

Detailed implementation contracts and phase sequencing are defined in:

- `docs/exec-plans/active/2026-02-12-phase-2-delivery.md`
- `docs/exec-plans/active/2026-02-12-phase-2-sdk-parity-python.md`
- `docs/exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`
- `docs/exec-plans/active/2026-02-12-phase-2-tenant-boundary.md`
- `docs/exec-plans/active/2026-02-12-phase-2-query-proxy.md`
- `docs/exec-plans/active/2026-02-12-phase-2-hybrid-storage.md`

This bootstrap plan stays as the umbrella phase marker while Phase 2 contains decision-complete delivery tasks.

## Tasks

- [ ] Replace query placeholders with Tempo-first query + storage hydration behavior.
- [x] Close Records-first externalization path in favor of Generation-first ingest (`docs/exec-plans/active/2026-02-12-generation-first-ingest.md`).
- [ ] Add plugin pages with real conversations/generations/traces drilldown tables.
- [ ] Add plugin backend resource proxy for query access.
- [ ] Add tenant/auth boundaries for API and plugin proxy paths.
- [ ] Add schema migrations for generation/conversation metadata and hot storage indexes.

## Risks

- Scope spans plugin, API, SDK, and storage contracts.
- Tenant boundary drift can cause inconsistent isolation behavior.
- Dual-store read behavior (hot+cold) can regress correctness if dedupe policy is inconsistent.

## Exit Criteria

- Query endpoints return persisted data instead of placeholders.
- Plugin query traffic is proxy-only and returns Grafana-compatible frame envelopes.
- Generation ingest persists normalized payloads with tenant context.
- Tenant boundaries are defined and enforced for exposed paths.
- Phase 2 plan tasks are complete or explicitly rolled into subsequent plans.
