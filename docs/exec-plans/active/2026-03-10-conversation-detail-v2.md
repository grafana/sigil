---
owner: sigil-core
status: active
last_reviewed: 2026-03-10
source_of_truth: true
audience: both
---

# Execution Plan: Conversation Detail V2 Shared-Ref Payload

## Goal

Ship a smaller conversation detail wire contract that preserves full generation detail after hydration and works with the merged previous-turn UI path.

## Checklist

- [x] Add query-side V2 response builder that interns repeated messages, tools, system prompts, and metadata into shared tables.
- [x] Add `GET /api/v2/conversations/{conversation_id}` in Sigil HTTP routes.
- [x] Add frontend hydration logic for V2 shared refs and switch `getConversationDetail` to request the V2 payload through the stable conversation resource path (`format=v2`).
- [x] Add focused backend tests for V2 interning and HTTP route behavior.
- [x] Add gzip response compression on the Sigil HTTP server.
- [ ] Validate mixed-version/plugin-proxy compatibility for the stable conversation detail resource path with `format=v2` in `backend-enterprise`.
- [ ] Add/update proxy/resource tests covering `format=v2` conversation detail passthrough in `backend-enterprise`.
- [x] Update architecture/frontend docs and add this design/exec-plan pair.

## Notes

- V1 remains unchanged during the migration.
- The V2 builder currently derives from the existing hydrated V1 generation payloads, then interns repeated fields before encoding the response.
- The frontend now relies on the existing conversation detail resource path and the `format=v2` query param for compatibility while still consuming the compact payload.
