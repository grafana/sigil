---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Execution Plan: Java SDK Parity

## Scope

Deliver Java SDK parity with Go/Python/TypeScript baselines for generation ingest and provider helper behavior.

## Plan

- [x] Create Gradle Java 17 multi-module scaffold in `sdks/java`.
- [x] Implement core runtime (`SigilClient`, recorders, context, validation).
- [x] Implement generation HTTP/gRPC exporters and trace OTLP wiring.
- [x] Add core parity tests (runtime, validation, spans, transport, auth, guardrail).
- [x] Add provider adapter modules for OpenAI/Anthropic/Gemini.
- [x] Add provider parity tests.
- [x] Add JMH benchmarks and benchmark README.
- [x] Wire Java tasks into `mise.toml` and include Java in `test:sdk:all`.
- [x] Update docs indexes, architecture references, and support list.
- [x] Add optional direct typed adapter facades for official SDK event object models.

## Validation Commands

- `mise run test:java:sdk-all`
- `mise run benchmark:java:sdk`
- `mise run test:sdk:all`
