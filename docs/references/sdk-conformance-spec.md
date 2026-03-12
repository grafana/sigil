---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# SDK Conformance Spec

Language-neutral specification of the currently shipped Sigil SDK core conformance baseline.

Reference implementation: Go core (`sdks/go/sigil/conformance_test.go`, `package sigil_test`).
Provider-wrapper reference implementations:

- OpenAI: `sdks/go-providers/openai/conformance_test.go`
- Anthropic: `sdks/go-providers/anthropic/conformance_test.go`
- Gemini: `sdks/go-providers/gemini/conformance_test.go`

Local entry points:

- `mise run sdk:conformance`
- `mise run test:sdk:conformance`
- `mise run test:go:sdk-conformance`
- `mise run test:ts:sdk-conformance`
- `mise run test:py:sdk-conformance`
- `mise run test:java:sdk-conformance`
- `mise run test:cs:sdk-conformance`
- `cd sdks/go && GOWORK=off go test ./sigil -run '^TestConformance' -count=1`
- `cd sdks/go-frameworks/google-adk && GOWORK=off go test ./... -run '^TestConformance' -count=1`
- `cd sdks/go-providers/openai && GOWORK=off go test ./... -run '^TestConformance' -count=1`
- `cd sdks/go-providers/anthropic && GOWORK=off go test ./... -run '^TestConformance' -count=1`
- `cd sdks/go-providers/gemini && GOWORK=off go test ./... -run '^TestConformance' -count=1`

Related docs:

- Semantic conventions: `docs/references/semantic-conventions.md`
- Architecture summary: `ARCHITECTURE.md#sdk-conformance-harness`
- Design doc / future scope: `docs/design-docs/2026-03-12-sdk-conformance-harness.md`

## Current baseline

The repo now ships three active conformance layers:

1. Core SDK conformance across Go, TypeScript/JavaScript, Python, Java, and .NET
2. Go provider-wrapper conformance in `sdks/go-providers/{openai,anthropic,gemini}`
3. Go framework-adapter conformance in `sdks/go-frameworks/google-adk`

The current shared core scenario set covers ten black-box scenarios:

1. Sync roundtrip semantics
2. Conversation title semantics
3. User ID semantics
4. Agent identity semantics
5. Streaming mode semantics and TTFT metrics
6. Tool execution semantics
7. Embedding semantics
8. Validation and error semantics
9. Rating submission semantics
10. Shutdown flush semantics

The provider-wrapper layer verifies normalized `sigil.Generation` outputs directly from provider request/response fixtures. It runs with `go test` only and does not require Docker, a Sigil backend, or live provider access.

The framework-adapter layer verifies framework lifecycle propagation, parent/child span linkage, framework metadata/tag projection, generation triggering, and explicit unsupported embedding contracts when the framework surface does not expose a first-class embeddings lifecycle.

The core SDK harness now runs across Go, TypeScript/JavaScript, Python, Java, and .NET using the same language-neutral contract. The provider-wrapper layer complements that by asserting mapper and wrapper behavior inside the Go provider modules.

### Core SDK baseline

The shipped core harness covers sync roundtrip, identity-resolution, validation/error, streaming, tool execution, embedding, rating, and shutdown-flush scenarios. This document enumerates the scenario contracts that the five shipped core SDK suites now replicate.

### Provider-wrapper baseline

The shipped Go provider-wrapper baseline covers:

- Sync normalization for OpenAI, Anthropic, and Gemini
- Streaming normalization for OpenAI, Anthropic, and Gemini
- Usage fields including provider-specific cache/reasoning metadata
- Stop reason mapping
- Tool call normalization
- Thinking content normalization where the provider exposes it as content
- Raw artifact capture behind explicit opt-in
- Explicit mapping-error behavior for invalid response/stream inputs
- Wrapper-level error semantics for provider failures and mapper failures without live providers

Each scenario is executed through exported SDK entry points and validates behavior across the same localhost-only capture harness:

- generation export payloads captured from a fake local gRPC ingest server
- OTLP spans captured with the SDK's in-memory span recorder
- OTLP metrics captured with the SDK's in-memory metric reader
- HTTP rating requests captured from a fake local API server when the scenario exercises ratings

