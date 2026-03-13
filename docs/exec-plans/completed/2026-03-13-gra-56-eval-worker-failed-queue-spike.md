# GRA-56: Eval Worker Failed Queue Accumulation Spike

## Status

- Completed: 2026-03-13
- Linear issue: `GRA-56`

## Summary

Fresh `grafana-assistant` validation in `dev` and local code inspection both point to the same dominant accumulation mode:

1. `sigil-eval-worker` hits a `generation_scores` write failure.
2. `worker.Service.failItem` records the error and requeues only while attempts remain.
3. After `SIGIL_EVAL_MAX_ATTEMPTS` is exhausted, `FailWorkItem` marks the row `failed`.
4. `ClaimWorkItems` never reclaims `failed` rows, so the backlog persists across polls and pod restarts.

This makes `GRA-56` mostly the recovery-semantics side of `GRA-54`, not an independent root cause.

## Evidence

### Grafana Assistant (`dev`)

- Task: `a2a-1a2c0fd2-bbcd-4e3d-ad54-c13227e16c2a`
- Context: `a7f83576-739d-4e57-88b0-15692a1ecd3c`
- Time window: 2026-03-12 06:16 CET to 2026-03-13 06:16 CET
- Workload: `sigil-eval-worker` in `sigil-dev-001`
- Failed queue depth: 182 stuck at 2026-03-13 07:16 CET, peak 364 at 2026-03-12 16:47 CET
- Dominant error window: 2026-03-12 12:43 CET to 2026-03-12 15:36 CET
- Dominant storage symptom: `generation_scores` insert attempts completing with `[rows:0]`
- Secondary signal: two MySQL connectivity errors around 2026-03-12 13:39 to 13:41 CET
- Recovery signal: no evidence that retries, pod restarts, or later claim cycles drained terminal failures
- Representative log samples from task `a2a-f2151b8c-4074-47b3-9bce-0422e2f3000a` / context `2be9db50-cb8f-4aff-926b-ee9dc2d64dd4`:
  - 2026-03-12 13:18:42 CET, `sigil-eval-worker-68f4854b47-nznpz`: `INSERT INTO generation_scores ... [rows:0] [3.4ms]`
  - 2026-03-12 13:18:46 CET, `sigil-eval-worker-68f4854b47-nznpz`: `INSERT INTO generation_scores ... [rows:0] [3.8ms]`
  - 2026-03-12 13:18:50 CET, `sigil-eval-worker-68f4854b47-nznpz`: `INSERT INTO generation_scores ... [rows:0] [3.9ms]`

### Repository code path

- `sigil/internal/eval/worker/service.go`
  - score write failures flow through `InsertScoreBatch(...)` into `failItem(...)`
  - retries use exponential backoff via `retryBackoff(item.Attempts + 1)`
  - after retries are exhausted, the worker delegates to `FailWorkItem(...)`
- `sigil/internal/storage/mysql/eval.go`
  - `ClaimWorkItems(...)` only claims rows where `status = queued`
  - stale `claimed` rows are recovered after `defaultEvalWorkItemClaimTTL`
  - `FailWorkItem(...)` sets terminal `status = failed` when the error is permanent or attempts reach `maxAttempts`
  - there is no storage or worker path that moves `failed` back to `queued`

### Regression coverage

- `go test ./sigil/internal/eval/worker -run 'TestServiceFailHandlingTransientAndPermanent'`
- `go test ./sigil/internal/storage/mysql -run 'TestEvalStoreWorkItemLifecycle|TestEvalStoreWorkItemClaimRecoversStaleClaim'`

These tests confirm the intended current semantics:

- transient failures requeue before the max-attempt cut-off
- stale claimed work is recovered
- terminal failed work remains failed

## Recovery Semantics

### What drains today

- `queued` work with `scheduled_at <= now`
- stale `claimed` work after the 10 minute claim TTL
- cancellation paths that explicitly call `RequeueClaimedWorkItem(...)`

### What does not drain today

- `failed` work items
- exhausted retryable write failures after attempt 3
- failures that survive pod restarts

## Relationship To GRA-54

- Same dominant root cause family: `generation_scores` write-path failures inside the eval worker
- Different question being answered:
  - `GRA-54` is about why the write path fails
  - `GRA-56` is about what happens after those failures exhaust retries
- Practical conclusion: fixing `GRA-54` removes the primary source of new failed items, but it does not provide a recovery path for rows already marked `failed`

## User Impact

- At least 182 evaluation results were still missing in `dev` as of 2026-03-13 07:16 CET
- Peak missing backlog reached 364 items on 2026-03-12 16:47 CET
- Missing `generation_scores` rows skew evaluator volume, pass-rate denominators, and downstream analytics
- Feature work that assumes complete evaluation data, including issue `#411`, remains exposed to silent undercounting

## Bounded Follow-up

Create one implementation issue to add an operator-safe replay path for retryable `failed` eval work items.

Recommended shape:

- add an explicit replay mechanism that moves selected `failed` rows back to `queued`
- gate it behind a feature flag or explicit operator command so rollback is immediate
- emit replay metrics alongside existing `sigil_eval_queue_depth` metrics
- keep default behavior unchanged until enabled

Success metrics:

- `sigil_eval_queue_depth{status="failed"}` returns to zero within 30 minutes after replaying a transient backlog in `dev`
- no replayable failed item remains older than 30 minutes after operator action
- no duplicate-score regressions are introduced because score writes remain idempotent by `(tenant_id, score_id)`

Rollback:

- disable the replay flag or stop invoking the replay command
- leave current terminal `failed` semantics as the fallback behavior
