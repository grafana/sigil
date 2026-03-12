---
owner: sigil-core
status: completed
last_reviewed: 2026-02-17
source_of_truth: true
audience: both
---

# Embedding Call Observability Delivery

## Implementation Status (2026-02-17)

Completed. Embedding observability is implemented across Go, Python, JS/TS, Java, and .NET with recorder lifecycle APIs, OTel embedding spans, duration/token metrics, opt-in input text capture with truncation, OpenAI+Gemini provider wrappers, and regression coverage for mapper/wrapper behavior (including tokenized single-input embedding requests).

## Goal

Add embedding call observability to all 5 SDKs using OTel spans and existing metric instruments. No Sigil ingest, proto, or storage changes.

## Scope

- `StartEmbedding` / `start_embedding` recording API in all SDKs (Go, Python, JS/TS, Java, .NET).
- `EmbeddingRecorder` with span attributes, metrics recording, opt-in input text capture.
- Provider wrappers for OpenAI, Anthropic, and Gemini embedding APIs.
- SDK README and architecture doc updates.

## Source design doc

- `docs/design-docs/2026-02-17-embedding-call-observability.md`

## Completion policy

- A checkbox moves to `[x]` when implementation code and automated tests for that item are complete in the working branch.
- When all exit criteria are met, move the plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/` in the same change.

## Implementation phases

### Phase A: Go SDK core

- [x] Add `EmbeddingStart` and `EmbeddingResult` types in `sdks/go/sigil/embedding.go`.
- [x] Add `EmbeddingCaptureConfig` to `Config` with defaults (`CaptureInput: false`, `MaxInputItems: 20`, `MaxTextLength: 1024`).
- [x] Add `EmbeddingRecorder` type with `SetResult`, `SetCallError`, `End`, `Err` methods.
- [x] Add `Client.StartEmbedding(ctx, EmbeddingStart)` method returning `(ctx, *EmbeddingRecorder)`.
- [x] Set OTel span attributes at start: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.embeddings.dimension.count`, `gen_ai.request.encoding_formats`, `gen_ai.agent.name`, `gen_ai.agent.version`.
- [x] Set OTel span attributes at end: `gen_ai.usage.input_tokens`, `gen_ai.response.model`, `gen_ai.embeddings.input_count`, `error.type`, `error.category`.
- [x] Implement opt-in input text capture: truncate per `EmbeddingCaptureConfig`, set `gen_ai.embeddings.input_texts` on span when enabled.
- [x] Record `gen_ai.client.operation.duration` histogram at end (reuse existing instrument with `gen_ai.operation.name=embeddings`).
- [x] Record `gen_ai.client.token.usage` histogram at end for `input` token type only.
- [x] Skip TTFT and tool_calls_per_operation histograms for embeddings.
- [x] Ensure nil-safety: nil client returns no-op recorder, all recorder methods are nil-safe.
- [x] Add context inheritance for `AgentName` and `AgentVersion` (same as `StartGeneration`).
- [x] Add unit tests for span attributes, metrics, nil-safety, opt-in capture, and truncation.

### Phase B: Go provider wrappers

- [x] Add `EmbeddingsNew` wrapper in `sdks/go-providers/openai/record.go`.
- [x] Add `EmbeddingsFromResponse` mapper in `sdks/go-providers/openai/mapper.go` (extract input count, input tokens, response model from OpenAI response).
- [x] Add mapper tests for `EmbeddingsFromResponse`.
- [x] Add integration-style test for `EmbeddingsNew` (span + metrics assertions).
- [x] Add Gemini embedding wrapper in `sdks/go-providers/gemini/` (if embedding API available in SDK).
- [x] Add Anthropic embedding wrapper in `sdks/go-providers/anthropic/` (N/A: no Anthropic embeddings API in current provider SDK surface).

### Phase C: JS/TS SDK

- [x] Add `EmbeddingStart`, `EmbeddingResult` types in `sdks/js/src/types.ts`.
- [x] Add `EmbeddingCaptureConfig` to client config.
- [x] Add `EmbeddingRecorder` class with `setResult`, `setCallError`, `end`, `err` methods.
- [x] Add `startEmbedding(embeddingStart)` method to client.
- [x] Set all OTel span attributes (same as Go).
- [x] Record duration and token usage metrics.
- [x] Implement opt-in input text capture with truncation.
- [x] Add OpenAI embedding provider wrapper in `sdks/js/src/providers/openai.ts`.
- [x] Add Anthropic and Gemini embedding provider wrappers (Gemini implemented, Anthropic N/A due current provider SDK API availability).
- [x] Add unit tests for span attributes, metrics, nil-safety, opt-in capture, and provider wrappers.

### Phase D: Python SDK

