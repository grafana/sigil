---
owner: sigil-core
status: completed
last_reviewed: 2026-02-16
source_of_truth: true
audience: both
---

# Execution Plan: Conversation and Generation Query Path

## Goal

Replace the placeholder query endpoints with a production conversation search backed by Tempo, hydrated from MySQL/object storage, with a user-friendly filter language.

## Scope

- Filter expression parser and TraceQL translator
- Tempo HTTP search client and response processor
- Conversation search endpoint with pagination
- Conversation detail endpoint (full generation hydration)
- Generation detail endpoint
- Tag discovery endpoints for filter autocomplete
- Drop placeholder stubs (`/api/v1/completions`, `/api/v1/traces/{trace_id}`)
- Wire new endpoints into HTTP routes and plugin proxy

## Source Design Doc

- `docs/design-docs/2026-02-15-conversation-query-path.md`

## Completion Summary (2026-02-15)

- Implemented full conversation query path in `sigil/internal/query`:
  - filter parser + TraceQL builder
  - Tempo search/tags client
  - pagination cursor + overfetch loop
  - conversation search/detail and generation detail services
- Replaced placeholder HTTP routes with production endpoints in `sigil/internal/server/http.go`.
- Wired query service dependencies for hot+cold hydration in `sigil/internal/server_module.go`.
- Updated plugin backend resource proxy routes for search/detail/tags endpoints.
- Delivered plugin testing UI updates (filter bar + cursor pagination + detail panes) and stories.
- Added/updated backend, proxy, and frontend automated tests for query path behavior.
- Removed runtime `memory` storage backend wiring; query-path startup now strictly requires MySQL WAL + configured object storage.
- Follow-up fix (2026-02-16): empty-filter TraceQL now uses `span.sigil.generation.id != ""` (instead of hardcoded operation names) so conversations remain discoverable when SDKs emit custom generation operation names.
- Added opt-in backend debug logs for query-path search/tag-value flows via `SIGIL_QUERY_DEBUG=true` to diagnose where results are filtered out.
- Follow-up fix (2026-02-16): plugin backend tenant propagation now only preserves inbound `X-Scope-OrgID` or uses configured fallback tenant ID (`fake` by default); it no longer derives tenant from `X-Grafana-Org-Id`.
- Follow-up fix (2026-02-16): local Compose tenant semantics aligned end-to-end by enabling Tempo multitenancy and configuring Alloy Tempo exporter to inject `X-Scope-OrgID: fake`.
- Follow-up fix (2026-02-16): tag-values alias resolution now preserves scoped Tempo keys (for example `model -> span.gen_ai.request.model`) so Tempo v2 tag-value lookups do not fail parsing.
- Follow-up fix (2026-02-16): plugin search tag-value route parsing now supports both URL-escaped and already-decoded slash-bearing keys (for example Kubernetes label keys containing `/`).
- Verified quality gates with `mise run check` (format/lint/typecheck/tests).

## Dependencies

- Phase D fan-out store (`storage.FanOutStore`) from `docs/exec-plans/active/2026-02-12-phase-2-hybrid-storage.md`. The conversation and generation detail endpoints need fan-out reads (hot MySQL + cold object storage, dedupe by `generation_id`). This can be developed in parallel: detail endpoints start with MySQL-only reads and switch to fan-out when Phase D lands.
- Existing `WALReader.GetByID` and `WALReader.GetByConversationID` for hot reads.
- Existing query proxy infrastructure (`sigil/internal/queryproxy`) for Tempo HTTP connectivity config.

## Implementation Phases

### Phase 1: Filter parser and TraceQL builder

- [x] Define filter expression grammar: `key op value` tokens with well-known key aliases.
- [x] Implement filter parser in `sigil/internal/query/filter.go`: tokenize input, classify each filter as Tempo-routed or MySQL-routed.
- [x] Implement TraceQL builder: translate Tempo-routed filters to a TraceQL query string with base predicate (`span.gen_ai.operation.name != ""`) and `select()` clause, plus empty-filter guard (`span.sigil.generation.id != ""`) to target generation spans without hardcoding operation names.
- [x] Implement well-known key alias map (model -> `span.gen_ai.request.model`, etc.).
- [x] Handle special cases: `status = error` -> `span.error.type != ""`, `tool.name` -> scoped to `execute_tool` spans.
- [x] Add parser/builder unit tests with table-driven cases covering all operators, well-known keys, arbitrary attributes, and edge cases (empty filter, MySQL-only filter, mixed filter).

### Phase 2: Tempo search client

