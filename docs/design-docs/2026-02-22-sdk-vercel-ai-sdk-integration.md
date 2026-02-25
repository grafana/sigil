---
owner: sigil-core
status: completed
last_reviewed: 2026-02-23
source_of_truth: true
audience: both
---

# SDK Vercel AI SDK Integration (TypeScript)

## Problem statement

Sigil has first-class framework integrations for LangChain, LangGraph, OpenAI Agents, LlamaIndex, and Google ADK. Teams using Vercel AI SDK (TypeScript) still need a way to get Sigil generation export, spans, and metrics without changing how they use the AI SDK.

Without an integration, teams instrument manually, producing inconsistent `conversation_id` values, missing token usage, no tool execution spans, and no TTFT for streaming flows.

## Decision summary

1. Add first-class Vercel AI SDK TypeScript integration in `sdks/js`.
2. Sigil must not touch the user's model. Users keep whatever model and provider they already use.
3. Integration is purely callback/hook-based: users spread Sigil hooks into their existing `generateText` and `streamText` calls.
4. One `GenerationRecorder` lifecycle per step (model call) covers generation export, OTel span, and metrics automatically.
5. Tool execution spans are captured via AI SDK's `experimental_onToolCallStart` / `experimental_onToolCallFinish` callbacks — no model wrapping needed.
6. AI SDK `experimental_telemetry` is not used. It creates competing spans with conflicting naming and adds no value on top of what the hook-based integration already captures.
7. `conversation_id` must be provided explicitly by the caller for multi-turn continuity — AI SDK has no server-side conversation identity.
8. Preserve generation ingest/query contracts (`ExportGenerations` gRPC and `POST /api/v1/generations:export`) unchanged.

## Goals

- Provide a hook-based integration that works with any AI SDK model and provider without modification.
- Emit Sigil generations, spans, and metrics for `generateText` and `streamText` flows, including multi-step agentic loops.
- Capture tool execution spans and timing via AI SDK's native tool lifecycle callbacks.
- Keep setup to a one-time factory call and a single spread per `generateText` / `streamText` invocation.
- Be honest about what AI SDK exposes server-side (no implicit conversation detection).

## Non-goals

- Core API/proto changes in Sigil ingest/query services.
- Python/Go/Java AI SDK integration in this workstream.
- Wrapping or replacing the user's AI SDK language model.
- Using `experimental_telemetry` for Sigil data capture.
- Embedding model instrumentation (`embed`, `embedMany`) — AI SDK has no callback equivalent for embedding calls; deferred to a separate workstream.

## Framework scope

- Framework: Vercel AI SDK (TypeScript), `ai` package v5.
- Middleware type: `LanguageModelV3Middleware` from `@ai-sdk/provider` — not used in this integration but referenced for completeness.
- Primary operations in scope: `generateText`, `streamText`.
- Agentic loops (multi-step `generateText`/`streamText` with `stopWhen`) are first-class, not an afterthought.
- Note: `experimental_onStepStart`, `experimental_onToolCallStart`, `experimental_onToolCallFinish` are v5 additions marked experimental in AI SDK; they can break in patch releases. Pin to a tested minor version and document this risk.

Reference docs:

- AI SDK generateText: <https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text>
- AI SDK streamText: <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>
- AI SDK middleware: <https://ai-sdk.dev/docs/ai-sdk-core/middleware>

## Architecture and packaging decisions

### Boundary rule

- Core Sigil JS runtime remains framework-agnostic.
- AI SDK integration lives under `sdks/js/src/frameworks/vercel-ai-sdk/` and depends on the core runtime only.

### Module layout

- `sdks/js/src/frameworks/vercel-ai-sdk/`
  - `index.ts` — public exports
  - `types.ts` — `SigilVercelAiSdkOptions`, `CallOptions`, hook return types
  - `hooks.ts` — `SigilVercelAiSdkInstrumentation` class implementing the hook factory
  - `mapping.ts` — field extraction and normalization utilities
- Public import subpath: `@grafana/sigil-sdk-js/vercel-ai-sdk`

### Public integration surface

