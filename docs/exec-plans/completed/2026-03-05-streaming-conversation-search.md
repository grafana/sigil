---
owner: sigil-core
status: completed
last_reviewed: 2026-03-05
source_of_truth: true
audience: both
---

# Execution Plan: Streaming Conversation Search

## Goal

Reduce perceived latency on the main Conversations page by streaming conversation search results from the plugin backend while preserving existing search semantics and keeping the existing buffered JSON route for compatibility.

## Source Design Doc

- `docs/design-docs/2026-03-05-streaming-conversation-search.md`

## Completion Summary (2026-03-05)

- Added plugin route `POST /query/conversations/search/stream` with `application/x-ndjson` response frames for `results`, `complete`, and `error`.
- Refactored plugin conversation search to use one shared engine for both buffered JSON and streaming routes.
- Kept the existing buffered route `POST /query/conversations/search` and wired it through the same shared search logic.
- Extended plugin frontend conversation datasource with a streaming client based on browser `fetch()` and NDJSON parsing.
- Switched only the main Conversations page to use streaming search, stale-request abort, and first-result auto-selection.
- Added frontend fallback to the existing JSON route when streaming is unavailable.
- Updated Storybook, backend route tests, frontend page tests, and datasource parser tests for the new contract.
- Updated `ARCHITECTURE.md`, `docs/FRONTEND.md`, and docs indexes to capture the new plugin-owned streaming route and exception to the default frontend transport rule.

## Delivered Scope

- Plugin backend streaming conversation search route
- Shared buffered/streaming search engine
- Main Conversations page streaming rollout
- JSON fallback path
- Automated backend and frontend coverage
- Documentation updates

## Out of Scope

- New Sigil `/api/v1` streaming search endpoint
- Streaming rollout to dashboard panels, landing search, generation pickers, or other search consumers
- Streaming conversation detail or generation detail payloads
