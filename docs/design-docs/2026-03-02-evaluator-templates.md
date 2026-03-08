---
owner: sigil-core
status: active
last_reviewed: 2026-03-07
source_of_truth: true
audience: both
---

# Evaluator Templates

## Summary

Evaluator templates add a versioned, forkable template layer on top of the existing evaluator system. Templates are reusable blueprints that can be forked into concrete evaluators with optional config overrides. Tenant-managed templates are stored in the template tables. Predefined evaluators shipped with Sigil remain hardcoded defaults and are exposed through the predefined evaluator endpoints.

Key design choices:

- **Versioned templates.** Each template has immutable version snapshots. Publishing a new version does not affect evaluators already forked from an earlier version.
- **Fork with overrides.** Forking a template creates a concrete evaluator, optionally overriding config fields (provider, model, etc.) and output keys.
- **Lineage tracking.** Forked evaluators record `source_template_id` and `source_template_version`, enabling drift detection and upgrade workflows.
- **Hardcoded predefined source.** Existing predefined evaluator endpoints (`/api/v1/eval/predefined/evaluators/{id}:fork`) resolve against the hardcoded predefined registry, not the template tables.
- **Read-only global template view.** Template CRUD and versioning apply to tenant templates only, but predefined defaults are still surfaced in template APIs as read-only global templates so the user experience stays consistent.

## Problem Statement

Sigil ships predefined evaluators as hardcoded Go structs. This approach has limitations:

1. Users cannot create their own reusable evaluator blueprints to share across teams or environments.
2. There is no reusable versioned template layer for tenant-authored evaluators.
3. Forked evaluators have no lineage back to their source, preventing upgrade notifications or drift detection.

## Design

### Domain Model

- **TemplateDefinition**: Metadata (ID, scope, kind, description, latest version) for tenant-managed templates.
- **TemplateVersion**: Immutable snapshot of a template's config and output keys at a specific version string.
- **EvaluatorDefinition** (extended): Adds `source_template_id` and `source_template_version` fields for lineage.

### Storage

Two new MySQL tables (`eval_templates`, `eval_template_versions`) with GORM auto-migration for tenant-managed templates. The `eval_evaluators` table gains two nullable lineage columns.

### Service Layer

`TemplateService` in `sigil/internal/eval/control/templates.go` provides:

- `CreateTemplate` / `GetTemplate` / `ListTemplates` / `DeleteTemplate`
- `PublishVersion` / `ListVersions`
- `ForkTemplate` (resolves version, merges config overrides, delegates to eval store)

### HTTP API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/eval/templates` | Create template with initial version |
| GET | `/api/v1/eval/templates` | List tenant templates (optional `?scope=` filter) |
| GET | `/api/v1/eval/templates/{id}` | Get template metadata |
| DELETE | `/api/v1/eval/templates/{id}` | Soft-delete template |
| POST | `/api/v1/eval/templates/{id}/versions` | Publish new version |
| GET | `/api/v1/eval/templates/{id}/versions` | List versions |
| POST | `/api/v1/eval/templates/{id}:fork` | Fork into concrete evaluator |

### Predefined Evaluators

Predefined evaluators remain hardcoded in Go under `sigil/internal/eval/predefined`. `GET /api/v1/eval/predefined/evaluators` and `POST /api/v1/eval/predefined/evaluators/{id}:fork` always resolve against that shipped registry. Forking still records `source_template_id` and `source_template_version` on the created evaluator so tenant evaluators retain lineage back to the predefined source definition.

## Alternatives Considered

1. **Store predefined evaluators in the template tables.** This unifies storage, but it makes shipped defaults depend on mutable database state and startup bootstrap order.
2. **Store templates as evaluators with a flag.** Avoids new tables, but conflates two different lifecycle models (templates are versioned blueprints; evaluators are runtime instances).
