---
owner: sigil-core
status: completed
last_reviewed: 2026-03-02
source_of_truth: true
audience: both
---

# Sigil Delivery: Runtime Role Split and Distributed Helm Topology

## Goal

Split Sigil runtime responsibilities into explicit deployable roles while keeping a single-binary `all` mode:

- transport-only `server`
- write-path `ingester`
- read/control-path `querier`
- background workers (`compactor`, `eval-worker`, `catalog-sync`)

## Scope

- Add runtime target `ingester`.
- Make `server` transport-only.
- Move ingest path + eval enqueue dispatch into `ingester`.
- Move query/proxy/model-cards/eval control routes into `querier`.
- Switch model-card storage to shared MySQL-backed store.
- Add first-class split-role Helm deployments/services.
- Update architecture and operator docs.

## Decisions Locked In Implementation

- Runtime composition remains in-process modules in one binary.
- `ingester` and `querier` each depend on `server` transport.
- `all` runs `ingester`, `querier`, `compactor`, and `eval-worker`.
- `catalog-sync` remains optional as a dedicated refresh-only role.
- Model-card catalog is shared via MySQL across role pods.
- Helm supports monolith mode and split role mode in a single chart.

## Checklist

### Runtime/module graph

- [x] Add `ingester` target to runtime config and CLI flags.
- [x] Register `ingester` module in dskit module graph.
- [x] Add module dependencies so role targets include `server`.
- [x] Keep `all` as single-process multi-role mode.

### Service ownership split

- [x] Refactor `server` module to start only HTTP/gRPC listeners.
- [x] Add shared transport registration registry for role modules.
- [x] Implement `ingester` module wiring for:
  - generation ingest HTTP route
  - generation ingest gRPC service
  - eval enqueue dispatcher
- [x] Implement `querier` module wiring for:
  - query and proxy HTTP routes
  - model-card routes
  - eval control and score ingest routes
  - eval seed bootstrap

### Shared catalog storage

- [x] Replace model-card in-memory store wiring with MySQL model-card store in runtime factory.
- [x] Keep `catalog-sync` role for dedicated refresh workers.

### Helm and docs

- [x] Add optional role deployments for `ingester`, `querier`, `compactor`, and `eval-worker`.
- [x] Add optional role services for `ingester` and `querier`.
- [x] Add `api.enabled` gate for primary monolith deployment/service.
- [x] Update chart docs and helm reference for split role mode.
- [x] Update architecture/runtime target docs.
- [x] Update online evaluation deployment guidance for querier/ingester split.

## Validation

- `go test ./sigil/internal/...`
- `go test ./sigil/...`
- `mise run test:helm`

## Exit Criteria

- Runtime targets cleanly separate transport, ingest, query, and background roles.
- Monolith `SIGIL_TARGET=all` remains supported.
- Helm can render monolith and split-role topologies from one chart.
- Documentation reflects target semantics and deployment guidance.
