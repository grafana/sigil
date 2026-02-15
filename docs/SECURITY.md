---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Security

Purpose: define Sigil security baseline for tenant boundaries, plugin proxying, and data-handling controls.

## Auth Model

Sigil uses lightweight tenant auth semantics, not full identity/authz.

For operator setup and usage patterns, see `docs/references/multi-tenancy.md`.

- tenant header: `X-Scope-OrgID`
- protected routes require tenant context when auth is enabled
- local/dev mode may inject a fake tenant context when auth is disabled

Runtime mode controls:

- `SIGIL_AUTH_ENABLED=true|false`
- fake-tenant mode is local/dev oriented and must not be treated as production isolation

## Enforcement Scope

Tenant context enforcement must be uniform across:

- query HTTP endpoints
- generation ingest HTTP and gRPC

OTLP traces and metrics are not ingested by Sigil in this phase. They flow through Alloy / OTel Collector, which applies any upstream auth/header policy separately.

Health endpoints are exempt from tenant enforcement.

## Reused Packages

Sigil reuses Loki-adjacent dskit utilities for tenant extraction and middleware behavior:

- `github.com/grafana/dskit/user`
- `github.com/grafana/dskit/tenant`
- `github.com/grafana/dskit/middleware`

## Plugin Proxy Boundary

- frontend query traffic must go through plugin backend resources
- tenant headers must be applied/forwarded by proxy/backend layers
- frontend components must not implement custom tenant header logic

## Downstream Query Proxying

For Sigil pass-through query proxy endpoints (Prometheus/Mimir and Tempo):

- outbound `X-Scope-OrgID` is always sourced from Sigil tenant context (auth tenant or fake tenant mode)
- client-supplied `X-Scope-OrgID` is not trusted directly for downstream forwarding
- only a safe request-header allowlist is forwarded to downstream backends
- hop-by-hop headers are stripped on both request and response paths

## Data Handling

- raw provider artifacts are default OFF
- raw content capture requires explicit debug opt-in
- normalized generation payload is preferred for default ingest and query workflows

## Threat Baseline

Primary risks in this phase:

- missing tenant context on protected routes
- cross-tenant query leakage
- accidental raw content capture in non-debug paths
- inconsistent auth behavior between HTTP and gRPC paths

## Required Security Tests (Local Phase)

- missing tenant behavior with auth enabled
- fake-tenant behavior with auth disabled
- uniform tenant extraction across ingest and query surfaces
- cross-tenant isolation checks for query and hydration flows
- proxy-only query path enforcement

## Update Cadence

- Update when tenant model, auth mode behavior, proxy boundaries, or payload sensitivity rules change.
