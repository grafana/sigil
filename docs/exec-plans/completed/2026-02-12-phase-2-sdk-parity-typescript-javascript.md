---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: SDK Parity (TypeScript/JavaScript)

## Goal

Deliver production-ready TypeScript/JavaScript SDK parity with Go using an OpenTelemetry-like mental model and stable lifecycle contracts.

## Completion

Completed on 2026-02-12.

## TypeScript Conventions

- Keep the core package authored in TypeScript with strict typing and explicit public contracts.
- Prefer named exports for stable SDK surfaces.
- Avoid implicit `any`; use explicit input/output interfaces and discriminated unions where shape variants exist.
- Keep recorder lifecycle methods explicit and side effects obvious (`setResult`, `setCallError`, `end`).
- Keep callback and manual `try/finally` styles behaviorally equivalent.

## Scope

- TypeScript/JavaScript core explicit API contracts and lifecycle semantics.
- Provider wrapper conventions and parity targets.
- Local test matrix and `mise` task expectations for TypeScript/JavaScript SDK behavior.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`

## Tasks

- [x] Define TypeScript/JavaScript core explicit APIs and lifecycle semantics:
  - `startGeneration`
  - `startStreamingGeneration`
  - `startToolExecution`
  - `setResult`
  - `setCallError`
  - `end`
  - `flush`
  - `shutdown`
- [x] Keep TypeScript primary examples in active-span callback style with explicit manual `try/finally` alternative.
- [x] Keep provider docs wrapper-first while retaining explicit-flow examples.
- [x] Lock provider parity target to OpenAI, Anthropic, Gemini.
- [x] Keep raw provider artifacts default OFF with explicit debug opt-in only.
- [x] Add/update local `mise` tasks for TypeScript/JavaScript parity checks.
- [x] Document required local test scenarios:
  - SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
  - SDK recorder/span parity tests (generation + tool span behavior and error typing).
  - SDK transport tests (generation export HTTP/gRPC roundtrip).
  - Provider mapper tests (OpenAI/Anthropic/Gemini sync + stream payload correctness).
- [x] Add OTLP trace transport checks (HTTP + gRPC).

## Execution Phases

1. Foundation: package structure, strict types, core recorder and lifecycle APIs, callback + manual style examples.
2. Transport/runtime: async queue, batch export, retry/backoff, flush/shutdown semantics.
3. Provider wrappers: OpenAI/Anthropic/Gemini wrappers with explicit mode mapping (`SYNC`/`STREAM`) and raw artifacts opt-in.
4. Validation hardening: parity and transport tests wired into `mise` commands.

## Current Runtime Status

- Core lifecycle APIs are implemented with queue/batch/retry/flush/shutdown semantics.
- Built-in generation transport supports HTTP and gRPC.
- Built-in OTLP trace transport supports HTTP and gRPC.
- Provider wrappers are implemented for OpenAI, Anthropic, and Gemini using wrapper-first entry points.
- Provider-specific wrapper docs are published for OpenAI, Anthropic, and Gemini.
- Generation payloads include `traceId`/`spanId` from active spans.
- gRPC transport parity includes full payload roundtrip assertions (including metadata/artifacts/callError/trace identity).
- OTLP trace transport parity checks run against local HTTP and gRPC collectors.
- Message `parts` mapping parity is covered for gRPC export payloads.
- gRPC transport parity covers tool schema bytes (`input_schema_json`) and artifact identity fields (`name`, `record_id`, `uri`).
- Validation parity covers role/part compatibility rules and artifact payload-or-record-id constraints.
- Generation/tool span parity tests cover operation-name override behavior, tool content capture, and error-type semantics.
- Empty tool-name behavior is parity-aligned with Go via no-op tool recorder semantics.

## Risks

- TypeScript/JavaScript lifecycle drift from Go/Python parity contracts.
- Callback and manual lifecycle patterns diverge semantically.
- Deferred CI increases regression risk despite local test requirements.

## Exit Criteria

- TypeScript/JavaScript SDK docs and implementation contract reflect OTel-like explicit lifecycle semantics.
- Provider wrapper behavior is documented and parity-locked to OpenAI/Anthropic/Gemini.
- Required local tests are defined and runnable through `mise`.

## Out of Scope

- CI rollout in this phase.
- Additional providers beyond OpenAI, Anthropic, Gemini.
