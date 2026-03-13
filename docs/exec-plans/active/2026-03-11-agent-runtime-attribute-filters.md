---
owner: sigil-core
status: active
last_reviewed: 2026-03-11
source_of_truth: true
audience: both
---

# Execution Plan: Agent Runtime Attribute Filters

## Goal

Add multi-clause runtime attribute filtering for agent list/detail views without splitting catalog agent identity by deployment space.

## Scope

- query service runtime search/context methods
- HTTP routes and plugin proxy forwarding
- plugin agents list/detail filter UX
- Storybook coverage for the new filter bar
- regression tests
- architecture/frontend contract docs

## Checklist

- [x] Add query service methods for Tempo-backed agent search and runtime context aggregation.
- [x] Restrict agent runtime filters to discovered `resource.*` and `span.*` keys.
- [x] Add HTTP routes:
  - [x] `POST /api/v1/agents/search`
  - [x] `POST /api/v1/agents:runtime-context`
- [x] Add plugin proxy routes:
  - [x] `POST /query/agents/search`
  - [x] `POST /query/agents/runtime-context`
- [x] Update plugin RBAC mapping for the new agent runtime read routes.
- [x] Add shared frontend `AgentAttributeFilterBar` with key -> operator -> value flow.
- [x] Wire agent list page to URL-backed `attr` clauses and filtered pagination.
- [x] Wire agent detail page to shared `attr` clauses and runtime context summary.
- [x] Preserve runtime filter state between list and detail navigation.
- [x] Add regression tests for query service, HTTP routes, plugin proxy, and frontend API clients.
- [x] Add Storybook coverage for the new filter bar.
- [x] Update:
  - [x] `ARCHITECTURE.md`
  - [x] `docs/FRONTEND.md`
  - [x] design/plan indexes

## Decisions Applied

- Keep agent identity as `agent_name + effective_version`.
- Use Tempo span/resource attributes for runtime scoping instead of adding new catalog tables.
- Filter list membership only; do not duplicate or regroup agent rows by runtime cohort.
