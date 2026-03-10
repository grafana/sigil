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
- [x] Add frontend hydration logic for V2 shared refs and switch `getConversationDetail` to the V2 resource path.
- [x] Add focused backend tests for V2 interning and HTTP route behavior.
- [x] Add gzip response compression on the Sigil HTTP server.
- [ ] Add/update plugin backend proxy route for `/query/v2/conversations/{conversation_id}` in `backend-enterprise`.
- [ ] Add proxy/resource tests for the V2 route in `backend-enterprise`.
- [x] Update architecture/frontend docs and add this design/exec-plan pair.

## Notes

- V1 remains unchanged during the migration.
- The V2 builder currently derives from the existing hydrated V1 generation payloads, then interns repeated fields before encoding the response.
- Cross-repo proxy work is required before the new frontend route can be exercised end-to-end outside this repository.
