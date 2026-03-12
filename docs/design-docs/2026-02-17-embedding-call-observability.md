---
owner: sigil-core
status: completed
last_reviewed: 2026-02-17
source_of_truth: true
audience: both
---

# Embedding Call Observability

## Problem statement

Sigil SDKs instrument text generation calls (chat completions, responses, streaming) with rich structured data — messages, tool calls, thinking blocks, token usage — exported to Sigil for storage and query. However, there is no support for embedding API calls.

Embedding calls are a core part of RAG pipelines and agent workflows. They represent significant cost and latency:

- A single OpenAI embedding batch can consume up to 300,000 tokens and 2,048 texts.
- Embedding models are called during document indexing, retrieval, and query rewriting.
- Without visibility, operators cannot answer: "What is my embedding latency p99?", "How many tokens are consumed by embedding calls per model?", or "Which agent is making the most embedding calls?"

## Decision summary

1. Use a **traces-only approach**: embedding calls are recorded as OTel spans with standard `gen_ai.*` attributes. No Sigil custom ingest, no new proto, no new storage tables.
2. Reuse **existing metric instruments** (`gen_ai.client.operation.duration`, `gen_ai.client.token.usage`) — embedding calls naturally flow through them with `gen_ai.operation.name = "embeddings"`.
3. Add **one custom span attribute** (`gen_ai.embeddings.input_count`) for batch size visibility.
4. Support **opt-in input text capture** on spans, off by default, with truncation limits.
5. Ship across **all 5 SDKs** (Go, Python, JS/TS, Java, .NET) with provider wrappers for OpenAI, Anthropic, and Gemini embedding APIs.

## Goals

- Add `StartEmbedding` / `start_embedding` recording API to all SDKs.
- Create OTel spans following the GenAI semantic conventions for embedding operations.
- Record embedding duration and token usage on existing metric histograms.
- Provide provider wrappers for OpenAI, Anthropic, and Gemini embedding APIs.
- Support opt-in capture of embedding input texts on spans.

## Non-goals

- Sigil custom ingest for embeddings (no new proto, storage, or query paths).
- Storing output vectors (float arrays are unreadable and already in vector DBs).
- Embedding quality analysis (similarity scores, retrieval recall) — these are properties of the retrieval step, not the embedding call itself.
- Image generation, speech/TTS, or reranking support (future work, same pattern).

## Execution status

Execution for this design is completed and tracked in:

- `docs/exec-plans/completed/2026-02-17-embedding-call-observability.md`

## Industry context

Common patterns across existing tooling:

- Trace-centric systems model embeddings as spans or run nodes linked to the parent workflow.
- Some products expose a dedicated embedding record type, mostly for UI categorization rather than a materially different storage model.
- Proxy-style capture focuses on request and response metadata, while retrieval-quality analysis still happens downstream.

### Key insight

Unlike text generations — where inspecting message content (prompts, responses, tool calls, thinking) is essential for debugging quality — embedding calls are a simple "texts in, vectors out" operation. The observability value is in **metrics** (latency, token usage, cost, error rate) and **trace correlation** (linking embedding calls to parent retrieval/agent spans), not in storing content.

- Input texts are already in the vector DB or source system.
- Output vectors are never useful for observability (nobody reads float arrays).
- Debugging embedding quality happens via retrieval metrics downstream, not by inspecting the embedding call.

This makes traces + metrics the right abstraction, and custom ingest unnecessary.

### OTel GenAI semantic conventions

OTel defines `gen_ai.operation.name = "embeddings"` as a well-known value (status: Development) with a dedicated span attribute set:

| Attribute | Requirement | Description |
|-----------|------------|-------------|
| `gen_ai.operation.name` | Required | `"embeddings"` |
| `gen_ai.provider.name` | Required | Provider identifier (e.g., `"openai"`) |
| `gen_ai.request.model` | Conditionally Required | Model name (e.g., `"text-embedding-3-small"`) |
| `gen_ai.embeddings.dimension.count` | Recommended | Requested output dimensions |
| `gen_ai.request.encoding_formats` | Recommended | Encoding format (e.g., `["float"]`) |
| `gen_ai.usage.input_tokens` | Recommended | Input token count |

Reference: [OTel GenAI Spans — Embeddings](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)

## Embedding span contract

### Span shape

Span name: `embeddings {gen_ai.request.model}` (follows OTel convention `{gen_ai.operation.name} {gen_ai.request.model}`).