### Framework-adapter baseline

The shipped Go framework-adapter baseline currently covers Google ADK run lifecycle, streaming lifecycle, tool-call observability, parent-child span linkage, framework metadata/tag propagation, and explicit unsupported embedding behavior.

## Harness requirements

Every SDK conformance runner that implements this baseline must provide:

1. A fake generation ingest receiver that captures the normalized generation payload as the backend would receive it.
2. Span capture using the SDK's local OpenTelemetry test utilities.
3. Metric capture using the SDK's local OpenTelemetry metric test utilities.
4. A fake rating HTTP server that captures request method, path, headers, and body.
5. A client configured to target only local receivers, with no Docker or external services.
6. A flush/shutdown step before assertions so asynchronous export is complete.

## Assertion conventions

- "Assert proto metadata `X = Y`" means the captured generation payload contains metadata key `X` with string value `Y`.
- "Assert proto field `X = Y`" means the captured normalized generation payload has field `X` set to `Y`.
- "Assert span attr `X = Y`" means the captured span has attribute key `X` with value `Y`.
- "Assert span attr `X` absent" means the captured span does not contain attribute `X`.
- "Assert metric `M` has data" means the named histogram has at least one data point.
- "Assert metric `M` absent" means the named histogram is not emitted for the scenario.
- "Assert no generation export" means the fake ingest server received zero generation export requests for the scenario.
- "Assert rating request `P`" means the fake rating server observed an HTTP request on path `P`.

## Common invariants for generation scenarios

These assertions apply to the sync generation scenarios in the current baseline (sync roundtrip, conversation title, user ID, agent identity, validation, shutdown flush):

- Use the SDK's sync generation entry point.
- Assert `gen_ai.operation.name = "generateText"` on the generation span.
- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Shutdown the client before reading captured generation payloads.

Additional scenario-family invariants:

- Streaming uses the SDK's streaming generation entry point, emits `gen_ai.operation.name = "streamText"`, and records `gen_ai.client.time_to_first_token`.
- Tool execution and embeddings use their dedicated SDK entry points, emit OTel spans and metrics, and do not enqueue generation export payloads.
- Rating submission uses the SDK's HTTP rating helper and does not depend on generation export capture.

## Scenario 1: Sync roundtrip semantics

### Setup

- Use the SDK's sync generation entry point.
- Record one representative normalized generation through the public API.
- Use gRPC ingest capture for the reference assertion path.

### Expected behavior

- Assert proto field `mode = GENERATION_MODE_SYNC`.
- Assert proto field `operation_name = "generateText"`.
- Assert proto field `conversation_id` preserves the explicit conversation ID.
- Assert proto field `agent_name` preserves the resolved agent name.
- Assert proto field `agent_version` preserves the resolved agent version.
- Assert proto field `trace_id` matches the finished generation span trace ID.
- Assert proto field `span_id` matches the finished generation span span ID.
- Assert proto request and response content preserves text, thinking, tool call, and tool result parts.
- Assert proto request controls preserve `max_tokens`, `temperature`, `top_p`, `tool_choice`, and `thinking_enabled`.
- Assert tool definitions preserve `name`, `description`, `type`, `input_schema_json`, and `deferred`.
- Assert proto usage preserves input/output/total/cache read/cache write/cache creation/reasoning token counts when the SDK supports those counters.
- Assert proto stop reason, merged tags, merged metadata, and artifacts are preserved.
- Assert proto metadata `sigil.sdk.name` is stamped by the SDK with the canonical runtime identity value and overrides conflicting caller-provided values.
- Assert span attr `gen_ai.operation.name = "generateText"`.
- Assert span attr `sigil.sdk.name` equals the canonical runtime identity value.
- Assert metric `gen_ai.client.operation.duration` has data.
- Assert metric `gen_ai.client.token.usage` has data.
- Assert metric `gen_ai.client.time_to_first_token` absent.

## Scenario 2: Conversation title semantics

### Setup matrix

