---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: false
audience: both
---

# Agent Identity Fields (`agent_name`, `agent_version`)

## Goal

Add optional agent identity metadata to generation payloads and emitted spans, with parity across SDK core, provider helpers, transport contracts, docs, and tests.

## Scope

- Proto/API contract: optional `agent_name`, `agent_version` on `Generation`.
- SDK core: generation/tool start fields, context helpers, span attributes, proto mapping.
- Provider helpers: options + propagation for OpenAI, Anthropic, Gemini.
- Documentation: architecture and generation ingest contract, plus SDK/provider examples.
- Tests: core behavior, transport roundtrip parity, provider mapper assertions.

## Tasks

- [x] Extend `Generation` proto with `agent_name` and `agent_version`.
- [x] Regenerate API and SDK protobuf stubs.
- [x] Add SDK core fields and context helpers.
- [x] Emit `gen_ai.agent.name` and `gen_ai.agent.version` on generation and tool spans.
- [x] Propagate fields through provider wrappers and mapper outputs.
- [x] Update examples and README snippets to demonstrate both fields.
- [x] Extend tests for context fallback, precedence, and transport fidelity.
- [x] Update architecture and reference contract docs.

## Notes

- Both fields are optional.
- `agent_version` has no strict validation and accepts any string.
- `gen_ai.agent.version` is emitted as an OTel-style extension key.
