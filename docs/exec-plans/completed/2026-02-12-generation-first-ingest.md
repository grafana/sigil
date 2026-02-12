---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Generation-First Ingest Phase

## Goal

Ship Generation-first ingest with OTEL traces + custom generation export (gRPC primary, HTTP parity), and remove Records-first runtime paths.

## Scope

- API: `sigil.v1` generation ingest service + HTTP parity endpoint.
- SDK: async buffered generation exporter, retries/backoff, flush/shutdown lifecycle.
- Providers: explicit mode (`SYNC`/`STREAM`) and raw artifact opt-in defaults.
- Docs: architecture/contracts/config updates for provider implementers.

## Tasks

- [x] Add `api/proto/sigil/v1/generation_ingest.proto` and generate API/SDK stubs.
- [x] Add API generation ingest service and memory-backed store abstraction.
- [x] Add gRPC handler: `GenerationIngestService.ExportGenerations`.
- [x] Add HTTP parity endpoint: `POST /api/v1/generations:export`.
- [x] Remove active runtime registration for Records REST endpoints.
- [x] Refactor Go SDK to async queue + batch + retry export model.
- [x] Add SDK `Flush(ctx)` and `Shutdown(ctx)` lifecycle methods.
- [x] Add SDK OTLP trace config supporting `grpc` and `http` protocols.
- [x] Set provider wrapper generation mode explicitly (`SYNC`/`STREAM`).
- [x] Switch raw artifacts default to OFF with explicit opt-in (`WithRawArtifacts()`).
- [x] Update architecture/agent/reference/SDK docs for generation-first contracts.

## Risks

- Background export failures are asynchronous and may be missed without log visibility.
- HTTP/gRPC parity drift is possible if only one transport is exercised in future changes.
- Placeholder query APIs still require persistent backing integration to expose stored generations.

## Exit Criteria

- Generation ingest is available via gRPC and HTTP parity with per-item acceptance results.
- Go SDK enqueues, batches, retries, and flushes on shutdown.
- Provider wrappers set mode and default to normalized payloads without raw artifacts.
- Removed records endpoints are no longer in active runtime registration.
