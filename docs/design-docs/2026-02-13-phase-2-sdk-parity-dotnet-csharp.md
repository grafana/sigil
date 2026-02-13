---
owner: sigil-core
status: completed
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Phase 2 Workstream: SDK Parity (.NET/C#)

## Scope

This workstream delivered the .NET/C# SDK parity track with Go-level runtime behavior and provider coverage.

Execution is completed and tracked in:

- `docs/exec-plans/completed/2026-02-13-phase-2-sdk-parity-dotnet-csharp.md`

## Locked Decisions

1. Split package layout: core + provider packages.
2. Provider wrappers are official SDK adapters (not DTO-only wrappers).
3. `.NET` suites are gated in `mise run test:sdk:all`.
4. Framework targets: core `net8.0` + `netstandard2.0`.
5. OpenAI scope for this pass: Chat Completions only (Responses API deferred).
6. Naming: `Grafana.Sigil.*` package IDs and namespaces.

## Runtime Contracts

- Core API and recorder lifecycle parity with Go:
  - `StartGeneration`, `StartStreamingGeneration`, `StartToolExecution`
  - `FlushAsync`, `ShutdownAsync`
  - `GenerationRecorder.SetResult`, `SetCallError`, `End`
  - `ToolExecutionRecorder.SetResult`, `SetExecutionError`, `End`
- Generation export runtime parity:
  - bounded queue, batch flush by size/interval
  - retry with exponential backoff
  - payload max-bytes guard
  - shutdown flush behavior
- Transport parity:
  - generation export over HTTP JSON and gRPC protobuf
  - OTLP traces over HTTP and gRPC
- Auth parity:
  - `none`, `tenant`, `bearer`
  - explicit headers override auth-injected `Authorization` and `X-Scope-OrgID`
- Span semantics parity:
  - operation defaults: `generateText`, `streamText`
  - tool operation: `execute_tool`

## Provider Coverage

- OpenAI:
  - Chat Completions sync + stream wrappers
  - request/response and stream-summary mappers
  - system-message filtering from input
  - tool and usage mapping
  - raw artifacts default OFF, explicit opt-in
- Anthropic:
  - Messages sync + stream wrappers
  - system prompt, thinking/tool-use/tool-result mapping
  - stream event aggregation and usage mapping
  - raw artifacts parity with opt-in behavior
- Gemini:
  - GenerateContent sync + stream wrappers
  - candidate/function call/function response mapping
  - stop reason and usage normalization
  - stream aggregation with provider-event artifacts

## Test Strategy

- Core validation tests:
  - role/part compatibility
  - artifact payload-or-record-id constraints
  - accepted conversation/response fields
- Core runtime/lifecycle tests:
  - batch and interval flush
  - retry/backoff
  - queue-full and shutdown behavior
  - idempotent `End()`
  - context default/override behavior
- Core transport tests:
  - generation HTTP and gRPC roundtrip parity
  - auth injection and explicit override behavior
- Core trace transport tests:
  - OTLP HTTP and OTLP gRPC export checks
  - required GenAI attributes and trace/span linkage
  - trace auth behavior and override behavior
- Provider tests:
  - sync=`SYNC`, stream=`STREAM`
  - provider errors mapped to `call_error`
  - raw artifacts OFF by default, ON with explicit opt-in
- Dependency boundary test:
  - core project does not reference provider SDK packages directly

## Build and Task Integration

- Added `.NET` toolchain to `mise`.
- Added and validated:
  - `test:cs:sdk-core`
  - `test:cs:sdk-openai`
  - `test:cs:sdk-anthropic`
  - `test:cs:sdk-gemini`
- Added `.NET` suites to `test:sdk:all`.
- Added optional quality tasks:
  - `format:cs`
  - `lint:cs` (`dotnet format --verify-no-changes`)

## Current Runtime Status

- .NET solution and split package structure are implemented in `sdks/dotnet`.
- All .NET parity suites pass locally.
- Documentation and governance indexes include the .NET parity workstream.
