---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: SDK Parity (TypeScript/JavaScript)

## Scope

This workstream isolates TypeScript/JavaScript SDK parity work from other Phase 2 tracks so implementation can proceed in parallel.

Execution for this workstream is completed and tracked in:

- `docs/exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`

## Implementation Sequence

TypeScript/JavaScript SDK foundation was the first implementation track in Phase 2:

1. lock core TypeScript API surface and lifecycle semantics
2. implement transport/runtime behavior (queue, retry/backoff, flush/shutdown)
3. add provider wrappers (OpenAI/Anthropic/Gemini)
4. complete test matrix and `mise` task coverage

This sequence is completed. Active implementation priority has moved to Python parity and non-SDK tracks.

## Positioning

If you already use OpenTelemetry, Sigil is a thin extension plus sugar for AI observability.

## TypeScript Conventions

- TypeScript source is the canonical implementation for this SDK track.
- Public API contracts are explicit and named-exported.
- Strict typing is required for config, recorder inputs, and transport payload mapping.
- Prefer small focused modules and explicit interfaces over broad implicit object shapes.
- Callback and manual `try/finally` usage styles must remain behaviorally equivalent.

## Core SDK UX (primary)

Core TypeScript docs are explicit API first:

- `startGeneration(...)`
- `startStreamingGeneration(...)`
- `startToolExecution(...)`
- `setResult(...)`
- `setCallError(...)`
- `end()`
- lifecycle: `flush()`, `shutdown()`

TypeScript docs use active-span callback style first, and manual `try/finally` as the explicit alternative.

## Provider docs (wrapper-first)

Provider package docs are wrapper-first for ergonomics, with explicit core flow shown as secondary when needed.

Provider parity target:

- OpenAI
- Anthropic
- Gemini

Raw provider artifacts remain default OFF and are only included with explicit debug opt-in.

Current TS/JS provider docs are split per provider:

- `sdks/js/docs/providers/openai.md`
- `sdks/js/docs/providers/anthropic.md`
- `sdks/js/docs/providers/gemini.md`

## Command and testing policy

- `mise` is the single command/task system in this phase.
- A single all-SDK local test command is required (`mise run test:sdk:all`) plus per-language/per-provider tasks.
- CI expansion remains deferred and tracked in tech debt.

## Required Local Test Scenarios

- SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
- SDK recorder/span parity tests (generation + tool span attributes, error typing, idempotent end behavior).
- SDK transport tests (generation HTTP/gRPC export roundtrip assertions).
- Provider mapper tests for OpenAI/Anthropic/Gemini sync and stream flows.
- OTLP trace transport assertions over HTTP and gRPC.

## Consequences

- TS/JS implementation can progress independently while preserving cross-language behavior parity.

## Current Runtime Status

- Core lifecycle APIs are implemented with queue/batch/retry/flush/shutdown semantics.
- Built-in generation transport supports HTTP and gRPC.
- Built-in OTLP trace transport supports HTTP and gRPC.
- Provider wrappers are implemented for OpenAI, Anthropic, and Gemini using wrapper-first entry points.
- Full generation transport roundtrip assertions cover HTTP and gRPC payload parity for generation exports.
- Generation payloads include `traceId`/`spanId` from active spans.
- gRPC export supports typed message `parts` parity (`text`, `thinking`, `tool_call`, `tool_result`).
- gRPC export covers tool schema (`inputSchemaJSON`) and artifact identity fields (`name`, `recordId`, `uri`).
- Runtime validation parity enforces role/part compatibility and artifact payload-or-record-id rules.
- Empty tool names return a no-op tool recorder for instrumentation safety parity.
