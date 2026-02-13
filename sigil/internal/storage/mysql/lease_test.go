package mysql

import (
	"context"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestAcquireLeaseLifecycle(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	const (
		tenant  = "tenant-lease"
		shardID = 3
		ttl     = 30 * time.Second
	)

	firstHeld, firstOwner, _, err := store.AcquireLease(context.Background(), tenant, shardID, "owner-a", ttl)
	if err != nil {
		t.Fatalf("acquire lease first: %v", err)
	}
	if !firstHeld || firstOwner != "owner-a" {
		t.Fatalf("expected owner-a lease held, got held=%v owner=%q", firstHeld, firstOwner)
	}

	renewedHeld, renewedOwner, _, err := store.RenewLease(context.Background(), tenant, shardID, "owner-a", ttl)
	if err != nil {
		t.Fatalf("renew lease: %v", err)
	}
	if !renewedHeld || renewedOwner != "owner-a" {
		t.Fatalf("expected owner-a renew to succeed, got held=%v owner=%q", renewedHeld, renewedOwner)
	}

	deniedHeld, deniedOwner, _, err := store.AcquireLease(context.Background(), tenant, shardID, "owner-b", ttl)
	if err != nil {
		t.Fatalf("competing lease acquire: %v", err)
	}
	if deniedHeld || deniedOwner != "owner-a" {
		t.Fatalf("expected owner-b lease deny while active, got held=%v owner=%q", deniedHeld, deniedOwner)
	}

	if err := store.DB().Model(&CompactorLeaseModel{}).
		Where("tenant_id = ? AND shard_id = ?", tenant, shardID).
		Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatalf("expire lease: %v", err)
	}

	stolenHeld, stolenOwner, _, err := store.AcquireLease(context.Background(), tenant, shardID, "owner-b", ttl)
	if err != nil {
		t.Fatalf("steal expired lease: %v", err)
	}
	if !stolenHeld || stolenOwner != "owner-b" {
		t.Fatalf("expected owner-b to steal expired lease, got held=%v owner=%q", stolenHeld, stolenOwner)
	}
}

func TestListShardsForCompactionAndTruncation(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-tenant-a-1", "conv-a", base),
		testGeneration("gen-tenant-a-2", "conv-a", base.Add(10*time.Second)),
	}))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-b", []*sigilv1.Generation{
		testGeneration("gen-tenant-b-1", "conv-b", base),
	}))

	compactionShards, err := store.ListShardsForCompaction(context.Background(), 60, 2, 10)
	if err != nil {
		t.Fatalf("list shards for compaction: %v", err)
	}
	if len(compactionShards) == 0 {
		t.Fatalf("expected at least one compaction shard")
	}
	if compactionShards[0].TenantID != "tenant-a" || compactionShards[0].Backlog < 2 {
		t.Fatalf("expected tenant-a shard first with backlog >=2, got %#v", compactionShards[0])
	}

	if err := store.DB().Model(&GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", "gen-tenant-a-1").
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": time.Now().UTC().Add(-2 * time.Hour),
		}).Error; err != nil {
		t.Fatalf("set compaction state: %v", err)
	}

	truncationShards, err := store.ListShardsForTruncation(context.Background(), 60, 2, time.Now().UTC().Add(-time.Hour), 10)
	if err != nil {
		t.Fatalf("list shards for truncation: %v", err)
	}
	if len(truncationShards) == 0 {
		t.Fatalf("expected at least one truncation shard")
	}
	if truncationShards[0].TenantID != "tenant-a" {
		t.Fatalf("expected tenant-a truncation shard, got %#v", truncationShards[0])
	}
}

func TestListShardsForCompactionExcludesFutureRows(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Now().UTC()
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-ready", []*sigilv1.Generation{
		testGeneration("gen-ready-1", "conv-ready", now.Add(-time.Minute)),
	}))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-future", []*sigilv1.Generation{
		testGeneration("gen-future-1", "conv-future", now.Add(30*time.Minute)),
	}))

	shards, err := store.ListShardsForCompaction(context.Background(), 60, 4, 10)
	if err != nil {
		t.Fatalf("list shards for compaction: %v", err)
	}
	if len(shards) == 0 {
		t.Fatalf("expected at least one compaction shard")
	}

	foundReady := false
	for _, shard := range shards {
		if shard.TenantID == "tenant-future" {
			t.Fatalf("future-dated tenant should not be discoverable for compaction: %#v", shard)
		}
		if shard.TenantID == "tenant-ready" {
			foundReady = true
		}
	}
	if !foundReady {
		t.Fatalf("expected ready tenant shard in discovery set: %#v", shards)
	}
}

func TestClaimLoadFinalizeAndStaleRecovery(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-claim-1", "conv-claim", base),
		testGeneration("gen-claim-2", "conv-claim", base.Add(time.Minute)),
		testGeneration("gen-claim-3", "conv-claim", base.Add(2*time.Minute)),
	}))

	pred := storage.ShardPredicate{ShardWindowSeconds: 60, ShardCount: 1, ShardID: 0}
	claimed, err := store.ClaimBatch(context.Background(), "tenant-a", "owner-a", pred, base.Add(10*time.Minute), 2)
	if err != nil {
		t.Fatalf("claim batch: %v", err)
	}
	if claimed != 2 {
		t.Fatalf("expected 2 claimed rows, got %d", claimed)
	}

	generations, ids, err := store.LoadClaimed(context.Background(), "tenant-a", "owner-a", pred, 10)
	if err != nil {
		t.Fatalf("load claimed: %v", err)
	}
	if len(generations) != 2 || len(ids) != 2 {
		t.Fatalf("expected 2 loaded claimed rows, got generations=%d ids=%d", len(generations), len(ids))
	}

	if err := store.FinalizeClaimed(context.Background(), "tenant-a", "owner-a", ids); err != nil {
		t.Fatalf("finalize claimed: %v", err)
	}

	var compactedCount int64
	if err := store.DB().Model(&GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-a", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != 2 {
		t.Fatalf("expected 2 compacted rows, got %d", compactedCount)
	}

	claimed, err = store.ClaimBatch(context.Background(), "tenant-a", "owner-b", pred, base.Add(10*time.Minute), 2)
	if err != nil {
		t.Fatalf("claim remaining row: %v", err)
	}
	if claimed != 1 {
		t.Fatalf("expected 1 claimed remaining row, got %d", claimed)
	}

	if err := store.DB().Model(&GenerationModel{}).
		Where("tenant_id = ? AND claimed_by = ?", "tenant-a", "owner-b").
		Update("claimed_at", time.Now().UTC().Add(-10*time.Minute)).Error; err != nil {
		t.Fatalf("age claim timestamp: %v", err)
	}

	recovered, err := store.ReleaseStaleClaims(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatalf("release stale claims: %v", err)
	}
	if recovered < 1 {
		t.Fatalf("expected stale claim recovery >= 1, got %d", recovered)
	}

	var remainingClaimed int64
	if err := store.DB().Model(&GenerationModel{}).
		Where("tenant_id = ? AND claimed_by IS NOT NULL", "tenant-a").
		Count(&remainingClaimed).Error; err != nil {
		t.Fatalf("count remaining claimed rows: %v", err)
	}
	if remainingClaimed != 0 {
		t.Fatalf("expected no claimed rows after stale claim recovery, got %d", remainingClaimed)
	}
}
