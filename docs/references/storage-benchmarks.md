---
owner: sigil-core
status: active
last_reviewed: 2026-02-19
source_of_truth: true
audience: both
---

# Storage Benchmark Baselines

Baseline capture date: 2026-02-19  
Host: Apple M4 Pro (`darwin/arm64`)  
Go runtime: `go1.25.7` via `mise` toolchain

## Commands

Primary suite:

```bash
mise run bench:storage
```

Targeted object-store runs (used to capture clean benchmark lines because object write benchmarks emit per-iteration info logs):

```bash
cd sigil && GOWORK=off go test ./internal/storage/object -run '^$' -bench '^BenchmarkReadIndex$' -benchmem
cd sigil && GOWORK=off go test ./internal/storage/object -run '^$' -bench '^BenchmarkReadGenerations$' -benchmem
cd sigil && GOWORK=off go test ./internal/storage/object -run '^$' -bench '^BenchmarkWriteBlock$' -benchmem
```

## Results

### `internal/storage` (`BenchmarkFanOutQuery`)

| Benchmark | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| `list_conversation_generations` | 234131 | 141455 | 41 |
| `get_generation_by_id_hot_hit` | 2071 | 720 | 11 |
| `get_generation_by_id_cold_fallback` | 2252 | 792 | 13 |

### `internal/storage/compactor`

| Benchmark | N | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: | ---: |
| `BenchmarkParallelCompaction` | 127 | 8729368 | 49220317 | 290244 |

### `internal/storage/mysql`

| Benchmark | N | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: | ---: |
| `BenchmarkWALStoreSaveBatchSingle` | 1 | 3757713333 | 196952 | 1317 |
| `BenchmarkWALStoreSaveBatch100` | 1 | 3267463292 | 2972608 | 27259 |
| `BenchmarkClaimBatch` | 1 | 3598519500 | 68968 | 502 |
| `BenchmarkBacklogDiscovery` | 1 | 3211023708 | 70104 | 541 |

### `internal/storage/object`

| Benchmark | N | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: | ---: |
| `BenchmarkEncodeBlock` | 67322 | 17377 | 90296 | 27 |
| `BenchmarkDecodeBlock` | 19868 | 58596 | 139313 | 1601 |
| `BenchmarkReadIndex` | 193896 | 5903 | 46333 | 18 |
| `BenchmarkReadGenerations` | 12612 | 98617 | 262828 | 2604 |
| `BenchmarkWriteBlock` | 70281 | 16607 | 82795 | 55 |

## Notes

- These are local machine baselines for regression visibility, not strict pass/fail thresholds.
- `internal/storage/mysql` benchmarks include migration/setup overhead, which drives low `N` and high `ns/op`.
- Re-capture this document when benchmark implementation changes or significant storage/query performance changes land.
