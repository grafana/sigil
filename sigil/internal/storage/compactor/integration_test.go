package compactor

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/storage/object"
	"github.com/thanos-io/objstore"
)

func TestConcurrentCompactorsCompactWithoutDoubleCompaction(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 21, 0, 0, 0, time.UTC)
	batch := make([]*sigilv1.Generation, 0, 20)
	for i := 0; i < 20; i++ {
		batch = append(batch, testGeneration(
			fmt.Sprintf("gen-concurrent-%d", i),
			"conv-concurrent",
			base.Add(time.Duration(i)*time.Second),
		))
	}
	mustSaveGenerations(t, store, "tenant-concurrent", batch)

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	serviceA := newTestService(store, "owner-a", blockStore, nil)
	serviceB := newTestService(store, "owner-b", blockStore, nil)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		serviceA.runCompactCycle(context.Background())
	}()
	go func() {
		defer wg.Done()
		serviceB.runCompactCycle(context.Background())
	}()
	wg.Wait()

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-concurrent", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != int64(len(batch)) {
		t.Fatalf("expected %d compacted rows, got %d", len(batch), compactedCount)
	}

	var blockCount int64
	if err := store.DB().Model(&mysql.CompactionBlockModel{}).
		Where("tenant_id = ?", "tenant-concurrent").
		Count(&blockCount).Error; err != nil {
		t.Fatalf("count compaction blocks: %v", err)
	}
	if blockCount != 1 {
		t.Fatalf("expected 1 compaction block for single tenant batch, got %d", blockCount)
	}
}

func TestConcurrentCompactorsTruncateSafely(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 21, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-truncate", []*sigilv1.Generation{
		testGeneration("gen-old-1", "conv-t", base),
		testGeneration("gen-old-2", "conv-t", base.Add(time.Second)),
		testGeneration("gen-recent", "conv-t", base.Add(2*time.Second)),
		testGeneration("gen-hot", "conv-t", base.Add(3*time.Second)),
	})

	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND generation_id IN ?", "tenant-truncate", []string{"gen-old-1", "gen-old-2"}).
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": time.Now().UTC().Add(-3 * time.Hour),
		}).Error; err != nil {
		t.Fatalf("set old compaction state values: %v", err)
	}
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", "tenant-truncate", "gen-recent").
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": time.Now().UTC().Add(-5 * time.Minute),
		}).Error; err != nil {
		t.Fatalf("set recent compaction state value: %v", err)
	}

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	serviceA := newTestService(store, "owner-a", blockStore, nil)
	serviceB := newTestService(store, "owner-b", blockStore, nil)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		serviceA.runTruncateCycle(context.Background())
	}()
	go func() {
		defer wg.Done()
		serviceB.runTruncateCycle(context.Background())
	}()
	wg.Wait()

	assertGenerationExists(t, store, "tenant-truncate", "gen-old-1", false)
	assertGenerationExists(t, store, "tenant-truncate", "gen-old-2", false)
	assertGenerationExists(t, store, "tenant-truncate", "gen-recent", true)
	assertGenerationExists(t, store, "tenant-truncate", "gen-hot", true)
}

func TestParallelShardCompactionOnSingleHotTenant(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 22, 0, 0, 0, time.UTC)
	batch := make([]*sigilv1.Generation, 0, 80)
	for i := 0; i < 80; i++ {
		batch = append(batch, testGeneration(
			fmt.Sprintf("gen-hot-%d", i),
			"conv-hot",
			base.Add(time.Duration(i)*time.Second),
		))
	}
	mustSaveGenerations(t, store, "tenant-hot", batch)

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	serviceA := newTestService(store, "owner-a", blockStore, nil)
	serviceB := newTestService(store, "owner-b", blockStore, nil)
	serviceA.cfg.ShardCount = 4
	serviceB.cfg.ShardCount = 4
	serviceA.cfg.ShardWindowSeconds = 1
	serviceB.cfg.ShardWindowSeconds = 1
	serviceA.cfg.Workers = 2
	serviceB.cfg.Workers = 2

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		serviceA.runCompactCycle(context.Background())
	}()
	go func() {
		defer wg.Done()
		serviceB.runCompactCycle(context.Background())
	}()
	wg.Wait()

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-hot", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != int64(len(batch)) {
		t.Fatalf("expected %d compacted rows, got %d", len(batch), compactedCount)
	}

	var blockCount int64
	if err := store.DB().Model(&mysql.CompactionBlockModel{}).
		Where("tenant_id = ?", "tenant-hot").
		Count(&blockCount).Error; err != nil {
		t.Fatalf("count compaction blocks: %v", err)
	}
	if blockCount < 2 {
		t.Fatalf("expected multiple shard blocks, got %d", blockCount)
	}
}

func TestCrashRecoveryViaStaleClaimSweep(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 22, 30, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-recovery", []*sigilv1.Generation{
		testGeneration("gen-recovery-1", "conv-recovery", base),
		testGeneration("gen-recovery-2", "conv-recovery", base.Add(time.Second)),
		testGeneration("gen-recovery-3", "conv-recovery", base.Add(2*time.Second)),
	})

	pred := storage.ShardPredicate{ShardWindowSeconds: 60, ShardCount: 1, ShardID: 0}
	claimed, err := store.ClaimBatch(context.Background(), "tenant-recovery", "owner-crashed", pred, base.Add(time.Hour), 10)
	if err != nil {
		t.Fatalf("claim batch: %v", err)
	}
	if claimed != 3 {
		t.Fatalf("expected 3 claimed rows, got %d", claimed)
	}
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND claimed_by = ?", "tenant-recovery", "owner-crashed").
		Update("claimed_at", time.Now().UTC().Add(-10*time.Minute)).Error; err != nil {
		t.Fatalf("age claimed rows: %v", err)
	}

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	service := newTestService(store, "owner-recover", blockStore, nil)
	service.cfg.ClaimTTL = 5 * time.Minute
	service.runClaimSweep(context.Background())
	service.runCompactCycle(context.Background())

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-recovery", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != 3 {
		t.Fatalf("expected stale-claim-recovered compaction of 3 rows, got %d", compactedCount)
	}
}

func TestFullLifecycleWriteCompactTruncate(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 23, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-lifecycle", []*sigilv1.Generation{
		testGeneration("gen-life-1", "conv-life", base),
		testGeneration("gen-life-2", "conv-life", base.Add(time.Second)),
		testGeneration("gen-life-3", "conv-life", base.Add(2*time.Second)),
	})

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	service := newTestService(store, "owner-lifecycle", blockStore, nil)
	service.runCompactCycle(context.Background())

	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-lifecycle", true).
		Update("compacted_at", time.Now().UTC().Add(-3*time.Hour)).Error; err != nil {
		t.Fatalf("age compacted rows: %v", err)
	}
	service.cfg.Retention = time.Hour
	service.runTruncateCycle(context.Background())

	var remainingRows int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ?", "tenant-lifecycle").
		Count(&remainingRows).Error; err != nil {
		t.Fatalf("count remaining lifecycle rows: %v", err)
	}
	if remainingRows != 0 {
		t.Fatalf("expected lifecycle rows to be truncated, got %d", remainingRows)
	}

	var blockCount int64
	if err := store.DB().Model(&mysql.CompactionBlockModel{}).
		Where("tenant_id = ?", "tenant-lifecycle").
		Count(&blockCount).Error; err != nil {
		t.Fatalf("count lifecycle blocks: %v", err)
	}
	if blockCount == 0 {
		t.Fatalf("expected lifecycle compaction block metadata")
	}
}
