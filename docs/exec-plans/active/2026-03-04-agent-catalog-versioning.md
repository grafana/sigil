---
owner: sigil-core
status: active
last_reviewed: 2026-03-04
source_of_truth: true
audience: both
---

# Execution Plan: Agent Catalog Versioning and Query APIs

## Goal

Deliver ingest-time agent projection + read APIs for agent list and version detail using hash-based effective versioning.

## Scope

- MySQL schema for agent catalog projections
- ingest write-path updates
- query service + HTTP routes
- plugin proxy routes + RBAC mapping
- plugin frontend navigation/pages for agents list + detail
- regression tests
- architecture/contract/frontend docs updates

## Checklist

- [x] Add `internal/agentmeta` canonicalization and effective-version hashing (`sha256:<digest>`).
- [x] Add MySQL models and migration entries for:
  - [x] `agent_heads`
  - [x] `agent_versions`
  - [x] `agent_version_models`
- [x] Extend WAL ingest transaction to upsert agent projection rows atomically with generation writes.
- [x] Add storage read methods for list heads, version fetch, latest version fetch, and per-version model usage.
- [x] Add query service methods:
  - [x] `ListAgentsForTenant`
  - [x] `GetAgentDetailForTenant`
  - [x] `ListAgentVersionsForTenant`
- [x] Add HTTP routes:
  - [x] `GET /api/v1/agents`
  - [x] `GET /api/v1/agents:lookup`
  - [x] `GET /api/v1/agents:versions`
- [x] Add plugin proxy routes:
  - [x] `GET /query/agents`
  - [x] `GET /query/agents/lookup`
  - [x] `GET /query/agents/versions`
- [x] Update plugin RBAC route mapping for agent routes (`data:read`).
- [x] Add plugin frontend routes/pages:
  - [x] `/agents` (agent cards list with prefix search + load more)
  - [x] `/agents/name/:agentName` and `/agents/anonymous` detail routes
  - [x] version selector on detail page backed by `agents:versions`
- [x] Add/Update Storybook stories for new agent pages.
- [x] Add tests for:
  - [x] hash/canonicalization stability
  - [x] ingest projection behavior (named + anonymous grouping)
  - [x] query service list/detail/version behavior and cursor validation
  - [x] HTTP route behavior for agents endpoints (including versions)
  - [x] plugin proxy route forwarding and permission mapping (including versions)
  - [x] frontend route and version-selector behavior
- [x] Update docs:
  - [x] `ARCHITECTURE.md`
  - [x] `docs/references/generation-ingest-contract.md`
  - [x] `docs/FRONTEND.md`
  - [x] docs indexes

## Decisions Applied

- No historical backfill.
- Named generations group by `agent_name`.
- Unnamed generations are intentionally merged into a single anonymous bucket (`agent_name=""`) in list responses.
- Effective version is projection-only; generation payload is not rewritten.
