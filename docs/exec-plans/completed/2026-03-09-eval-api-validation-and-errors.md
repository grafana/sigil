---
owner: sigil-core
status: completed
last_reviewed: 2026-03-09
source_of_truth: true
audience: both
---

# Execution Plan: Eval API Validation and Error Mapping

## Goal

Move evaluation request validation to the API/control boundary, tighten endpoint contracts for evaluator/template/saved-conversation workflows, and standardize typed internal errors with HTTP status mapping.

## Scope

- control-layer request DTO validation and normalization
- shared evaluator config and output-key validation
- typed control errors and HTTP error mapping
- saved/manual conversation API validation tightening
- duplicate-create conflict handling for evaluation resources
- regression test updates for new validation and status semantics

## Checklist

- [x] Add shared control error types for validation, not found, conflict, unavailable, and internal failures.
- [x] Map typed control errors to stable HTTP status codes in evaluation handlers.
- [x] Improve JSON decode errors for malformed bodies, unknown trailing payloads, and type mismatches.
- [x] Add validated request DTO handling for evaluator create, template create/publish/fork, and eval test requests.
- [x] Add shared evaluator config validation for:
  - [x] `regex`
  - [x] `json_schema`
  - [x] `heuristic`
  - [x] `llm_judge`
- [x] Tighten output-key validation for bounds, pass constraints, reserved keys, and string enum/pass-match normalization.
- [x] Validate template list `scope` at the API layer.
- [x] Return typed not-found errors for missing templates and template versions.
- [x] Return typed conflict errors for duplicate evaluator, template, template-version, and rule creates.
- [x] Tighten saved/manual conversation validation for:
  - [x] `saved_id`
  - [x] duplicate saved conversation conflicts
  - [x] duplicate conversation conflicts
  - [x] tag normalization
  - [x] manual generation IDs
  - [x] manual model/provider presence
  - [x] message role/content validation
  - [x] timestamp ordering
- [x] Add saved-conversation store lookup by `(tenant_id, conversation_id)` for conflict checks.
- [x] Update regression tests for stricter validation and new `404`/`409` semantics.

## Result

- Evaluation write endpoints now validate request shape and evaluator-specific config before service execution.
- Service code returns typed domain/control errors instead of relying on generic validation wrappers or plain string matching.
- HTTP handlers distinguish `400`, `404`, `409`, `503`, and `500` for evaluation APIs.
- Saved/manual conversation APIs reject malformed input and duplicate creates earlier, at the API boundary.
- Existing runtime logic keeps operational failures, but request-shape validation is centralized at the control layer.
