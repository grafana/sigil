---
owner: sigil-core
status: completed
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Execution Plan: Timeout And Cancellation Mitigation

## Goal

Reduce user-visible timeout and cancellation spikes across Sigil query and ingest paths by aligning cold-read budgets with the real request timeout and adding clearer root-cause attribution for timeout versus cancellation failures.

## Scope

1. Query path
   - align default cold-read total budget with the configured query proxy/request timeout
   - preserve existing per-index timeout and concurrency controls
   - emit explicit cold-read outcome metrics for timeout and cancellation
2. Ingest path
   - distinguish store timeout and cancellation failures from generic store errors in ingest metrics
   - add structured timeout/cancellation fields to WAL save failure logs
3. Validation
   - add regression tests for derived cold-read budgeting and timeout/cancellation attribution
   - run targeted backend tests covering config, storage fanout, query, ingest, and module wiring

## Completion Summary

- Query cold-read default budget now inherits the effective query proxy timeout
  when `SIGIL_QUERY_COLD_TOTAL_BUDGET` is not explicitly set, eliminating the
  default 6s vs 30s request-budget mismatch that was already special-cased on
  the `eval:test` path.
- Query fanout now emits `sigil_query_cold_read_outcome_total{operation,outcome}`
  so timeout and cancellation spikes are attributable at the cold-read layer.
- Generation ingest metrics now distinguish `timeout`, `canceled`, and
  `store_error` outcomes, and WAL save failure logs include structured timeout
  and cancellation flags for faster root-cause attribution.
- Regression coverage was added for derived cold-read budgeting and both query
  and ingest timeout/cancellation attribution paths.

## Implementation Checklist

- [x] Capture the concrete mismatch signal between query request timeout and cold-read timeout.
- [x] Align the default query cold-read budget with the effective query proxy timeout.
- [x] Add cold-read outcome attribution for query fanout timeout/cancellation paths.
- [x] Add ingest metric attribution for timeout/cancellation store failures.
- [x] Add structured timeout/cancellation fields to WAL save failure logs.
- [x] Add regression tests for config-derived budget alignment and timeout/cancellation attribution.
- [x] Run targeted validation: `go test ./sigil/internal ./sigil/internal/config ./sigil/internal/storage ./sigil/internal/query ./sigil/internal/ingest/generation`

## Notes

- The pre-change reproduction signal was static but concrete: normal query detail paths still used a 6s cold-read budget while `eval:test` already had a special-case override to use the full 30s request timeout, indicating the mismatch was already known on an adjacent path.
