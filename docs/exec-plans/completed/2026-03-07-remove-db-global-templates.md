---
owner: sigil-core
status: completed
last_reviewed: 2026-03-07
source_of_truth: true
audience: both
---

# Execution Plan: Remove DB-Backed Global Templates

## Goal

Stop storing Sigil's built-in predefined evaluators as global templates in the template tables. Predefined evaluators should always load from the hardcoded defaults we ship in Go, while template CRUD and versioning remain tenant-managed only.

## Scope

- predefined evaluator listing and forking
- template store/query semantics
- template control-plane API behavior
- evaluator/templates frontend copy and stories
- docs describing predefined evaluators versus tenant templates
- regression tests for the new contract

## Checklist

- [x] Remove startup bootstrap of predefined evaluators into the template tables.
- [x] Remove predefined-evaluator template-store fallback from the eval control service.
- [x] Keep predefined evaluator forking, but source it from hardcoded defaults and preserve source lineage fields.
- [x] Narrow template store listing/lookups to tenant-managed templates only.
- [x] Remove global-template behavior from template service and template HTTP tests.
- [x] Restore a dedicated predefined-evaluator catalog in the UI so built-in defaults remain visible after removing DB-backed global templates.
- [x] Update frontend template surfaces to describe tenant-managed templates rather than DB-backed global templates.
- [x] Update architecture/design/reference docs to reflect the new contract.
- [x] Run targeted verification for backend and frontend changes.

## Decisions Applied

- Predefined evaluators remain versioned in code through the shipped default definitions, not through database template versions.
- Tenant templates stay versioned and forkable through `eval_templates` and `eval_template_versions`.
- `source_template_id` and `source_template_version` remain populated when a tenant evaluator is forked from a predefined evaluator, even though the source is now hardcoded.
- Template list/detail endpoints still surface predefined defaults as read-only synthetic `scope=global` templates so the user experience stays unchanged.
- Global predefined templates intentionally expose no version-history entries and no mutating operations.

## Verification

- `go test ./sigil/internal/eval/control ./sigil/internal/storage/mysql`
- `pnpm --filter @grafana/sigil-plugin exec eslint src/pages/EvaluatorsPage.tsx src/pages/TemplatesPage.tsx src/components/evaluation/EvaluatorCardGrid.tsx src/components/evaluation/EvaluatorTable.tsx src/stories/evaluation/EvaluatorsPage.stories.tsx src/stories/evaluation/TemplateCardGrid.stories.tsx`
- `pnpm --filter @grafana/sigil-plugin exec prettier --check src/pages/EvaluatorsPage.tsx src/pages/TemplatesPage.tsx src/components/evaluation/EvaluatorCardGrid.tsx src/components/evaluation/EvaluatorTable.tsx src/stories/evaluation/EvaluatorsPage.stories.tsx src/stories/evaluation/TemplateCardGrid.stories.tsx`

## Docs Updated

- `ARCHITECTURE.md`
- `docs/design-docs/2026-02-17-online-evaluation.md`
- `docs/design-docs/2026-03-02-evaluator-templates.md`
- `docs/references/eval-control-plane.md`
- `docs/references/online-evaluation-user-guide.md`
- `docs/FRONTEND.md`
