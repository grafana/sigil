---
owner: sigil-core
status: active
last_reviewed: 2026-02-22
source_of_truth: true
audience: both
---

# SDK Vercel AI SDK Integration (TypeScript)

## Problem statement

Sigil has first-class framework integrations for LangChain, LangGraph, OpenAI Agents, LlamaIndex, and Google ADK. Teams using Vercel AI SDK (TypeScript) still need manual instrumentation decisions for generation export, trace/span attributes, usage metrics, and tool lifecycle capture.

Without an official integration contract for AI SDK, teams will produce inconsistent `conversation_id` mapping, inconsistent framework metadata keys, and non-deterministic start/end correlation for streaming and tool events.

## Decision summary

1. Add first-class Vercel AI SDK TypeScript integration in `sdks/js`.
2. Keep Sigil generation export as source of truth (conversation-first).
3. Default to Sigil-native instrumentation (spans + metrics + generations) without requiring AI SDK telemetry.
4. Support optional AI SDK telemetry (`experimental_telemetry`) as supplemental OTel enrichment.
5. Keep framework lineage IDs optional in metadata/span attributes; do not force a thread/run-only model.
6. Preserve generation ingest/query contracts (`ExportGenerations` gRPC and `POST /api/v1/generations:export`) unchanged.

## Goals

- Provide an idiomatic AI SDK integration path using middleware and wrapped model APIs.
- Emit Sigil generations for `generateText` and `streamText` flows.
- Emit Sigil spans and metrics with deterministic lifecycle closure for success, error, and abort paths.
- Capture tool execution spans and generation attributes where AI SDK exposes tool lifecycle signals.
- Keep setup simple (quick-start) while preserving customization hooks.

## Non-goals

- Core API/proto changes in Sigil ingest/query services.
- Python/Go/Java AI SDK integration in this workstream.
- Forcing users to enable AI SDK telemetry to get Sigil data.
- Building a cross-framework abstraction layer that hides framework-native concepts.

## Framework scope

- Framework: Vercel AI SDK (TypeScript), current docs track (`ai-sdk.dev`, v6 docs).
- Primary operations in scope:
  - `generateText`
  - `streamText`
- Compatibility baseline:
  - AI SDK middleware (`LanguageModelV3Middleware`) and wrapped model usage (`wrapLanguageModel`).
  - Optional per-call telemetry settings via `experimental_telemetry`.

Reference docs:

- AI SDK middleware: <https://ai-sdk.dev/docs/ai-sdk-core/middleware>
- AI SDK `generateText`: <https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text>
- AI SDK `streamText`: <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>
- AI SDK telemetry: <https://ai-sdk.dev/docs/ai-sdk-core/telemetry>

## Architecture and packaging decisions

### Boundary rule

- Core Sigil JS runtime remains framework-agnostic.
- AI SDK integration lives in framework module(s) under `sdks/js/src/frameworks/` and depends on core runtime.

### Module layout

- `sdks/js/src/frameworks/vercel-ai-sdk/`
  - handler/adapter implementation
  - middleware helpers
  - type surface for options and resolvers
- public import subpath:
  - `@grafana/sigil-sdk-js/vercel-ai-sdk`

### Public integration surface (planned)

- `createSigilVercelAiSdkMiddleware(client, options)`
  - returns AI SDK-compatible middleware.
- `withSigilVercelAiSdk(model, client, options)`
  - convenience wrapper around `wrapLanguageModel` for one-liner onboarding.
- `buildSigilTelemetrySettings(context)` (optional helper)
  - returns `experimental_telemetry` config for hybrid mode.

No unified cross-framework API is introduced.

## Data model and mapping contract

## Canonical framework identity

All generated spans/generations include:

- `sigil.framework.name = "vercel-ai-sdk"`
- `sigil.framework.source = "framework"`
- `sigil.framework.language = "typescript"`

## Conversation identity

`conversation_id` precedence order:

1. Explicit Sigil integration option (`conversationId`).
2. User resolver output (`resolveConversationId`) from call context.
3. Known app/session keys passed in context metadata:
   - `conversationId`
   - `chatId`
   - `sessionId`
4. AI SDK UI chat id when available in app wiring.
5. Deterministic fallback:
   - `sigil:framework:vercel-ai-sdk:<root_run_id>`

Notes:

- `thread_id` is optional lineage metadata, not a required identity for this integration.
- If `thread_id` is meaningful and available, keep it as supporting metadata.

## Generation field mapping

| Sigil generation field | Source in AI SDK flow | Notes |
|---|---|---|
| `conversation_id` | precedence resolver above | deterministic fallback required |
| `provider` | model/provider resolution | use explicit override if configured |
| `model` | model id from call/model object | normalize to provider/model contract |
| `mode` | operation type | `SYNC` for `generateText`, `STREAM` for `streamText` |
| `input` | call params/messages | gated by `captureInputs` |
| `output` | final response text/messages | gated by `captureOutputs` |
| `usage.input_tokens` | `usage.inputTokens`/`usage.promptTokens` equivalents | mapped to Sigil canonical token usage |
| `usage.output_tokens` | `usage.outputTokens`/`usage.completionTokens` equivalents | mapped to Sigil canonical token usage |
| `usage.total_tokens` | `usage.totalTokens` | fallback to sum if absent |
| `stop_reason` | finish/stop reason fields | optional |
| `error` | exception/abort payload | classify to `error.type` / `error.category` |

