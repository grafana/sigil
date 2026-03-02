---
owner: sigil-core
status: active
last_reviewed: 2026-03-02
source_of_truth: true
audience: both
---

# Evaluator Templates

## Summary

Evaluator templates add a versioned, forkable template layer on top of the existing evaluator system. Templates are reusable blueprints that can be forked into concrete evaluators with optional config overrides. Predefined evaluators (shipped with Sigil) are migrated into this layer as global-scope templates, providing a unified model for both built-in and user-created templates.

Key design choices:

- **Versioned templates.** Each template has immutable version snapshots. Publishing a new version does not affect evaluators already forked from an earlier version.
- **Fork with overrides.** Forking a template creates a concrete evaluator, optionally overriding config fields (provider, model, etc.) and output keys.
- **Lineage tracking.** Forked evaluators record `source_template_id` and `source_template_version`, enabling drift detection and upgrade workflows.
- **Backwards-compatible migration.** Existing predefined evaluator endpoints (`/api/v1/eval/predefined/evaluators/{id}:fork`) now resolve through the templates table. The old endpoints continue to work unchanged.
- **Scoped visibility.** Templates are either `global` (shipped with Sigil, visible to all tenants) or `tenant`-scoped (user-created, private to a tenant).

## Problem Statement

Sigil ships predefined evaluators as hardcoded Go structs. This approach has limitations:

1. Users cannot create their own reusable evaluator blueprints to share across teams or environments.
2. There is no versioning for predefined evaluators, making it impossible to evolve prompts while preserving existing forks.
3. Forked evaluators have no lineage back to their source, preventing upgrade notifications or drift detection.

## Design

### Domain Model

- **TemplateDefinition**: Metadata (ID, scope, kind, description, latest version).
- **TemplateVersion**: Immutable snapshot of a template's config and output keys at a specific version string.
- **EvaluatorDefinition** (extended): Adds `source_template_id` and `source_template_version` fields for lineage.

### Storage

Two new MySQL tables (`eval_templates`, `eval_template_versions`) with GORM auto-migration. The `eval_evaluators` table gains two nullable lineage columns.

### Service Layer

`TemplateService` in `sigil/internal/eval/control/templates.go` provides:

- `CreateTemplate` / `GetTemplate` / `ListTemplates` / `DeleteTemplate`
- `PublishVersion` / `ListVersions`
- `ForkTemplate` (resolves version, merges config overrides, delegates to eval store)

### HTTP API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/eval/templates` | Create template with initial version |
| GET | `/api/v1/eval/templates` | List templates (optional `?scope=` filter) |
| GET | `/api/v1/eval/templates/{id}` | Get template metadata |
| DELETE | `/api/v1/eval/templates/{id}` | Soft-delete template |
| POST | `/api/v1/eval/templates/{id}/versions` | Publish new version |
| GET | `/api/v1/eval/templates/{id}/versions` | List versions |
| POST | `/api/v1/eval/templates/{id}:fork` | Fork into concrete evaluator |

### Bootstrap

On startup, `BootstrapPredefinedTemplates` upserts all hardcoded predefined evaluators into the templates table as global-scope templates. The predefined fork endpoint resolves through the templates table first, falling back to the hardcoded registry only if the template is missing.

## Alternatives Considered

1. **Keep predefined evaluators as a separate path.** Simpler, but duplicates the fork logic and prevents users from creating their own reusable templates.
2. **Store templates as evaluators with a flag.** Avoids new tables, but conflates two different lifecycle models (templates are versioned blueprints; evaluators are runtime instances).
