---
owner: sigil-core
status: active
last_reviewed: 2026-03-10
source_of_truth: true
audience: both
---

# Conversation Detail V2 Shared-Ref Payload

## Goal

Reduce conversation detail response size without dropping generation-detail fidelity needed by the current UI and the merged previous-turn flow from PR 417.

## Decision

- Add `GET /api/v2/conversations/{conversation_id}` as an explicit new contract.
- Keep `GET /api/v1/conversations/{conversation_id}` unchanged during migration.
- Move repeated payload blobs behind shared tables:
  - `shared.messages`
  - `shared.tools`
  - `shared.system_prompts`
  - `shared.metadata`
- Emit dense integer refs on each generation payload:
  - `input_refs`
  - `output_refs`
  - `tool_refs`
  - `system_prompt_ref`
  - `metadata_ref`
- Keep scalar and low-cardinality generation fields inline so the payload remains a full-fidelity generation detail contract after hydration.

## Frontend Contract

- The plugin conversation API layer fetches the V2 resource path and hydrates it back into the existing `ConversationDetail` / `GenerationDetail` runtime shape.
- Downstream conversation-detail components do not consume ref tables directly.
- Invalid ref indexes fail fast during hydration instead of being ignored.

## Transport

- Sigil HTTP responses are gzip-compressed when the client advertises gzip support.
- This applies to both V1 and V2 JSON responses and gives an immediate wire-size win even before every caller moves to V2.

## Rollout

- Land V2 in Sigil and switch the plugin conversation data source to the V2 resource route.
- Keep V1 available as a compatibility path until parity confidence is established.
- Coordinate the plugin backend/resource proxy route for the explicit V2 path in `backend-enterprise`; that repo is outside this workspace.
