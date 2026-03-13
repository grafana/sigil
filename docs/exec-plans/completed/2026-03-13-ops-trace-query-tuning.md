---
owner: sigil-core
status: completed
last_reviewed: 2026-03-13
source_of_truth: true
audience: both
---

# Execution Plan: Ops Trace Query Tuning

## Goal

Identify the dominant ops-side bottleneck for large-conversation Sigil trace
reads, document the relevant tuning knobs, and produce one bounded rollout
recommendation tied back to `GRA-40` and `GRA-44`.

## Scope

1. Rebuild the issue context from the March 12 latency spike artifacts.
2. Confirm the exact trace-read hot path in the current repo.
3. Use Grafana Assistant `ops` evidence to isolate one dominant downstream
   bottleneck on that path.
4. Turn that finding into one bounded tuning slice with rollback notes and
   expected impact.

## Completion Summary

- Re-established the large-conversation trace-read path on current `main`:
  plugin-side eager trace fan-out still proxies Tempo
  `/api/v2/traces/{trace_id}` through Sigil with concurrency `10`.
- Confirmed live `ops` access and used Grafana Assistant to identify the exact
  route-specific downstream operation:
  Tempo querier `/api/v2/traces/{trace_id}` trace reads in `tempo-prod`.
- Classified the dominant ops-side bottleneck for this ticket as Tempo
  memcached cache instability on that trace-read path, not the other
  namespace-wide incidents surfaced during broader searches.
- Documented the relevant Tempo memcached client knobs, one bounded canary
  rollout, rollback triggers, and expected latency/error improvements.
- Related the ops-side result directly back to the `GRA-44` product slice:
  it lowers the per-trace tail cost underneath the same large-conversation
  trace fan-out multiplier.

## Implementation Checklist

- [x] Reset the stale rework attempt and create a fresh workpad/branch.
- [x] Record pull/sync evidence against current `origin/main`.
- [x] Re-read the March latency spike and conversation-query-path docs.
- [x] Confirm the current repo hot path for large-conversation trace reads.
- [x] Run Grafana Assistant `ops` entity discovery for the Sigil workloads.
- [x] Run route-specific assistant investigation for large-conversation trace
  reads.
- [x] Distinguish the chosen bottleneck from adjacent MySQL/WAL and Mimir
  scheduler signals.
- [x] Produce an in-repo spike artifact with one bounded tuning recommendation.

## Validation

- `grafana-assistant prompt --instance ops --json 'In the last 24 hours, investigate workloads named sigil-querier, cortex-gw, and sigil-ingester...'`
- `grafana-assistant prompt --instance ops --json 'Investigate Sigil requests that proxy Tempo trace reads, especially GET /api/v2/traces/<trace_id>...'`
- `grafana-assistant prompt --instance ops --json 'For the large-conversation trace-read hot path identified as Tempo querier /api/v2/traces/{trace_id} in tempo-prod, document the exact tuning knobs...'`
- repo review of:
  - `apps/plugin/src/conversation/loader.ts`
  - `apps/plugin/src/conversation/fetchTrace.ts`
  - `sigil/internal/queryproxy/proxy.go`
  - `sigil/internal/querier_module.go`
  - `sigil/internal/config/config.go`

## Notes

- Broader assistant prompts exposed other genuine pressure signals
  (`sigil-ops-001` MySQL/WAL exhaustion and `mimir-ops-03` scheduler
  saturation), but only the Tempo trace-read prompt matched the exact
  large-conversation hot path selected by `GRA-44`.
- The exact deployed Tempo memcached config could not be dumped from
  infrastructure memory during this run, so the documented knob names are based
  on Tempo configuration inference rather than a live config export.
