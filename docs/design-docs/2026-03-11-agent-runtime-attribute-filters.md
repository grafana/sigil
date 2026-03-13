---
owner: sigil-core
status: active
last_reviewed: 2026-03-11
source_of_truth: true
audience: both
---

# Agent Runtime Attribute Filters

## Context

The agent catalog projection is intentionally keyed by `agent_name` and Sigil `effective_version`. Operators also need to answer a different question: where is an agent version actually observed at runtime across resource namespaces, services, clusters, and relevant span attributes.

That runtime context lives in Tempo span/resource attributes, not in the MySQL catalog projection.

## Decision Summary

Sigil adds a Tempo-backed agent runtime filter path without changing agent identity:

- `POST /api/v1/agents/search`
- `POST /api/v1/agents:runtime-context`

The plugin exposes matching resource endpoints:

- `POST /api/plugins/grafana-sigil-app/resources/query/agents/search`
- `POST /api/plugins/grafana-sigil-app/resources/query/agents/runtime-context`

Agents list and detail pages now share a multi-clause filter bar that supports discovered `resource.*` and `span.*` keys with `=`, `!=`, and `=~` operators.

## Semantics

- Multiple clauses are ANDed.
- Allowed keys on this path are discovered `resource.*` and `span.*` attributes only.
- Agent identity stays `agent_name + effective_version`; filters do not create new agent rows or new version ids.
- Runtime context aggregation only counts spans carrying `span.sigil.generation.id` so tool-only spans do not create false agent matches.
- Effective-version filtering on runtime context is done by hydrating matched generations from storage and recomputing Sigil descriptors, not by trusting producer `span.gen_ai.agent.version`.

## API Shape

### Search (`POST /api/v1/agents/search`)

Request:

- `filters`: TraceQL-style clause string restricted to `resource.*` and `span.*`
- `time_range`
- `page_size`
- optional `cursor`
- optional `name_prefix`

Response:

- same agent list payload as `GET /api/v1/agents`
- filtered to agents with matching generation spans in the selected time range

### Runtime Context (`POST /api/v1/agents:runtime-context`)

Request:

- `agent_name`
- optional `effective_version`
- `filters`
- `time_range`

Response:

- `matching_generation_count`
- `first_seen_at`
- `last_seen_at`
- grouped top observed values for pinned deployment keys and active filter keys

## Frontend Contract

- Agents list persists filter clauses in repeated `attr=key|operator|value` URL params.
- Agents detail reads the same `attr` params and preserves them when navigating back to the list.
- When `from` / `to` are present in the URL, detail runtime queries use that range; otherwise they fall back to the selected version's observed first/last seen window.
