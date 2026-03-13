---
owner: sigil-core
status: active
last_reviewed: 2026-03-07
source_of_truth: true
audience: contributors
---

# Frontend

Purpose: define plugin UI architecture, proxy boundaries, and frame-compatibility contracts for Sigil in Grafana.

## Core Rules

- Keep plugin code under `apps/plugin/src`.
- Frontend query calls must go through plugin backend resources only.
- Frontend must not call Sigil API query endpoints directly.
- Use `getBackendSrv().fetch()` for plugin-to-backend calls by default.
- Exception: browser `fetch()` is allowed for the conversation search streaming route because the page must consume incremental NDJSON chunks.
- Evaluation actor metadata is backend-owned. Frontend eval request payloads must not send `created_by` or `updated_by`.
- Conversation detail fetch prefers the shared-ref V2 payload via the stable V1 conversation route using `format=v2`, then hydrates it back into the existing runtime detail shape inside the conversation API layer.

## Proxy Contract

Current plugin query contract:

- Frontend query entrypoints:
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search/stream`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}?format=v2`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/generations/{generation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/agents`
  - `POST /api/plugins/grafana-sigil-app/resources/query/agents/search`
  - `GET /api/plugins/grafana-sigil-app/resources/query/agents/lookup`
  - `GET /api/plugins/grafana-sigil-app/resources/query/agents/versions`
  - `POST /api/plugins/grafana-sigil-app/resources/query/agents/runtime-context`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tags`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tag/{tag}/values`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/model-cards`
  - `GET /api/plugins/grafana-sigil-app/resources/query/model-cards/lookup`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/prometheus/...`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/...`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/evaluators`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/evaluators`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/evaluators/{evaluator_id}`
  - `DELETE /api/plugins/grafana-sigil-app/resources/eval/evaluators/{evaluator_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/predefined/evaluators`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/predefined/evaluators/{template_id}:fork`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/rules`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/rules`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `PATCH /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `DELETE /api/plugins/grafana-sigil-app/resources/eval/rules/{rule_id}`
  - `POST /api/plugins/grafana-sigil-app/resources/eval/rules:preview`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/judge/providers`
  - `GET /api/plugins/grafana-sigil-app/resources/eval/judge/models?provider={id}`
- Plugin backend still exposes `GET /api/plugins/grafana-sigil-app/resources/query/v2/conversations/{conversation_id}` for direct V2 passthrough, but frontend callers should prefer the stable `format=v2` form above for compatibility.
- Plugin backend forwards to Sigil API query endpoints:
  - `POST /api/v1/conversations:batch-metadata` (search hydration only)
  - `GET /api/v1/conversations/{conversation_id}?format=v2`
  - `GET /api/v2/conversations/{conversation_id}` (supported passthrough; not the preferred frontend entrypoint)
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/generations/{generation_id}`
  - `GET /api/v1/agents`
  - `POST /api/v1/agents/search`
  - `GET /api/v1/agents:lookup`
  - `GET /api/v1/agents:versions`
  - `POST /api/v1/agents:runtime-context`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `POST /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/model-cards` (list mode and `resolve_pair` mode)
  - `GET /api/v1/model-cards:lookup`
  - `GET /api/v1/eval/evaluators`
  - `POST /api/v1/eval/evaluators`
  - `GET /api/v1/eval/evaluators/{evaluator_id}`
  - `DELETE /api/v1/eval/evaluators/{evaluator_id}`
  - `GET /api/v1/eval/predefined/evaluators`
  - `POST /api/v1/eval/predefined/evaluators/{template_id}:fork`
  - `GET /api/v1/eval/rules`
  - `POST /api/v1/eval/rules`
  - `GET /api/v1/eval/rules/{rule_id}`
  - `PATCH /api/v1/eval/rules/{rule_id}`
  - `DELETE /api/v1/eval/rules/{rule_id}`
  - `POST /api/v1/eval/rules:preview`
  - `GET /api/v1/eval/judge/providers`
  - `GET /api/v1/eval/judge/models?provider={id}`

For eval write routes, the plugin backend also forwards trusted Grafana user identity to Sigil using:

- `X-Grafana-User`

This header is derived from Grafana request context in the plugin backend, not from page code.

Conversation search and search-tag discovery are plugin-owned orchestration flows:

- plugin backend exposes buffered JSON search and NDJSON streaming search routes for the same conversation-search semantics
- plugin backend proxies conversation search/search-stream/stats to Sigil when the Sigil endpoints are available
- plugin backend uses Grafana Tempo datasource proxy directly only for:
  - legacy fallback when the Sigil search endpoints are not available
  - raw Tempo proxy routes (`/query/proxy/tempo/...`)

Conversation search routing rules:

- `time_range` selects conversations that have at least one generation in the requested window.
- Returned search summary fields are lifetime/current conversation summaries from the MySQL projection, not values restricted to the matched window.
- MySQL projection fast path is used for browse-safe conversation filters available in projection, including `generation_count`, `provider`, `model`, `agent`, `status=error`, and projected token select fields.
- Projection `!=` filters on `provider`, `model`, and `agent` are full-conversation exclusions: the target must be absent from the conversation summary.
- Tempo is used only when hit selection depends on unsupported trace predicates such as arbitrary `span.*`, `resource.*`, tool filters, or other deep search conditions.
- Projection summaries are not backfilled. This change does not provide or support a backfill migration. On upgraded deployments, older conversations may temporarily show partial lifetime summaries or token counters until those rows are refreshed by new ingest. This is intentional and accepted.

Reason: the product contract is "find conversations that were active in this window, then return their current conversation summary." The MySQL projection stores that summary directly, while Tempo is only needed when MySQL cannot identify the matching conversation set.

Legacy placeholders removed:

- `/api/v1/completions`
- `/api/v1/traces/{trace_id}`

Tenant headers are applied/forwarded by plugin backend proxy logic, not by page components.

## Plugin RBAC

Sigil plugin query routes enforce action-based RBAC in the plugin backend:

- `grafana-sigil-app.data:read`
  - `GET /query/conversations`
  - `GET /query/v2/conversations/{conversation_id}`
  - `POST /query/conversations/search`
  - `POST /query/conversations/search/stream`
  - `GET /query/conversations/{conversation_id}`
  - `GET /query/conversations/{conversation_id}/ratings`
  - `GET /query/conversations/{conversation_id}/annotations`
  - `GET /query/generations/{generation_id}`
  - `GET /query/agents`
  - `POST /query/agents/search`
  - `GET /query/agents/lookup`
  - `GET /query/agents/versions`
  - `POST /query/agents/runtime-context`
  - `GET /query/search/tags`
  - `GET /query/search/tag/{tag}/values`
  - `GET /query/model-cards`
  - `GET /query/model-cards/lookup`
  - `GET /query/settings`
  - `GET|POST /query/proxy/prometheus/...`
  - `GET /query/proxy/tempo/...`
- `grafana-sigil-app.feedback:write`
  - `POST /query/conversations/{conversation_id}/ratings`
  - `POST /query/conversations/{conversation_id}/annotations`
- `grafana-sigil-app.settings:write`
  - `PUT /query/settings/datasources`

Default role grants in `apps/plugin/src/plugin.json`:

- `Sigil Reader` (granted to `Editor`, `Admin`)
- `Sigil Feedback Writer` (manual assignment)
- `Sigil Admin` (granted to `Admin`)

Current plugin backend tenant header precedence:

1. Preserve inbound `X-Scope-OrgID` when present.
2. Otherwise use plugin connection fallback tenant ID (default `fake`).

## Response Shape Contract

Sigil query responses consumed by frontend must follow Grafana datasource query envelope semantics:

- `QueryDataResponse` with `results.<refId>.frames`

Frame compatibility requirements:

- metrics frames must render in graph/table panels
- trace detail frames must support Grafana trace view conventions
- trace search frames must support Tempo-style table/drilldown patterns

See `docs/references/grafana-query-response-shapes.md`.

## Page Responsibilities

- Dashboard:
  - run metrics panels from Prometheus proxy endpoints only
  - support fuzzy filters for provider/model/agent and arbitrary label-key/value matchers
  - allow advanced raw matcher clauses for resource labels injected by Alloy/OTel pipelines
  - estimate cost from token metrics plus model-card resolve mode (`resolve_pair=provider:model`)
  - use strict provider+model pricing joins; unresolved pairs remain explicit (no fallback guessing)
  - when resolve maps cloud-provider model IDs to catalog IDs (for example Bedrock IDs mapping to `anthropic/*` cards), keep original provider/model labels in UI and show mapping as supplemental context
- Conversations:
  - query conversations with expression filters and selectable attributes
  - progressively append streamed conversation search rows on the main conversations page while preserving the existing cursor contract at stream completion
  - display optional `conversation_title` labels from Tempo span attribute `sigil.conversation.title` (latest matching span wins; fallback to conversation id)
  - display optional conversation `user_id` labels from Tempo span attribute `user.id` (latest matching span wins)
  - support cursor pagination in list view
  - open conversation detail with hydrated generations, ratings, and annotations
  - hydrate V2 shared-ref detail payloads (`messages`, `tools`, `system_prompts`, `metadata`) back into the existing `ConversationDetail` / `GenerationDetail` runtime shape before rendering
  - display optional conversation detail `user_id` from generation metadata key `sigil.user.id`
  - open generation detail with trace/span identifiers
  - render conversation span tree with the local Jaeger-style tree component (`SigilSpanTree`) backed by:
    - `components/conversations/jaegerTree/adapter.ts` for flattening and row metadata
    - `components/conversations/jaegerTree/collapseState.ts` for collapse/expand behavior parity
  - keep the tree customization surface plugin-owned via `renderNode` callback on `SigilSpanTree`
- Evaluation:
  - manage evaluators: browse predefined evaluators, fork/customize them into tenant evaluators, create custom evaluators, and manage tenant template versions
  - manage rules: create with selector/match/sample-rate/evaluator config, enable/disable, list and delete
  - visualize evaluation pipeline: render each rule as a horizontal flow (selector → match → sample → evaluators)
  - preview rule matching: dry-run rule criteria against recent traffic to show matching generation counts and samples
  - support two-level navigation: overview, evaluators, and rules sub-pages under a single Evaluation nav entry
  - use shared effective-prompt fallback for `llm_judge` forms, summaries, and detail views so omitted prompts still display the backend defaults
  - explain the `llm_judge` variable model in authoring surfaces: simple variables render plain text, structured variables render tagged fragments, and empty structured values disappear
  - display actor attribution returned by the backend for eval resources; do not let users edit actor fields client-side
- Agents:
  - list tenant agent heads with prefix search and cursor pagination
  - support multi-clause runtime attribute filters over discovered `resource.*` and `span.*` keys
  - surface unnamed-agent bucket explicitly with warning treatment
  - open detail view for named and anonymous buckets
  - support effective-version selection via query param deep-linking and version history lookup
  - show per-version runtime context summaries from Tempo without splitting catalog identity
- Traces:
  - use Tempo proxy links for trace drilldown from generation/conversation views
- Settings: connection and runtime preferences, including query/tenant validation visibility.

## UX Direction

- Prioritize debugging workflows over broad dashboard chrome.
- Keep high information density with progressive disclosure.
- Show linked navigation between conversation, generation, and trace contexts.
- Avoid loading all details at once; use expandable sections and targeted detail panes.

## Testing Expectations (Local Phase)

- route rendering and navigation tests
- plugin configuration tests
- proxy request/response contract tests
- frame-shape compatibility tests for metrics/traces responses
- tenant header behavior tests at proxy boundary

## Update Cadence

- Update when plugin proxy contracts, query/frame shapes, or core page behavior changes.
