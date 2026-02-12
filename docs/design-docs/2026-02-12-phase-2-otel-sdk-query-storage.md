---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2: OTel-Like SDKs, Plugin Proxy Query, and Hybrid Generation Storage

## Context

Sigil now has a stable generation-first ingest contract and a production-ready Go SDK baseline. Phase 2 aligns the rest of the stack around the same operating model:

- SDK ergonomics should feel familiar to OpenTelemetry users.
- Query access should go through the Grafana plugin backend proxy and return Grafana-compatible query response shapes.
- Generation storage should support both hot metadata/payload access and durable compacted history.
- Tenant isolation should use the same lightweight header model used in Loki.

## Parallel Workstream Docs

Phase 2 delivery is split into parallel design workstreams while preserving these decisions:

- `docs/design-docs/2026-02-12-phase-2-sdk-parity-python.md`
- `docs/design-docs/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`
- `docs/design-docs/2026-02-12-phase-2-tenant-boundary.md`
- `docs/design-docs/2026-02-12-phase-2-query-proxy.md`
- `docs/design-docs/2026-02-12-phase-2-hybrid-storage.md`

## Implementation Priority

Execution remains SDK-first. TypeScript/JavaScript SDK parity is complete; active SDK priority is now Python parity, followed by query/tenant/storage delivery tracks.

## Goals

- Define a decision-complete implementation contract for Python and TypeScript/JavaScript SDK parity.
- Define query contracts and payload shapes that are panel-compatible in Grafana.
- Define tenant/auth boundaries and headers for all ingest and query paths.
- Define hybrid storage behavior (hot MySQL + cold object storage) and fan-out read behavior.
- Capture long-term ingestion-log evolution (Kafka/WarpStream) as explicit next-step architecture.

## Non-Goals

- Shipping CI expansion in this phase.
- Replacing Tempo for trace storage, index, or metrics derivation.
- Shipping a full identity/authz platform beyond tenant header enforcement.

## Decision 1: SDK UX and Parity

### Positioning

If you already use OpenTelemetry, Sigil is a thin extension plus sugar for AI observability.

### Core SDK UX (primary docs)

Core SDK docs for Go, Python, and TypeScript use explicit client APIs as primary:

- start generation: `start_generation` / `startGeneration`
- start streaming generation: `start_streaming_generation` / `startStreamingGeneration`
- start tool execution: `start_tool_execution` / `startToolExecution`
- set result: `set_result` / `setResult`
- set provider call error: `set_call_error` / `setCallError`
- close recorder: `end` / `end`
- lifecycle: `flush`, `shutdown`

Python docs use context manager examples as the default pattern.

TypeScript docs use active-span callback style first, and manual `try/finally` as the explicit alternative.

### Provider docs (secondary, wrapper-first)

Provider package docs are wrapper-first for ergonomics, with explicit core flow shown as secondary when needed.

Provider parity target across Go, Python, and TypeScript/JavaScript:

- OpenAI
- Anthropic
- Gemini

Raw provider artifacts remain default OFF and are only included with explicit debug opt-in.

### Command and testing policy

- `mise` is the single command/task system in this phase.
- A single all-SDK local test command is required (`mise run test:sdk:all`) plus per-language/per-provider tasks.
- CI expansion remains deferred and tracked in tech debt.

## Decision 2: Query Access and Response Envelopes

### Access path

All query operations must go through plugin backend proxy handlers.

- Sigil API query contract: `POST /api/v1/query`
- Plugin resource proxy contract: `POST /api/plugins/grafana-sigil-app/resources/query`

Plugin frontend must not call Sigil API query endpoints directly.

### Envelope contract

Public query responses for metrics and traces follow Grafana datasource envelope shape:

- `QueryDataResponse` with `results.<refId>.frames`

This allows direct compatibility with panel pipelines and existing data frame consumers.

### Frame compatibility requirements

- Metrics: Grafana-compatible metric frames (time/value/labels with valid frame metadata for graph/table).
- Trace detail: Grafana/Tempo trace frame shape (`preferredVisualisationType: trace` and trace fields/meta).
- Trace search: Tempo/Grafana table shape (trace id, start time, service, name, duration, nested span frames where applicable).

See `docs/references/grafana-query-response-shapes.md` for concrete schemas and references.

## Decision 3: Tenant Auth Model (Loki-style)

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

## Decision 4: Generation Storage and Querying

### Storage roles

MySQL is not only a write log. In Phase 2 it is the hot store for:

- generation metadata and retrieval indexes
- conversation metadata
- hot payload rows needed for low-latency reads and recent data correctness

Object storage holds compacted long-term payload segments.

Object storage integration standardizes on the Thanos `objstore` Go package:

- `github.com/thanos-io/objstore`

### Compaction and lifecycle

- Accepted generations are written to MySQL hot tables.
- A background compactor batches and compresses eligible rows to object storage.
- Compaction state is tracked in MySQL.
- Hot payload pruning occurs only after successful durable object write and state update.
- Object reads/writes for compaction and retrieval use the Thanos `objstore` abstraction layer.

### Query read policy (fixed)

Generation/conversation retrieval fans out across hot and cold stores:

1. query hot MySQL rows for the requested filter/range
2. query compacted object segments for the same filter/range
3. union results
4. dedupe by `generation_id`
5. on overlap conflict, prefer hot MySQL row

### Tempo-first search and hydration

Search and metrics derivation remain Tempo-first.

- Tempo is queried first for traces and metrics-oriented filtering.
- Sigil storage hydrates generation and conversation payloads by IDs returned from Tempo-driven workflows.

Initial filter allowlist for generation search/hydration paths:

- `conversation_id`
- `model.provider`
- `model.name`
- `agent.id`
- `agent.version`
- `error.type`
- `env`
- curated custom tags

## Decision 5: Long-Term Event Log Evolution

Sigil defines an ingestion-log abstraction with pluggable backends.

- Phase 2 backend: MySQL
- future candidates: Kafka, WarpStream

Migration intent is explicitly documented to avoid coupling business logic to a MySQL-specific queue/log implementation.

## Additional Product Constraints

- Cost fields are provider-reported only in this phase.
- Model cards use external source plus fallback static catalog, but query/frame compatibility work is higher priority for this phase.

## Required Local Test Scenarios

- SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown) for Go/Python/TS.
- SDK transport tests (generation HTTP/gRPC export and OTLP trace transport assertions).
- Provider mapper tests for OpenAI/Anthropic/Gemini sync and stream flows.
- Tenant auth tests for required header behavior and fake-tenant mode.
- Query envelope tests asserting `QueryDataResponse` and frame metadata compatibility.
- Hybrid hot+cold read tests with fan-out, dedupe by `generation_id`, overlap preference, and no-loss expectations.
- Plugin proxy tests asserting frontend query traffic only uses plugin resource paths.

## Consequences

- Frontend and API contracts become stricter, reducing integration ambiguity.
- Storage/query implementations must support dual-store correctness, not single-store shortcuts.
- Deferred CI work remains a visible risk and is tracked as explicit debt.
