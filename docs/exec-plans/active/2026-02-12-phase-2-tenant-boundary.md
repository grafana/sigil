---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: Tenant Boundary

## Goal

Deliver uniform, lightweight Loki-style tenant enforcement across Sigil query and ingest surfaces.

## Scope

- HTTP and gRPC tenant extraction/enforcement behavior.
- Runtime auth mode matrix for OSS and local development.
- Plugin proxy tenant propagation rules.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-tenant-boundary.md`

## Tasks

- [ ] Define `X-Scope-OrgID` as tenant header for all query and ingest surfaces.
- [ ] Reuse dskit tenant/auth packages:
  - `github.com/grafana/dskit/user`
  - `github.com/grafana/dskit/tenant`
  - `github.com/grafana/dskit/middleware`
- [ ] Define `SIGIL_AUTH_ENABLED=true|false` behavior and fake-tenant local mode.
- [ ] Define uniform enforcement across:
  - query HTTP routes
  - generation ingest HTTP and gRPC
  - OTLP ingest HTTP and gRPC
- [ ] Keep health endpoints exempt.
- [ ] Define plugin proxy tenant header forwarding/injection behavior.
- [ ] Document required local test scenarios:
  - missing tenant behavior
  - fake tenant behavior
  - uniform enforcement across all query and ingest surfaces

## Risks

- Tenant propagation drift between plugin proxy and API layers.
- Partial enforcement causes isolation gaps across transport surfaces.
- Ambiguous local mode behavior can mask production auth issues.

## Exit Criteria

- Tenant boundary behavior is fully specified and consistent across HTTP and gRPC paths.
- Auth mode matrix is explicit for enabled and disabled modes.
- Local tests cover missing/fake tenant and uniform enforcement cases.

## Out of Scope

- Full identity/authz platform beyond tenant header enforcement.
