---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: SDK Parity (Python)

## Scope

This workstream isolates Python SDK parity work from other Phase 2 tracks so implementation can proceed in parallel.

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

- Python SDK is currently scaffold-level and does not yet provide Go/TypeScript parity runtime behavior.
- Provider wrappers and transport/runtime parity checks remain part of active implementation.