Span kind: `CLIENT`.

### Attributes

OTel standard attributes:

| Attribute | Source | When set |
|-----------|--------|----------|
| `gen_ai.operation.name` | `"embeddings"` (constant) | Start |
| `gen_ai.provider.name` | `EmbeddingStart.Model.Provider` | Start |
| `gen_ai.request.model` | `EmbeddingStart.Model.Name` | Start |
| `gen_ai.embeddings.dimension.count` | `EmbeddingStart.Dimensions` | Start (if set) |
| `gen_ai.request.encoding_formats` | `EmbeddingStart.EncodingFormat` | Start (if set) |
| `gen_ai.usage.input_tokens` | `EmbeddingResult.InputTokens` | End |
| `gen_ai.response.model` | `EmbeddingResult.ResponseModel` | End (if available) |
| `error.type` | Error classification | End (on error) |

Existing Sigil custom attributes (same as generations):

| Attribute | Source | When set |
|-----------|--------|----------|
| `gen_ai.agent.name` | `EmbeddingStart.AgentName` or context | Start |
| `gen_ai.agent.version` | `EmbeddingStart.AgentVersion` or context | Start |
| `error.category` | HTTP status mapping | End (on error) |

One new custom attribute:

| Attribute | Source | When set |
|-----------|--------|----------|
| `gen_ai.embeddings.input_count` | `EmbeddingResult.InputCount` | End |

Rationale for `gen_ai.embeddings.input_count`: A single embedding API call can embed 1 text or 2,048 texts. This batch size is critical for cost analysis and throughput planning but is not derivable from token counts alone. The attribute follows the existing `gen_ai.embeddings.*` namespace used by OTel for `dimension.count`.

### No Sigil ingest

`EmbeddingRecorder.End()` finalizes the span and records metrics but does NOT call `persistGeneration()`. There is no Sigil export path for embeddings.

## SDK recording API

### Types

`EmbeddingStart` (seed fields, set before the provider call):

- `Model` (ModelRef — provider + name, **required**)
- `AgentName` (optional string, inherits from context if empty)
- `AgentVersion` (optional string, inherits from context if empty)
- `Dimensions` (optional int — requested output dimensions)
- `EncodingFormat` (optional string — e.g., `"float"`, `"base64"`)
- `Tags` (optional map[string]string)
- `Metadata` (optional map[string]any)
- `StartedAt` (optional time, defaults to now)

`EmbeddingResult` (set after the provider call):

- `InputCount` (int — number of texts in the request)
- `InputTokens` (int64 — total input tokens consumed)
- `InputTexts` (optional []string — raw texts, only captured when opt-in is enabled)
- `ResponseModel` (optional string — actual model name from provider response)
- `Dimensions` (optional int — actual output dimensions, if different from requested)

### Client methods

| SDK | Method | Returns |
|-----|--------|---------|
| Go | `client.StartEmbedding(ctx, EmbeddingStart{...})` | `(ctx, *EmbeddingRecorder)` |
| Python | `client.start_embedding(EmbeddingStart(...))` | context manager / `EmbeddingRecorder` |
| JS/TS | `client.startEmbedding(embeddingStart)` | `EmbeddingRecorder` |
| Java | `client.startEmbedding(embeddingStart)` | `EmbeddingRecorder` |
| .NET | `client.StartEmbedding(embeddingStart)` | `EmbeddingRecorder` |

### Recorder methods

| Method | Description |
|--------|-------------|
| `SetResult(EmbeddingResult)` | Store embedding result data |
| `SetCallError(error)` | Record provider call failure |
| `End()` | Finalize span, record metrics. Idempotent, nil-safe. |
| `Err()` | Return accumulated local errors (validation only) |

The recorder follows the same pattern as `GenerationRecorder` but is simpler: no streaming, no `SetFirstTokenAt`, no message output, no generation ingest.

### Usage pattern

```go
ctx, rec := client.StartEmbedding(ctx, sigil.EmbeddingStart{
    Model: sigil.ModelRef{Provider: "openai", Name: "text-embedding-3-small"},
})
defer rec.End()

resp, err := openaiClient.Embeddings.New(ctx, req)
if err != nil {
    rec.SetCallError(err)
    return err
}

rec.SetResult(sigil.EmbeddingResult{
    InputCount:  len(req.Input),
    InputTokens: resp.Usage.TotalTokens,
    InputTexts:  req.Input, // only captured if CaptureInput is enabled
})
```

