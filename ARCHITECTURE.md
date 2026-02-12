---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Sigil Architecture

## System Boundaries

- `apps/plugin`: Grafana plugin UI and backend proxy for Sigil APIs.
- `api`: OTLP trace ingest, generation ingest, and query APIs.
- `sdks/*`: post-LLM instrumentation SDKs (Go, Python, TypeScript/JavaScript).
- Tempo: trace storage and TraceQL execution backend.
- MySQL: hot metadata/index store plus hot generation payload store.
- Object storage: long-term compacted generation payload storage.
  - implementation standard: Thanos `objstore` Go package (`github.com/thanos-io/objstore`).

## Phase 2 Target State

Phase 2 defines production contracts for SDK parity, query envelopes, tenant boundaries, and hybrid storage/query behavior. Some runtime paths remain placeholders today; this file defines the implementation target.

### Execution priority

SDK parity tracks are completed. Active implementation sequencing is:

1. query proxy + tenant boundary
2. hybrid storage/query behavior
3. cross-track consistency and tech debt capture

SDK parity completion is tracked in:

- `docs/exec-plans/completed/2026-02-12-phase-2-sdk-parity-python.md`
- `docs/exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`

## Ingest Model (Generation-First)

### Trace pipeline

- SDKs export traces via OTLP (`grpc` or `http`) using SDK trace configuration.
- API exposes OTLP gRPC (`:4317`) and OTLP HTTP traces (`/v1/traces`) and forwards to Tempo.

### Generation pipeline

- SDKs export normalized generations to Sigil custom ingest.
- Primary transport is gRPC with HTTP parity.
- HTTP and gRPC ingest paths call one shared export service path.
- Export in SDKs is buffered, batched, and asynchronous.
- `shutdown` is required to flush pending generations and trace provider state.

## Query Model

- Tempo is the primary backend for trace search and TraceQL-based metrics workflows.
- Sigil query services hydrate generation and conversation payloads/metadata from Sigil storage.
- Query access from the plugin frontend is plugin-proxy-only.

### Query access path

1. Frontend sends query request to plugin backend resource endpoint.
2. Plugin backend applies tenant header behavior and forwards to Sigil API query endpoint.
3. Sigil API queries Tempo first and performs storage hydration/fan-out reads as needed.
4. Sigil API returns Grafana-compatible query envelope and frames.

## Tenant/Auth Model

- Tenant header: `X-Scope-OrgID`.
- Auth model is lightweight tenant header extraction/enforcement.
- OSS mode supports `auth enabled/disabled` behavior:
  - enabled: tenant header required on protected endpoints
  - disabled: fake tenant context is injected for local/dev
- Tenant handling uses dskit utilities (`user`, `tenant`, `middleware`).
- Enforcement scope is uniform for query + generation ingest + OTLP ingest (HTTP and gRPC).
- Health endpoints are exempt.

## Storage Model

### Hot store (MySQL)

MySQL is not only an ingest log. It stores:

- generation metadata and indexes used by application queries
- conversation metadata
- hot payload rows used for recent reads and overlap resolution
- compaction state and bookkeeping

### Cold store (object storage)

- compacted, compressed generation payload segments
- long-term retained payload history
- implemented via Thanos `objstore` interfaces and clients

### Read policy (fixed)

Query reads fan out to hot and cold stores, union results, and dedupe by `generation_id`.

- overlap conflict policy: prefer hot MySQL row

## API Contracts

### Ingest

- OTLP gRPC traces: `:4317` (`opentelemetry.proto.collector.trace.v1.TraceService/Export`)
- OTLP HTTP traces: `POST /v1/traces`
- Generation ingest gRPC: `sigil.v1.GenerationIngestService.ExportGenerations`
- Generation ingest HTTP parity: `POST /api/v1/generations:export`

### Query

- Sigil API query endpoint: `POST /api/v1/query`
- Plugin resource proxy endpoint: `POST /api/plugins/grafana-sigil-app/resources/query`

## Query Response Contract

- Envelope: Grafana datasource `QueryDataResponse` shape (`results.<refId>.frames`).
- Metrics frames: Grafana-compatible metric data frames for graph/table usage.
- Trace detail frames: Grafana/Tempo-compatible trace frame shape (`preferredVisualisationType: trace`).
- Trace search frames: Tempo/Grafana-compatible table frame shape (trace id, start time, service, name, duration, nested spans when present).

See `docs/references/grafana-query-response-shapes.md`.

## Generation Contract

- Generation mode is explicit:
  - `SYNC`: non-stream provider flows
  - `STREAM`: streaming provider flows
- Normalized fields are always sent:
  - model/system prompt/input/output/tools/usage/metadata/timestamps/tags
- Tool definitions support optional input schema JSON for transport parity (`input_schema_json` over gRPC).
- Optional identity fields are supported end-to-end:
  - `conversation_id`
  - `agent_name`
  - `agent_version`
- Raw artifacts are optional debug payloads and default OFF.
- Artifact identity fields (`name`, `record_id`, `uri`) are supported when present.

## SDK Runtime Contracts

- OTel-first mental model: Sigil extends familiar instrumentation flow with AI-specific normalized generation semantics.
- Core APIs are explicit client/recorder lifecycle APIs.
- Provider wrappers are convenience sugar, documented wrapper-first in provider modules.
- Provider parity target for Go/Python/TS: OpenAI, Anthropic, Gemini.
- Python SDK runtime lives in `sdks/python` with provider wrapper packages in `sdks/python-providers/*`.
- Raw provider artifacts are default OFF, explicit opt-in only.
- SDK validation enforces message role/part compatibility and artifact payload-or-record-id constraints.
- Empty tool names return a no-op tool recorder (instrumentation safety behavior).
- `rec.Err()` surfaces local validation/enqueue failures only.
- Background export failures are retried and logged.

## Service Responsibilities

- `apps/plugin`: UI routes and backend proxy handlers for Sigil query contracts.
- `api/internal/ingest`: OTLP ingest handling and Tempo forwarding.
- `api/internal/generations`: generation ingest validation and persistence coordination.
- `api/internal/query`: Tempo-first query orchestration plus storage hydration and fan-out reads.
- `api/internal/storage/mysql`: hot metadata/index/payload access.
- `api/internal/storage/object`: compacted payload access.
  - implementation should wrap Thanos `objstore` primitives.

## Evolution Path

Sigil defines an ingestion-log abstraction with pluggable backends.

- Phase 2 backend: MySQL
- Future candidates: Kafka, WarpStream

This prevents tight coupling of ingest semantics to one concrete log implementation.
