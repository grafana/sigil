---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: SDK Parity (TypeScript/JavaScript)

## Goal

Deliver production-ready TypeScript/JavaScript SDK parity with Go using an OpenTelemetry-like mental model and stable lifecycle contracts.

## Scope

- TypeScript/JavaScript core explicit API contracts and lifecycle semantics.
- Provider wrapper conventions and parity targets.
- Local test matrix and `mise` task expectations for TypeScript/JavaScript SDK behavior.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`

## Tasks

- [ ] Define TypeScript/JavaScript core explicit APIs and lifecycle semantics:
  - `startGeneration`
  - `startStreamingGeneration`
  - `startToolExecution`
  - `setResult`
  - `setCallError`
  - `end`
  - `flush`
  - `shutdown`
- [ ] Keep TypeScript primary examples in active-span callback style with explicit manual `try/finally` alternative.
- [ ] Keep provider docs wrapper-first while retaining explicit-flow examples.
- [ ] Lock provider parity target to OpenAI, Anthropic, Gemini.
- [ ] Keep raw provider artifacts default OFF with explicit debug opt-in only.
- [ ] Add/update local `mise` tasks for TypeScript/JavaScript parity checks.
- [ ] Document required local test scenarios:
  - SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
  - SDK transport tests (generation export HTTP/gRPC roundtrip, OTLP trace transport checks).
  - Provider mapper tests (OpenAI/Anthropic/Gemini sync + stream payload correctness).

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
