---
owner: sigil-core
status: completed
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Agent And Large-Conversation Latency Spike

## Summary

This spike re-ran the March 12, 2026 latency investigation after the first pass
was sent back to `Rework`.

The updated codebase changes the recommendation:

- **Do not take conversations-browser pagination/windowing first.**
- **Take large-conversation trace windowing / generation-first explore first (`GRA-44`).**

Why the recommendation changed:

- recent work already reduced the many-hit browser cost materially on `origin/main`
- the browser still derives the current-range histogram and current top stats from
  the fully drained result set, so paging-only changes would break the current UX
  contract unless they also add separate full-range aggregates
- the large-conversation explore path is still dominated by Tempo trace fan-out
- agent-detail query endpoints remain cheap relative to the other paths

## Recent Work That Matters

- `2026-03-05-streaming-conversation-search.md` moved the browser search flow to a
  streamed plugin-owned search route with the same cursor semantics.
- `Fix dense agent version header layout` landed on March 12, 2026 and addressed
  the dense-version rendering problem on the agent page. It did not introduce a
  new slow query path.
- `apps/plugin` now boots cleanly enough in the worktree stack to measure the
  plugin proxy path directly through Grafana.

## Recommendation

Choose this first implementation slice:

- **`GRA-44`: Window large-conversation trace loading behind generation-first explore.**

Why this is first now:

- it still aligns with the production signal direction in the ticket:
  `sigil-querier`/`cortex-gw` latency and cancellations are more consistent with
  trace fan-out pressure than with agent lookup or projection search paging
- it is the clearest remaining measured multiplier on current `main`
- it preserves browser semantics without needing a second scope increase for
  histogram/current-range aggregate correctness
- it is bounded enough to ship independently of broader infra tuning

## Measured Results

All measurements below were taken on **Thursday, March 12, 2026** against the
local worktree stack after updating to `origin/main` commit `ac00593`.

### Conversations Browser Path

Dataset:

- `524` conversations in the measured window

Measured via Grafana/plugin resource routes:

| Path | Result |
| --- | --- |
| first browser search page | `52.9 ms` wall, `50` rows returned, `has_more=true` |
| current drain-all browser loop | `147.6 ms` wall over `11` sequential search requests for `524` rows |
| current-range aggregate stats endpoint | `24.4 ms` wall |
| Sigil direct first page | `54.6 ms` wall |
| Sigil direct drain-all loop | `120.4 ms` wall over `11` sequential search requests |

Interpretation:

- the browser still drains every page for the current range
- on current `main`, that drain-all loop is no longer the dominant local cost
- the current-range top stats can already come from a dedicated aggregate route
  (`POST /api/v1/conversations/stats`)
- the histogram still has **no** server aggregate route and is currently built
  from the fully loaded conversation set

Conclusion:

- a paging-only browser slice is no longer a clean first move
- preserving whole-range histogram/current stats semantics would require a
  broader browser-aggregate split, not just `Load more`

### Large Conversation Explore Path

Dataset:

- one conversation with `30` generations and `30` unique trace IDs
- example conversation: `devex-go-mistral-0-1773347248309`

Measured results:

| Path | Result |
| --- | --- |
| plugin conversation detail, warm | `8.1 ms` wall, `38.2 KB` |
| Sigil direct conversation detail | `8.7 ms` wall, `38.2 KB` |
| Tempo trace fan-out, `30` trace fetches, concurrency `10` | `67.6 ms` wall, `641.9 ms` summed request time, `235.8 KB` total payload |

Interpretation:

- detail hydration itself is cheap on current `main`
- the follow-on Tempo trace leg is still the dominant local cost in the explore flow
- reducing eager raw trace loading remains the best bounded product-side lever

### Agent Detail Path

Measured via Grafana/plugin resource routes:

| Path | Result |
| --- | --- |
| `GET /query/agents` | `29.2 ms` wall |
| `GET /query/agents/versions` | `6.2 ms` wall |

Measured via direct Sigil API:

| Path | Result |
| --- | --- |
| `GET /api/v1/agents` | `1.7 ms` wall |
| `GET /api/v1/agents:versions` | `1.2 ms` wall |

Interpretation:

- the primary agent read path is not a measured bottleneck in local reproduction
- current agent-page risk is more about secondary UI requests or layout density
  than a slow core lookup query

## End-To-End Latency Budget

### Conversations Browser

1. Grafana/plugin request reaches `POST /query/conversations/search`.
2. The browser loops until every cursor page has been drained.
3. Current-range top stats can come from `POST /query/conversations/stats`.
4. The histogram still depends on the fully loaded `conversations[]` array.

