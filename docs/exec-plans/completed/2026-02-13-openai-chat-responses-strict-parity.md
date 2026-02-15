---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Execution Plan: OpenAI Strict Parity (Chat + Responses)

## Goal

Deliver strict OpenAI provider parity across JS, Python, Go, Java, and .NET for both
Chat Completions and Responses, with one atomic breaking change.

## Scope

- Replace simplified OpenAI helper DTO public APIs with strict provider-mirror surfaces.
- Add strict chat + responses wrappers and mappers in each SDK.
- Update tests and examples/devex emitters for dual OpenAI paths.
- Update architecture and docs to reflect responses support and strict parity.

## Tasks

- [x] Update docs and architecture references for strict OpenAI parity.
- [x] JS: strict namespaces for chat/responses + tests/docs.
- [x] Python: strict chat/responses modules + tests/docs.
- [x] Go: strict chat/responses wrappers + mappers + tests/docs.
- [x] Java: strict chat/responses wrappers + mappers + tests/docs.
- [x] .NET: strict chat/responses recorder + mapper + tests/docs.
- [x] Devex emitters: emit both openai chat and openai responses shapes.
- [x] Run SDK parity validation suites.

## Validation Commands

- `mise run test:go:sdk-openai`
- `mise run test:ts:sdk-js`
- `mise run test:py:sdk-openai`
- `mise run test:java:sdk-openai`
- `mise run test:cs:sdk-openai`
- `mise run test:sdk:all`