- [x] Implement Tempo HTTP search client in `sigil/internal/query/tempo.go`: build URL, call `GET /api/search`, parse JSON response.
- [x] Define Go types for Tempo search response (`SearchResponse`, `TraceResult`, `SpanSet`, `Span`, `Attribute`).
- [x] Implement span attribute extraction: walk `traces[].spanSets[].spans[].attributes[]`, extract `gen_ai.conversation.id`, `sigil.generation.id`, model, agent, error fields, and user-selected columns.
- [x] Implement conversation grouping: group extracted spans by `conversation_id`, collect distinct generation IDs, trace IDs, models, agents, error counts, and selected attribute values per conversation.
- [x] Configure Tempo base URL from existing `queryproxy.Config.TempoBaseURL`.
- [x] Add unit tests with recorded Tempo response fixtures.

### Phase 3: Pagination and overfetch loop

- [x] Implement cursor encoding/decoding in `sigil/internal/query/pagination.go`: `end_nanos`, `returned_conversations` set, `filter_hash`.
- [x] Implement overfetch loop: query Tempo with `3 * page_size` limit, accumulate conversations, shrink time window if more needed, cap at max iterations (default 5).
- [x] Implement cursor validation: reject cursor if `filter_hash` doesn't match current filter.
- [x] Add tests: full page, partial page (Tempo exhausted), multi-round overfetch, cursor continuation, filter change invalidation.

### Phase 4: Conversation search endpoint

- [x] Implement `POST /api/v1/conversations/search` handler: parse request body, invoke filter parser, run Tempo search with pagination, enrich from MySQL (`conversations`, `conversation_rating_summaries`, `conversation_annotation_summaries`), apply MySQL-side filters, build response.
- [x] Implement MySQL batch enrichment: batch-fetch conversation metadata, rating summaries, and annotation summaries for a set of conversation IDs.
- [x] Implement MySQL-side filter application (`generation_count` comparisons).
- [x] Register route in `sigil/internal/server/http.go` with tenant middleware.
- [x] Add integration test: filter -> TraceQL -> Tempo mock -> MySQL -> response assertion.

### Phase 5: Conversation detail endpoint

- [x] Implement `GET /api/v1/conversations/{conversation_id}` handler: read all generations for the conversation from MySQL (hot) via `WALReader.GetByConversationID`, deserialize payloads, sort by `created_at`, include trace/span links, ratings, annotations.
- [x] When Phase D fan-out store is available: switch to fan-out reads (hot + cold, dedupe by `generation_id`, hot-row preference).
- [x] Register route in HTTP server (replaces existing `GET /api/v1/conversations/{id}` handler with richer response).
- [x] Add tests: conversation with multiple generations, empty conversation, tenant isolation.

### Phase 6: Generation detail endpoint

- [x] Implement `GET /api/v1/generations/{generation_id}` handler: read single generation from MySQL via `WALReader.GetByID`, deserialize payload, return full generation with trace/span links.
- [x] When Phase D fan-out store is available: add cold-store fallback.
- [x] Register route in HTTP server.
- [x] Add tests: existing generation, missing generation, tenant isolation.

### Phase 7: Tag discovery endpoints

- [x] Implement `GET /api/v1/search/tags` handler: call Tempo `GET /api/v2/search/tags`, merge with well-known Sigil aliases and MySQL-only keys, return unified tag list.
- [x] Implement `GET /api/v1/search/tag/{tag}/values` handler: map alias to full attribute path, call Tempo `GET /api/v2/search/tag/{path}/values`, return values.
- [x] Register routes in HTTP server with tenant middleware.
- [x] Add tests with Tempo mock responses.

### Phase 8: Route cleanup and plugin proxy wiring