## Span attributes and metrics mapping

### Span attributes

Required span attributes:

- `gen_ai.operation.name` (`generateText`, `streamText`, `execute_tool`)
- `gen_ai.provider.name`
- `gen_ai.request.model`
- `gen_ai.conversation.id`
- framework attributes (`sigil.framework.*`)

Optional span attributes (low-cardinality only):

- `sigil.framework.run_id`
- `sigil.framework.parent_run_id`
- `sigil.framework.thread_id`
- `sigil.framework.component_name`
- `sigil.framework.event_id`
- `error.type`
- `error.category`

High-cardinality payload content remains in generation metadata/content, not span attrs.

### Metrics

Use existing Sigil SDK metric instruments:

- `gen_ai.client.operation.duration`
- `gen_ai.client.token.usage`
- `gen_ai.client.time_to_first_token` (streaming)
- `gen_ai.client.tool_calls_per_operation`

## Metadata mapping

Generation metadata includes normalized framework metadata when available:

- `sigil.framework.run_id`
- `sigil.framework.parent_run_id`
- `sigil.framework.thread_id`
- `sigil.framework.component_name`
- `sigil.framework.run_type`
- `sigil.framework.event_id`
- `sigil.framework.retry_attempt`

Normalization requirements:

- bounded depth
- circular-safe
- deterministic primitive conversion
- invalid date/object handling should not break callback execution

## Lifecycle mapping

## `generateText` flow (`SYNC`)

1. Create generation/span context and stable run id.
2. Capture input payload if enabled.
3. Execute wrapped call.
4. Capture final output, usage, finish reason.
5. Emit tool spans if tool call/result structures are available in result.
6. End generation/span/metrics exactly once.

## `streamText` flow (`STREAM`)

1. Create generation/span context and stable run id.
2. Capture input payload if enabled.
3. Process stream chunks/events:
   - record first token timestamp (TTFT)
   - aggregate output chunks when output capture enabled
   - correlate tool-call and tool-result events
4. Finalize on finish event with usage and finish reason.
5. On stream error/abort, classify error and end generation/span exactly once.

## Tool lifecycle mapping

- Start tool span when tool invocation event is observed.
- End tool span on corresponding result/error event.
- For id-less tool events, synthesize stable fallback ids and persist lookup mapping until closure.

## Error and abort behavior

- Never swallow recorder finalization errors by default.
- Abort/error paths must end all started generation/tool spans.
- Duplicate callback delivery must be deduplicated atomically per run/tool id.

## Integration modes

## Mode A: Sigil-native (default)

- Sigil middleware emits generations, spans, and metrics directly.
- No dependency on `experimental_telemetry`.
- Trace-generation correlation is maintained via active span context (`trace_id` / `span_id` linkage).

## Mode B: Hybrid telemetry (optional)

- Keep Sigil-native generation export as source of truth.
- Add AI SDK `experimental_telemetry` for additional OTel span enrichment.
- Ensure capture flags are consistent between Sigil options and telemetry settings (`recordInputs`, `recordOutputs`).
- Include Sigil correlation metadata in telemetry metadata when configured.

Telemetry caveat:

- AI SDK telemetry is documented as experimental; Sigil correctness must not depend on it.

## Options contract (planned)

- `agentName?`
- `agentVersion?`
- `providerResolver?`
- `captureInputs` (default `true`)
- `captureOutputs` (default `true`)
- `extraTags?`
- `extraMetadata?`
- `conversationId?`
- `resolveConversationId?(context) => string | undefined`
- `resolveThreadId?(context) => string | undefined`
- `telemetryBridge?` (off by default)

## Documentation requirements for implementation phase

- Framework guide at `sdks/js/docs/frameworks/vercel-ai-sdk.md` including:
  - quickstart one-liner
  - middleware-first wiring
  - streaming and tool examples
  - conversation mapping example
  - capture controls and privacy notes
  - telemetry hybrid mode example
  - troubleshooting section

## Testing and acceptance criteria

Required test categories:

- unit tests for mapping functions and metadata normalization
- integration-style tests for `generateText` and `streamText` lifecycles
- regression tests for id-less event fallback correlation
- capture toggles (`captureInputs`, `captureOutputs`) for model and tool payloads
- error/abort lifecycle closure tests
- hybrid mode tests ensuring telemetry bridge does not alter generation correctness

Acceptance criteria:

- conversation-first mapping deterministic and documented
- tool and generation lifecycles close correctly under concurrent/eventful flows
- generation export contains required framework metadata and trace correlation
- docs snippets compile against published TypeScript types

## Risks

- AI SDK callback/event payload shapes may evolve between versions.
- Streaming tool event correlation can be brittle for id-less payloads without stable fallback mapping.
- Dual instrumentation (Sigil + telemetry) can create duplicated spans if not clearly scoped.
- High-cardinality metadata drift if allowlist/normalization rules are not enforced.

## Explicit assumptions and defaults

- TypeScript Vercel AI SDK only in this workstream.
- Sigil generation export remains primary source of truth.
- Optional lineage metadata is preserved when available; not required.
- No schema changes to Sigil generation ingest/query contracts.
