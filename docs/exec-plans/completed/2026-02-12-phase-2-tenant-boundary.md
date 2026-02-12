---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: Tenant Boundary + Per-Export SDK Auth Modes

## Goal

Deliver uniform, lightweight Loki-style tenant enforcement across Sigil query and ingest surfaces, and add strict per-export SDK auth modes so trace and generation can authenticate independently.

## Completion

Completed on 2026-02-12.

## Scope

- HTTP and gRPC tenant extraction/enforcement behavior.
- Runtime auth mode matrix for OSS and local development.
- Per-export SDK auth model for Go/Python/TypeScript/JavaScript.
- Documentation updates for env-secret wiring and deployment topology guidance.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-tenant-boundary.md`

## Tasks

- [x] Define `X-Scope-OrgID` as tenant header for all query and ingest surfaces.
- [x] Reuse dskit tenant/auth packages:
  - `github.com/grafana/dskit/user`
  - `github.com/grafana/dskit/tenant`
  - `github.com/grafana/dskit/middleware`
- [x] Implement `SIGIL_AUTH_ENABLED=true|false` with `SIGIL_FAKE_TENANT_ID` local-dev mode.
- [x] Enforce tenant boundary uniformly across:
  - query HTTP routes
  - generation ingest HTTP and gRPC
  - OTLP ingest HTTP and gRPC
- [x] Keep health endpoints exempt.
- [x] Add per-export SDK auth configuration for trace and generation export:
  - auth modes `none|tenant|bearer`
  - strict validation for mode/field combinations
  - explicit header precedence for `Authorization` and `X-Scope-OrgID`
- [x] Document env-secret examples for split auth paths:
  - `SIGIL_GEN_BEARER_TOKEN`
  - `SIGIL_TRACE_BEARER_TOKEN`
- [x] Document topology guidance:
  - direct generation-to-Sigil path
  - trace via OTEL Collector/Alloy path
  - enterprise proxy bearer-to-tenant translation pattern

## Current Runtime Status

- Auth-enabled protected HTTP endpoints return `401` when tenant is missing.
- Auth-enabled protected gRPC methods return `Unauthenticated` when tenant metadata is missing.
- Auth-disabled mode injects fake tenant context uniformly.
- SDK auth is per-export for trace and generation; no global auth coupling.
- Sigil API enforces tenant header and does not validate bearer tokens in this phase.

## Risks

- Tenant propagation drift between plugin proxy and API layers.
- Partial enforcement could cause isolation gaps across transport surfaces.
- Ambiguous local mode behavior can mask production auth issues.

## Exit Criteria

- Tenant boundary behavior is implemented and consistent across HTTP and gRPC paths.
- Auth mode matrix is explicit for enabled and disabled modes.
- SDK per-export auth behavior is implemented with strict validation and precedence rules.
- Local tests cover missing/fake tenant and split per-export auth scenarios.

## Out of Scope

- Full identity/authz platform beyond tenant header enforcement.
- Native Sigil API bearer-token validation.
