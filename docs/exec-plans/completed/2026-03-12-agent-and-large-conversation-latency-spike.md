---
owner: sigil-core
status: completed
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Execution Plan: Agent And Large-Conversation Latency Spike

## Goal

Find the dominant latency bottleneck for agent detail and large-conversation loading, document a reproducible profiling method, and choose one implementation slice to execute next.

## Scope

1. Reconstruct the current request path in plugin and Sigil code.
2. Reproduce many-hits and 20+ trace cases on the local stack.
3. Measure search, detail, and trace-loading costs with route and storage metrics.
4. Produce a written recommendation and create the follow-up implementation issue.

## Completion Summary

- Confirmed that the primary agent lookup endpoints are cheap in local reproduction and are not the dominant first-slice target.
- Measured that projection-backed search is cheap per page, but the current conversations browser multiplies latency by draining every page before settling.
- Measured that large-conversation detail fetches are relatively cheap locally, while the follow-on Tempo trace fan-out already dominates the wall clock for a `30`-trace conversation.
- Chose plugin/API pagination-windowing for the conversations browser as the first implementation slice, with trace windowing / generation-first tree work deferred.
- Documented the profiling method and the measured results in `docs/design-docs/2026-03-12-agent-and-large-conversation-latency-spike.md`.

## Implementation Checklist

- [x] Capture the relevant plugin and backend call paths.
- [x] Reproduce a many-hits search dataset locally.
- [x] Reproduce a 20+ trace conversation locally.
- [x] Measure projection-backed search cost.
- [x] Measure current drain-all search behavior cost.
- [x] Measure large conversation detail cost.
- [x] Measure Tempo trace fan-out cost for the same conversation.
- [x] Measure agent lookup and versions endpoint cost.
- [x] Document the profiling method and recommendation.
- [x] Create the follow-up implementation issue.
- [x] Sync final notes back to the Linear workpad.

## Notes

- The local plugin/Grafana stack was not required for the spike result once `plugin-precache` failed; direct Sigil and Tempo probes plus plugin call-path analysis were enough to isolate the dominant multiplier.
- Follow-up issues created from the spike: `GRA-43` for conversations browser pagination-windowing and `GRA-44` for deferred large-conversation trace windowing / generation-first explore.
