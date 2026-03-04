---
owner: sigil-core
status: completed
last_reviewed: 2026-03-04
source_of_truth: true
audience: both
---

# Eval Saved Conversations

## Problem

Users testing evaluators in the eval test panel must search for conversations on every test run. There is no way to bookmark production conversations for reuse or create synthetic test conversations with known input/output pairs. This slows down evaluator development and prevents building curated test sets.

## Goals

- Let users save (bookmark) existing production conversations for quick access in the eval test panel.
- Let users create manual test conversations with authored input/output pairs via API.
- Distinguish telemetry-ingested generations from manually created test data.
- Keep scope tight: eval test panel integration only, no offline eval run coupling.

## Non-Goals

- Offline eval runs/datasets.
- UI for authoring manual conversations (API-only for now).
- Bulk import/export of test conversations.
- Conversation-level batch evaluation (running all generations through an evaluator in one action).
- Saved conversation collections/folders.
- Filtering production dashboards to exclude manual data (manual conversations have no traces and won't appear in Tempo-based search).

## Decision Summary

| Decision | Choice |
|----------|--------|
| Save scope | Tenant-wide |
| User-authored creation | API-only |
| Usage scope | Eval test panel only (for now) |
| Organization | Name + tags |
| Approach | Shared generations table + source column |
| Source mechanism | New column on generations table |
| Deletion model | Hard delete on saved conversations |
| Manual creation path | Separate from ingest pipeline |

## Entity Relationship Model

```
┌──────────────────────────────┐
│   eval_saved_conversations   │  ◄── NEW TABLE
├──────────────────────────────┤
│ id (PK, auto)                │
│ tenant_id                    │──┐
│ saved_id (unique/tenant)     │  │
│ conversation_id              │──┼──► conversations (tenant_id, conversation_id)
│ name                         │  │
│ tags_json                    │  │
│ source (telemetry|manual)    │  │
│ saved_by                     │  │
│ created_at                   │  │
│ updated_at                   │  │
└──────────────────────────────┘  │
                                  │
┌──────────────────────────────┐  │
│        conversations         │◄─┘
├──────────────────────────────┤
│ tenant_id, conversation_id   │
│ generation_count             │
│ last_generation_at           │
└────────┬─────────────────────┘
         │ 1:N
         ▼
┌──────────────────────────────┐
│        generations           │  ◄── MODIFIED (new column)
├──────────────────────────────┤
│ tenant_id, generation_id     │
│ conversation_id              │
│ source (telemetry|manual)    │  ◄── NEW COLUMN
│ payload (protobuf)           │
└──────────────────────────────┘
```

Key relationships:

- `eval_saved_conversations` references `conversations` via `(tenant_id, conversation_id)` — logical FK, not enforced at DB level (matching existing Sigil patterns).
- One conversation can have one saved entry per tenant (unique on `tenant_id, conversation_id`).
- `source` on both tables: `eval_saved_conversations.source` classifies the save type. `generations.source` classifies data origin.
- Default for `generations.source`: `telemetry` — existing rows correct without backfill.

## Table Schema

### eval_saved_conversations (new)

```sql
CREATE TABLE eval_saved_conversations (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(128)  NOT NULL,
  saved_id        VARCHAR(128)  NOT NULL,
  conversation_id VARCHAR(255)  NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  source          VARCHAR(16)   NOT NULL,
  tags_json       JSON          NOT NULL,
  saved_by        VARCHAR(255)  NOT NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  UNIQUE KEY ux_eval_saved_conversations_tenant_saved (tenant_id, saved_id),
  UNIQUE KEY ux_eval_saved_conversations_tenant_conversation (tenant_id, conversation_id),
  KEY idx_eval_saved_conversations_tenant_source_updated (tenant_id, source, updated_at)
);
```

### generations (add column)

```sql
ALTER TABLE generations
  ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'telemetry';
```

Design notes:

- No soft deletes — hard delete. No downstream references (unlike evaluators/rules referenced by scores/work items).
- `saved_id` is user-provided and idempotent, matching `rating_id`, `annotation_id` patterns.
- `tags_json` is JSON type, matching `metadata_json` patterns on scores, ratings, annotations.
- `saved_by` is a plain string (not an FK), matching how `operator_id` works in annotations.
- Index on `(tenant_id, source, updated_at)` supports filtered listing.

## API Contracts

### Save existing conversation (bookmark telemetry)

```
POST /api/v1/eval/saved-conversations
```

Request:

```json
{
  "saved_id": "sc_support_regression_01",
  "conversation_id": "conv-abc-123",
  "name": "Support regression - token limit hit",
  "tags": {"use_case": "support", "priority": "high"},
  "saved_by": "operator-jane"
}
```

Response: `200 OK` with full saved conversation object.

Validation: conversation must exist in `conversations` table for the tenant. `source` set to `telemetry` automatically.

### Create manual test conversation (user-authored)

```
POST /api/v1/eval/saved-conversations:manual
```

Request:

```json
{
  "saved_id": "sc_edge_case_empty_response",
  "name": "Edge case - empty assistant response",
  "tags": {"category": "edge_case"},
  "saved_by": "operator-jane",
  "generations": [
    {
      "generation_id": "gen_manual_001",
      "operation_name": "chat",
      "mode": "SYNC",
      "model": {"provider": "openai", "name": "gpt-4"},
      "input": [{"role": "user", "content": [{"text": "Summarize this document"}]}],
      "output": [{"role": "assistant", "content": [{"text": ""}]}],
      "started_at": "2026-03-04T10:00:00Z",
      "completed_at": "2026-03-04T10:00:01Z"
    }
  ]
}
```

Response: `200 OK` with saved conversation object (includes auto-generated `conversation_id`).

Behavior:

- Generates `conversation_id` deterministically: `conv_manual_<saved_id>`.
- Single transaction: creates `conversations` row, `generations` rows (source=manual), and `eval_saved_conversations` row (source=manual).
- No eval enqueue events, no agent catalog projection.

### List saved conversations

```
GET /api/v1/eval/saved-conversations?source=telemetry&limit=50&cursor=...
```

Response: paginated list with `saved_id`, `conversation_id`, `name`, `source`, `tags`, `saved_by`, `created_at`. Optional `source` filter.

### Get saved conversation

```
GET /api/v1/eval/saved-conversations/{saved_id}
```

Response: full saved conversation object enriched with conversation metadata (generation_count, last_generation_at).

### Delete saved conversation

```
DELETE /api/v1/eval/saved-conversations/{saved_id}
```

Response: `204 No Content`. Hard delete.

- `source=manual`: also deletes associated `conversations` and `generations` rows (cascade cleanup).
- `source=telemetry`: only deletes the saved row. Underlying conversation/generations untouched.

### Plugin proxy routes

All proxied under:

```
/api/plugins/grafana-sigil-app/resources/eval/saved-conversations/...
```

RBAC: `grafana-sigil-app.eval:write` for create/delete, `grafana-sigil-app.data:read` for list/get.

## Manual Creation Flow

```
POST /api/v1/eval/saved-conversations:manual
        │
        ▼
  Validate request
  (name, saved_id, at least 1 generation,
   each generation has input+output)
        │
        ▼
  Generate conversation_id
  (deterministic: "conv_manual_<saved_id>")
        │
        ▼
  Single transaction:
  ┌─────────────────────────────────────┐
  │ 1. INSERT conversations row         │
  │ 2. For each generation:             │
  │    - Encode to protobuf             │
  │    - INSERT generations row         │
  │      (source='manual')              │
  │ 3. INSERT eval_saved_conversations  │
  │    (source='manual')                │
  └─────────────────────────────────────┘
        │
        ▼
  Return saved conversation object
```

Compared to `ExportGenerations`, this path skips:

- Eval enqueue events (no async evaluation triggered).
- Agent catalog projection (no agent_heads/agent_versions updates).
- SDK validation rules (no `sigil.sdk.name` requirement).

What it shares:

- Same protobuf encoding for generation payloads.
- Same `generations` and `conversations` tables.
- Generations readable by all existing query APIs.
- Eval test panel works unchanged — reads generations by ID.

## Eval Test Panel Integration

The `GenerationPicker` component gains a "Saved" tab:

- On mount, fetches saved conversations via `GET /eval/saved-conversations`.
- Saved list shows name, source badge (telemetry/manual), generation count.
- Selecting a saved conversation loads its generations via existing `getConversationDetail`.
- Rest of the flow unchanged: pick generation, run evaluator, see results.
- "Recent" and "Search" tabs remain for ad-hoc testing.

No new components needed. This extends `GenerationPicker` with a new data source and tab toggle. `EvalTestPanel`, `TestResultDisplay`, and evaluator execution are untouched.

## Forward Compatibility

- Manual conversations won't appear in Tempo-based conversation search (no traces), so they stay out of production dashboards naturally.
- The `source` column on `generations` is a foundation for future features (offline eval, dataset management) without additional migration.
- The `eval_saved_conversations` table could later gain a `collection_id` column if grouping is needed.
