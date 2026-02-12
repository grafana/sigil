---
owner: sigil-core
status: completed
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: SDK Parity (Python)

## Scope

This workstream isolates Python SDK parity work from other Phase 2 tracks so implementation can proceed in parallel.

Execution for this workstream is completed and tracked in:

- `docs/exec-plans/completed/2026-02-12-phase-2-sdk-parity-python.md`

## Implementation Sequence

Python SDK implementation sequence for this track:

1. lock core Python API surface and lifecycle semantics
2. implement transport/runtime behavior (queue, retry/backoff, flush/shutdown)
3. add provider wrappers (OpenAI/Anthropic/Gemini)
4. complete test matrix and `mise` task coverage

This sequence is completed. Active implementation priority has moved to non-SDK Phase 2 tracks.

## Positioning

If you already use OpenTelemetry, Sigil is a thin extension plus sugar for AI observability.

## Core SDK UX (primary)

Core Python docs are explicit API first:

- `start_generation(...)`
- `start_streaming_generation(...)`
- `start_tool_execution(...)`
- `set_result(...)`
- `set_call_error(...)`
- `end()`
- lifecycle: `flush()`, `shutdown()`

Python docs use context-manager examples as the default pattern.

## Provider docs (wrapper-first)

Provider package docs are wrapper-first for ergonomics, with explicit core flow shown as secondary when needed.

Provider parity target:

- OpenAI
- Anthropic
- Gemini

Raw provider artifacts remain default OFF and are only included with explicit debug opt-in.

## Command and testing policy

- `mise` is the single command/task system in this phase.
- A single all-SDK local test command is required (`mise run test:sdk:all`) plus per-language/per-provider tasks.
- CI expansion remains deferred and tracked in tech debt.

## Required Local Test Scenarios

- SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
- SDK transport tests (generation HTTP/gRPC export and OTLP trace transport assertions).
- Provider mapper tests for OpenAI/Anthropic/Gemini sync and stream flows.

## Consequences

- Python implementation can progress independently while preserving cross-language behavior parity.

## Current Runtime Status

- Python SDK core runtime is implemented under `sdks/python` with explicit lifecycle APIs, validation, async buffered generation export, and OTLP trace export.
- Provider wrapper packages are implemented under `sdks/python-providers/{openai,anthropic,gemini}` with wrapper-first APIs and raw-artifact opt-in behavior.
- Local parity suites now cover lifecycle, validation, generation transport (HTTP/gRPC), OTLP trace transport (HTTP/gRPC), and provider mapper/wrapper behavior.