```ts
// Primary factory
createSigilVercelAiSdk(client: SigilClient, options?: SigilVercelAiSdkOptions)
  => SigilVercelAiSdkInstrumentation

// On the instrumentation object:
.generateTextHooks(callOptions?: CallOptions) => GenerateTextHooks
.streamTextHooks(callOptions?: CallOptions)   => StreamTextHooks

interface SigilVercelAiSdkOptions {
  agentName?: string;
  agentVersion?: string;
  captureInputs?: boolean;               // default: true
  captureOutputs?: boolean;              // default: true
  extraTags?: Record<string, string>;
  extraMetadata?: Record<string, unknown>;
  resolveConversationId?: (event: StepStartEvent) => string | undefined;
}

interface CallOptions {
  conversationId?: string;
  agentName?: string;
  extraMetadata?: Record<string, unknown>;
}
```

No model wrapping helpers, no middleware factory, no telemetry bridge helpers.

### Usage pattern

```ts
// One-time setup:
const sigil = createSigilVercelAiSdk(client, { agentName: 'research-agent' });

// generateText — spread hooks:
const result = await generateText({
  model: openai('gpt-4o'),              // user's model — completely unchanged
  ...sigil.generateTextHooks({ conversationId: 'chat-123' }),
  tools: { search, calculate },
  stopWhen: hasToolResult(),
  prompt: 'Research this topic...',
});

// streamText — spread hooks:
const result = streamText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  ...sigil.streamTextHooks({ conversationId: 'chat-456' }),
  prompt: '...',
});
```

## Conversation identity

### Why explicit is required

AI SDK is stateless on the server side. There is no session, thread, or conversation object — users manage conversation history themselves by accumulating `messages` between turns. Unlike LangChain (thread IDs in config), LangGraph (configurable thread IDs), or OpenAI Agents (run IDs), AI SDK exposes no implicit conversation identity in its step callbacks.

For multi-turn continuity, callers **must** supply `conversationId` explicitly.

### Precedence

1. `hooks({ conversationId })` — explicit per-call (required for multi-turn conversations).
2. `resolveConversationId(stepStartEvent)` — resolver function; receives the `experimental_onStepStart` event and may derive a conversation ID from request context or message history.
3. Fallback: `sigil:framework:vercel-ai-sdk:<response.id>` — scoped to a single response only; does not create conversation-level continuity.

The design does not attempt to auto-detect `chatId`, `sessionId`, or similar keys because these do not appear in AI SDK's server-side step callback payloads.

## Canonical framework identity

All generated spans and generations include:

- `sigil.framework.name = "vercel-ai-sdk"`
- `sigil.framework.source = "framework"`
- `sigil.framework.language = "typescript"`

## Hook lifecycle and timing

### How all three signals are produced from one recorder

A single `GenerationRecorder` lifecycle covers generation export, OTel span, and metrics:

1. `experimental_onStepStart` fires → `client.startGeneration({ startedAt: new Date(), model, conversationId, ... })` — recorder created, span opens at correct wall-clock time.
2. For `streamText`: `onChunk` fires → on first chunk with `chunk.type === 'text'`, call `recorder.setFirstTokenAt(new Date())` to capture TTFT.
3. `onStepFinish` fires → `recorder.setResult(...)` + `recorder.end()` — span closes, metrics recorded, generation enqueued for export.

This gives correct span duration, TTFT, and generation export all without model wrapping.

The instrumentation maintains a step state map keyed by step number to correlate `experimental_onStepStart` with `onStepFinish`.

### `generateText` flow (`SYNC`)

1. `experimental_onStepStart`: record `startedAt`, store input messages and model info, create `GenerationRecorder`.
2. `onStepFinish`: extract usage, text output, toolCalls, toolResults, finishReason, response metadata; call `recorder.setResult(...)` and `recorder.end()`.
3. `experimental_onToolCallStart`: open a `ToolExecutionRecorder` per tool call.
4. `experimental_onToolCallFinish`: close the tool recorder with result or error and `durationMs`.

### `streamText` flow (`STREAM`)

Same as generateText flow, plus:

5. `onChunk`: on first `chunk.type === 'text'` chunk, call `recorder.setFirstTokenAt(new Date())`.
6. `onError`: call `recorder.setCallError(error)` and `recorder.end()` to ensure the recorder closes on stream failure.

