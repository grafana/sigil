---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# SDK Conformance Spec

Language-neutral specification of the currently shipped Sigil SDK conformance baseline.

Reference implementation: Go (`sdks/go/sigil/conformance_test.go`, `package sigil_test`).
Provider-wrapper reference implementations:

- OpenAI: `sdks/go-providers/openai/conformance_test.go`
- Anthropic: `sdks/go-providers/anthropic/conformance_test.go`
- Gemini: `sdks/go-providers/gemini/conformance_test.go`

Local entry points:

- `mise run test:sdk:conformance`
- `cd sdks/go && GOWORK=off go test ./sigil -run '^TestConformance' -count=1`
- `cd sdks/go-providers/openai && GOWORK=off go test ./... -run '^TestConformance' -count=1`
- `cd sdks/go-providers/anthropic && GOWORK=off go test ./... -run '^TestConformance' -count=1`
- `cd sdks/go-providers/gemini && GOWORK=off go test ./... -run '^TestConformance' -count=1`

Related docs:

- Semantic conventions: `docs/references/semantic-conventions.md`
- Architecture summary: `ARCHITECTURE.md#sdk-conformance-harness`
- Design doc / future scope: `docs/design-docs/2026-03-12-sdk-conformance-harness.md`

## Current baseline

The shipped Go baseline now has two active layers:

1. Core SDK conformance in `sdks/go/sigil`
2. Provider-wrapper conformance in `sdks/go-providers/{openai,anthropic,gemini}`

The current core scenario set covers nine black-box scenarios:

1. Conversation title semantics
2. User ID semantics
3. Agent identity semantics
4. Streaming mode semantics and TTFT metrics
5. Tool execution semantics
6. Embedding semantics
7. Validation and error semantics
8. Rating submission semantics
9. Shutdown flush semantics

The provider-wrapper layer verifies normalized `sigil.Generation` outputs directly from provider request/response fixtures. It runs with `go test` only and does not require Docker, a Sigil backend, or live provider access.

The core SDK harness still covers the exported client API with local fake receivers. The provider-wrapper layer complements that by asserting mapper and wrapper behavior inside the provider modules.

### Core SDK baseline

The shipped Go core harness covers identity-resolution, validation/error, streaming, tool execution, embedding, rating, and shutdown-flush scenarios. This document only enumerates the scenario contracts that other SDKs are expected to replicate today.

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

## Harness requirements

Every SDK conformance runner that implements this baseline must provide:

1. A fake generation ingest receiver that captures the normalized generation payload as the backend would receive it.
2. Span capture using the SDK's local OpenTelemetry test utilities.
3. Metric capture using the SDK's local OpenTelemetry metric test utilities.
4. A client configured to target only local receivers, with no Docker or external services.
5. A flush/shutdown step before assertions so asynchronous export is complete.

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

These assertions apply to the sync generation scenarios in the current baseline (conversation title, user ID, agent identity, validation, shutdown flush):

- Use the SDK's sync generation entry point.
- Assert `gen_ai.operation.name = "generateText"` on the generation span.
- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Shutdown the client before reading captured generation payloads.

Additional scenario-family invariants:

- Streaming uses the SDK's streaming generation entry point, emits `gen_ai.operation.name = "streamText"`, and records `gen_ai.client.time_to_first_token`.
- Tool execution and embeddings use their dedicated SDK entry points, emit OTel spans and metrics, and do not enqueue generation export payloads.
- Rating submission uses the SDK's HTTP rating helper and does not depend on generation export capture.

## Scenario 1: Conversation title semantics

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

## Scenario 2: User ID semantics

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

## Scenario 3: Agent identity semantics

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

## Scenario 4: Streaming mode semantics and TTFT metrics

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

## Scenario 5: Tool execution semantics

### Setup

- Start tool execution through the dedicated SDK entry point with tool identity, conversation identity, and agent identity.
- End with structured arguments and structured tool result content.

### Expected behavior

- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Assert no generation export.
- Assert span attrs for tool name, tool call ID, tool type, tool call arguments, tool call result, conversation title, agent name, and agent version.

## Scenario 6: Embedding semantics

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

## Scenario 7: Validation and error semantics

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

## Scenario 8: Rating submission semantics

### Setup

- Submit a conversation rating through the SDK's rating helper with rating ID, rating value, comment, and metadata.

### Expected behavior

- Assert rating request `/api/v1/conversations/{conversation_id}/ratings`.
- Assert the request method is `POST`.
- Assert the request body preserves rating ID, rating value, comment, and metadata fields.
- Assert the SDK parses and returns the rating response payload.

## Scenario 9: Shutdown flush semantics

### Setup

- Configure generation export batching so a single generation remains queued before the flush interval.
- Record one sync generation and assert that no export happened yet.
- Call `Shutdown`.

### Expected behavior

- Assert no generation export before `Shutdown`.
- Assert exactly one generation export after `Shutdown`.
- Assert the flushed generation payload matches the recorded conversation identity.

## Extending the spec

Future phases will extend this document with the remaining core gaps (full roundtrip payload coverage, SDK identity protection, metadata/tag merge behavior, resource attributes) plus provider-wrapper and framework-adapter scenarios. Provider-wrapper embedding scenarios apply only when the official provider SDK/API surface exposes a native embedding operation; when it does not, the suite should assert the wrapper's explicit unsupported capability contract instead of fabricating request DTOs or synthetic embedding spans. Until those phases land, this document is the authoritative baseline for the currently shipped Go conformance harness.
