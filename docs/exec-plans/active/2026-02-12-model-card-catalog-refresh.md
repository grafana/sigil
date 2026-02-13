---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Delivery Plan: Model Card Catalog Refresh and API

## Goal

Deliver an automated model-card catalog with external-source refresh, static fallback, MySQL storage, and stable `/api/v1` read endpoints.

## Scope

- source adapters and normalization layer
- scheduled refresh with fallback
- MySQL schema and migrations
- model-card API handlers and tests
- docs and operational metrics

## Source design doc

- `docs/design-docs/2026-02-12-model-card-catalog-refresh.md`

## Tasks

### Phase A: Schema and storage

- [ ] Add MySQL migration for:
  - `model_cards`
  - `model_card_aliases`
  - `model_card_refresh_runs`
- [ ] Add repository interfaces in `sigil/internal/modelcards`.
- [ ] Implement MySQL repository methods for list/filter/lookup and refresh-run writes.
- [ ] Add migration and repository tests.

### Phase B: Source adapters and refresh engine

- [ ] Implement `openrouter` source adapter (`GET /api/v1/models`).
- [ ] Implement static fallback loader (`sigil/internal/modelcards/fallback/openrouter_models.v1.json`).
- [ ] Implement normalization + validation pipeline into canonical model-card contract.
- [ ] Implement refresh coordinator with:
  - MySQL advisory lock
  - retry + timeout
  - primary->fallback failover
  - stale marking with grace window
- [ ] Record refresh runs in `model_card_refresh_runs`.
- [ ] Add unit tests for success, fallback, and failure paths.

### Phase C: API surface

- [ ] Add route `GET /api/v1/model-cards`.
- [ ] Add route `GET /api/v1/model-cards:lookup`.
- [ ] Add route `GET /api/v1/model-cards:sources`.
- [ ] Add protected route `POST /api/v1/model-cards:refresh`.
- [ ] Add input validation and pagination guards.
- [ ] Add HTTP handler tests for filtering, sorting, pagination, and lookup errors.

### Phase D: Tooling and observability

- [ ] Add refresh command target (for example via `mise` task) for manual runs.
- [ ] Add snapshot update command for fallback JSON regeneration.
- [ ] Add metrics:
  - refresh duration
  - success/failure counters
  - catalog age
  - row count
- [ ] Add logs for source selection and fallback usage.

### Phase E: Rollout and docs

- [ ] Wire scheduler interval/config in runtime config.
- [ ] Enable in dev compose and verify end-to-end behavior.
- [ ] Update docs index entries and design status as implementation lands.
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
