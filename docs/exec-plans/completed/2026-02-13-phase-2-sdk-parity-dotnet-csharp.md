---
owner: sigil-core
status: completed
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# Phase 2 Workstream Delivery: SDK Parity (.NET/C#)

## Goal

Deliver production-ready .NET/C# SDK parity with Go using an OpenTelemetry-aligned explicit lifecycle model.

## Completion

Completed on 2026-02-13.

## Source Design Doc

- `docs/design-docs/2026-02-13-phase-2-sdk-parity-dotnet-csharp.md`

## Scope

- .NET core runtime package and provider packages (`OpenAI`, `Anthropic`, `Gemini`).
- HTTP/gRPC generation export parity and OTLP trace transport parity.
- Provider wrapper parity for sync/stream flows and raw-artifact opt-in behavior.
- `.NET` task integration into `mise` and global SDK parity gate.

## Tasks

- [x] Add .NET SDK workspace and solution under `sdks/dotnet`.
- [x] Implement core API and recorder lifecycle parity:
  - `StartGeneration`
  - `StartStreamingGeneration`
  - `StartToolExecution`
  - `FlushAsync`
  - `ShutdownAsync`
- [x] Implement generation export runtime parity:
  - bounded queue
  - size/interval batch flush
  - retry/backoff
  - shutdown flush
- [x] Implement generation transport parity:
  - HTTP JSON export
  - gRPC protobuf export
- [x] Implement OTLP trace transport parity:
  - HTTP exporter
  - gRPC exporter
- [x] Implement provider wrappers and mappers:
  - OpenAI Chat Completions sync + stream
  - Anthropic Messages sync + stream
  - Gemini GenerateContent sync + stream
- [x] Keep raw artifacts default OFF with explicit opt-in only.
- [x] Implement core and provider test suites, including transport/auth coverage.
- [x] Add dependency-boundary test to keep core free of provider SDK dependencies.
- [x] Add `.NET` tooling and tasks in `mise.toml`.
- [x] Add `.NET` suites to `test:sdk:all`.
- [x] Add `.NET` SDK README and update architecture/docs indexes.

## Validation

Validated locally with:

- `mise exec -- dotnet test sdks/dotnet/Sigil.DotNet.sln -c Release`
- `mise run test:cs:sdk-core`
- `mise run test:cs:sdk-openai`
- `mise run test:cs:sdk-anthropic`
- `mise run test:cs:sdk-gemini`

All commands passed.

## Out of Scope (This Pass)

- OpenAI Responses API support.
- CI rollout changes beyond local `mise` parity gating.