## Opt-in input text capture

Following the OTel pattern for `gen_ai.input.messages` (Opt-In for inference spans), the SDK supports opt-in capture of embedding input texts on the span.

### Why off by default

- **Size**: Embedding inputs can be up to 300,000 tokens per batch (~225K words). Span attribute size limits in backends like Tempo default to ~32KB.
- **Privacy**: Embedding inputs often contain user documents with PII.
- **Duplication**: Input texts are already stored in the vector DB or source system.

### Configuration

```go
type EmbeddingCaptureConfig struct {
    CaptureInput  bool // default: false
    MaxInputItems int  // default: 20, cap how many texts to record
    MaxTextLength int  // default: 1024, truncate each text to this many characters
}
```

When `CaptureInput` is enabled:

- `EmbeddingResult.InputTexts` is read and truncated per the configured limits.
- The truncated texts are set as `gen_ai.embeddings.input_texts` (string array) on the span.
- Texts exceeding `MaxTextLength` are truncated with a `...` suffix.
- Only the first `MaxInputItems` texts are included; remaining items are dropped.

When `CaptureInput` is disabled (default), `EmbeddingResult.InputTexts` is ignored and no text attribute is set.

### Sizing analysis

| Scenario | Texts | MaxInputItems=20, MaxTextLength=1024 | Attribute size |
|----------|-------|--------------------------------------|---------------|
| Single query | 1 | 1 text, up to 1KB | ~1KB |
| Small RAG batch | 20 | 20 texts, up to 1KB each | ~20KB |
| Large indexing batch | 500 | 20 texts captured (of 500), up to 1KB each | ~20KB |
| Max API batch | 2048 | 20 texts captured (of 2048), up to 1KB each | ~20KB |

With defaults, the attribute stays under 20KB regardless of batch size. Well within Tempo's 32KB default span attribute limit.

## Metrics

Existing SDK metric instruments cover embeddings with no new instruments needed.

### `gen_ai.client.operation.duration` (existing)

Records embedding call latency with `gen_ai.operation.name = "embeddings"`. Attributes:

- `gen_ai.operation.name`: `"embeddings"`
- `gen_ai.provider.name`
- `gen_ai.request.model`
- `gen_ai.agent.name`
- `error.type` (on error)
- `error.category` (on error)

Example query: `histogram_quantile(0.99, rate(gen_ai_client_operation_duration_bucket{gen_ai_operation_name="embeddings"}[5m]))`

### `gen_ai.client.token.usage` (existing)

Records input token consumption with `gen_ai.token.type = "input"`. Output/cache/reasoning token types are not applicable for embeddings.

Example query: `sum by (gen_ai_request_model) (rate(gen_ai_client_token_usage_sum{gen_ai_operation_name="embeddings"}[5m]))`

### Skipped instruments

- `gen_ai.client.time_to_first_token`: Not applicable (embeddings are not streamed).
- `gen_ai.client.tool_calls_per_operation`: Not applicable (embeddings have no tool calls).

## Provider wrappers

Each provider SDK package gets an embedding wrapper following the existing chat completions pattern.

### Go

```go
// sdks/go-providers/openai/record.go
func EmbeddingsNew(
    ctx context.Context,
    client *sigil.Client,
    provider osdk.Client,
    req osdk.EmbeddingNewParams,
    opts ...Option,
) (*osdk.CreateEmbeddingResponse, error) {
    options := applyOptions(opts)

    ctx, rec := client.StartEmbedding(ctx, sigil.EmbeddingStart{
        AgentName:    options.agentName,
        AgentVersion: options.agentVersion,
        Model:        sigil.ModelRef{Provider: options.providerName, Name: string(req.Model)},
    })
    defer rec.End()

    resp, err := provider.Embeddings.New(ctx, req)
    if err != nil {
        rec.SetCallError(err)
        return nil, err
    }

    rec.SetResult(EmbeddingsFromResponse(req, resp))
    return resp, rec.Err()
}
```

Similar wrappers for:
- Anthropic Voyager models (when embedding API is available)
- Gemini embedding API (`models/text-embedding-004`)

### Other SDKs

Each SDK follows the same pattern adapted to the language:

- **JS/TS**: `openaiEmbeddings(client, openai, params, opts?)` in `sdks/js/src/providers/openai.ts`
- **Python**: `openai_embeddings(client, openai, params, **opts)` in `sdks/python-providers/openai/`
- **Java**: `OpenAIEmbeddings.create(client, openai, params, opts)` in `sdks/java/providers/openai/`
- **.NET**: `OpenAIEmbeddings.CreateAsync(client, openai, params, opts)` in `sdks/dotnet/src/Grafana.Sigil.OpenAI/`