| Case | Start conversation title | Context conversation title | Metadata `sigil.conversation.title` | Expected resolved title |
|---|---|---|---|---|
| explicit wins | `"Explicit"` | `"Context"` | `"Meta"` | `"Explicit"` |
| context fallback | `""` | `"Context"` | absent | `"Context"` |
| metadata fallback | `""` | absent | `"Meta"` | `"Meta"` |
| whitespace omitted | `"   "` | absent | absent | absent |

### Expected behavior

- Assert span attr `sigil.conversation.title` equals the resolved title when present.
- Assert span attr `sigil.conversation.title` is absent when the resolved title is empty.
- Assert proto metadata `sigil.conversation.title` equals the resolved title when present.
- Assert proto metadata `sigil.conversation.title` is absent when the resolved title is empty.

## Scenario 3: User ID semantics

### Setup matrix

| Case | Start user ID | Context user ID | Metadata `sigil.user.id` | Metadata `user.id` | Expected resolved user ID |
|---|---|---|---|---|---|
| explicit wins | `"explicit"` | `"ctx"` | `"canonical"` | `"legacy"` | `"explicit"` |
| context fallback | `""` | `"ctx"` | absent | absent | `"ctx"` |
| canonical metadata | `""` | absent | `"canonical"` | absent | `"canonical"` |
| legacy metadata | `""` | absent | absent | `"legacy"` | `"legacy"` |
| canonical beats legacy | `""` | absent | `"canonical"` | `"legacy"` | `"canonical"` |
| whitespace trimmed | `"  padded  "` | absent | absent | absent | `"padded"` |

### Expected behavior

- Assert span attr `user.id` equals the resolved user ID.
- Assert proto metadata `sigil.user.id` equals the resolved user ID.

## Scenario 4: Agent identity semantics

### Setup matrix

| Case | Start agent name | Start agent version | Context agent name | Context agent version | Result agent name | Result agent version | Expected name | Expected version |
|---|---|---|---|---|---|---|---|---|
| explicit fields | `"agent-explicit"` | `"v1.2.3"` | absent | absent | absent | absent | `"agent-explicit"` | `"v1.2.3"` |
| context fallback | `""` | `""` | `"agent-context"` | `"v-context"` | absent | absent | `"agent-context"` | `"v-context"` |
| result-time override | `"agent-seed"` | `"v-seed"` | absent | absent | `"agent-result"` | `"v-result"` | `"agent-result"` | `"v-result"` |
| empty omission | `""` | `""` | absent | absent | absent | absent | absent | absent |

### Expected behavior

- Assert span attr `gen_ai.agent.name` equals the resolved name when present.
- Assert span attr `gen_ai.agent.name` is absent when the resolved name is empty.
- Assert span attr `gen_ai.agent.version` equals the resolved version when present.
- Assert span attr `gen_ai.agent.version` is absent when the resolved version is empty.
- Assert proto field `agent_name` equals the resolved name when present, otherwise empty.
- Assert proto field `agent_version` equals the resolved version when present, otherwise empty.

## Provider-wrapper scenarios

### Common expectations

Every provider-wrapper conformance suite should:

- Use in-process request/response or stream fixtures only.
- Assert the normalized `Generation` shape returned by the mapper.
- Cover both sync and streaming code paths for the provider package.
- Assert usage, stop reason, tool calls, and raw artifact opt-in behavior.
- Assert mapping errors for malformed or missing provider responses/streams.
- Assert wrapper-level error semantics without live provider access:
  - provider call failures are returned unchanged
  - mapper failures do not discard the native provider response

### OpenAI provider baseline

OpenAI has two normalization paths under test:

- Chat Completions:
  - sync mapping of text + tool calls, reasoning-enabled request controls, usage, stop reason, and request/response/tools artifacts
  - streaming mapping of accumulated text + tool calls, usage, stop reason, and request/tools/provider-event artifacts
- Responses API:
  - sync mapping of text + tool calls, reasoning-enabled request controls, usage, stop reason, and request/response artifacts
  - streaming mapping of accumulated text, stop reason, and request/provider-event artifacts

OpenAI currently treats reasoning as controls/tokens rather than emitting a distinct `ThinkingPart`.

### Anthropic provider baseline

Anthropic message conformance covers:

