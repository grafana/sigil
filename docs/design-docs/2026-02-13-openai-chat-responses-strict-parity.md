---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# OpenAI Strict Parity: Chat Completions + Responses

## Context

OpenAI provider helpers across SDKs currently center on chat-completions helper DTOs.
This diverges from the official SDK surface and blocks strict cross-language parity for
the Responses API.

## Decision

Ship a single breaking parity pass that:

1. Adds strict official OpenAI SDK signatures for both chat and responses paths.
2. Uses provider-mirror naming for wrappers and mappers.
3. Keeps chat support first-class with no deprecation warnings.
4. Makes docs/examples responses-first while keeping chat documented.
5. Removes simplified OpenAI helper DTO public APIs.

## Public Contract

All SDKs expose both:

- Chat Completions sync + streaming wrappers
- Responses sync + streaming wrappers
- Strict mappers for chat and responses request/response payloads

The normalized generation contract remains unchanged:

- mode: `SYNC` or `STREAM`
- request controls: `max_tokens`, `temperature`, `top_p`, `tool_choice`, `thinking_enabled`
- thinking budget metadata: `sigil.gen_ai.request.thinking.budget_tokens`
- raw artifacts default off and opt-in only

## Rollout

One atomic PR across:

- `sdks/js`
- `sdks/python-providers/openai`
- `sdks/go-providers/openai`
- `sdks/java/providers/openai`
- `sdks/dotnet/src/Grafana.Sigil.OpenAI`

Related docs and active execution plan are updated in the same change.

