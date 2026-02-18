// Package eval defines the core online-evaluation domain model used by Sigil.
//
// The package is intentionally small and focused:
//   - core types (`EvaluatorDefinition`, `RuleDefinition`, `WorkItem`, `GenerationScore`)
//   - error semantics (`Permanent`, `IsPermanent`)
//   - boundaries consumed by focused subpackages (`rules`, `enqueue`, `worker`, `ingest`)
//
// High-level online-evaluation flow (durable, asynchronous, test-weighted):
//
//	generation ingest (WAL SaveBatch tx)
//	            |
//	            | 1) persist generation rows
//	            | 2) persist eval_enqueue_events rows (same tx)
//	            v
//	  +--------------------------+
//	  |   eval_enqueue_events    |
//	  +--------------------------+
//	            |
//	            | dispatcher claims rows
//	            | (FOR UPDATE SKIP LOCKED, stale-claim recovery)
//	            v
//	  +--------------------------+
//	  | enqueue.Service          |
//	  | - retry with backoff     |
//	  | - permanent-fail cutoff  |
//	  +--------------------------+
//	            |
//	            | Process(event)
//	            v
//	  +--------------------------+
//	  | rules.Engine             |
//	  | - selector               |
//	  | - matcher                |
//	  | - conversation sampler   |
//	  +--------------------------+
//	            |
//	            | enqueue deterministic work_id
//	            v
//	  +--------------------------+
//	  |      eval_work_items     |
//	  +--------------------------+
//	            |
//	            | worker claims rows
//	            | (distributed-safe claim loop)
//	            v
//	  +--------------------------+
//	  | worker.Service           |
//	  | - global rate limiter    |
//	  | - concurrency semaphore  |
//	  | - retry/permanent fail   |
//	  +--------------------------+
//	            |
//	            | execute evaluator kind
//	            | (heuristic/regex/json_schema/llm_judge)
//	            v
//	  +--------------------------+
//	  |    generation_scores     |
//	  +--------------------------+
//	            |
//	            +--> score query APIs
//	            +--> generation detail latest_scores
//
// Scale and distribution model:
//   - In single-process mode, dispatcher + worker run as local services.
//   - In multi-pod mode, the same binaries scale horizontally because event/work
//     claiming is DB-coordinated with row locks and deterministic IDs.
//   - Retries and backoff are persisted in MySQL, so transient failures do not
//     lose evaluation intent once ingest commits.
//
// Test-weighted confidence map (from fastest to broadest):
//   - Rule logic: `rules/selector_test.go`, `rules/matcher_test.go`,
//     `rules/sampler_test.go`, `rules/engine_test.go`.
//   - Dispatcher behavior: `enqueue/service_test.go` (notify, retry, permanent
//     classification).
//   - Worker budgets and retry semantics: `worker/service_test.go` (rate,
//     concurrency caps, transient/permanent failure handling, metrics).
//   - Durable storage lifecycle: `storage/mysql/eval_test.go`,
//     `storage/mysql/wal_test.go` (claim/complete/fail, stale-claim recovery,
//     transactional enqueue intent).
//   - End-to-end pipeline: `storage/mysql/eval_pipeline_integration_test.go`
//     (ingest -> enqueue -> worker -> score materialization).
package eval
