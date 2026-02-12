---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: both
---

# Phase 2 Workstream: SDK Parity (TypeScript/JavaScript)

## Scope

This workstream isolates TypeScript/JavaScript SDK parity work from other Phase 2 tracks so implementation can proceed in parallel.

## Positioning

If you already use OpenTelemetry, Sigil is a thin extension plus sugar for AI observability.

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

## Command and testing policy

- `mise` is the single command/task system in this phase.
- A single all-SDK local test command is required (`mise run test:sdk:all`) plus per-language/per-provider tasks.
- CI expansion remains deferred and tracked in tech debt.

## Required Local Test Scenarios

- SDK parity tests (validation, lifecycle, retry/backoff, flush/shutdown).
- SDK transport tests (generation HTTP/gRPC export and OTLP trace transport assertions).
- Provider mapper tests for OpenAI/Anthropic/Gemini sync and stream flows.

## Consequences

- TS/JS implementation can progress independently while preserving cross-language behavior parity.
