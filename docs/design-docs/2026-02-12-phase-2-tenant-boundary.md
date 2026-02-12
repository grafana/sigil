---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: Tenant Boundary + Per-Export SDK Auth Modes

## Scope

This workstream isolates tenant/auth boundary implementation and per-export SDK auth modes from query-shape and storage tracks.

Execution for this workstream is completed and tracked in:

- `docs/exec-plans/completed/2026-02-12-phase-2-tenant-boundary.md`

## Tenant Auth Model (Loki-style)

Tenant identity uses `X-Scope-OrgID`.

Sigil reuses dskit tenant/auth utilities:

- `github.com/grafana/dskit/user`
- `github.com/grafana/dskit/tenant`
- `github.com/grafana/dskit/middleware`

Runtime config:

- `SIGIL_AUTH_ENABLED=true|false`
- `SIGIL_FAKE_TENANT_ID=<id>` (default `fake`)
- when disabled, fake tenant injection is allowed for local/dev workflows

Enforcement scope is uniform:

- query HTTP routes
- generation ingest HTTP and gRPC
- OTLP ingest HTTP and gRPC

Health endpoints stay unauthenticated.

Auth-enabled failure behavior:

- missing tenant on protected HTTP routes: `401 Unauthorized`
- missing tenant metadata on protected gRPC methods: `Unauthenticated`

## SDK Per-Export Auth Model

SDK auth is per export (not global):

- trace export auth config
- generation export auth config

Supported auth modes:

- `none`
- `tenant` -> inject `X-Scope-OrgID`
- `bearer` -> inject `Authorization: Bearer <token>`

Validation behavior is strict and fail-fast during config resolution / client initialization:

- `tenant` requires tenant id and forbids bearer token.
- `bearer` requires bearer token and forbids tenant id.
- `none` forbids both tenant id and bearer token.

Header precedence rule:

- If explicit export headers already include `Authorization` or `X-Scope-OrgID`, explicit headers win.

## Topology Guidance

- Generations can be exported directly to Sigil generation ingest using tenant mode.
- Traces can be exported to OTEL Collector/Alloy with independent auth mode (including `none`).
- Enterprise proxy pattern is supported by SDK bearer mode:
  - client sends bearer token
  - proxy authenticates and translates to upstream tenant header
  - Sigil enforces tenant header

Sigil API does not validate bearer tokens in this phase.

## Required Local Test Scenarios

- Tenant auth tests for required header behavior and fake-tenant mode.
- Uniform tenant boundary tests for query + generation ingest + OTLP ingest.
- SDK tests for split per-export auth behavior and strict validation.

## Consequences

- Tenant isolation behavior is explicit and consistent across HTTP and gRPC surfaces.
- SDK auth design cleanly supports mixed generation/trace topologies without global auth coupling.