- [x] Add `EmbeddingStart`, `EmbeddingResult` types in `sdks/python/sigil_sdk/types.py`.
- [x] Add `EmbeddingCaptureConfig` to client config.
- [x] Add `EmbeddingRecorder` class with `set_result`, `set_call_error`, `end`, `err` methods.
- [x] Add `start_embedding(embedding_start)` method to client.
- [x] Set all OTel span attributes (same as Go).
- [x] Record duration and token usage metrics.
- [x] Implement opt-in input text capture with truncation.
- [x] Add OpenAI embedding provider wrapper in `sdks/python-providers/openai/`.
- [x] Add Anthropic and Gemini embedding provider wrappers (Gemini implemented, Anthropic N/A due current provider SDK API availability).
- [x] Add unit tests for span attributes, metrics, nil-safety, opt-in capture, and provider wrappers.

### Phase E: Java SDK

- [x] Add `EmbeddingStart`, `EmbeddingResult` types in `sdks/java/core/`.
- [x] Add `EmbeddingCaptureConfig` to client config.
- [x] Add `EmbeddingRecorder` class with `setResult`, `setCallError`, `end`, `err` methods.
- [x] Add `startEmbedding(embeddingStart)` method to client.
- [x] Set all OTel span attributes (same as Go).
- [x] Record duration and token usage metrics.
- [x] Implement opt-in input text capture with truncation.
- [x] Add OpenAI embedding provider wrapper in `sdks/java/providers/openai/`.
- [x] Add Anthropic and Gemini embedding provider wrappers (Gemini implemented, Anthropic N/A due current provider SDK API availability).
- [x] Add unit tests for span attributes, metrics, nil-safety, opt-in capture, and provider wrappers.

### Phase F: .NET SDK

- [x] Add `EmbeddingStart`, `EmbeddingResult` types in `sdks/dotnet/src/Grafana.Sigil/`.
- [x] Add `EmbeddingCaptureConfig` to client config.
- [x] Add `EmbeddingRecorder` class with `SetResult`, `SetCallError`, `End`, `Err` methods.
- [x] Add `StartEmbedding(embeddingStart)` method to client.
- [x] Set all OTel span attributes (same as Go).
- [x] Record duration and token usage metrics.
- [x] Implement opt-in input text capture with truncation.
- [x] Add OpenAI embedding provider wrapper in `sdks/dotnet/src/Grafana.Sigil.OpenAI/`.
- [x] Add Anthropic and Gemini embedding provider wrappers (Gemini implemented, Anthropic N/A due current provider SDK API availability).
- [x] Add unit tests for span attributes, metrics, nil-safety, opt-in capture, and provider wrappers.

### Phase G: Documentation

- [x] Update `sdks/go/README.md` with embedding recording examples.
- [x] Update `sdks/js/README.md` with embedding recording examples.
- [x] Update `sdks/python/README.md` with embedding recording examples.
- [x] Update `sdks/java/README.md` with embedding recording examples.
- [x] Update `sdks/dotnet/README.md` with embedding recording examples.
- [x] Update `ARCHITECTURE.md` with embedding observability coverage.
- [x] Update repository docs with embedding support notes.
- [x] Document opt-in input text capture with PII warnings in all SDK READMEs.
- [x] Add TraceQL query examples for embedding spans to SDK docs.

## Required tests

- Span attribute tests: all OTel standard attributes and custom attributes are set correctly.
- Metrics tests: duration and token usage histograms record with correct attributes and values.
- Nil-safety tests: nil client returns no-op recorder, all recorder methods are nil-safe.
- Opt-in capture tests: texts are truncated per config, attribute is absent when disabled.
- Truncation edge cases: empty texts, texts at exact limit, texts over limit, more items than max.
- Error handling tests: `SetCallError` sets span status, error.type, and error.category correctly.
- Provider wrapper tests: mapper correctly extracts input count, tokens, and response model from provider responses.
- No-ingest test: verify `End()` does NOT call `persistGeneration()`.

## Risks

- OTel GenAI semantic conventions are Development status — attribute names may change before stabilization.
- Not all providers have mature embedding APIs (Anthropic's is limited). Provider wrappers may ship incrementally.
- Opt-in text capture adds span attribute size. Conservative defaults mitigate this.

## Exit criteria

- All 5 SDKs support `StartEmbedding` / `start_embedding` with correct OTel spans and metrics.
- OpenAI provider wrappers are available in all SDKs.
- Opt-in input text capture works with truncation in all SDKs.
- All SDK READMEs document embedding recording with examples.
- `ARCHITECTURE.md` reflects embedding observability coverage.
- All new behaviors are covered by automated tests.

## Out of scope

- Sigil custom ingest, storage, or query for embeddings.
- Output vector capture.
- Embedding quality analysis.
- Plugin UI changes for embedding views.
