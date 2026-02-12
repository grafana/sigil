---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: SDK Parity (Python)

## Goal

Deliver production-ready Python SDK parity with Go using an OpenTelemetry-like mental model and stable lifecycle contracts.

## Completion

Completed on 2026-02-12.

## Scope

- Python core explicit API contracts and lifecycle semantics.
- Provider wrapper conventions and parity targets.
- Local test matrix and `mise` task expectations for Python SDK behavior.

## Source Design Doc

- `docs/design-docs/2026-02-12-phase-2-sdk-parity-python.md`

## Current Runtime Status

- Python SDK core runtime is implemented in `sdks/python`.
- Provider wrapper packages are implemented in `sdks/python-providers/openai`, `sdks/python-providers/anthropic`, and `sdks/python-providers/gemini`.
- Parity suites for lifecycle, validation, generation transport, trace transport, and provider mapping are implemented and runnable locally.

## Tasks

- [x] Define Python core explicit APIs and lifecycle semantics:
  - `start_generation`
  - `start_streaming_generation`
  - `start_tool_execution`
  - `set_result`
  - `set_call_error`
  - `end`
  - `flush`
  - `shutdown`
- [x] Keep provider docs wrapper-first while retaining explicit-flow examples.
- [x] Lock provider parity target to OpenAI, Anthropic, Gemini.
- [x] Keep raw provider artifacts default OFF with explicit debug opt-in only.
- [x] Add/update local `mise` tasks for Python parity checks.
- [x] Document required local test scenarios:
  - SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
  - SDK transport tests (generation export HTTP/gRPC roundtrip, OTLP trace transport checks).
  - Provider mapper tests (OpenAI/Anthropic/Gemini sync + stream payload correctness).

## Risks

- Python API lifecycle drift from Go/TS parity contracts.
- Wrapper ergonomics diverge from explicit core behavior.
- Deferred CI increases regression risk despite local test requirements.

## Exit Criteria

- Python SDK docs and implementation contract reflect OTel-like explicit lifecycle semantics.
- Provider wrapper behavior is documented and parity-locked to OpenAI/Anthropic/Gemini.
- Required local tests are defined and runnable through `mise`.

## Out of Scope

- CI rollout in this phase.
- Additional providers beyond OpenAI, Anthropic, Gemini.
