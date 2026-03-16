---
owner: sigil-core
status: completed
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Execution Plan: Agent And Large-Conversation Latency Spike

## Goal

Reproduce the current latency path for agent detail, conversations browser, and
large-conversation explore on updated `origin/main`, then choose one
implementation slice with the highest current leverage.

## Scope

1. Rebuild the earlier spike after rework feedback.
2. Re-measure the browser, agent, and large-conversation paths on current main.
3. Account explicitly for the whole-range histogram/current-stats browser semantics.
4. Produce the revised recommendation and owner-ready follow-up issue.

## Completion Summary

- Confirmed that the conversations browser still drains all result pages for the
  current range, but current-range top stats already have a dedicated aggregate
  endpoint while the histogram still depends on the fully drained result set.
- Measured that the many-hit browser path on current `main` is materially
  cheaper than the first spike suggested: about `147.6 ms` wall through the
  plugin route for `524` rows across `11` requests.
- Measured that large-conversation detail hydration is still cheap, while the
  follow-on Tempo trace fan-out remains the dominant local cost in the explore
  path.
- Confirmed that agent list/version query timings remain low and do not justify
  taking an agent-query slice first.
- Revised the recommendation to choose `GRA-44` first and defer browser paging
  work until aggregate semantics are preserved.

## Implementation Checklist

- [x] Re-read the browser, histogram, agent, and large-conversation code paths.
- [x] Validate current worktree stack behavior on updated `origin/main`.
- [x] Re-seed representative many-hit and large-conversation datasets.
- [x] Measure plugin/browser search and stats timings.
- [x] Measure direct Sigil search/detail timings.
- [x] Measure Tempo trace fan-out timings for a 30-trace conversation.
- [x] Measure agent list/version timings.
- [x] Re-evaluate the original recommendation against current semantics and timings.
- [x] Update the spike write-up and completed execution plan.
- [x] Update the follow-up issue set so the chosen slice and deferred slices are explicit.

## Notes

- Review feedback correctly invalidated the earlier paging-only recommendation:
  the browser cannot stop draining current-range results without also replacing
  the histogram/current-stats dependency on the full loaded row set.
- The production evidence embedded in `GRA-40` still matters. Even though local
  timings are much lower, the direction of the production signal remains more
  consistent with Tempo/downstream trace-query pressure than with agent lookup
  or projection search page cost.
