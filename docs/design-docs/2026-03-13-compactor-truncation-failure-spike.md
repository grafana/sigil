---
owner: sigil-core
status: completed
last_reviewed: 2026-03-13
source_of_truth: true
audience: both
---

# Compactor Truncation Failure Spike

## Context

`GRA-55` was opened after fresh Grafana Assistant runtime validation showed
recurring `sigil-compactor` failures in `sigil-dev-001` even after `GRA-31`
("Harden compactor truncation against MySQL deadlocks") merged on
2026-03-12 15:18:23 UTC and was included in the currently deployed compactor
image.

The spike goal was to determine whether the current failures are:

- a regression of the `GRA-31` deadlock path,
- a different compactor failure mode on the same truncation path, or
- a correlated infrastructure/connectivity symptom.

## Runtime Evidence

### Logs

Grafana Assistant investigation (`taskId=a2a-dbba924b-62ca-4fd5-be7a-773fc467b532`,
`contextId=adb3701e-d258-4c01-ac45-f8b0e47704d2`) found:

- 65 recurring `sigil-compactor` errors over the last 24 hours across 8 pods.
- Highest concentration on `sigil-compactor-d8b57c664-d5zhq` with 26 errors.
- Representative timestamps from raw logs:
  - 2026-03-12 11:22:59 UTC
  - 2026-03-12 11:27:59 UTC
  - 2026-03-12 11:57:59 UTC
- Raw log aggregation truncates the message body and only preserves the source
  location: `github.com/grafana/sigil/sigil/internal/storage/mysql/compaction.go:68...`

### Metrics

Grafana Assistant reported:

- `sigil_compactor_shard_backlog` spiked on 2026-03-12 between 14:52 UTC and
  15:05 UTC.
- Peak backlog by shard in that window:
  - shard 1: 209
  - shard 2: 128
  - shard 3: 132
  - shard 4: 159
  - shard 5: 159
- Backlog recovered to low single digits by the end of the observed window.
- `sigil_compactor_runs_total` showed continued successful runs rather than a
  full stop.
- MySQL connectivity metrics remained clean (`mysql_global_status_connection_errors_total`
  stayed at zero across tracked connection-error classes).

### Deployment State

Grafana Assistant deployment metadata reported:

- active compactor image tag:
  `ghcr.io/grafana/sigil:d580d1ef51c2593bc7a5aa140ebc6283ae690a72`
- compactor rollout time: 2026-03-12 20:14:38 UTC

Local git verification confirmed that deployed commit
`d580d1ef51c2593bc7a5aa140ebc6283ae690a72` contains merge commit `cddaa7e`
for PR #479 / `GRA-31`.

### Cadence

The recurring error rhythm is consistent with the default compactor truncation
loop:

- `SIGIL_COMPACTOR_TRUNCATE_INTERVAL` defaults to 5 minutes in
  [sigil/internal/config/config.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/config/config.go:24)
- the ticket evidence and runtime findings both showed failures recurring about
  every 5 to 10 minutes

## Code Path Mapping

The current failure signature maps to the truncation delete path introduced long
before `GRA-31`:

- [sigil/internal/storage/mysql/compaction.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/mysql/compaction.go:68)
  executes the `DELETE ... JOIN (...)` statement inside `WALStore.TruncateCompacted`.
- [sigil/internal/storage/compactor/service.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/compactor/service.go:439)
  wraps that truncation call from `truncateOwnedShard`.

`GRA-31` did not change the SQL statement itself. It added a compactor-level
retry loop around the same callsite:

- [sigil/internal/storage/compactor/service.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/compactor/service.go:450)
  retries truncation with exponential backoff and a halved batch size.
- [sigil/internal/storage/mysql/retry.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/mysql/retry.go:64)
  defines which nested MySQL/network errors count as retryable.

## Classification

### Decision

This spike classifies the dominant current mode as a **new failure mode on the
same truncation path**, not a regression of the specific `GRA-31`
deadlock-hardening behavior.

### Why

1. The observed failures still terminate at
   [compaction.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/mysql/compaction.go:68),
   so there is overlap in code path.
2. `GRA-31` specifically hardened retryable lock/deadlock handling after the
   storage-layer retry budget is exhausted, but the current evidence does not
   expose any deadlock-specific message text.
3. MySQL connectivity metrics are clean, so this is not explained by a broad
   database outage.
4. The compactor continues to make progress and backlog recovers, which points
   to intermittent truncation failures rather than a permanent stall.
5. The current logs are too truncated to prove that the root error matches one
   of the retryable classes in
   [sigil/internal/storage/mysql/retry.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/mysql/retry.go:64).
6. The currently deployed compactor image already contains PR #479 / `GRA-31`,
   so the recurrence is happening on a post-hardening binary rather than a
   stale pre-rollout build.

### Important caveat

`sigil_compactor_truncate_deadlocks_total` was not visible in the investigated
metric windows, but that does **not** contradict the rollout evidence above.
The metric is a labeled counter and no series are emitted until one of the
label values is incremented.

## Operational Impact

- Error frequency: 65 recurring truncation-path errors over 24 hours.
- Breadth: 8 compactor pods affected, with one pod carrying about 40% of the
  observed errors.
- Health effect: shard backlog rose to 209 on the hottest shard and exceeded
  100 on 5 shards in a single burst window.
- Service risk: compaction recovered in the observed window, but repeated
  truncate failures shrink the safety margin for read amplification and hot
  storage cleanup if load or lock contention worsens.

## Recommended Follow-up

Create one bounded implementation issue to harden and instrument the truncation
failure boundary:

1. Preserve the root MySQL error code/message at the compactor worker failure
   site so the log no longer collapses to `compaction.go:68...`.
2. Add a truncation-failure counter keyed by coarse class (`retryable_lock`,
   `retryable_connection`, `non_retryable_sql`, `unknown`).
3. Extend the retry classification only if the captured dev error proves to be
   transient and safe to retry.
4. Add a regression test for the exact captured error class.

### Success metrics

- `compaction.go:68` worker-failure logs drop from 65 per 24 hours to 0 in dev.
- shard backlog does not exceed 20 items for more than 15 minutes on any shard
  during normal synthetic traffic.
- any remaining truncation failures emit a structured error class and root code.

### Rollback

Rollback is low risk because the proposed implementation is additive around the
existing `GRA-31` path:

- revert the classifier expansion and new metrics/logging,
- retain the existing `GRA-31` retry/backoff behavior unchanged.
