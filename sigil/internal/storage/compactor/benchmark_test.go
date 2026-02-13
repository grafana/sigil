package compactor

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func BenchmarkParallelCompaction(b *testing.B) {
	const (
		shardCount    = 8
		rowsPerShard  = 4000
		compactorWork = 8
	)

	discoverer := benchmarkDiscoverer{shardCount: shardCount, backlog: rowsPerShard}
	claimer := newBenchmarkClaimer(shardCount, rowsPerShard)
	service := &Service{
		cfg: config.CompactorConfig{
			CompactInterval:    time.Minute,
			TruncateInterval:   time.Minute,
			Retention:          time.Hour,
			BatchSize:          1000,
			LeaseTTL:           30 * time.Second,
			ShardCount:         shardCount,
			ShardWindowSeconds: 60,
			Workers:            compactorWork,
			CycleBudget:        2 * time.Minute,
			ClaimTTL:           5 * time.Minute,
			TargetBlockBytes:   64 * 1024 * 1024,
		},
		logger:        log.NewNopLogger(),
		ownerID:       "bench-owner",
		discoverer:    discoverer,
		leaser:        benchmarkLeaser{},
		claimer:       claimer,
		truncator:     benchmarkTruncator{},
		blockWriter:   benchmarkBlockWriter{},
		metadataStore: benchmarkMetadataStore{},
	}

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		claimer.reset(rowsPerShard)
		service.runCompactCycle(ctx)
	}
}

type benchmarkDiscoverer struct {
	shardCount int
	backlog    int
}

func (d benchmarkDiscoverer) ListShardsForCompaction(_ context.Context, _ int, _ int, _ int) ([]storage.TenantShard, error) {
	out := make([]storage.TenantShard, 0, d.shardCount)
	for shardID := 0; shardID < d.shardCount; shardID++ {
		out = append(out, storage.TenantShard{
			TenantID: "tenant-bench",
			ShardID:  shardID,
			Backlog:  d.backlog,
		})
	}
	return out, nil
}

func (d benchmarkDiscoverer) ListShardsForTruncation(_ context.Context, _ int, _ int, _ time.Time, _ int) ([]storage.TenantShard, error) {
	return nil, nil
}

type benchmarkLeaser struct{}

func (benchmarkLeaser) AcquireLease(_ context.Context, _ string, _ int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	return true, ownerID, time.Now().UTC().Add(ttl), nil
}

func (benchmarkLeaser) RenewLease(_ context.Context, _ string, _ int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	return true, ownerID, time.Now().UTC().Add(ttl), nil
}

type benchmarkClaimer struct {
	mu        sync.Mutex
	remaining map[int]int
	claimed   map[int]int
	sequence  uint64
}

func newBenchmarkClaimer(shards int, rowsPerShard int) *benchmarkClaimer {
	c := &benchmarkClaimer{
		remaining: make(map[int]int, shards),
		claimed:   make(map[int]int, shards),
	}
	for shardID := 0; shardID < shards; shardID++ {
		c.remaining[shardID] = rowsPerShard
	}
	return c
}

func (c *benchmarkClaimer) reset(rowsPerShard int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for shardID := range c.remaining {
		c.remaining[shardID] = rowsPerShard
		c.claimed[shardID] = 0
	}
}

func (c *benchmarkClaimer) ClaimBatch(_ context.Context, _ string, _ string, shard storage.ShardPredicate, _ time.Time, limit int) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	remaining := c.remaining[shard.ShardID]
	if remaining <= 0 {
		c.claimed[shard.ShardID] = 0
		return 0, nil
	}
	claimed := limit
	if claimed > remaining {
		claimed = remaining
	}
	c.remaining[shard.ShardID] = remaining - claimed
	c.claimed[shard.ShardID] = claimed
	return claimed, nil
}

func (c *benchmarkClaimer) LoadClaimed(_ context.Context, _ string, _ string, shard storage.ShardPredicate, _ int) ([]*sigilv1.Generation, []uint64, error) {
	c.mu.Lock()
	count := c.claimed[shard.ShardID]
	c.claimed[shard.ShardID] = 0
	start := c.sequence
	c.sequence += uint64(count)
	c.mu.Unlock()

	generations := make([]*sigilv1.Generation, 0, count)
	ids := make([]uint64, 0, count)
	now := time.Now().UTC()
	for i := 0; i < count; i++ {
		id := start + uint64(i) + 1
		ids = append(ids, id)
		generations = append(generations, &sigilv1.Generation{
			Id:             fmt.Sprintf("bench-gen-%d-%d", shard.ShardID, id),
			ConversationId: fmt.Sprintf("bench-conv-%d", shard.ShardID),
			Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model:          &sigilv1.ModelRef{Provider: "bench", Name: "bench"},
			StartedAt:      timestamppb.New(now.Add(-time.Second)),
			CompletedAt:    timestamppb.New(now),
		})
	}
	return generations, ids, nil
}

func (c *benchmarkClaimer) FinalizeClaimed(_ context.Context, _ string, _ string, _ []uint64) error {
	return nil
}

func (c *benchmarkClaimer) ReleaseStaleClaims(_ context.Context, _ time.Duration) (int64, error) {
	return 0, nil
}

type benchmarkTruncator struct{}

func (benchmarkTruncator) TruncateCompacted(_ context.Context, _ string, _ storage.ShardPredicate, _ time.Time, _ int) (int64, error) {
	return 0, nil
}

type benchmarkBlockWriter struct{}

func (benchmarkBlockWriter) WriteBlock(_ context.Context, _ string, _ *storage.Block) error {
	return nil
}

type benchmarkMetadataStore struct{}

func (benchmarkMetadataStore) InsertBlock(_ context.Context, _ storage.BlockMeta) error {
	return nil
}

func (benchmarkMetadataStore) ListBlocks(_ context.Context, _ string, _, _ time.Time) ([]storage.BlockMeta, error) {
	return nil, nil
}
