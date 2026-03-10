---
owner: sigil-core
status: completed
last_reviewed: 2026-03-09
source_of_truth: true
audience: both
---

# Execution Plan: Evaluation Resource User Attribution

## Goal

Persist Grafana-backed `created_by` / `updated_by` metadata on evaluation resources and expose it through the evaluation control APIs and plugin UI.

## Checklist

- [x] Add actor fields to eval domain types and response DTOs.
- [x] Add actor columns to MySQL eval models.
- [x] Forward Grafana user identity from the plugin backend on eval write routes.
- [x] Require trusted Grafana user identity at the Sigil eval control boundary for tenant-managed writes.
- [x] Stamp actor fields on evaluator, rule, template, and template-version writes.
- [x] Return actor fields on evaluation read APIs.
- [x] Surface actor metadata in key evaluation UI views.
- [x] Add regression coverage for:
  - [x] missing actor identity on eval writes
  - [x] proxy forwarding of Grafana user identity on eval writes
  - [x] storage round-tripping actor fields

## Notes

- Actor identity is stored as one normalized string field.
- Request JSON does not accept actor fields.
- Predefined/global resources use `system@grafana.com`.
- Ownership enforcement is out of scope for this pass.