- [x] Remove placeholder handlers: `listCompletions`, `getTrace` from `sigil/internal/server/http.go`.
- [x] Remove unused `Completion` and `Trace` types and bootstrap methods from `sigil/internal/query/service.go`.
- [x] Add plugin backend resource routes for new endpoints:
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/generations/{id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tags`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tag/{tag}/values`
- [x] Update existing conversation list/detail plugin routes to use new handlers.
- [x] Add route tests asserting new endpoint registration and placeholder removal.

### Phase 9: Docs and cleanup

- [x] Update `ARCHITECTURE.md` Query Model section with new endpoint contracts and flow.
- [x] Update `docs/design-docs/index.md` with new design doc entry.
- [x] Update `docs/index.md` with new exec plan reference.
- [x] Update `docs/references/grafana-query-response-shapes.md` if response shapes diverge from existing contract.
- [x] Capture deferred work in `docs/exec-plans/tech-debt-tracker.md`:
  - Ingest-time materialization of conversation aggregates
  - `sigil.sdk.name` span attribute for strict scoping
  - `sigil.gen_ai.tool_call_count` span attribute
  - Generation search endpoint
  - Streaming search support

## Risks

- **Tempo search latency**: overfetch loop may add variable latency. Mitigated by max iteration bound and overfetch multiplier tuning.
- **Pagination non-determinism**: Tempo returns non-deterministic results for identical queries. Time-window cursor minimizes but does not eliminate duplicates across pages. `returned_conversations` set in cursor handles dedup.
- **Summary coverage**: Tempo span attributes reflect matching spans only, not all generations. UI must communicate this clearly. Mitigated by MySQL authoritative `generation_count`.
- **Fan-out store dependency**: conversation/generation detail endpoints need Phase D fan-out for cold-store reads. Mitigated by starting with MySQL-only (hot) reads and adding cold-store when Phase D lands.
- **Filter parser complexity**: arbitrary attribute support (`resource.X`, `span.X`) plus special-case handling (`status = error`) creates parser surface area. Mitigated by table-driven tests with comprehensive edge cases.

### Phase 10: Testing UI (filter bar + conversation list)

A quick testing UI to validate all query endpoints end-to-end through the plugin frontend. Not a production UI -- just enough to exercise every filter and endpoint.

- [x] Add new types in `apps/plugin/src/conversation/types.ts`:
  - `ConversationSearchRequest` (filters string, select array, time_range, page_size, cursor)
  - `ConversationSearchResult` (conversation_id, generation_count, models, agents, error_count, has_errors, trace_ids, rating_summary, annotation_count, selected)
  - `ConversationSearchResponse` (conversations array, next_cursor, has_more)
  - `ConversationDetail` (full conversation with hydrated generations array)
  - `GenerationDetail` (full generation payload with trace/span links)
- [x] Add API methods in `apps/plugin/src/conversation/api.ts`:
  - `searchConversations(request)` -> `POST /resources/query/conversations/search`
  - `getConversationDetail(id)` -> `GET /resources/query/conversations/{id}` (returns full hydrated generations)
  - `getGeneration(id)` -> `GET /resources/query/generations/{id}`
  - `getSearchTags(start, end)` -> `GET /resources/query/search/tags`
  - `getSearchTagValues(tag, start, end)` -> `GET /resources/query/search/tag/{tag}/values`
- [x] Build filter bar component (`apps/plugin/src/components/FilterBar.tsx`):
  - Text input with `key op value` syntax
  - Autocomplete dropdown powered by `getSearchTags` and `getSearchTagValues`
  - Well-known key suggestions (model, agent, provider, status, duration, tool.name, namespace, cluster, service, generation_count)
  - Parse tokens and show as pills/chips with remove button
  - Time range picker (start/end)
- [x] Update `ConversationsPage.tsx`:
  - Replace boolean filter dropdowns with the new filter bar component
  - Wire filter bar to `searchConversations` API
  - Display search results with default summary columns (conversation_id, generation_count, models, agents, error_count, timestamps, trace_ids)
  - Add "Load more" button wired to cursor pagination
  - On row click: call `getConversationDetail` and show full conversation with all generations (messages, tools, usage, trace/span links)
  - On generation click: call `getGeneration` and show full generation detail
  - Show trace link per generation (link to Tempo proxy for trace view)
- [x] Add Storybook stories:
  - `FilterBar.stories.tsx` with mock tag/values responses
  - Updated `ConversationsPage.stories.tsx` with mock search results and detail views
- [x] Manual test checklist:
  - Empty filter returns all conversations
  - Single filter: `model = "gpt-4o"`
  - Multiple filters: `model = "gpt-4o" status = error duration > 5s`
  - MySQL-routed filter: `generation_count > 5`
  - Tool filter: `tool.name = "weather"`
  - Resource attribute filter: `namespace = "production"`
  - Pagination: "Load more" fetches next page
  - Conversation detail: shows all generations with messages and trace links
  - Generation detail: shows full payload

## Exit Criteria

- Conversation search returns paginated results filtered by span/resource attributes and conversation-level metadata.
- Filter bar expression is parsed and translated to TraceQL without exposing TraceQL syntax to users.
- Conversation detail returns all hydrated generations with trace/span links.
- Generation detail returns full payload with trace/span links.
- Tag discovery endpoints provide autocomplete data from Tempo merged with well-known aliases.
- Placeholder endpoints are removed.
- Plugin proxy routes are wired for all new endpoints.
- Tests cover filter parsing, TraceQL building, Tempo response processing, pagination, endpoint handlers, and tenant isolation.
- Testing UI exercises all filter types, pagination, conversation detail, and generation detail through the plugin frontend.

## Out of Scope

- Ingest-time materialization of conversation aggregates.
- Production-quality UI design and polish (separate track).
- Generation search endpoint (`POST /api/v1/generations/search`).
- Streaming search.
- `sigil.sdk.name` or `sigil.gen_ai.tool_call_count` SDK changes.
