---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: Tenant Boundary

## Scope

This workstream isolates tenant/auth boundary implementation from SDK, query-shape, and storage tracks.

## Tenant Auth Model (Loki-style)

Tenant identity uses `X-Scope-OrgID`.

Sigil reuses dskit tenant/auth utilities:

- `github.com/grafana/dskit/user`
- `github.com/grafana/dskit/tenant`
- `github.com/grafana/dskit/middleware`

Runtime config:

- `SIGIL_AUTH_ENABLED=true|false`
- when disabled, fake tenant injection is allowed for local/dev workflows

Enforcement scope is uniform:

- query HTTP routes
- generation ingest HTTP and gRPC
- OTLP ingest HTTP and gRPC

Health endpoints stay unauthenticated.

## Required Local Test Scenarios

- Tenant auth tests for required header behavior and fake-tenant mode.
- Uniform tenant boundary tests for query + generation ingest + OTLP ingest.

## Consequences

- Tenant isolation behavior is explicit and implementable independent of storage/query UI progress.
