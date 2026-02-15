---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# SDK Metrics and Telemetry Pipeline Delivery

## Implementation Status (2026-02-14)

Completed. All SDK runtimes emit the four histogram instruments with TTFT/error-category parity, Sigil OTLP trace ingest/Tempo forwarding has been removed, and Alloy is now the default telemetry pipeline in both Compose and Helm. Follow-up delivery also added instrumentation-only generation mode (`generation export protocol = none`) across Go/JS/Python/Java/.NET so teams can instrument first and enable transport later.

## Goal

Move high-level AI observability metrics to Prometheus via SDK-emitted OTel metrics. Remove OTLP trace ingest from Sigil. Bundle Alloy as the standard telemetry pipeline. Update architecture docs and README to reflect the new data flow.

## Scope

- OTel metric instruments in all 5 SDKs (Go, Python, TypeScript/JavaScript, Java, .NET)
- Alloy bundling in Helm chart and docker-compose
- Trace ingest removal from Sigil (code, config, ports, metrics)
- Architecture and README updates with new data flow diagrams
- Migration guidance for existing deployments

## Source design doc

- `docs/design-docs/2026-02-13-sdk-metrics-and-telemetry-pipeline.md`

## Completion policy

- A checkbox moves to `[x]` only when implementation code and automated tests for that item are merged to `main`.
- Design docs, architecture text, or branch-local changes are not sufficient to close checklist items.

## Implementation phases

### Phase A: SDK Metrics (Go baseline)

#### Metric instruments

- [x] Add MeterProvider setup to Go SDK core (`sdks/go/`), sharing OTLP exporter and Resource with TracerProvider.
- [x] Define `gen_ai.client.operation.duration` histogram with buckets `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]`.
- [x] Define `gen_ai.client.token.usage` histogram with buckets `[1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 100000]`.
- [x] Define `gen_ai.client.time_to_first_token` histogram with buckets `[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`.
- [x] Define `gen_ai.client.tool_calls_per_operation` histogram with buckets `[0, 1, 2, 3, 5, 10, 20, 50]`.

#### Recording at generation completion

