---
owner: sigil-core
status: completed
last_reviewed: 2026-03-05
source_of_truth: true
audience: both
---

# Streaming Conversation Search

## Context

Conversation search already lives in the plugin backend as a Tempo-backed orchestration flow:

- plugin backend builds TraceQL and queries Tempo through the Grafana datasource proxy
- plugin backend hydrates conversation metadata from Sigil `POST /api/v1/conversations:batch-metadata`
- frontend receives one buffered JSON response after the full search finishes

That shape keeps the API simple, but it delays the first visible result until every Tempo window, metadata batch, and cursor decision completes.

## Decision Summary

Sigil adds a plugin-owned streaming route for conversation search:

- `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search/stream`
- request body is identical to the existing JSON search route
- response content type is `application/x-ndjson`
- stream frames are:
  - `{"type":"results","conversations":[...]}`
  - `{"type":"complete","has_more":true|false,"next_cursor":"..."}`
  - `{"type":"error","message":"..."}`

The existing buffered route remains:

- `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search`

Both routes share one backend search engine so filtering, ordering, dedupe, and cursor semantics stay identical.

## Transport Choice

NDJSON over `POST` is used instead of SSE because:

- the existing request body is already JSON and does not fit naturally into SSE `GET`
- browser `fetch()` can consume incremental chunks without adding a second session-setup endpoint
- the plugin backend already uses `httpadapter`, which supports flush-based chunk delivery

## Backend Semantics

- Result batches are emitted once per Tempo search iteration when that iteration adds new conversations to the current page.
- `complete` is emitted only after the backend has finalized `has_more` and `next_cursor`.
- If validation or upstream failure happens before the stream starts, the route returns a normal HTTP error response.
- If failure happens after at least one chunk has been written, the route emits an `error` frame and closes the stream.
- No Sigil `/api/v1` search endpoint is added in this milestone. Search remains plugin-owned.

## Frontend Semantics

- Only the main Conversations page switches to the streaming route in this milestone.
- The datasource adds a streaming method that uses browser `fetch()` plus incremental NDJSON parsing.
- The page aborts stale searches when a newer search starts or the page unmounts.
- The first streamed conversation is auto-selected so detail loading can start before the search completes.
- `load more` uses the same streaming route with the existing cursor request field.
- Pagination state updates only when the final `complete` frame arrives.
- If a stream fails after partial rows were rendered, rows remain visible, an error banner is shown, and pagination is cleared until the user reruns the search.

## Compatibility

- Existing search callers outside the main Conversations page continue to use the buffered JSON route.
- The streaming client falls back to the buffered JSON route when the stream endpoint is unavailable or the browser cannot expose a response body stream.
- RBAC remains under the existing `grafana-sigil-app.data:read` permission.

## Consequences

### Positive

- Faster perceived search response on the main Conversations page.
- No new Sigil server contract or tenant/auth path to maintain.
- Shared search engine avoids drift between buffered and streaming behavior.

### Tradeoffs

- The main Conversations page needs one explicit exception to the usual `getBackendSrv().fetch()` rule.
- Mid-stream failure can leave partial rows visible without a reusable cursor.
- Other search surfaces remain buffered until a later rollout expands the client.
