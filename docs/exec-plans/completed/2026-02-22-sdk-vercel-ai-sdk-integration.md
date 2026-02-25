---
owner: sigil-core
status: completed
last_reviewed: 2026-02-23
source_of_truth: true
audience: both
---

# SDK Integrations Delivery: Vercel AI SDK (TypeScript)

## Goal

Deliver first-class Vercel AI SDK TypeScript integration using a hook-based approach: Sigil plugs in as callbacks spread into `generateText` / `streamText` calls. The user's model is never touched. Coverage includes generation export, OTel spans, metrics, tool execution spans, TTFT, and multi-step agentic loops.

## Source design doc

- `docs/design-docs/2026-02-22-sdk-vercel-ai-sdk-integration.md`

## Completion policy

- A checkbox moves to `[x]` only when code/tests/docs for that item are complete in the working branch.
- Checklist status is updated in-branch as implementation progresses.
- When all exit criteria are met, move this plan to `docs/exec-plans/completed/`.

## Scope

- TypeScript integration for Vercel AI SDK (`ai` package v5) in `sdks/js`.
- Hook-based instrumentation via `createSigilVercelAiSdk(client)` factory.
- `generateTextHooks()` and `streamTextHooks()` covering single-step and multi-step agentic loops.
- Tool execution spans via `experimental_onToolCallStart` / `experimental_onToolCallFinish`.
- TTFT capture via `onChunk` for streaming steps.
- Docs, tests, and quality task updates required for durable delivery.

## Out of scope

- Python/Go/Java AI SDK integration modules.
- Sigil ingest/query schema changes.
- Plugin UI feature work specific to this framework.
- `experimental_telemetry` — not used; removed from design.
- Embedding model instrumentation (`embed`, `embedMany`).
- Model wrapping or middleware (`wrapLanguageModel`, `LanguageModelV3Middleware`).

## Track A: API and version lock

- [x] Pin supported AI SDK major/minor version (`ai` v5) and document in framework guide.
- [x] Confirm stability of `experimental_onStepStart`, `experimental_onToolCallStart`, `experimental_onToolCallFinish` in the pinned version.
- [x] Document version compatibility risk (experimental callbacks can break in patch releases).
- [x] Confirm `onStepFinish` payload shape for usage fields: `usage.inputTokenDetails.cacheReadTokens`, `usage.inputTokenDetails.cacheWriteTokens`, `usage.outputTokenDetails.reasoningTokens`.

## Track B: JS framework module scaffolding

- [x] Create `sdks/js/src/frameworks/vercel-ai-sdk/` module structure (`index.ts`, `types.ts`, `hooks.ts`, `mapping.ts`).
- [x] Define `SigilVercelAiSdkOptions`, `CallOptions`, `GenerateTextHooks`, `StreamTextHooks` in `types.ts`.
- [x] Add `SigilVercelAiSdkInstrumentation` class skeleton in `hooks.ts`.
- [x] Add step state map type (`stepNumber → { recorder, startedAt, inputMessages }`).
- [x] Add tool recorder map type (`toolCallId → ToolExecutionRecorder`).
- [x] Add package subpath export `@grafana/sigil-sdk-js/vercel-ai-sdk`.
- [x] Add `vercel-ai-sdk` to `FrameworkName` union in `frameworks/shared.ts` (if applicable).

## Track C: Hook-based lifecycle mapping

