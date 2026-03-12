---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Execution Plan: SDK Conformance Harness

## Goal

Deliver a no-Docker conformance test suite that validates all SDK-emitted fields the UI and backend depend on, across all SDK layers (core, provider wrappers, framework adapters) and all languages (Go, JS, Python, Java, .NET). Fix any SDK bugs discovered during implementation.

Design doc: `docs/design-docs/2026-03-12-sdk-conformance-harness.md`

## Scope

Three conformance layers, each testing a different part of the SDK stack:

1. **Core SDK conformance** -- generation export, OTLP spans/metrics, identity resolution, rating HTTP.
2. **Provider wrapper conformance** -- provider request/response mapping to normalized `Generation` shape.
3. **Framework adapter conformance** -- span hierarchy, framework attributes, generation triggering.

Full matrix: 5 core SDKs + 15 provider wrappers + 11 framework adapters = 31 conformance suites at full coverage.

## Working model

Building conformance tests against the real public API will surface issues that internal tests miss -- missing fields on the proto, broken fallback chains, serialization mismatches, public API gaps. When a test fails because the SDK is wrong (not the test), fix the SDK in the same branch:

1. Write the conformance scenario.
2. Run it. If it fails because the SDK behavior doesn't match the spec, fix the SDK code.
3. The conformance test itself serves as the regression test for the fix.
4. Log the fix in the "SDK fixes" section below so the PR description captures what was discovered.

### Current shipped baseline

The repo currently ships the Go core conformance harness entry point:

- Local task: `mise run test:sdk:conformance`
- Direct runner: `cd sdks/go && GOWORK=off go test ./sigil -run '^TestConformance' -count=1`
- Current covered scenarios: full generation roundtrip, conversation title semantics, user ID semantics, agent identity semantics, streaming mode semantics, tool execution semantics, embedding semantics, validation/error semantics, rating submission semantics, shutdown flush semantics
- Current assertion targets in active use: generation export proto, OTLP spans, OTLP metrics

### SDK fixes discovered during implementation

(Updated as issues are found.)

- Added `cache_creation_input_tokens` to the generation ingest proto and Go SDK proto mapping so the full roundtrip export preserves the complete token usage payload.
- Synced the checked-in JS proto copy and regenerated the Go protobuf bindings so `ToolDefinition.deferred` is present in the conformance ingest schema used by the Go SDK harness.

## Phase A: Go core SDK

### A1: Test infrastructure

- [x] Add `conformance_helpers_test.go` (`package sigil_test`):
  - [x] `conformanceEnv` struct wiring `sigil.Client` to all four capture targets
  - [x] `newConformanceEnv(t, ...opts)` constructor with functional options
  - [x] `fakeIngestServer` implementing `GenerationIngestServiceServer` on `127.0.0.1:0`
  - [x] `fakeRatingServer` wrapping `httptest.Server` with request capture
  - [x] OTel `tracetest.SpanRecorder` + `sdktrace.TracerProvider` setup
  - [x] OTel `sdkmetric.ManualReader` + `sdkmetric.MeterProvider` setup
  - [ ] Optional `resource.Resource` injection for OTLP resource attribute scenarios
  - [x] Span assertion helpers: `findSpan`, `spanAttrs`, `requireSpanAttr`, `requireSpanAttrAbsent`
  - [x] Metric assertion helpers: `findHistogram`, `requireNoHistogram`
  - [x] Proto assertion helpers: `requireProtoMetadata`, `requireProtoMetadataAbsent`

### A2: Core scenarios (generation identity and resolution chains)

- [x] Add `conformance_test.go` (`package sigil_test`)
- [x] Scenario 1: Full generation roundtrip (sync, gRPC)
  - [x] All identity fields preserved on proto
  - [x] All content types: text, thinking, tool call, tool result
  - [x] Request controls: max_tokens, temperature, top_p, tool_choice, thinking_enabled
  - [x] Tags, metadata, artifacts (request + response)
  - [x] Usage (all six token fields) and stop reason
  - [x] Trace linkage: proto trace_id/span_id match OTLP span IDs
  - [x] Span attributes match `semantic-conventions.md` generation section
  - [x] Metrics: operation.duration, token.usage present; no TTFT for sync
- [x] Scenario 2: Conversation title semantics (table-driven)
  - [x] Explicit field wins
  - [x] Context fallback
  - [x] Metadata fallback
  - [x] Whitespace-only omission
- [x] Scenario 3: User ID semantics (table-driven)
  - [x] Explicit field wins
  - [x] Context fallback
  - [x] Canonical metadata fallback (`sigil.user.id`)
  - [x] Legacy metadata fallback (`user.id`)
  - [x] Canonical wins over legacy
  - [x] Whitespace trimming
- [x] Scenario 4: Agent identity semantics
  - [x] Explicit fields
  - [x] Context fallback
  - [x] Result-time override
  - [x] Empty field omission from span

### A3: Extended scenarios

- [ ] Scenario 5: SDK identity protection (`sigil.sdk.name` overwrite)
- [ ] Scenario 6: Tags and metadata merge (start + result, conflict resolution)
- [ ] Scenario 7: Resource attributes on OTLP spans
- [x] Scenario 8: Streaming mode (mode, operation name, TTFT metric)
- [x] Scenario 9: Tool execution (span shape, attributes, metrics, context propagation)
- [x] Scenario 10: Embedding (span, metrics, no generation export)
- [x] Scenario 11: Validation and error semantics
  - [x] Invalid generation: no export, ErrValidationFailed
  - [x] SetCallError: error span attributes, metric labels
- [x] Scenario 12: Rating helper (request shape, auth headers, response parsing)
- [x] Scenario 13: Shutdown flushes pending generation

### A4: Spec and docs

