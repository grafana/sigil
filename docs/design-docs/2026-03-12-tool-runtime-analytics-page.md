---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Tool Runtime Analytics Page

## Context

We want a tool-specific page that answers three practical questions:

- which tools are used the most
- which tools fail the most
- which conversations should I open to understand those failures

The open question is whether Sigil already has enough data to support that page or whether we need to persist extra tool-specific data first.

## Decision Summary

Sigil has enough data for an MVP **runtime tool analytics page keyed by tool name**, without adding new storage first.

The recommended first route is:

- hidden drilldown route under analytics: `/analytics/tools/:toolName`

The MVP page should be execution-centric, not schema-catalog-centric:

- use Prometheus metrics for tool execution volume, error rate, and latency
- use existing conversation search with `tool.name = "<tool>"` for conversation drilldown
- use existing conversation detail for raw tool call / tool result inspection

We should **not** add a first-class global tool catalog in the first step.

We should add ingest-time tool projection data only if we need one or more of these:

- fast tenant-wide top-tools browse without metric queries
- stable tool-definition identity when the same tool name has multiple schemas
- per-tool conversation counts or per-conversation tool call counts from a single query API
- richer ranking tables than current conversation-centric search can provide

## What Already Exists

### Signals that are already good enough

1. Runtime tool executions are already represented in tracing semantics.
   - `gen_ai.tool.name` is defined for `execute_tool` spans.
   - `gen_ai.operation.name = execute_tool` is the runtime discriminator.
   - Source: `docs/references/semantic-conventions.md`

2. Tool execution metrics already exist.
   - `gen_ai.client.operation.duration` covers `execute_tool`.
   - For `execute_tool`, the tool name is recorded in `gen_ai.request.model`, which means Prometheus can already rank tool executions and tool errors by grouping on `gen_ai_request_model` while filtering `gen_ai_operation_name="execute_tool"`.
   - Source: `docs/references/semantic-conventions.md`

3. Conversation search already supports tool filtering.
   - `tool.name` is a first-class filter key.
   - Tool filters route to Tempo and automatically constrain to `execute_tool` spans.
   - Sources: `sigil/pkg/searchcore/filter.go`, `docs/FRONTEND.md`, `ARCHITECTURE.md`

4. Conversation detail already contains the drilldown payload we need.
   - full generations
   - tool call / tool result message parts
   - declared tool definitions on generations
   - trace/span IDs for deeper investigation
   - Sources: `sigil/proto/sigil/v1/generation_ingest.proto`, `sigil/internal/query/service.go`, `sigil/internal/query/conversation_detail_v2.go`

5. Agent detail already exposes declared tool definitions and schema diffs.
   - This is useful for agent-version context, but it is not runtime analytics.
   - Sources: `sigil/internal/query/service_agents.go`, `apps/plugin/src/components/agents/ToolsPanel.tsx`

### Signals that do not exist yet

Sigil does not currently expose:

- a `/tools` or `/tools/:toolName` query API
- a MySQL projection keyed by tool
- first-class per-tool ranking responses
- conversation search results aggregated by tool
- a stable global tool-definition identity across agents and versions

The current `conversations` projection is intentionally conversation-level only.

## Recommended UX

### Route and navigation

Primary route:

- `/a/grafana-sigil-app/analytics/tools/:toolName`

Why analytics first:

- the existing analytics shell already owns time range, filters, ranked panels, and chart/table composition
- the page is primarily about cross-conversation runtime behavior, not authoring or version governance
- it avoids adding another top-level nav item before we know the page will earn it

Recommended entry points:

1. New "Top tools" ranked panel in Analytics Usage or Errors.
2. Click a tool chip from conversation explore.
3. Click a tool row from the agent detail Tools tab.
4. Deep link from future alerts or assistant summaries.

### Page shape

#### Header

- tool name
- time range
- inherited dashboard filters
- badge showing the current mode is runtime analytics

#### Stat strip

- executions
- error rate
- p95 latency
- conversations touched
- unique agents seen
- last seen

#### Time-series row

- executions over time
- errors over time
- p95 latency over time

#### Breakdowns