- [x] Implement `experimental_onStepStart` handler: record `startedAt`, store input messages, resolve model info and `conversationId`, create `GenerationRecorder`.
- [x] Implement `onStepFinish` handler: extract usage (including cache and reasoning token details), text, finishReason, responseId, responseModel; call `recorder.setResult()` + `recorder.end()`.
- [x] Implement `stepType` → framework metadata mapping (`sigil.framework.step_type`).
- [x] Implement `reasoningText` → metadata mapping (not merged into output content).
- [x] Implement `onChunk` handler (streamText): on first `chunk.type === 'text'` chunk call `recorder.setFirstTokenAt(new Date())`.
- [x] Implement `onError` handler (streamText): `recorder.setCallError(error)` + `recorder.end()`, close any open tool recorders.
- [x] Implement deterministic `conversationId` precedence: explicit call option → resolver → fallback.
- [x] Implement provider inference from `experimental_onStepStart` `model.provider` with `modelId` prefix fallback.
- [x] Ensure trace-generation linkage is preserved (`traceId`/`spanId` from the recorder's span context).

## Track D: Tool lifecycle

- [x] Implement `experimental_onToolCallStart` handler: open `ToolExecutionRecorder`, store in tool map keyed by `toolCallId`.
- [x] Implement `experimental_onToolCallFinish` handler (success path): `recorder.setResult({ arguments: event.toolCall.input, result: event.output })` + `recorder.end()`, remove from map.
- [x] Implement `experimental_onToolCallFinish` handler (error path): `recorder.setCallError(event.error)` + `recorder.end()`, remove from map.
- [x] Ensure all open tool recorders are closed when the parent step errors or aborts (drain the tool map).
- [x] Confirm `toolCallId` is always non-empty from AI SDK — no synthetic fallback needed.

## Track E: Documentation and examples

- [x] Add framework guide: `sdks/js/docs/frameworks/vercel-ai-sdk.md`.
- [x] Add quickstart snippet: factory setup + `generateTextHooks` spread.
- [x] Add conversation ID section: explicit note that `conversationId` must be supplied for multi-turn; explain fallback scope.
- [x] Add multi-step agentic loop example: `generateText` with `tools` + `stopWhen`.
- [x] Add streaming example: `streamText` with `streamTextHooks` showing TTFT.
- [x] Add capture/privacy snippet: `captureInputs=false`, `captureOutputs=false`.
- [x] Add troubleshooting section: missing usage (provider doesn't return it), missing TTFT (non-streaming step), tool span not appearing (tool has no `execute`).

## Track F: Tests and quality wiring

- [x] Add unit tests for field extraction and metadata normalization in `mapping.ts`.
- [x] Add integration-style tests for `generateText` single-step: success, error.
- [x] Add integration-style tests for `generateText` multi-step agentic loop: 2-step tool call loop, correct `stepType` per step.
- [x] Add integration-style tests for `streamText`: success, error/abort, TTFT captured on first text chunk.
- [x] Add tool lifecycle tests: success path (correct durationMs mapping), error path.
- [x] Add capture toggle tests: `captureInputs=false` and `captureOutputs=false` for model and tool payloads.
- [x] Add conversation ID tests: explicit override, resolver function, fallback value format.
- [x] Add recorder closure tests: all open recorders closed on step error; no open spans after abort.
- [x] Add concurrent call tests: two simultaneous `generateText` calls do not cross-contaminate step maps.
- [x] Add usage extraction tests: cache tokens, reasoning tokens, zero-safe extraction.
- [x] Update `mise` tasks and JS test command docs for new framework module.

## Track G: Governance and index sync

- [x] Update `docs/index.md` links once implementation docs exist.
- [x] Update `docs/design-docs/index.md` status when implementation completes.
- [x] Update `ARCHITECTURE.md` if framework contract text changes.
- [x] Keep this plan checklist synchronized as work lands.

## Required tests

- Lifecycle mapping:
  - `generateText`: start/end/error, single-step and multi-step
  - `streamText`: start/chunks/finish/error/abort
- Mapping fidelity:
  - `conversationId` precedence and fallback
  - Framework metadata fields (`stepType`, `reasoningText`)
  - Token usage extraction including cache and reasoning details
  - `finishReason`, `responseId`, `responseModel`
- Tool coverage:
  - Start/end/error mapping
  - Open tool recorders closed on parent step error
- Capture controls:
  - Model input/output capture toggles
  - Tool argument/result capture toggles
- Reliability:
  - Concurrent call isolation (step maps per instrumentation call)
  - Recorder closure on all exit paths
- Multi-step:
  - Correct `stepType` per step in agentic loop
  - Per-step input messages captured from `experimental_onStepStart`

## Validation commands (executed)

- `mise run typecheck:ts:sdk-js`
- `mise run test:ts:sdk-js-frameworks`

## Risks

- `experimental_onStepStart`, `experimental_onToolCallStart`, `experimental_onToolCallFinish` can change in AI SDK patch releases — pin and monitor.
- If `onStepFinish` usage token fields are absent (provider does not return them), extraction must produce zeroes safely without throwing.
- `onError` (streamText) may not fire if the caller does not consume the stream — document limitation.
- Step number re-use within a single call is assumed not to happen; if AI SDK changes this, the step map approach breaks.

## Exit criteria

- Factory and hook methods implemented and exported under `@grafana/sigil-sdk-js/vercel-ai-sdk`.
- User's model is not wrapped or modified in any way.
- `generateTextHooks()` and `streamTextHooks()` return TypeScript-valid objects accepted at call sites without casts.
- `generateText` single-step and multi-step agentic loops produce correct generation records, closed spans, and metric observations.
- `streamText` produces correct generation record with TTFT when streaming.
- Tool spans are emitted and closed correctly in success and error paths.
- Capture toggles respected for model and tool payloads.
- Recorder lifecycle closes on all exit paths: success, error, abort.
- `conversationId` precedence is deterministic and documented.
- Docs include quickstart, conversation ID guidance, agentic loop, streaming, and privacy controls.
- Test coverage and quality commands pass for the new integration.

## Explicit assumptions and defaults

- TypeScript-only scope for Vercel AI SDK in this plan.
- Sigil generation export is source of truth — `experimental_telemetry` is not used.
- `conversation_id` is primary identity; no implicit detection from AI SDK payloads.
- No schema changes to Sigil generation ingest/query contracts.