- sync mapping of text, `ThinkingPart`, tool calls, usage, stop reason, and request/response/tools artifacts
- streaming mapping of accumulated `ThinkingPart`, accumulated text, accumulated tool-call JSON, usage, stop reason, and request/tools/provider-event artifacts
- wrapper error semantics for provider failures and mapper failures

### Gemini provider baseline

Gemini generate-content conformance covers:

- sync mapping of `ThinkingPart`, tool calls, text output, usage, stop reason, and request/response/tools artifacts
- streaming mapping of accumulated `ThinkingPart`, tool calls, text output, usage, stop reason, and request/tools/provider-event artifacts
- wrapper error semantics for provider failures and mapper failures

## Scenario 5: Streaming mode semantics and TTFT metrics

### Setup

- Start a streaming generation through the SDK's streaming entry point.
- Record first-token timing before ending the recorder.
- End with a single assistant text output and token usage.

### Expected behavior

- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` has data.
- Assert proto field `mode = GENERATION_MODE_STREAM`.
- Assert proto field `operation_name = "streamText"`.
- Assert the exported output preserves the stitched assistant text.
- Assert the recorded span name is `streamText <model>`.

## Scenario 6: Tool execution semantics

### Setup

- Start tool execution through the dedicated SDK entry point with tool identity, conversation identity, and agent identity.
- End with structured arguments and structured tool result content.

### Expected behavior

- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Assert no generation export.
- Assert span attrs for tool name, tool call ID, tool type, tool call arguments, tool call result, conversation title, agent name, and agent version.

## Scenario 7: Embedding semantics

### Setup

- Start an embedding operation through the dedicated SDK entry point with explicit dimensions and encoding format.
- End with embedding result metadata including input count, input tokens, response model, and dimensions.

### Expected behavior

- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.token.usage` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Assert `gen_ai.client.tool_calls_per_operation` is absent.
- Assert no generation export.
- Assert span attrs for agent identity, embedding input count, and embedding dimension count.

## Scenario 8: Validation and error semantics

### Setup matrix

| Case | Entry point | Result | Expected local error | Expected export |
|---|---|---|---|---|
| invalid generation | sync generation | invalid input message shape | `ErrValidationFailed` | none |
| provider call error | sync generation | `SetCallError("provider unavailable")` | nil | one generation payload with call error |

### Expected behavior

- Invalid generations fail locally with `ErrValidationFailed`.
- Invalid generations record span attr `error.type = "validation_error"` and do not export a generation payload.
- Provider call errors record span attr `error.type = "provider_call_error"`.
- Provider call errors export proto field `call_error` and metadata key `call_error` with the provider error message.

## Scenario 9: Rating submission semantics

### Setup

- Submit a conversation rating through the SDK's rating helper with rating ID, rating value, comment, and metadata.

### Expected behavior

- Assert rating request `/api/v1/conversations/{conversation_id}/ratings`.
- Assert the request method is `POST`.
- Assert the request body preserves rating ID, rating value, comment, and metadata fields.
- Assert the SDK parses and returns the rating response payload.

## Scenario 10: Shutdown flush semantics

### Setup

- Configure generation export batching so a single generation remains queued before the flush interval.
- Record one sync generation and assert that no export happened yet.
- Call `Shutdown`.

### Expected behavior

- Assert no generation export before `Shutdown`.
- Assert exactly one generation export after `Shutdown`.
- Assert the flushed generation payload matches the recorded conversation identity.

## Go provider wrapper baseline

The shipped Go provider baseline now has two complementary assertion styles in each provider package:

1. Direct normalization assertions against the returned `sigil.Generation` or `sigil.EmbeddingResult`
2. Recorder-path assertions that route the normalized result through the real Go Sigil client and validate the exported generation payload and emitted spans via `sdks/go/sigil/sigiltest`

### Provider scenarios

Every shipped Go provider suite should cover these behaviors when the provider surface exists:

