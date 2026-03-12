---
owner: sigil-core
status: completed
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Agent And Large-Conversation Latency Spike

## Summary

This spike measured the current latency path for:

- agent detail reads
- large conversation browser loads with many hits
- large conversation explore loads with 20+ traces

The dominant first-slice opportunity is **plugin/API pagination-windowing for the conversations browser**, not agent detail query tuning.

## Recommendation

Choose this first implementation slice:

- **Stop draining all conversation search pages on initial browser load.**
- Load only the first page, preserve explicit `Load more`, and keep selection/rendering incremental.

Why this is first:

- It is the clearest measured multiplier in the current path.
- It is bounded to plugin/API behavior and does not require a larger trace-model redesign.
- It reduces repeated querier load immediately for the high-hit path.
- Agent detail server reads are already cheap in local reproduction.

## Measured Results

Local reproduction used the worktree stack core services plus synthetic Go traffic.

### Many-hits browser path

Dataset:

- `648` conversations in the active time window

Measured requests:

| Path | Result |
| --- | --- |
| projection-backed search, first page | `12.6 ms` curl wall, `10.9 ms` Sigil request time delta, `5.3 ms` MySQL projection page delta |
| conversations browser current drain-all behavior | `1.55 s` wall for `13` sequential search requests to fetch `648` rows |
| projection page size reality | client asks for `100`, backend normalizes to `50`, which forces more round-trips |
| Tempo-backed search (`service = "sigil-sdk-traffic-go"`) first page | `46.6 ms` curl wall, `46.1 ms` Sigil request time delta |

Interpretation:

- The high-hit default path is not slow because a single projection query is expensive.
- It is slow because the client waits for repeated page fetches until exhaustion.
- Tempo-backed search is slower per page than projection-backed search, but the current browser self-amplifies even the cheap projection path.

### Large conversation explore path

Dataset:

- one conversation with `30` generations and `30` unique trace IDs

Measured requests:

| Path | Result |
| --- | --- |
| conversation detail (`GET /api/v1/conversations/{id}?format=v2`) | `15.4 ms` curl wall, `40.3 KB` response |
| MySQL `get_conversation` delta | `3.0 ms` |
| MySQL `get_by_conversation` delta | `1.8 ms` |
| fan-out read delta | `2.0 ms` |
| Tempo trace fan-out, `30` trace fetches, concurrency `10` | `157.7 ms` wall, `1.20 s` summed trace time, `243 KB` total payload |

Interpretation:

- In local reproduction, the detail fetch itself is not the dominant cost.
- The Tempo trace leg is already about `10x` the detail wall time.
- This matches the production signal direction from the ticket context: downstream Tempo/cortex latency matters more than conversation detail hydration for the large-conversation explore experience.

### Agent detail path

Measured request averages over `5` runs:

| Path | Result |
| --- | --- |
| `GET /api/v1/agents:lookup` | `3.6 ms` avg |
| `GET /api/v1/agents:versions` | `0.9 ms` avg |
| `GET /api/v1/agents` | `1.0 ms` avg |

Interpretation:

- The core agent read endpoints are not the current dominant bottleneck.
- Agent-page slowness is more likely to come from secondary page fan-out and UI behavior than from the primary lookup query.

## Latency Budget

### Conversations browser

1. Plugin page kicks off search and currently keeps paging until cursor exhaustion.
2. Each page hits `POST /api/v1/conversations/search`.
3. For browse-safe filters, Sigil uses the MySQL projection page query.
4. The dominant wall time is accumulated request chaining, not a single MySQL scan.

### Conversation explore

1. Plugin loads conversation detail from Sigil V2.
2. Sigil reads projection metadata, hot generations, optional fan-out, annotations, rating summary, and score summaries.
3. Plugin then fetches every unique Tempo trace for the conversation.
4. The dominant local wall time is the Tempo trace fan-out leg.

### Agent detail

1. Plugin loads agent lookup, versions, rating, prompt insights, and activity separately.
2. The primary lookup and versions endpoints are cheap.
3. Any remaining slowness is outside the core lookup query shape.

## Before/After Targets

For the chosen first slice:

- Initial many-hits browser load on a `500+` hit dataset should require `1` search request before first render, not `13`.
- Initial browser search wall time on the local synthetic dataset should drop from about `1.55 s` to under `200 ms`.
- Backend projection search cost should stay near the current single-page baseline, about `10-15 ms` locally.

## Deferred Follow-Ups

- **Conversation explore trace windowing / generation-first tree**
  - The current large-conversation experience is still dominated by Tempo trace fan-out after detail returns.
  - This is the right next investigation after browser windowing lands.
- **Agent detail secondary request dedupe / lazy-load**
  - The page still fans out to rating, versions, prompt insights, and activity separately.
  - The core lookup is cheap, so this is lower priority than conversations browser paging.
- **Tempo-backed search tuning**
  - Unsupported filters still fall back to Tempo and are measurably slower per page than projection-backed search.

## Reproducible Profiling Method

Use the local worktree stack core services and direct API probes.

1. Start the stack:

```bash
mise run up:worktree:detached
```

2. Seed a large conversation (`30` generations, `30` traces):

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

3. Seed many short conversations (`500+` rows):

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

4. Time the first projection-backed search page:

```bash
docker compose --project-name gra-40 exec -T sigil \
  curl -s -o /dev/null -w '%{time_total}\n' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8080/api/v1/conversations/search \
  -d '{"filters":"","time_range":{"from":"2026-03-12T16:30:00Z","to":"2026-03-12T18:00:00Z"},"page_size":100}'
```

5. Time the current drain-all paging loop by replaying the cursor chain until `has_more=false`.

6. Time a large detail fetch:

```bash
docker compose --project-name gra-40 exec -T sigil \
  curl -s -o /dev/null -w '%{time_total} %{size_download}\n' \
  'http://localhost:8080/api/v1/conversations/<conversation_id>?format=v2'
```

7. Time the trace fan-out leg with the conversation's `trace_id`s against Tempo:

```bash
curl -H 'X-Scope-OrgID: fake' \
  "http://tempo:3200/api/v2/traces/<trace_id>?start=<from>&end=<to>"
```

8. Attribute backend work with metrics deltas:

- `sigil_request_duration_seconds`
- `sigil_wal_operation_duration_seconds{op="list_conversation_projection_page"}`
- `sigil_wal_operation_duration_seconds{op="get_conversation"}`
- `sigil_wal_operation_duration_seconds{op="get_by_conversation"}`
- `sigil_query_fanout_duration_seconds`

## Caveats

- `grafana-assistant --instance ops` auth was unavailable in this session, so production runtime evidence came from the ticket context rather than a fresh ops query.
- The local plugin/Grafana stack did not finish booting because `plugin-precache` currently requires `go mod tidy` in `apps/plugin`; this spike therefore measured plugin-path behavior from code and measured server/runtime behavior directly against Sigil and Tempo.