- [x] Publish `docs/references/sdk-conformance-spec.md` for the current Go core baseline (language-neutral)
- [x] Add `test:sdk:conformance` task to `mise.toml`
- [x] Update `ARCHITECTURE.md` SDK section
- [x] Update discoverability docs (`docs/index.md`, `docs/references/index.md`, `sdks/go/README.md`)
- [x] Verify: `mise run test:sdk:conformance` passes
- [x] Verify: `go test -run TestConformance -count=5 ./sdks/go/sigil/` proves determinism

## Phase B: Go provider wrappers

Test that each Go provider mapper correctly transforms provider request/response into the normalized `Generation` shape.

### Current shipped baseline

- [x] `sdks/go-providers/openai/conformance_test.go`
  - [x] Chat Completions sync normalization
  - [x] Chat Completions stream normalization
  - [x] Responses sync normalization
  - [x] Responses stream normalization
  - [x] Recorder-path sync/stream export assertions via `sdks/go/sigil/sigiltest`
  - [x] Usage mapping (prompt/completion/total/cache/reasoning)
  - [x] Stop reason mapping
  - [x] Tool-call normalization
  - [x] Raw artifact opt-in coverage
  - [x] Explicit mapping-error coverage
  - [x] Wrapper error semantics for provider failures and mapper failures
  - [x] Embedding mapping through the recorder path
- [x] `sdks/go-providers/anthropic/conformance_test.go`
  - [x] Sync normalization with `ThinkingPart`
  - [x] Streaming normalization with accumulated `ThinkingPart`
  - [x] Recorder-path sync/stream export assertions via `sdks/go/sigil/sigiltest`
  - [x] Usage mapping (input/output/cache/server-tool metadata)
  - [x] Stop reason mapping
  - [x] Tool-call normalization
  - [x] Raw artifact opt-in coverage
  - [x] Explicit mapping-error coverage
  - [x] Wrapper error semantics for provider failures and mapper failures
  - [x] Explicit embedding support gate coverage while the official Anthropic SDK/API surface lacks native embeddings
- [x] `sdks/go-providers/gemini/conformance_test.go`
  - [x] Sync normalization with `ThinkingPart`
  - [x] Streaming normalization with accumulated `ThinkingPart`
  - [x] Recorder-path sync/stream export assertions via `sdks/go/sigil/sigiltest`
  - [x] Usage mapping (prompt/candidate/total/cache/reasoning/tool-use metadata)
  - [x] Stop reason mapping
  - [x] Tool-call normalization
  - [x] Raw artifact opt-in coverage
  - [x] Explicit mapping-error coverage
  - [x] Wrapper error semantics for provider failures and mapper failures
  - [x] Embedding mapping through the recorder path
- [x] Extend `sdk-conformance-spec.md` with provider wrapper section

### Remaining provider-wrapper scope

- [ ] Remove duplicate fixture surface between direct-normalization and recorder-path suites if the maintenance cost outweighs the extra coverage
- [ ] Wrapper error-to-span/category assertions with local fake ingest/span capture, if provider suites need to validate `SetCallError` transport semantics directly
- [ ] Native provider-wrapper embedding conformance scenarios for Anthropic only if the official provider SDK/API surface later exposes a real embeddings operation

## Phase C: Go framework adapter (google-adk)

- [x] `sdks/go-frameworks/google-adk/conformance_test.go`
  - [x] Framework invocation spans with `sigil.framework.name`, `sigil.framework.language`, and `sigil.framework.source` are asserted at the parent span boundary
  - [x] LLM calls within framework trigger generation recording
  - [x] Span hierarchy: framework span is parent of generation span
  - [x] Framework-specific metadata propagation is asserted explicitly
  - [x] Generation tags include `sigil.framework.name` and `sigil.framework.language`
- [x] Extend `sdk-conformance-spec.md` with framework adapter section

## Phase D: Other language core SDKs

Each language implements the 13 core scenarios from `sdk-conformance-spec.md`:

- [ ] **TypeScript/JS**: `sdks/js/test/conformance.test.mjs` (Vitest + OTel JS test utilities)
- [ ] **Python**: `sdks/python/tests/test_conformance.py` (pytest + OTel Python test utilities)
- [ ] **Java**: `sdks/java/core/src/test/java/.../ConformanceTest.java` (JUnit + OTel Java test utilities)
- [ ] **.NET**: `sdks/dotnet/tests/.../ConformanceTests.cs` (xUnit + OTel .NET test utilities)

## Phase E: Other language providers and frameworks

Priority order follows adoption:

### Python (highest adoption)
- [ ] Provider conformance: openai, anthropic, gemini
- [ ] Framework conformance: langchain, langgraph, openai-agents, llamaindex, google-adk

### TypeScript/JavaScript
- [ ] Provider conformance: openai, anthropic, gemini
- [ ] Framework conformance: langchain, langgraph, openai-agents, llamaindex, google-adk, vercel-ai-sdk

### Java
- [ ] Provider conformance: openai, anthropic, gemini
- [ ] Framework conformance: google-adk

### .NET
- [ ] Provider conformance: openai, anthropic, gemini

## Decisions Applied

- In-process external test package (`package sigil_test`), not subprocess.
- Shared conformance spec document, not shared code library.
- gRPC as primary export transport (HTTP parity already proven in `exporter_transport_test.go`).
- Retry/flush mechanics excluded from scope (unit tests own these).
- Backend-derived fields excluded (`agent_effective_version`, conversation rollups).
- No assertion libraries -- `t.Fatalf` with clear got/want messages only.
- Table-driven tests for resolution chain scenarios (title, user ID, agent identity).
- Three conformance layers (core, provider, framework) because each transforms data differently and breaks independently.
- Fix bugs found during implementation in the same branch.