- Sync mapping: request/response pairs normalize the expected model, prompts, input, output, and tags.
- Streaming mapping: streamed provider summaries preserve accumulated output, final usage, and stop reason.
- Tool semantics: provider tool calls become `tool_call` parts and provider tool outputs become `tool_result` parts.
- Reasoning semantics: provider reasoning/thinking content is preserved when the provider surface emits that content.
- Usage semantics: provider-specific token fields such as cache, reasoning, or tool-use tokens are preserved.
- Error semantics: mapper validation failures stay local, and provider API failures routed via `SetCallError` preserve call error text plus the expected span error category on the recorder path.
- Artifact semantics: direct normalization suites validate raw artifact opt-in coverage where the provider exposes it.
- Embedding semantics: embedding wrappers emit normalized embedding results and recorder-path embedding spans with the expected input count and dimensions.

### Current Go scope notes

- OpenAI: chat-completions, responses, recorder-path, error, and embedding coverage are shipped.
- Gemini: direct normalization, recorder-path, error, and embedding coverage are shipped.
- Anthropic: direct normalization, recorder-path, and error coverage are shipped. Embedding coverage is not applicable until the Anthropic provider wrapper exposes an embedding API surface in this repository.

## Go framework adapter extension: Google ADK

The Go repo now ships the first framework-adapter conformance suite for
`sdks/go-frameworks/google-adk`.

### Scenario 10: Framework run lifecycle semantics

### Setup

- Create a local-only Sigil client with HTTP generation export pointed at an
  `httptest.Server`, plus in-memory OTel span and metric capture.
- Create a parent framework span with:
  - `sigil.framework.name = "google-adk"`
  - `sigil.framework.source = "handler"`
  - `sigil.framework.language = "go"`
- Create callbacks via `googleadk.NewCallbacks(client, opts)`.
- Drive one sync run via `OnRunStart(ctx, RunStartEvent{...})` then
  `OnRunEnd(runID, RunEndEvent{...})`.

### Expected behavior

- Assert a generation export is emitted with one generation payload.
- Assert the generation span is a child of the supplied framework parent span.
- Assert exported `trace_id` and `span_id` match the emitted generation span.
- Assert generation tags include:
  - `sigil.framework.name = "google-adk"`
  - `sigil.framework.source = "handler"`
  - `sigil.framework.language = "go"`
- Assert framework metadata is propagated into generation metadata when present:
  - `sigil.framework.run_id`
  - `sigil.framework.run_type`
  - `sigil.framework.thread_id`
  - `sigil.framework.parent_run_id`
  - `sigil.framework.component_name`
  - `sigil.framework.retry_attempt`
  - `sigil.framework.event_id`
  - `sigil.framework.tags`
- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent for the sync run.

### Scenario 11: Framework streaming semantics

### Setup

- Reuse the same local-only harness.
- Drive one stream run via `OnRunStart(Stream=true, ...)`, `OnRunToken(...)`, and
  `OnRunEnd(...)`.

### Expected behavior

- Assert the generated export payload uses `operation_name = "streamText"`.
- Assert streaming output chunks are stitched into one assistant text output when
  `OnRunEnd` does not provide explicit output messages.
- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` has data.

### Framework embedding applicability

Framework-adapter embedding scenarios apply only when the framework surface
exposes a first-class embeddings lifecycle that the Sigil adapter can observe.
When the framework does not expose that lifecycle, the conformance suite should
assert the adapter's explicit unsupported capability contract instead of
fabricating synthetic embedding callbacks or spans.

Current Go scope note:

- Google ADK: run and tool lifecycle conformance is shipped. Embedding
  conformance is currently not applicable because the Google ADK lifecycle
  surface used in this repository does not expose a dedicated embeddings
  callback, so the suite asserts `CheckEmbeddingsSupport()`.

## Extending the spec

Future phases will extend this document with the remaining core gaps (resource
attributes and any newly exported transport fields) plus provider-wrapper and
framework-adapter scenarios in other languages. Provider-wrapper embedding scenarios apply only
when the official provider SDK or API surface exposes a native embedding
operation; when it does not, the suite should assert the wrapper's explicit
unsupported capability contract instead of fabricating request DTOs or
synthetic embedding spans. Framework-adapter embedding scenarios follow the
same rule for framework lifecycle surfaces. Until those phases land, this
document is the authoritative baseline for the currently shipped Go core
harnesses, Go provider conformance harnesses, and the first Go
framework-adapter suite (`google-adk`).
