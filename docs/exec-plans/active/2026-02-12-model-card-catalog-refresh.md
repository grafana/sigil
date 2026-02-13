---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Delivery Plan: Model Card Catalog Refresh and API

## Goal

Deliver an automated model-card catalog with external-source refresh, embedded static fallback, in-memory cache storage, and stable `/api/v1` read endpoints.

## Scope

- source adapters and normalization layer
- scheduled refresh with fallback
- in-memory cache wiring in runtime targets
- model-card API handlers and tests
- docs and operational metrics

## Source design doc

- `docs/design-docs/2026-02-12-model-card-catalog-refresh.md`

## Tasks

### Phase A: Storage model

- [x] Add repository interfaces in `sigil/internal/modelcards`.
- [x] Implement in-memory repository for list/filter/lookup and refresh-run writes.
- [x] Wire model-card service creation to memory-only store (independent of `SIGIL_STORAGE_BACKEND`).

### Phase B: Source adapters and refresh engine

- [x] Implement `openrouter` source adapter (`GET /api/v1/models`).
- [x] Implement static fallback loader (`sigil/internal/modelcards/fallback/openrouter_models.v1.json`).
- [x] Implement normalization + validation pipeline into canonical model-card contract.
- [x] Implement refresh coordinator with:
  - retry + timeout
  - primary->fallback failover
  - in-memory refresh-run tracking
- [x] Add unit tests for success, fallback, and failure paths.

### Phase C: API surface

- [x] Add route `GET /api/v1/model-cards`.
- [x] Add route `GET /api/v1/model-cards:lookup`.
- [x] Add route `GET /api/v1/model-cards:sources`.
- [x] Add protected route `POST /api/v1/model-cards:refresh`.
- [x] Add input validation, pagination guards, and regex model search (`regex` query param).
- [x] Add HTTP handler tests for filtering, sorting, pagination, and lookup errors.

### Phase D: Tooling and observability

- [x] Add refresh/snapshot command targets via `mise` tasks for manual runs.
- [x] Add snapshot update/check commands for fallback JSON regeneration.
- [ ] Add metrics:
  - refresh duration
  - success/failure counters
  - catalog age
  - row count
- [ ] Add logs for source selection and fallback usage (partial; error paths logged).

### Phase E: Runtime targets and Helm

- [x] Add runtime target `catalog-sync` in config/runtime module wiring.
- [x] Ensure `all` target shares a single in-process model-card service between API and refresh loop.
- [x] Ensure `server` target runs its own model-card refresh loop (per-pod memory cache).
- [x] Add Helm `catalogSync.enabled` optional deployment template.
- [x] Keep Helm default mode backward-compatible (`sigil.target=all`).
- [x] Add Helm render tests for split mode (`sigil.target=server` + `catalogSync.enabled=true` + singleton replica).

### Phase F: Rollout and docs

- [x] Wire scheduler interval/config in runtime config.
- [x] Enable in dev compose and verify end-to-end behavior.
- [x] Update docs index entries and design status as implementation lands.
- [ ] Capture deferred items in `docs/exec-plans/tech-debt-tracker.md` if needed.

## Risks

- Source schema drift causing refresh breakage.
- Incorrect stale-marking deleting or hiding active models.
- API contract churn if canonical schema is not kept stable.
- Fallback snapshot staleness masking prolonged source outages.

## Exit criteria

- Automatic refresh runs successfully from primary source.
- Fallback path is tested and operational.
- Model cards are queryable via `/api/v1/model-cards*` endpoints.
- Freshness metadata is visible to API consumers.
- Metrics and logs are sufficient to detect staleness and failure modes.

## Out of scope

- Multi-vendor direct fan-in in first implementation.
- Benchmark/ranking enrichment data ingestion.
- Tenant-specific pricing overrides.
