---
owner: sigil-core
status: completed
last_reviewed: 2026-03-13
source_of_truth: true
audience: both
---

# Ops-Side Trace Query Tuning

## Context

`GRA-51` exists to isolate the dominant ops-side bottleneck behind the
production trace-query latency/cancellation signal that remained after the
March 12 product spike selected `GRA-44` as the first product-side slice.

The product-side spike established two important local facts:

- large-conversation explore is still dominated by trace fan-out after
  conversation detail loads
- the plugin currently fans out up to 10 concurrent Tempo trace reads for the
  unique trace IDs referenced by a conversation

That means the ops investigation for `GRA-51` must stay anchored to the
large-conversation trace-read hot path, not merely to whichever backend was
noisiest in the same 24-hour window.

## Route And Hot Path

Local code review on current `origin/main` shows the relevant product path:

1. `apps/plugin/src/conversation/loader.ts` orders unique trace IDs and fetches
   them with client concurrency `10`.
2. `apps/plugin/src/conversation/fetchTrace.ts` proxies each fetch through
   `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/{trace_id}`.
3. Sigil forwards Tempo proxy requests with a shared
   `SIGIL_QUERY_PROXY_TIMEOUT` budget (default `30s`) in
   [sigil/internal/queryproxy/proxy.go](../../sigil/internal/queryproxy/proxy.go)
   and
   [sigil/internal/querier_module.go](../../sigil/internal/querier_module.go).

This is the path that matters for `GRA-44`: large-conversation trace reads are
essentially a multiplier on `/api/v2/traces/{trace_id}` tail latency.

## Runtime Evidence

### Confirmed Sigil Workloads

Grafana Assistant entity discovery
(`taskId=a2a-b50762ce-7b91-494a-ba71-1cfc63f5f229`) confirmed:

- `sigil-querier` pods in namespace `sigil-ops-001`
- `sigil-ingester` pods in namespace `sigil-ops-001`

This was useful for scoping, but it did not itself identify the large-trace
read bottleneck.

### Route-Specific Finding

Grafana Assistant route-focused trace-read investigation
(`taskId=a2a-719892b9-f5a6-4a5f-8ef0-a41deed73a2f`) found the relevant
downstream operation for the large-conversation hot path:

- Tempo query frontend / querier path:
  `querier_tempo_api_v2_traces_traceid`
- request volume:
  `232 reqps` average, `467 reqps` peak
- affected runtime:
  `tempo-prod` query frontend and querier fleet
- dominant failing dependency:
  memcached caches serving Tempo parquet metadata/page reads

Strongest supporting evidence from the same investigation:

- `2026-03-13 08:35:21 CET`: 10 simultaneous memcached failures across the
  querier fleet
- failure shape: about `60%` write failures and `25%` read timeouts
- affected cache servers:
  `10.144.142.116:11211`, `10.144.41.207:11211`, `10.144.245.14:11211`
- query frontend symptom:
  `2026-03-13 08:35:17 CET` query-frontend latency around `1.56s` on the same
  trace-read path

### Why This Beats The Other Hypotheses

Broader namespace-scoped assistant prompts also surfaced two real but less
route-specific signals:

- `sigil-ops-001` MySQL pressure and WAL timeout/cancellation bursts
  (`taskId=a2a-acfee427-fb40-44cf-ae65-eace1bab45df`)
- `mimir-ops-03` query scheduler saturation during a separate
  `cortex-gw` / scheduler incident
  (`taskId=a2a-8e82ba2e-b429-4ae1-a85f-365fa438b69a`)

Those incidents matter operationally, but neither prompt tied its finding to
the exact large-conversation trace-read route. The route-specific prompt above
did. For `GRA-51`, the Tempo `/api/v2/traces/{trace_id}` path is the relevant
hot path, so the Tempo memcached layer is the dominant bottleneck for this
ticket.

## Code Path Mapping

The runtime finding matches the product-side architecture:

- `GRA-44` exists because large conversations fan out into many Tempo trace ID
  reads after detail hydration.