Dominant budget note on current `main`:

- list draining is no longer expensive enough locally to outrank the large
  conversation trace path
- the semantic cost of changing it correctly is now larger than the measured gain

### Conversation Explore

1. Plugin fetches conversation detail through `GET /query/conversations/{id}?format=v2`.
2. The page then fetches every unique Tempo trace referenced by the loaded generations.
3. Trace fetches run with client concurrency `10`.

Dominant budget note:

- detail is cheap
- Tempo trace fan-out is the first user-visible multiplier left in this path

### Agent Detail

1. Plugin loads agents list / detail / versions.
2. Recent dense-version UI work already addressed the obvious layout issue.
3. Core agent query timings remain low.

Dominant budget note:

- no evidence that agent query/data-shape work should go first

## Before/After Targets

For the chosen first slice (`GRA-44`):

- initial large-conversation explore render should **not** wait for all unique
  traces in the conversation
- eager trace fetch count on the synthetic `30`-trace dataset should drop from
  `30` to a bounded initial window
- local initial trace-loading wall time should drop from about `67.6 ms` to
  **under `25 ms`**
- plugin detail fetch should remain near the current `~8 ms` warm baseline

## Deferred Follow-Ups

- **`GRA-43`: split browser aggregates from paged browser rows**
  - keep whole-range histogram and current-range stats correct
  - only after that is in place does browser row pagination/windowing become a
    clean product slice
- **`GRA-45`: investigate production trace-query infra tuning**
  - the ticket’s production evidence still points to `sigil-querier`,
    `cortex-gw`, and cancellation pressure that local reproduction cannot fully
    model
- **agent detail secondary request dedupe / lazy-load**
  - lower priority until the trace path is reduced

## Reproducible Profiling Method

1. Start the worktree stack:

```bash
mise run up:worktree:detached
```

2. Seed one large conversation:

```bash
docker compose --project-name gra-40 --profile core --profile traffic-lite run --rm --no-deps \
  -e SIGIL_TRAFFIC_INTERVAL_MS=100 \
  -e SIGIL_TRAFFIC_ROTATE_TURNS=50 \
  -e SIGIL_TRAFFIC_CONVERSATIONS=1 \
  -e SIGIL_TRAFFIC_MAX_CYCLES=30 \
  -e SIGIL_TRAFFIC_GEN_GRPC_ENDPOINT=sigil:4317 \
  -e SIGIL_TRAFFIC_TRACE_GRPC_ENDPOINT=alloy:4317 \
  sdk-traffic-lite bash -lc 'export PATH=/usr/local/go/bin:$PATH; go run ./sdks/go/cmd/devex-emitter'
```

3. Seed many short conversations:

```bash
docker compose --project-name gra-40 --profile core --profile traffic-lite run --rm --no-deps \
  -e SIGIL_TRAFFIC_INTERVAL_MS=5 \
  -e SIGIL_TRAFFIC_ROTATE_TURNS=1 \
  -e SIGIL_TRAFFIC_CONVERSATIONS=130 \
  -e SIGIL_TRAFFIC_MAX_CYCLES=130 \
  -e SIGIL_TRAFFIC_GEN_GRPC_ENDPOINT=sigil:4317 \
  -e SIGIL_TRAFFIC_TRACE_GRPC_ENDPOINT=alloy:4317 \
  sdk-traffic-lite bash -lc 'export PATH=/usr/local/go/bin:$PATH; go run ./sdks/go/cmd/devex-emitter'
```

4. Use the worktree URLs:

```bash
./scripts/run-sigil-worktree.sh url
```

5. Time browser/plugin search and stats through Grafana resource routes after
   logging in as `admin` / `admin`.

6. Time direct Sigil API search/detail requests through:

```bash
http://sigil.gra-40.orb.local
```

7. Time Tempo trace fan-out through:

```bash
http://tempo.gra-40.orb.local/api/v2/traces/<trace_id>
```

8. Attribute the browser behavior from code:

- `apps/plugin/src/pages/ConversationsBrowserPage.tsx`
- `apps/plugin/src/components/conversations/ConversationTimelineHistogram.tsx`
- `sigil/internal/server/conversation_search.go`

## Caveats

- `grafana-assistant --instance ops` reported missing auth in this session.
- `grafana-assistant --instance dev` returned datasource errors / timeouts for
  the bounded Sigil runtime prompts, so production runtime evidence comes from
  the ticket context rather than a fresh assistant-backed query.