## Error handling

### Error classification

Embedding errors use the same classification as generation errors:

- `error.type`: `provider_call_error`, `mapping_error`, `validation_error`
- `error.category`: `rate_limit`, `server_error`, `auth_error`, `timeout`, `client_error`, `sdk_error`

Provider helpers extract HTTP status codes from embedding API error responses and map them to categories using the same logic as chat completions.

### Nil-safety

All recorder methods are safe to call on a nil or no-op recorder. If `client` is nil, `StartEmbedding` returns a no-op recorder that silently discards all calls. This ensures instrumentation never crashes business logic.

## Observability

SDK-side Prometheus metrics (via OTel → Alloy → Prometheus):

- `gen_ai_client_operation_duration_bucket{gen_ai_operation_name="embeddings", ...}` — latency distribution
- `gen_ai_client_token_usage_sum{gen_ai_token_type="input", gen_ai_operation_name="embeddings", ...}` — token consumption rate

No new metrics are introduced. Embedding calls flow naturally through the existing instruments.

## Alternatives considered

### Separate Embedding entity with Sigil custom ingest

A new `Embedding` proto message, new `ExportEmbeddings` gRPC/HTTP endpoint, new MySQL table, and new compaction block type.

Rejected because:
- The observability value for embeddings is in metrics and traces, not structured content inspection.
- Would require new proto definitions, ingest service, validation, storage, compaction support, query paths, and plugin UI — significant effort for little user value beyond what traces provide.
- Market leaders (LangSmith, Phoenix) treat embeddings as trace spans, not separate entities.

### Extend Generation with EMBEDDING mode

Add `GENERATION_MODE_EMBEDDING` to the existing `GenerationMode` enum, add optional embedding-specific fields to the `Generation` proto.

Rejected because:
- 14 of 28 generation fields are irrelevant for embeddings (conversation_id, mode, response_id, system_prompt, input/output Messages, tools, stop_reason, max_tokens, temperature, top_p, tool_choice, thinking_enabled).
- 5 new fields are needed that don't exist in Generation (input_texts, dimensions, encoding_format, input_count, vector_count).
- The Generation type is already serialized as protobuf bytes in the MySQL WAL — empty fields still contribute to payload overhead.
- Validation, normalization, and query paths would all need mode-aware branching.

### Traces-only (chosen)

OTel spans with standard `gen_ai.*` attributes, existing metric instruments, opt-in content capture.

Chosen because:
- Simplest: no Sigil changes, no new proto, no new storage, no new compaction.
- Aligned with OTel GenAI semantic conventions (`gen_ai.operation.name = "embeddings"` is a well-known value).
- Aligned with market leaders.
- Extensible: if users later need Sigil-native embedding views, lightweight ingest can be added incrementally.

## Risks and mitigations

- **OTel conventions are Development status**: Attribute names may change before stabilization. Mitigated by using well-known values already adopted by the ecosystem, and by following the `OTEL_SEMCONV_STABILITY_OPT_IN` opt-in mechanism.
- **No Sigil-native embedding list/query**: Users who want "show me all embedding calls for this conversation" must use Tempo/TraceQL. Mitigated by documenting TraceQL query examples and by keeping the door open for lightweight ingest in the future.
- **Opt-in text capture size**: Even with truncation, 20 texts at 1KB each adds 20KB to a span. Mitigated by conservative defaults and clear documentation.
- **Provider wrapper coverage**: Not all providers have embedding APIs (Anthropic's is limited). Mitigated by starting with OpenAI (most common) and adding providers as their APIs mature.

## Future considerations

- If users need Sigil-native embedding list/detail views, add a lightweight ingest path with a slim `Embedding` proto.
- Image generation, speech/TTS, and reranking operations follow the same pattern: traces + metrics first, custom ingest only if structured content inspection is needed.
- OTel may add `gen_ai.embeddings.input_count` to the standard; if so, migrate from custom attribute to standard.

## Out of scope

- Sigil custom ingest, storage, or query for embeddings.
- Output vector capture.
- Embedding quality analysis (similarity scores, retrieval metrics).
- Provider-specific features beyond standard embedding APIs.
- Plugin UI changes for embedding-specific views.
