---
owner: sigil-core
status: completed
last_reviewed: 2026-03-13
source_of_truth: true
audience: both
---

# Execution Plan: Compactor Truncation Failure Spike

## Goal

Classify the recurring `sigil-compactor` failures seen in `sigil-dev-001`,
determine whether they regress `GRA-31`, quantify impact, and produce one
bounded follow-up implementation issue.

## Scope

1. Reproduce the compactor error signal from runtime evidence.
2. Map the observed failure to concrete code paths in the compactor/truncator.
3. Compare the current failure shape with the `GRA-31` deadlock hardening.
4. Quantify compaction-health impact and create one owner-ready follow-up.

## Completion Summary

- Reproduced the current runtime signal via Grafana Assistant with concrete pod,
  timestamp, and backlog evidence.
- Mapped the recurring failures to the truncation SQL execution at
  [sigil/internal/storage/mysql/compaction.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/mysql/compaction.go:68)
  and the compactor retry wrapper added by
  [sigil/internal/storage/compactor/service.go](/Users/cyriltovena/code/symphony-workspaces/GRA-55/sigil/internal/storage/compactor/service.go:450).
- Verified that the active dev compactor image
  `d580d1ef51c2593bc7a5aa140ebc6283ae690a72` already contains merge commit
  `cddaa7e` from PR #479 / `GRA-31`.
- Classified the dominant current mode as a new or still-unclassified truncation
  failure on the same path, not a proven regression of the explicit `GRA-31`
  deadlock retry logic.
- Quantified impact at 65 errors over 24 hours with shard backlog peaks up to
  209 items and a follow-up implementation issue to harden observability and
  retry classification around the truncation boundary.

## Implementation Checklist

- [x] Capture a concrete reproduction signal with timestamps and affected pods.
- [x] Record pull/sync evidence against `origin/main`.
- [x] Inspect the truncation code path and the `GRA-31` hardening changes.
- [x] Distinguish the current signal from broad MySQL connectivity failures.
- [x] Quantify the compaction-health impact using runtime metrics.
- [x] Produce an in-repo spike artifact with classification, impact, and
  proposed follow-up.
- [x] Create one bounded Linear follow-up issue linked to `GRA-55`.

## Validation

- `grafana-assistant prompt --instance dev --json '<targeted compactor investigation prompt>'`
- `git fetch origin --prune`
- `git pull --ff-only origin $(git branch --show-current)`
- `git merge --ff-only origin/main`
- repo review of the code paths and the merged `GRA-31` PR (#479)

## Notes

- The dominant blind spot was log truncation: the aggregation system preserves
  `compaction.go:68` but not the root MySQL error text, which is why the
  follow-up is centered on explicit error classification at the compactor
  boundary.