- [x] Record duration observation on `gen_ai.client.operation.duration` with attributes: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name`, `error.type`.
- [x] Record token observations on `gen_ai.client.token.usage` for each non-zero token type (`input`, `output`, `cache_read`, `cache_write`, `cache_creation`, `reasoning`) at generation completion.
- [x] Record tool call count observation on `gen_ai.client.tool_calls_per_operation`: count output message parts with `Kind == PartKindToolCall` and record as histogram observation.
- [x] Record duration observation at tool call completion with same duration attributes (`gen_ai.operation.name` = `execute_tool`).

#### Time-to-first-token (streaming)

- [x] Capture `time.Now()` on first `stream.Next()` that returns data in provider streaming helpers.
- [x] Compute TTFT = first_chunk_time - span_start_time and record on `gen_ai.client.time_to_first_token`.
- [x] Only record TTFT for streaming operations (`gen_ai.operation.name` = `streamText`).
- [x] Propagate first-chunk timestamp through `StreamSummary` or equivalent in each provider helper.

#### Missing span attributes

- [x] Add `gen_ai.usage.reasoning_tokens` (int64) to `generationSpanAttributes()` -- currently in `TokenUsage` but not set on spans.
- [x] Add `gen_ai.usage.cache_creation_input_tokens` (int64) to `generationSpanAttributes()` -- currently in `TokenUsage` but not set on spans.

#### Error categorization

- [x] Add `error.category` span attribute to provider helpers: extract HTTP status code from provider error responses and map to category (`rate_limit`, `server_error`, `auth_error`, `timeout`, `client_error`, `sdk_error`).
- [x] Set `error.category` on the `gen_ai.client.operation.duration` histogram observation alongside `error.type`.
- [x] Implement HTTP status extraction in OpenAI, Anthropic, and Gemini Go provider helpers.

#### Lifecycle and tests

- [x] Add MeterProvider shutdown to client shutdown flow (flush metrics alongside traces and generations).
- [x] Unit tests: metric observation correctness, attribute values, zero-value token skipping.
- [x] Unit tests: TTFT recording for streaming operations, no TTFT for sync operations.
- [x] Unit tests: tool call count recording correctness (0 calls, 1 call, multiple calls).
- [x] Unit tests: error categorization mapping (429 -> rate_limit, 500 -> server_error, etc.).
- [x] Integration test: verify all 4 metric instruments arrive at a test OTLP receiver with correct names and attributes.

### Phase B: SDK Metrics (Python, TypeScript/JavaScript, Java, .NET)

- [x] Port all 4 metric instruments from Go to Python SDK (`sdks/python/sigil_sdk/`).
- [x] Port all 4 metric instruments from Go to TypeScript/JavaScript SDK (`sdks/js/src/`).
- [x] Port all 4 metric instruments from Go to Java SDK (`sdks/java/core/`).
- [x] Port all 4 metric instruments from Go to .NET SDK (`sdks/dotnet/src/Grafana.Sigil.Core/`).
- [x] Port TTFT capture for streaming helpers in each SDK's provider packages.
- [x] Port error categorization (HTTP status extraction) to each SDK's provider helpers.
- [x] Port missing span attributes (`reasoning_tokens`, `cache_creation_input_tokens`) to each SDK.
- [x] Each SDK: unit tests for metric observation correctness (all 4 instruments, TTFT, error categories).
- [x] Each SDK: verify OTLP metric export works alongside trace export.

### Phase C: Bundle Alloy and Prometheus

#### docker-compose

- [x] Add Alloy service to `docker-compose.yaml` with OTLP receiver (`:4317` gRPC, `:4318` HTTP).
- [x] Create Alloy config (`config/alloy/config.river`) routing traces to Tempo and metrics to Prometheus.
- [x] Configure Alloy with Docker metadata enrichment (`discovery.docker` and `discovery.relabel`) so metrics and traces are labeled with container name, compose service, and image.
- [x] Add Prometheus service to `docker-compose.yaml` (for local dev metrics storage) with OTLP receiver enabled and appropriate scrape/retention config.
- [x] Create `Dockerfile.sdk-traffic` in `.config/` -- a traffic generator container that uses the latest Go SDK to send realistic generation + trace + metric data to Alloy. This validates the full pipeline end-to-end in local dev.
- [x] Add `sdk-traffic` service to `docker-compose.yaml` that builds from `.config/Dockerfile.sdk-traffic`, points `OTEL_EXPORTER_OTLP_ENDPOINT` at Alloy, and `SIGIL_ENDPOINT` at Sigil.

#### Auth delegation

- [x] SDK auth for traces and metrics is no longer needed in the SDK config -- Alloy handles auth injection (tenant headers, bearer tokens) for upstream backends. Remove trace auth configuration from SDK examples and simplify the SDK config surface.
- [x] Alloy config includes tenant header injection (`X-Scope-OrgID`) for Tempo and Prometheus when auth is enabled.

#### Helm chart

- [x] Add Alloy deployment templates to Helm chart (`charts/sigil/templates/alloy-deployment.yaml`, `alloy-service.yaml`, `alloy-configmap.yaml`).
- [x] Add Alloy configuration values to `charts/sigil/values.yaml` (`alloy.enabled`, `alloy.image`, `alloy.config`).
- [x] Add Prometheus deployment templates to Helm chart (or document using an external Prometheus).
- [x] Configure Alloy in Helm with k8s metadata enrichment (`discovery.kubernetes`).
- [x] Configure Alloy in Helm with auth/tenant header injection for multi-tenant deployments.

#### Verification

- [x] Update SDK example configs to point `OTEL_EXPORTER_OTLP_ENDPOINT` at Alloy instead of Sigil.
- [x] Verify end-to-end locally: `sdk-traffic` container -> Alloy -> traces appear in Tempo + metrics appear in Prometheus.
- [x] Verify Docker metadata labels appear on metrics in Prometheus (e.g., `container`, `compose_service`).

### Phase D: Remove Trace Ingest from Sigil

- [x] Remove `sigil/internal/tempo/` package (client.go, tests).
- [x] Remove `sigil/internal/ingest/trace/` package (service.go, http.go, grpc.go, tests).
- [x] Remove OTLP HTTP server (`:4318`) from `sigil/internal/server_module.go`.
- [x] Remove OTLP gRPC trace service registration (`collecttracev1.RegisterTraceServiceServer`) from `server_module.go`.
- [x] Remove Tempo client lifecycle (init in `start`, close in `stop`) from `server_module.go`.
- [x] Keep generation gRPC service on `:4317` (or move to main API server on `:8080`; decide and document).
- [x] Remove `SIGIL_TEMPO_OTLP_GRPC_ENDPOINT` and `SIGIL_TEMPO_OTLP_HTTP_ENDPOINT` from `sigil/internal/config/config.go`.
- [x] Remove `TempoOTLPGRPCEndpoint` and `TempoOTLPHTTPEndpoint` from `Config` struct.
- [x] Remove `sigil_tempo_forward_*` Prometheus metrics from `sigil/internal/tempo/client.go` (already deleted with the package).
- [x] Update Helm chart: remove `sigil.tempo.grpcEndpoint` and `sigil.tempo.httpEndpoint` values.
- [x] Update Helm chart: remove OTLP port `:4318` from Sigil service definition.
- [x] Update `docker-compose.yaml`: SDK/Alloy sends traces to Tempo directly, not through Sigil.
- [x] Remove Tempo OTLP endpoint environment variables from `docker-compose.yaml` Sigil service.
- [x] Run `mise run ci` to verify no broken imports, lint errors, or test failures.

### Phase E: Documentation and Architecture Updates

- [x] Update `ARCHITECTURE.md`:
  - Rewrite System Boundaries to list Alloy as a system boundary and remove "OTLP trace ingest" from Sigil's description.
  - Rewrite Ingest Model: remove trace pipeline section, add SDK metrics pipeline section, keep generation pipeline.
  - Update Deployment topology guidance: Alloy is the standard telemetry path, Sigil is generation ingest + query only.
  - Update write path diagram: remove Sigil trace ingest -> Tempo path, add SDK -> Alloy -> Tempo + Prometheus path.
  - Update API Contracts: remove OTLP trace endpoints (`:4317` TraceService, `POST /v1/traces`).
  - Update Service Responsibilities: remove `sigil/internal/ingest/trace` entry, add SDK metrics description.
  - Add new section: SDK Metrics describing the four instruments, attributes, and cardinality.
- [x] Update `README.md`:
  - Update "What You Get" section: remove OTLP gRPC/HTTP ports from Sigil, add Alloy as telemetry pipeline.
  - Update "Architecture At A Glance" mermaid diagram to show SDK -> Alloy -> Tempo + Prometheus, SDK -> Sigil for generations.
  - Update "Why Sigil" bullets: update OpenTelemetry-native description.
  - Update SDK example: change trace endpoint from Sigil to Alloy.
  - Update local stack description to include Alloy.
- [x] Update `docs/design-docs/index.md`: add `2026-02-13-sdk-metrics-and-telemetry-pipeline.md` entry.
- [x] Update `docs/exec-plans/active/2026-02-12-phase-2-delivery.md`: add SDK metrics and telemetry pipeline track.
- [x] Update SDK READMEs with metrics setup guidance (document that metrics are emitted automatically).
- [x] Update `docs/references/helm-chart.md` with Alloy configuration reference.
- [x] Update `.env.example`: remove Tempo endpoint vars, add Alloy guidance.
- [x] Update Hybrid storage data flow diagram in `ARCHITECTURE.md`: remove `Sigil Trace Ingest` node, add `Alloy` node.

## Risks

- SDK changes across 5 languages is significant work; mitigated by Go baseline first, then porting the same pattern.
- Customers without a collector lose trace/metric enrichment; mitigated by bundling Alloy in Helm/docker-compose.
- OTel GenAI metric semantic conventions are not yet stable; mitigated by accepting a rename if needed.
- `gen_ai.agent.name` cardinality; mitigated by being bounded by real agent count. Collector-level attribute filtering available as escape hatch.
- Generation gRPC port (`:4317` currently shared with OTLP traces); needs clear migration guidance. Alloy takes over `:4317`/`:4318` for OTLP.

## Rollout

1. Ship SDK metrics (Phase A + B) as additive -- no breaking changes, metrics are new.
2. Ship Alloy bundling (Phase C) as additive -- Alloy runs alongside existing stack.
3. Ship trace ingest removal (Phase D) as a breaking change with migration guide.
4. Ship docs (Phase E) alongside Phase D.

## Exit criteria

- All 4 SDK-emitted metrics (duration, token usage, TTFT, tool calls per operation) flow through Alloy to Prometheus with collector-enriched labels.
- TTFT is captured for streaming operations across all SDKs.
- Error categorization (rate_limit, server_error, auth_error, timeout) is implemented in provider helpers across all SDKs.
- Missing span attributes (`reasoning_tokens`, `cache_creation_input_tokens`) are set on generation spans across all SDKs.
- Sigil no longer has OTLP trace ingest code, config, or ports.
- Alloy is bundled and pre-configured in Helm chart and docker-compose.
- `ARCHITECTURE.md` and `README.md` accurately reflect the new architecture with updated diagrams.
- All changes are covered by unit and integration tests.
- Migration guidance is documented for existing deployments.

## Out of scope

- Sigil query API proxying PromQL to Prometheus (future single-datasource experience).
- Custom metric instruments beyond the 4 defined (can be added later).
- Alloy advanced configuration (sampling, tail-based sampling, custom processors).
- Grafana dashboard provisioning for AI metrics.
- Input message count / context depth metrics (derivable from generation records; can be added as a 5th instrument later if needed).
