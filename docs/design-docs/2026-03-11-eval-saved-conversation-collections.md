---
owner: sigil-core
status: active
last_reviewed: 2026-03-11
source_of_truth: true
audience: both
---

# Eval Saved Conversation Collections

## Problem

Saved conversations are a flat, unbounded list per tenant. As users save more conversations (both telemetry bookmarks and manual test cases), finding and managing related conversations becomes increasingly difficult. There is no way to group conversations into logical sets — for example, "auth regression tests", "streaming edge cases", or "v2 launch validation."

This also blocks future offline/batch evaluation, which needs a "dataset" concept — a curated group of conversations to run evaluators against.

## Goals

- Let users create named collections to group saved conversations.
- Support many-to-many: a saved conversation can belong to multiple collections.
- Provide CRUD APIs for collections and membership management.
- Integrate collections into the eval test panel's GenerationPicker for filtered browsing.
- Design the schema so future batch eval ("run evaluator against collection X") requires no migration changes.

## Non-Goals

- Nested collections (sub-folders). Flat collections only.
- Offline eval runs or dataset versioning/snapshotting (future work, see `docs/design-docs/drafts/2026-02-15-offline-evaluation.md`).
- Bulk import/export of collections.
- Requiring conversations to belong to a collection (ungrouped conversations remain valid).
- UI for drag-and-drop reordering within collections.

## Decision Summary

| Decision | Choice |
|----------|--------|
| Grouping model | Many-to-many (join table) |
| Collection hierarchy | Flat (no nesting) |
| Collection ID | Server-generated UUID |
| Membership scope | Saved conversations only (not raw conversations) |
| Deletion model | Hard delete collection + memberships; saved conversations untouched |

## Entity Relationship Model

```
┌──────────────────────────────┐
│       eval_collections       │  ◄── NEW TABLE
├──────────────────────────────┤
│ tenant_id (PK)               │
│ collection_id (PK, UUID)     │
│ name                         │
│ description                  │
│ created_by                   │
│ updated_by                   │
│ created_at                   │
│ updated_at                   │
└──────────┬───────────────────┘
           │ 1:N
           ▼
┌──────────────────────────────┐
│   eval_collection_members    │  ◄── NEW TABLE (join)
├──────────────────────────────┤
│ tenant_id (PK)               │──┐
│ collection_id (PK)           │  │
│ saved_id (PK)                │──┼──► eval_saved_conversations (tenant_id, saved_id)
│ added_by                     │  │
│ created_at                   │  │
└──────────────────────────────┘  │
                                  │
┌──────────────────────────────┐  │
│   eval_saved_conversations   │◄─┘  (existing, unchanged)
├──────────────────────────────┤
│ tenant_id, saved_id          │
│ conversation_id              │
│ name, source, tags_json      │
│ saved_by                     │
│ created_at, updated_at       │
└──────────────────────────────┘
```

Key relationships:

- `eval_collection_members` references both `eval_collections` and `eval_saved_conversations` via composite keys — logical FKs, not enforced at DB level (matching existing Sigil patterns).
- A saved conversation can appear in many collections. A collection can contain many saved conversations.
- Deleting a collection cascade-deletes its membership rows but does not affect saved conversations.
- Deleting a saved conversation should cascade-delete its membership rows across all collections.

## Table Schema

### eval_collections (new)

```sql
CREATE TABLE eval_collections (
  tenant_id       VARCHAR(128)  NOT NULL,
  collection_id   VARCHAR(36)   NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  description     TEXT,
  created_by      VARCHAR(255)  NOT NULL,
  updated_by      VARCHAR(255)  NOT NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (tenant_id, collection_id)
);
```

### eval_collection_members (new)

```sql
CREATE TABLE eval_collection_members (
  tenant_id       VARCHAR(128)  NOT NULL,
  collection_id   VARCHAR(36)   NOT NULL,
  saved_id        VARCHAR(128)  NOT NULL,
  added_by        VARCHAR(255)  NOT NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  PRIMARY KEY (tenant_id, collection_id, saved_id),
  KEY idx_eval_collection_members_saved (tenant_id, saved_id)
);
```

Design notes:

- Composite PKs eliminate surrogate IDs — simpler, fewer indexes.
- Index on `(tenant_id, saved_id)` on the members table supports "which collections does this conversation belong to?" queries.
- No `updated_at` on members — membership is immutable (add or remove, no update).
- `added_by` tracks who added the conversation to the collection.
- `description` is nullable TEXT, not JSON — free-form prose for documenting what a collection covers.

