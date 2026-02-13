---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Java SDK Parity (Go Baseline)

## Context

Sigil SDK parity previously covered Go, Python, and TypeScript/JavaScript. Java was missing from the parity matrix for generation ingest transport, trace export transport, provider helpers, and parity test coverage.

## Decision

Create a dedicated Java SDK track under `sdks/java` using Java 17 and a Gradle multi-module layout:

- `:core`
- `:providers:openai`
- `:providers:anthropic`
- `:providers:gemini`
- `:benchmarks`

## Runtime Contract

The Java SDK follows the same generation-first ingest contract used by other SDKs:

- generation mode mapping:
  - non-stream wrappers: `SYNC`
  - stream wrappers: `STREAM`
- generation export protocols: HTTP and gRPC
- trace export protocols: OTLP HTTP and OTLP gRPC
- auth modes: `none`, `tenant`, `bearer` with explicit header override precedence
- raw provider artifacts default off with explicit opt-in

## API Surface

Core package: `com.grafana.sigil.sdk`

- `SigilClient`
- `GenerationRecorder`
- `ToolExecutionRecorder`
- `SigilContext`
- config/model types and validation

Provider modules expose wrapper-first APIs and explicit mapper functions.

## Testing and Guardrails

- core runtime tests (queue/batch/retry/flush/shutdown)
- validation tests (role/part and artifact constraints)
- span parity tests
- transport tests for HTTP and gRPC export
- provider wrapper parity tests
- payload-size max-byte guardrail tests
- JMH benchmarks for runtime and mapper hot paths

## Tradeoffs

- Provider adapters currently focus on wrapper + mapper parity and compile-only official SDK integration points.
- Additional direct typed adapters for every official SDK response event type remain optional follow-up work.