### Agentic loop (multi-step)

Multi-step `generateText`/`streamText` with `stopWhen` fires `experimental_onStepStart` + `onStepFinish` once per model call. Each step produces one Sigil generation record under the same `conversationId`.

`stepType` from `onStepFinish` (`"initial"` | `"continue"` | `"tool-result"`) is stored as framework metadata to track the position in the agentic loop. Tool results from the previous step appear as `tool` role messages in the next step's input; these are captured naturally via the per-step input from `experimental_onStepStart`.

There is no global recorder spanning all steps — one recorder per step keeps lifecycle management simple and deterministic.

## Generation field mapping

| Sigil generation field | Source in AI SDK hook | Notes |
|---|---|---|
| `conversation_id` | precedence resolver above | explicit required for multi-turn |
| `provider` | `experimental_onStepStart` `model.provider` | fallback: infer from `modelId` prefix |
| `model` | `onStepFinish` `response.modelId` | actual model used by provider |
| `mode` | operation type | `SYNC` for generateText, `STREAM` for streamText |
| `input` | `experimental_onStepStart` `messages` | gated by `captureInputs` |
| `output` | `onStepFinish` `text` | gated by `captureOutputs` |
| `usage.input_tokens` | `onStepFinish` `usage.inputTokens` | |
| `usage.output_tokens` | `onStepFinish` `usage.outputTokens` | |
| `usage.cache_read_input_tokens` | `onStepFinish` `usage.inputTokenDetails.cacheReadTokens` | |
| `usage.cache_write_input_tokens` | `onStepFinish` `usage.inputTokenDetails.cacheWriteTokens` | |
| `usage.reasoning_tokens` | `onStepFinish` `usage.outputTokenDetails.reasoningTokens` | |
| `stop_reason` | `onStepFinish` `finishReason` | |
| `response_id` | `onStepFinish` `response.id` | |
| `response_model` | `onStepFinish` `response.modelId` | |
| `error` | `onError` callback (streamText) or caught exception | classify to `error.type` / `error.category` |

Generation metadata includes:

- `sigil.framework.step_type` — `onStepFinish` `stepType` (`"initial"`, `"continue"`, `"tool-result"`)
- `sigil.framework.reasoning_text` — `onStepFinish` `reasoningText` when present (not merged into output content)
- Standard framework identity fields (`sigil.framework.name`, `.source`, `.language`)
- User-supplied `extraMetadata`

## Span attributes and metrics

### Span attributes

Required:

- `gen_ai.operation.name` (`generateText`, `streamText`, `execute_tool`)
- `gen_ai.provider.name`
- `gen_ai.request.model`
- `gen_ai.conversation.id`
- `sigil.framework.name`, `sigil.framework.source`, `sigil.framework.language`

Optional (low-cardinality):

- `gen_ai.response.id`
- `gen_ai.response.model`
- `gen_ai.response.finish_reasons`
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
- `gen_ai.usage.cache_read_input_tokens`, `gen_ai.usage.cache_write_input_tokens`
- `gen_ai.usage.reasoning_tokens`
- `sigil.framework.step_type`
- `error.type`, `error.category`

High-cardinality payload content (input messages, output text) remains in generation metadata/content, not span attributes.

### Metrics

Use existing Sigil SDK metric instruments:

- `gen_ai.client.operation.duration`
- `gen_ai.client.token.usage`
- `gen_ai.client.time_to_first_token` (streamText steps only, when TTFT captured via `onChunk`)
- `gen_ai.client.tool_calls_per_operation`

All metrics are recorded automatically by `recorder.end()` via the existing `SigilClient` instrumentation — no additional metric wiring required in the framework module.

## Tool lifecycle mapping

- `experimental_onToolCallStart` event → `client.startToolExecution({ toolName: event.toolCall.toolName, toolCallId: event.toolCall.toolCallId, ... })`
- `experimental_onToolCallFinish` event:
  - On `event.success === true` → `recorder.setResult({ arguments: event.toolCall.input, result: event.output })` + `recorder.end()`
  - On `event.success === false` → `recorder.setCallError(event.error)` + `recorder.end()`
