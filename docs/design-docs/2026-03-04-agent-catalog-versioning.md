---
owner: sigil-core
status: active
last_reviewed: 2026-03-04
source_of_truth: true
audience: both
---

# Agent Catalog Versioning and Query APIs

## Context

Generation ingest already carries `agent_name`, `agent_version`, `system_prompt`, and `tools`, but Sigil previously had no first-class API for:

- listing agents with stable grouping and lightweight metadata
- retrieving a full agent definition for a specific version
- deterministic internal versioning when producers omit `agent_version`

## Decision Summary

Sigil adds a MySQL agent catalog projection, written at ingest time, with agent query endpoints:

- `GET /api/v1/agents`
- `GET /api/v1/agents:lookup`
- `GET /api/v1/agents:versions`

Effective agent version is computed as `sha256:<digest>` from canonicalized `system_prompt + tools` and used as the internal identity for version lookup and dedupe.

Producer `agent_version` remains informational metadata and is not used as the lookup key.

## Grouping Semantics

- Named generations (`agent_name != ""`) are grouped by exact name in list responses.
- Unnamed generations (`agent_name == ""`) are intentionally grouped into a single anonymous bucket in list responses.
- Detail lookup uses query params:
  - `name` (required query key, empty value allowed)
  - `version` (optional effective version; defaults to latest seen for that name bucket)

## Storage Model

New MySQL projection tables:

- `agent_heads`: one row per `(tenant_id, agent_name)` with latest summary data
- `agent_versions`: one row per `(tenant_id, agent_name, effective_version)` with canonical prompt/tools and counts
- `agent_version_models`: per-version provider/model usage counts

Projection is updated transactionally in the same write path as `generations` + `conversations` inserts.

No backfill is performed in this milestone; projection coverage starts at deployment.

## Canonicalization Rules

- Text normalization: trim and collapse whitespace runs.
- Tools are canonicalized and order-insensitive for hashing:
  - canonical schema JSON if valid JSON
  - deterministic base64 marker fallback when schema bytes are non-JSON
- Hash input envelope includes canonical version marker (`canonical_version=1`).
- Token estimate is a deterministic approximation: `ceil(chars / 4)` over canonical prompt and tools.

## API Shape

### List (`GET /api/v1/agents`)

Returns one item per name bucket:

- name, latest effective/declared version, first/latest seen timestamps
- generation count, version count
- latest prompt prefix, latest tool count
- token estimate breakdown
- cursor-based pagination

### Lookup (`GET /api/v1/agents:lookup`)

Returns full detail for one bucket version:

- canonical system prompt
- canonical tool definitions (with per-tool token estimate)
- declared version first/latest
- provider/model usage distribution for that version

### Version History (`GET /api/v1/agents:versions`)

Returns paginated version summaries for one name bucket:

- effective version identity
- declared version first/latest
- first/last seen timestamps and generation count
- tool count and token estimate breakdown
- prompt prefix for quick scanning

Frontend uses this endpoint for a route-deep-linkable version selector in agent detail pages.

## Consequences

### Positive

- Deterministic version identity independent of producer version hygiene.
- Fast list and detail APIs without scanning protobuf blobs.
- Stable query path for UI and downstream consumers.

### Tradeoffs

- Anonymous bucket groups potentially unrelated unnamed agents by design.
- No historical backfill means older generations are not represented in catalog until re-ingested.