- top agents using this tool
- top error types for this tool
- top services or namespaces when those labels exist

#### Conversations section

Use the existing conversation-browser/table pattern:

- recent conversations using this tool
- error conversations using this tool
- each row links to the existing conversation explore page

Recommended columns:

- conversation
- last seen
- agents
- generation count
- conversation error count
- ratings / annotations if present

#### Optional side panel

- quick explanation of what this page means:
  - runtime executions, not declared inventory
  - tool name grouped globally
  - same name may represent multiple schemas

## MVP Data Plan

### Most used tool

Use Prometheus:

- metric: `gen_ai_client_operation_duration_seconds_count`
- filter: `gen_ai_operation_name="execute_tool"`
- group by: `gen_ai_request_model`

This is slightly awkward semantically because the tool name rides in the model label for `execute_tool`, but it is sufficient for the page and should stay hidden behind plugin code.

### Most errors by tool

Use the same metric family with:

- `gen_ai_operation_name="execute_tool"`
- `error_type!=""`
- optional `error_category` breakdown

This gives us:

- failing tool executions
- tool-specific error rate
- dominant error classes per tool

### Link to conversations

Use existing conversation search:

- filter: `tool.name = "<toolName>"`
- error slice: `tool.name = "<toolName>" status = error`

Then reuse the existing conversation list/table and the current conversation explore route.

### What the MVP intentionally does not do

- canonical tool-definition page
- schema history across agents
- per-conversation tool call counts
- top tools API served from Sigil instead of derived from metrics

## Should We Record Tool-Specific Data In Sigil?

### Recommendation

Not for the MVP page.

The page can ship with current signals if we keep the scope focused on:

- executions
- errors
- latency
- conversation drilldown

### When to add storage

Add a small tool projection only if the page must become a first-class entity with its own browse/index APIs.

Recommended future projection shape:

- `tool_heads`
  - `tenant_id`
  - `tool_name`
  - `first_seen_at`
  - `last_seen_at`
  - latest observed `type`
  - latest observed `description`
  - latest observed `definition_hash`
  - lifetime `execution_count`
  - lifetime `error_count`
  - lifetime `conversation_count`
  - lifetime `agent_count`
- `tool_definition_variants`
  - keyed by `(tenant_id, tool_name, definition_hash)`
  - canonicalized schema / description payload
  - first/last seen
  - usage counts

This keeps the runtime page simple:

- analytics stay time-range driven from Prometheus
- fast lookup and definition summaries come from MySQL
- we avoid storing raw arguments/results again because those are already available in trace/generation detail

## Tradeoffs

### Benefits of the MVP-first approach

- no new Sigil write-path changes
- no new projection tables or backfill questions
- reuses existing conversation drilldown and analytics UI patterns
- keeps the first version honest about what the data represents

### Limitations of the MVP-first approach

- "tool name" is not a stable schema identity
- top-tool rankings come from metrics, not a dedicated tools API
- conversation tables can show conversations that used the tool, but not precise per-conversation call counts without more query work
- tool filters remain Tempo-backed, so large-window drilldowns are not as cheap as MySQL projection reads

## Recommended Rollout

1. Add a hidden analytics drilldown page for one tool.
2. Add one ranked "Top tools" panel that links into it.
3. Reuse conversation search for drilldown tables.
4. Observe whether users ask for:
   - schema identity
   - faster browse
   - top tools list page
   - per-tool conversation counts
5. Only then add a MySQL tool projection.

## Evidence

- Tool filters and Tempo routing already exist: `sigil/pkg/searchcore/filter.go`
- Conversation search/detail contracts are conversation-first: `docs/FRONTEND.md`, `ARCHITECTURE.md`, `sigil/internal/query/service.go`
- Generation payload already carries tool call/result and declared tool data: `sigil/proto/sigil/v1/generation_ingest.proto`
- Agent pages already show declared tools, but not runtime analytics: `sigil/internal/query/service_agents.go`, `apps/plugin/src/components/agents/ToolsPanel.tsx`
- Plugin navigation currently has no tool route: `apps/plugin/src/constants.ts`, `apps/plugin/src/app/App.tsx`, `apps/plugin/src/plugin.json`