- `event.durationMs` from `onToolCallFinish` provides wall-clock tool execution time directly — no id-less correlation or fallback needed.
- `toolCallId` is always provided by AI SDK — no synthetic fallback id required.
- Tool recorders are stored in a `Map<toolCallId, ToolExecutionRecorder>` and removed on close.

## Error and abort behavior

- `onError` (streamText) → `recorder.setCallError(error)` + `recorder.end()`. Must fire even if stream was partially consumed.
- `onStepFinish` with `finishReason === 'error'` → classify error and end recorder.
- All started tool recorders must be closed when the parent step errors — iterate the open tool map and end any remaining recorders.
- Recorder closure is idempotent: `recorder.end()` called multiple times is safe (guarded by `ended` flag in the core client).

## Options contract

```ts
interface SigilVercelAiSdkOptions {
  agentName?: string;
  agentVersion?: string;
  captureInputs?: boolean;               // default: true
  captureOutputs?: boolean;              // default: true
  extraTags?: Record<string, string>;
  extraMetadata?: Record<string, unknown>;
  resolveConversationId?: (event: StepStartEvent) => string | undefined;
}

interface CallOptions {
  conversationId?: string;              // required for multi-turn continuity
  agentName?: string;                   // overrides global agentName for this call
  extraMetadata?: Record<string, unknown>;
}
```

No telemetry bridge option. No model reference option. No middleware-level options.

## Documentation requirements

Framework guide at `sdks/js/docs/frameworks/vercel-ai-sdk.md`:

- Quickstart: factory setup + `generateTextHooks` spread (one-liner)
- Conversation ID: explicit note that users must supply it for multi-turn
- Multi-step agentic loop example with `stopWhen` and tools
- Streaming with TTFT example
- `captureInputs` / `captureOutputs` privacy controls
- Troubleshooting: missing usage (provider doesn't return it), missing TTFT (non-streaming step), tool IDs

## Testing and acceptance criteria

Required test categories:

- Unit tests for field extraction and metadata normalization (`mapping.ts`)
- Integration-style tests for `generateText` single-step: success, error
- Integration-style tests for `generateText` multi-step (agentic loop): 2-step tool call loop, stepType metadata
- Integration-style tests for `streamText`: success, error, TTFT capture
- Tool lifecycle: success, error, correct `durationMs` mapping
- Capture toggles: `captureInputs=false`, `captureOutputs=false` for both model and tool payloads
- Conversation ID: explicit override, resolver function, fallback value
- Recorder closure: all open recorders closed on error, no leaks
- Concurrent calls: multiple simultaneous `generateText` calls do not cross-contaminate step maps

Acceptance criteria:

- Model is never wrapped or modified.
- `generateTextHooks()` and `streamTextHooks()` return objects that TypeScript accepts at the respective call sites without casts.
- Each `onStepFinish` produces exactly one generation record, one closed span, and metric observations.
- Each `experimental_onToolCallFinish` produces exactly one closed tool span.
- Recorder lifecycle is always closed: no open spans on success, error, or abort.
- `conversationId` fallback is documented and tested.
- Docs snippets compile against published TypeScript types.

## Risks

- `experimental_onStepStart`, `experimental_onToolCallStart`, and `experimental_onToolCallFinish` are marked experimental in AI SDK v5 and can change in patch releases.
- If AI SDK changes the `onStepFinish` payload shape (e.g., renames `usage.inputTokenDetails`), field extraction silently produces zeroes — defensive fallback extraction required.
- Multi-step step numbering: step map keyed by step number works only if AI SDK guarantees sequential, non-reused step numbers within a single `generateText` call.
- `onError` (streamText) may not fire if the caller consumes the stream without error handling — document this and encourage `onError` usage.

## Explicit assumptions and defaults

- TypeScript Vercel AI SDK only, `ai` package v5.
- Sigil generation export is the source of truth — not OTel telemetry.
- `conversation_id` is the primary identity; no implicit detection from request payloads.
- `experimental_telemetry` is not used and not documented.
- No schema changes to Sigil generation ingest/query contracts.