- each cache stall on Tempo trace lookup is multiplied by both:
  - the plugin’s eager multi-trace fetch pattern
  - Sigil’s shared downstream timeout budget

Relevant repo knobs on the Sigil side:

- [apps/plugin/src/conversation/loader.ts](../../apps/plugin/src/conversation/loader.ts)
  hard-codes trace fetch concurrency at `10`
- [apps/plugin/src/conversation/fetchTrace.ts](../../apps/plugin/src/conversation/fetchTrace.ts)
  fetches `/api/v2/traces/{trace_id}` via the Sigil proxy route
- [sigil/internal/config/config.go](../../sigil/internal/config/config.go)
  defaults `SIGIL_QUERY_PROXY_TIMEOUT` to `30s`
- [sigil/internal/config/config.go](../../sigil/internal/config/config.go)
  also makes `SIGIL_QUERY_COLD_TOTAL_BUDGET` inherit that same request budget

The Sigil knobs above affect blast radius and failure timing, but the evidence
points to Tempo cache instability as the first infra/runtime bottleneck in the
trace-read leg itself.

## Bounded Recommendation

### Recommendation

Take one bounded Tempo-side rollout slice:

1. increase Tempo memcached client timeout for trace-read caches from the
   typical `200ms` range to `500ms`
2. raise memcached client `max_idle_conns` modestly (`100` to `150`)
3. canary only the Tempo querier / query-frontend memcached client config first

The most relevant knobs are the Tempo memcached client settings used on the
trace-read path. Grafana Assistant could not retrieve the exact deployed
`tempo-prod` config values because infrastructure memory was unavailable
(`taskId=a2a-a0c74e5b-4350-4d0c-afa3-6af2cec3b521`), so the config keys below
are documented as Tempo-configuration inference rather than a live config dump:

```yaml
query_frontend:
  search:
    cache:
      memcached:
        timeout: 500ms
        max_idle_conns: 150

storage:
  trace:
    cache:
      parquet-footer:
        memcached:
          timeout: 500ms
          max_idle_conns: 150
      bloom:
        memcached:
          timeout: 500ms
          max_idle_conns: 150
```

### Expected Impact

For the `GRA-44` hot path, the expected outcome is:

- reduce cache timeout/error bursts on `/api/v2/traces/{trace_id}` from the
  observed spike window toward sub-`0.5%` error rates
- cut Tempo trace-read tail latency by roughly `10-20%` for cached reads
- reduce the number of Sigil large-conversation trace fetches that stall long
  enough to consume most of the shared `30s` proxy budget
- lower cancellation amplification when one large conversation fans out into
  many concurrent trace fetches

### Rollback

This rollout is low-risk and reversible:

1. revert the memcached client timeout / idle-connection settings to the
   previous values
2. restart the affected Tempo querier / query-frontend pods
3. confirm query latency and cache error metrics return to the pre-change
   baseline

Rollback should be triggered if:

- cache error rate increases instead of falling
- cache miss rate drops sharply enough to imply unhealthy client behavior
- query latency regresses by more than about `15%`

## Relation To GRA-40 And GRA-44

This finding does not replace `GRA-44`; it sharpens the ops-side explanation
for why `GRA-44` was chosen first.

- `GRA-40` / the March 12 spike correctly identified large-conversation trace
  fan-out as the remaining product-side multiplier.
- `GRA-51` now identifies the first dominant ops-side bottleneck underneath
  that multiplier: Tempo memcached instability on `/api/v2/traces/{trace_id}`.
- Together, the two tickets support a bounded combined strategy:
  - `GRA-44` reduces the number of trace reads that users trigger eagerly
  - the Tempo memcached rollout reduces the per-trace tail/error cost when
    those reads do happen

## Secondary Signals Kept Out Of Scope

Two other ops findings remain real but are not the chosen dominant bottleneck
for this ticket:

1. `sigil-ops-001` MySQL / WAL pressure is an ingest-path risk and should be
   tracked independently if it continues.
2. `mimir-ops-03` query-scheduler saturation is a separate downstream incident
   worth follow-up only if it can be tied to the same user-facing Sigil route.
