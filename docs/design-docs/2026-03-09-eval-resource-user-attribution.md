---
owner: sigil-core
status: completed
last_reviewed: 2026-03-09
source_of_truth: true
audience: both
---

# Evaluation Resource User Attribution

## Summary

Evaluation resources now persist Grafana-backed actor attribution for tenant-managed writes.

Covered resources:

- evaluators: `created_by`, `updated_by`
- rules: `created_by`, `updated_by`
- templates: `created_by`, `updated_by`
- template versions: `created_by`

This follows the same identity-boundary pattern already used by plugin-backed conversation annotation flows:

1. Grafana plugin backend reads the authenticated Grafana user from request context.
2. The plugin backend forwards a trusted header to Sigil on eval write routes.
3. Sigil control handlers stamp actor fields at the API boundary.
4. Storage persists actor fields with the resource write.

Clients do not send actor fields in request JSON.

## Identity Boundary

The trusted actor header is:

- `X-Grafana-User`

For eval write routes, the plugin backend forwards the current Grafana user using email first and login as fallback. Sigil treats that header as authoritative only at the plugin/backend proxy boundary.

Sigil control handlers require `X-Grafana-User` on tenant-managed eval writes:

- create evaluator
- fork predefined evaluator
- create rule
- update rule
- create template
- publish template version
- fork template

Missing identity is a control-layer error mapped to `401`.

## Resource Behavior

### Mutable resources

Create operations set both actor fields:

- `created_by = current_user`
- `updated_by = current_user`

Update operations preserve creator and refresh updater:

- `created_by = existing value`
- `updated_by = current_user`

### Immutable versions

Template version rows store:

- `created_by = current_user`

Template head rows also refresh `updated_by` when a new version becomes latest.

### Fork semantics

Forked resources are new tenant-managed resources. They do not inherit actor metadata from the source resource.

- predefined evaluator fork -> new evaluator stamped with current user
- template fork -> new evaluator stamped with current user

### System-projected resources

Read-only predefined/global eval resources use the fallback sentinel:

- `created_by = "system@grafana.com"`
- `updated_by = "system@grafana.com"` where applicable

Existing rows without explicit actor values also normalize to `system@grafana.com`.

## API Surface

Read responses now include actor metadata:

- evaluator responses: `created_by`, `updated_by`
- rule responses: `created_by`, `updated_by`
- template responses: `created_by`, `updated_by`
- template version responses/summaries: `created_by`

Write request payloads are unchanged.

## Storage Contract

MySQL-backed eval tables persist actor fields directly on the resource rows.

Defaults:

- non-null string columns
- default value: `system@grafana.com`

This avoids partial rows for predefined/system-projected resources and older records.

## Frontend Contract

The plugin frontend keeps eval request bodies free of actor fields.

Actor metadata is display-only in this pass:

- evaluator list/detail surfaces
- template list/detail/version history surfaces
- rule detail surface

No ownership enforcement or actor-based filtering is introduced in this change.