## API Contracts

### Create collection

```
POST /api/v1/eval/collections
```

Request:

```json
{
  "name": "Auth Regression Tests",
  "description": "Conversations covering authentication edge cases and error paths",
  "created_by": "operator-jane"
}
```

Response: `200 OK` with full collection object including server-generated `collection_id`.

### List collections

```
GET /api/v1/eval/collections?limit=50&cursor=...
```

Response: paginated list with `collection_id`, `name`, `description`, `created_by`, `updated_by`, `created_at`, `updated_at`, and `member_count` (derived via COUNT query or denormalized).

### Get collection

```
GET /api/v1/eval/collections/{collection_id}
```

Response: full collection object with `member_count`.

### Update collection

```
PATCH /api/v1/eval/collections/{collection_id}
```

Request:

```json
{
  "name": "Auth Regression Tests v2",
  "description": "Updated description",
  "updated_by": "operator-jane"
}
```

Response: `200 OK` with updated collection object. Only provided fields are updated.

### Delete collection

```
DELETE /api/v1/eval/collections/{collection_id}
```

Response: `204 No Content`. Hard delete of collection and all its membership rows. Saved conversations are untouched.

### Add members to collection

```
POST /api/v1/eval/collections/{collection_id}/members
```

Request:

```json
{
  "saved_ids": ["sc_support_regression_01", "sc_edge_case_empty_response"],
  "added_by": "operator-jane"
}
```

Response: `200 OK`. Accepts a list to support batch addition. Idempotent — adding an already-present member is a no-op.

Validation: each `saved_id` must exist in `eval_saved_conversations` for the tenant.

### Remove member from collection

```
DELETE /api/v1/eval/collections/{collection_id}/members/{saved_id}
```

Response: `204 No Content`. Idempotent — removing a non-member is a no-op.

### List collection members

```
GET /api/v1/eval/collections/{collection_id}/members?limit=50&cursor=...
```

Response: paginated list of saved conversation objects (joined from `eval_saved_conversations`), enriched with `added_by` and membership `created_at`.

### List collections for a saved conversation

```
GET /api/v1/eval/saved-conversations/{saved_id}/collections
```

Response: list of collection objects this saved conversation belongs to. Uses the `(tenant_id, saved_id)` index on `eval_collection_members`.

### Plugin proxy routes

All proxied under:

```
/api/plugins/grafana-sigil-app/resources/eval/collections/...
/api/plugins/grafana-sigil-app/resources/eval/saved-conversations/{saved_id}/collections
```

RBAC: `grafana-sigil-app.eval:write` for create/update/delete/add/remove members, `grafana-sigil-app.data:read` for list/get.

## Eval Test Panel Integration

The `GenerationPicker` component's "Saved" tab gains collection filtering:

- A dropdown/selector at the top of the Saved tab lists available collections (fetched via `GET /eval/collections`).
- Selecting a collection filters the saved conversation list to that collection's members.
- "All" option shows the existing unfiltered behavior.
- Selecting a saved conversation within a collection loads its generations via existing `getConversationDetail`.
- Rest of the flow unchanged: pick generation, run evaluator, see results.

From the saved conversations list view (outside the eval test panel), users can:

- See which collections a conversation belongs to.
- Add/remove a conversation to/from collections via a multi-select action.

## Forward Compatibility

### Batch eval (future)

A future `POST /api/v1/eval/runs` endpoint could accept `{ evaluator_id, collection_id }` and join `eval_collection_members` → `eval_saved_conversations` → `conversations` → `generations` to run an evaluator against all generations in a collection. No schema changes needed.

### Dataset snapshots (future)

For reproducible eval runs, a snapshot mechanism could capture the set of `saved_id`s in a collection at a point in time. This would be a new table (`eval_collection_snapshots`) referencing the collection — the current schema supports this addition without modification.

### Offline eval alignment

The draft offline eval design (`docs/design-docs/drafts/2026-02-15-offline-evaluation.md`) proposes datasets as the unit of batch evaluation. Collections can serve as the source material for datasets — either directly (a collection _is_ a dataset) or via snapshot (a dataset references a frozen collection state). The many-to-many model supports both approaches.
