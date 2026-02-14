---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Conversation Ratings and Annotations Delivery

## Goal

Deliver separate conversation signal APIs:

- `ratings` for user/SDK-facing quality feedback
- `annotations` for operator-facing triage workflows

while enabling cheap conversation-list filtering and timeline drilldown.

## Scope

- Ratings API (HTTP) and SDK support in all SDKs
- Annotations API (HTTP, operator/plugin path)
- MySQL event + summary tables for both signals
- Query/UI surface updates for list filters and conversation timelines
- Auth/identity handling for operator annotations from Grafana user context

## Source design doc

- `docs/design-docs/2026-02-13-conversation-ratings-and-annotations.md`

## Completion policy

- A checkbox moves to `[x]` only when implementation code and automated tests for that item are merged to `main`.
- Design docs, architecture text, or branch-local changes are not sufficient to close checklist items.

## Implementation phases

### Phase A: Ratings contract and schema

- [x] Define HTTP request/response contract for ratings (`ConversationRatingValue`, payload fields, errors).
- [x] Add endpoint `POST /api/v1/conversations/{conversation_id}/ratings`.
- [x] Add ratings list endpoint `GET /api/v1/conversations/{conversation_id}/ratings`.
- [x] Add MySQL table `conversation_ratings`.
- [x] Add MySQL table `conversation_rating_summaries`.
- [x] Add rating indexes for tenant+conversation reads and bad-rating filtering.

### Phase B: Ratings ingest and query integration

- [x] Implement rating validation and payload limits.
- [x] Implement idempotency on `(tenant_id, rating_id)`.
- [x] Implement replay conflict behavior for same id/key with different payload.
- [x] Implement transactional insert + summary upsert flow.
- [x] Extend conversation list/detail responses with `rating_summary`.
- [x] Add list filter `has_bad_rating`.
- [x] Add service metrics for rating request/latency/results.

### Phase C: SDK parity for ratings (all languages)

- [x] Go SDK: `SubmitConversationRating`.
- [x] Python SDK: `submit_conversation_rating`.
- [x] TypeScript/JavaScript SDK: `submitConversationRating`.
- [x] Java SDK: `submitConversationRating`.
- [x] .NET SDK: `SubmitConversationRatingAsync`.
- [x] Reuse auth/tenant behavior patterns in each SDK (same as ingest auth boundary).
- [x] Implement ratings submission over HTTP transport in each SDK.
- [x] Add SDK tests for ratings HTTP transport, validation, and idempotency error mapping.

### Phase D: Annotations contract and schema

- [x] Add endpoint `POST /api/v1/conversations/{conversation_id}/annotations`.
- [x] Add endpoint `GET /api/v1/conversations/{conversation_id}/annotations`.
- [x] Add MySQL table `conversation_annotations`.
- [x] Add MySQL table `conversation_annotation_summaries`.
- [x] Add annotation indexes for tenant+conversation timeline reads.
- [x] Implement annotation validation and payload limits.
- [x] Implement idempotency on `(tenant_id, annotation_id)`.
- [x] Implement transactional insert + annotation summary upsert flow.

### Phase E: Operator identity and plugin path

- [x] Plugin backend injects Grafana user identity headers for annotation writes.
- [x] Sigil annotation create path requires operator identity headers.
- [x] Sigil persists `operator_id`, `operator_login`, `operator_name`.
- [x] Add plugin backend proxy routes for ratings and annotations endpoints.
- [x] Add auth/tenant tests for new proxy and API paths.

### Phase F: UI surfacing

- [x] Conversation list: show rating summary and annotation summary.
- [x] Conversation list: add filters `has_bad_rating` and `has_annotations`.
- [x] Conversation detail: show ratings timeline section.
- [x] Conversation detail: show operator annotations timeline section.
- [x] Conversation detail: merge/sort timeline events with clear event-type badges.
- [x] Add frontend tests for filtering, rendering, and timeline interactions.

### Phase G: Docs and rollout

- [x] Update `ARCHITECTURE.md` with ratings/annotations API and storage contracts.
- [x] Update `sigil/docs/README.md` endpoint list.
- [x] Update `docs/FRONTEND.md` proxy contract routes.
- [x] Update all SDK READMEs with ratings examples (no annotation SDK section).
- [x] Add feature flags:
  - `SIGIL_CONVERSATION_RATINGS_ENABLED`
  - `SIGIL_CONVERSATION_ANNOTATIONS_ENABLED`
- [x] Update `docs/generated/db-schema.md` with new tables.

## Required tests

- API handler tests for ratings create/list behavior and tenant enforcement.
- API handler tests for annotations create/list behavior and operator identity requirements.
- Storage tests for rating and annotation summary consistency.
- Idempotency tests for both ratings and annotations.
- Query tests for `has_bad_rating` and `has_annotations` filters.
- SDK tests for ratings HTTP transport and validation behavior.
- Plugin proxy tests for operator identity propagation.

## Risks

- Confusion between rating quality signal and operator notes.
- Operator identity trust boundary could be weak if headers are not set consistently.
- Summary drift if write + summary update is not transactional.

## Exit criteria

- Ratings can be submitted through all SDKs and queried per conversation.
- Annotations can be submitted by operators through Sigil/Grafana plugin and queried per conversation.
- Conversation list supports bad-rating and annotation filters with summary fields.
- Bad-conversation flag is derived from ratings only and remains stable.
- All new behaviors are covered by automated tests.

## Out of scope

- LLM-as-judge and offline evaluation workflows.
- Annotation taxonomy automation or policy engines.
- Retention/deletion workflows for ratings/annotations content.
