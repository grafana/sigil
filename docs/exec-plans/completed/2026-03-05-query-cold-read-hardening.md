---
owner: sigil-core
status: completed
last_reviewed: 2026-03-05
source_of_truth: true
audience: both
---

# Execution Plan: Query Cold-Read Hardening

## Goal

Reduce S3/index read amplification and latency pileups on conversation detail reads while keeping strict correctness semantics when cold data is required.

## Completion Summary

- Added bounded cold-read policies for conversation fan-out:
  - hot-first gating when expected generation count is already satisfied
  - bounded block metadata range from conversation timestamps
  - bounded cold worker concurrency and global in-flight index read limits
  - per-index timeout/retry and request-level cold-read budget
- Added object-store index caching and request coalescing:
  - in-process TTL/LRU cache for `index.sigil`
  - singleflight dedupe for concurrent reads of the same block index
  - negative cache for missing/stale blocks
- Expanded query-path observability:
  - explicit cold read metrics (cache hits/misses, inflight gauge, scanned blocks, index read duration)
  - object-store tracing attributes for index/generation bytes and range counts
- Updated HTTP request histogram buckets to include long-tail latency up to 60s (removes 10s clipping artifact).
- Added query cold-read configuration surface:
  - `SIGIL_QUERY_COLD_TOTAL_BUDGET`
  - `SIGIL_QUERY_COLD_INDEX_READ_TIMEOUT`
  - `SIGIL_QUERY_COLD_INDEX_RETRIES`
  - `SIGIL_QUERY_COLD_INDEX_WORKERS`
  - `SIGIL_QUERY_COLD_INDEX_MAX_INFLIGHT`
  - `SIGIL_QUERY_COLD_INDEX_CACHE_TTL`
  - `SIGIL_QUERY_COLD_INDEX_CACHE_MAX_BYTES`
- Updated architecture and reliability docs to reflect new fan-out/read semantics.

## Implementation Checklist

- [x] Add cold-read and index-cache config types in storage package.
- [x] Wire query cold-read config from runtime env/config into querier query service dependencies.
- [x] Implement plan-aware fan-out conversation read path with hot-first gating and bounded cold scans.
- [x] Add bounded cold index read policies (timeouts, retries, in-flight limits, worker pool).
- [x] Implement object-store index cache + singleflight coalescing.
- [x] Add cold-read metrics and tracing attributes.
- [x] Extend HTTP request-duration histogram bucket range to 60s.
- [x] Add/update tests across config, fan-out, object store, and query path.
- [x] Run full backend test suite (`go test ./...` under `sigil`).

