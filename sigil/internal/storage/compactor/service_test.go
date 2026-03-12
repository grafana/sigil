package compactor

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/go-kit/log"
	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/storage/object"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/thanos-io/objstore"
)

func TestRunCompactCycleSuccessWritesBlockAndMarksCompacted(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-c-1", "conv-c", base),
		testGeneration("gen-c-2", "conv-c", base.Add(time.Minute)),
		testGeneration("gen-c-3", "conv-c", base.Add(2*time.Minute)),
	})

	bucket := objstore.NewInMemBucket()
	blockStore := object.NewStoreWithBucket("sigil", bucket)
	service := newTestService(store, "owner-a", blockStore, nil)
	service.runCompactCycle(context.Background())

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-a", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != 3 {
		t.Fatalf("expected 3 compacted rows, got %d", compactedCount)
	}

	var block mysql.CompactionBlockModel
	if err := store.DB().Where("tenant_id = ?", "tenant-a").First(&block).Error; err != nil {
		t.Fatalf("load compaction block: %v", err)
	}

	dataExists, err := bucket.Exists(context.Background(), block.ObjectPath)
	if err != nil {
		t.Fatalf("check data object existence: %v", err)
	}
	if !dataExists {
		t.Fatalf("expected data object to exist at %q", block.ObjectPath)
	}

	indexExists, err := bucket.Exists(context.Background(), block.IndexPath)
	if err != nil {
		t.Fatalf("check index object existence: %v", err)
	}
	if !indexExists {
		t.Fatalf("expected index object to exist at %q", block.IndexPath)
	}
}

func TestRunCompactCycleUploadFailureDoesNotMarkCompacted(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-u-1", "conv-u", base),
	})

	service := newTestService(store, "owner-a", failingBlockWriter{err: errors.New("upload failed")}, nil)
	service.runCompactCycle(context.Background())

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-a", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != 0 {
		t.Fatalf("expected no compacted rows after upload failure, got %d", compactedCount)
	}

	var blockCount int64
	if err := store.DB().Model(&mysql.CompactionBlockModel{}).
		Where("tenant_id = ?", "tenant-a").
		Count(&blockCount).Error; err != nil {
		t.Fatalf("count compaction blocks: %v", err)
	}
	if blockCount != 0 {
		t.Fatalf("expected no block metadata rows after upload failure, got %d", blockCount)
	}
}

func TestRunCompactCycleMetadataFailureDoesNotMarkCompacted(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-m-1", "conv-m", base),
	})

	blockStore := object.NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	service := newTestService(store, "owner-a", blockStore, failingMetadataStore{err: errors.New("metadata insert failed")})
	service.runCompactCycle(context.Background())

	var compactedCount int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND compacted = ?", "tenant-a", true).
		Count(&compactedCount).Error; err != nil {
		t.Fatalf("count compacted rows: %v", err)
	}
	if compactedCount != 0 {
		t.Fatalf("expected no compacted rows after metadata failure, got %d", compactedCount)
	}
}

func TestRunTruncateCycleDeletesOnlyCompactedRowsOlderThanRetention(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	mustSaveGenerations(t, store, "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-old", "conv-t", base),
		testGeneration("gen-recent", "conv-t", base.Add(time.Minute)),
		testGeneration("gen-hot", "conv-t", base.Add(2*time.Minute)),
	})

	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", "gen-old").
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": time.Now().UTC().Add(-2 * time.Hour),
		}).Error; err != nil {
		t.Fatalf("set old compaction state: %v", err)
	}
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", "gen-recent").
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": time.Now().UTC().Add(-10 * time.Minute),
		}).Error; err != nil {
		t.Fatalf("set recent compaction state: %v", err)
	}

	service := newTestService(store, "owner-a", object.NewStoreWithBucket("sigil", objstore.NewInMemBucket()), nil)
	service.runTruncateCycle(context.Background())

	assertGenerationExists(t, store, "tenant-a", "gen-old", false)
	assertGenerationExists(t, store, "tenant-a", "gen-recent", true)
	assertGenerationExists(t, store, "tenant-a", "gen-hot", true)
}

func TestTruncateOwnedShardRetriesRetryableLockErrorsWithBackoff(t *testing.T) {
	retryBefore := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("retry"))
	recoveredBefore := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("recovered"))
	exhaustedBefore := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("exhausted"))

	truncator := &sequenceTruncator{
		responses: []truncateResponse{
			{err: &mysqlDriver.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"}},
			{err: &mysqlDriver.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"}},
			{deleted: 2},
			{deleted: 0},
		},
	}
	var slept []time.Duration
	service := &Service{
		cfg: config.CompactorConfig{
			BatchSize:          8,
			LeaseTTL:           30 * time.Second,
			ShardCount:         1,
			ShardWindowSeconds: 60,
		},
		logger:    log.NewNopLogger(),
		truncator: truncator,
		sleepFn: func(_ context.Context, d time.Duration) error {
			slept = append(slept, d)
			return nil
		},
	}

	err := service.truncateOwnedShard(
		context.Background(),
		storage.TenantShard{TenantID: "tenant-a", ShardID: 0},
		time.Now().UTC().Add(-time.Hour),
		time.Now().Add(time.Minute),
		time.Now().Add(time.Hour),
		time.Hour,
	)
	if err != nil {
		t.Fatalf("truncate owned shard: %v", err)
	}

	if got, want := truncator.limits, []int{8, 4, 2, 8}; !reflect.DeepEqual(got, want) {
		t.Fatalf("truncate limits=%v, want %v", got, want)
	}
	if got, want := slept, []time.Duration{truncateInitialRetryBackoff, truncateInitialRetryBackoff * 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("sleep backoff=%v, want %v", got, want)
	}

	if got := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("retry")) - retryBefore; got != 2 {
		t.Fatalf("retry metric increment=%v, want 2", got)
	}
	if got := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("recovered")) - recoveredBefore; got != 1 {
		t.Fatalf("recovered metric increment=%v, want 1", got)
	}
	if got := testutil.ToFloat64(compactorTruncateDeadlocksTotal.WithLabelValues("exhausted")) - exhaustedBefore; got != 0 {
		t.Fatalf("exhausted metric increment=%v, want 0", got)
	}
}

func assertGenerationExists(t *testing.T, store *mysql.WALStore, tenantID, generationID string, expected bool) {
	t.Helper()

	var count int64
	if err := store.DB().Model(&mysql.GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		Count(&count).Error; err != nil {
		t.Fatalf("count generation %q: %v", generationID, err)
	}
	if (count > 0) != expected {
		t.Fatalf("expected generation %q existence=%v, got count=%d", generationID, expected, count)
	}
}

func TestRunCompactCycleIdempotencyGuardAllowsRetryAfterFinalizeFailure(t *testing.T) {
	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	claimedGenerations := []*sigilv1.Generation{
		testGeneration("gen-idempotency-1", "conv-idempotency", base),
	}

	claimer := &finalizeFailsOnceClaimer{generations: claimedGenerations}
	blockWriter := &countingBlockWriter{}
	metadataStore := &duplicateAwareMetadataStore{blocks: map[string]storage.BlockMeta{}}
	service := &Service{
		cfg: config.CompactorConfig{
			CompactInterval:    time.Minute,
			TruncateInterval:   time.Minute,
			Retention:          time.Hour,
			BatchSize:          1000,
			LeaseTTL:           30 * time.Second,
			ShardCount:         1,
			ShardWindowSeconds: 60,
			Workers:            1,
			CycleBudget:        30 * time.Second,
			ClaimTTL:           5 * time.Minute,
			TargetBlockBytes:   64 * 1024 * 1024,
		},
		logger:        log.NewNopLogger(),
		ownerID:       "owner-a",
		discoverer:    fixedTenantDiscoverer{tenantID: "tenant-idempotency"},
		leaser:        alwaysHeldLeaser{},
		claimer:       claimer,
		truncator:     noopTruncator{},
		blockWriter:   blockWriter,
		metadataStore: metadataStore,
	}

	service.runCompactCycle(context.Background())
	if claimer.finalizeSucceeded {
		t.Fatalf("expected first cycle finalize to fail")
	}

	service.runCompactCycle(context.Background())
	if !claimer.finalizeSucceeded {
		t.Fatalf("expected second cycle to succeed via idempotency guard")
	}
	if claimer.calls != 2 {
		t.Fatalf("expected 2 claimer calls, got %d", claimer.calls)
	}
	if blockWriter.writes != 2 {
		t.Fatalf("expected 2 block uploads across retry, got %d", blockWriter.writes)
	}
	if metadataStore.inserts != 2 {
		t.Fatalf("expected 2 metadata insert attempts, got %d", metadataStore.inserts)
	}
	if len(metadataStore.blocks) != 1 {
		t.Fatalf("expected exactly 1 persisted block metadata entry, got %d", len(metadataStore.blocks))
	}
}

func TestRunCompactCycleDrainsAlreadyClaimedRowsWhenNoNewClaims(t *testing.T) {
	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	claimedGenerations := []*sigilv1.Generation{
		testGeneration("gen-preclaimed-1", "conv-preclaimed", base),
	}

	claimer := &preclaimedRowsClaimer{generations: claimedGenerations}
	blockWriter := &countingBlockWriter{}
	metadataStore := &duplicateAwareMetadataStore{blocks: map[string]storage.BlockMeta{}}
	service := &Service{
		cfg: config.CompactorConfig{
			CompactInterval:    time.Minute,
			TruncateInterval:   time.Minute,
			Retention:          time.Hour,
			BatchSize:          1000,
			LeaseTTL:           30 * time.Second,
			ShardCount:         1,
			ShardWindowSeconds: 60,
			Workers:            1,
			CycleBudget:        30 * time.Second,
			ClaimTTL:           5 * time.Minute,
			TargetBlockBytes:   64 * 1024 * 1024,
		},
		logger:        log.NewNopLogger(),
		ownerID:       "owner-a",
		discoverer:    fixedTenantDiscoverer{tenantID: "tenant-preclaimed"},
		leaser:        alwaysHeldLeaser{},
		claimer:       claimer,
		truncator:     noopTruncator{},
		blockWriter:   blockWriter,
		metadataStore: metadataStore,
	}

	service.runCompactCycle(context.Background())

	if claimer.claimCalls == 0 {
		t.Fatalf("expected claim attempt")
	}
	if claimer.loadCalls == 0 {
		t.Fatalf("expected pre-claimed rows to be loaded even with zero new claims")
	}
	if claimer.finalizeCalls != 1 {
		t.Fatalf("expected finalize to run once for pre-claimed rows, got %d", claimer.finalizeCalls)
	}
	if blockWriter.writes != 1 {
		t.Fatalf("expected one block upload for pre-claimed rows, got %d", blockWriter.writes)
	}
	if metadataStore.inserts != 1 {
		t.Fatalf("expected one metadata insert for pre-claimed rows, got %d", metadataStore.inserts)
	}
}

type fixedTenantDiscoverer struct {
	tenantID string
}

func (d fixedTenantDiscoverer) ListShardsForCompaction(_ context.Context, _ int, _ int, _ int) ([]storage.TenantShard, error) {
	return []storage.TenantShard{{TenantID: d.tenantID, ShardID: 0, Backlog: 1}}, nil
}

func (d fixedTenantDiscoverer) ListShardsForTruncation(_ context.Context, _ int, _ int, _ time.Time, _ int) ([]storage.TenantShard, error) {
	return nil, nil
}

type alwaysHeldLeaser struct{}

func (alwaysHeldLeaser) AcquireLease(_ context.Context, _ string, _ int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	return true, ownerID, time.Now().UTC().Add(ttl), nil
}

func (alwaysHeldLeaser) RenewLease(_ context.Context, _ string, _ int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	return true, ownerID, time.Now().UTC().Add(ttl), nil
}

type noopTruncator struct{}

func (noopTruncator) TruncateCompacted(_ context.Context, _ string, _ storage.ShardPredicate, _ time.Time, _ int) (int64, error) {
	return 0, nil
}

type truncateResponse struct {
	deleted int64
	err     error
}

type sequenceTruncator struct {
	responses []truncateResponse
	limits    []int
}

func (t *sequenceTruncator) TruncateCompacted(_ context.Context, _ string, _ storage.ShardPredicate, _ time.Time, limit int) (int64, error) {
	t.limits = append(t.limits, limit)
	if len(t.responses) == 0 {
		return 0, nil
	}
	response := t.responses[0]
	t.responses = t.responses[1:]
	return response.deleted, response.err
}

type finalizeFailsOnceClaimer struct {
	generations       []*sigilv1.Generation
	ids               []uint64
	calls             int
	finalizeSucceeded bool
}

func (c *finalizeFailsOnceClaimer) ClaimBatch(_ context.Context, _ string, _ string, _ storage.ShardPredicate, _ time.Time, _ int) (int, error) {
	c.calls++
	if c.calls <= 2 {
		return len(c.generations), nil
	}
	return 0, nil
}

func (c *finalizeFailsOnceClaimer) LoadClaimed(_ context.Context, _ string, _ string, _ storage.ShardPredicate, _ int) ([]*sigilv1.Generation, []uint64, error) {
	if len(c.ids) == 0 {
		c.ids = make([]uint64, len(c.generations))
		for i := range c.ids {
			c.ids[i] = uint64(i + 1)
		}
	}
	return c.generations, c.ids, nil
}

func (c *finalizeFailsOnceClaimer) FinalizeClaimed(_ context.Context, _ string, _ string, _ []uint64) error {
	if c.calls == 1 {
		return errors.New("finalize failed")
	}
	c.finalizeSucceeded = true
	return nil
}

func (c *finalizeFailsOnceClaimer) ReleaseStaleClaims(_ context.Context, _ time.Duration) (int64, error) {
	return 0, nil
}

type preclaimedRowsClaimer struct {
	generations   []*sigilv1.Generation
	ids           []uint64
	claimCalls    int
	loadCalls     int
	finalizeCalls int
	drained       bool
}

func (c *preclaimedRowsClaimer) ClaimBatch(_ context.Context, _ string, _ string, _ storage.ShardPredicate, _ time.Time, _ int) (int, error) {
	c.claimCalls++
	return 0, nil
}

func (c *preclaimedRowsClaimer) LoadClaimed(_ context.Context, _ string, _ string, _ storage.ShardPredicate, _ int) ([]*sigilv1.Generation, []uint64, error) {
	c.loadCalls++
	if c.drained {
		return []*sigilv1.Generation{}, []uint64{}, nil
	}
	if len(c.ids) == 0 {
		c.ids = make([]uint64, len(c.generations))
		for i := range c.ids {
			c.ids[i] = uint64(i + 1)
		}
	}
	return c.generations, c.ids, nil
}

func (c *preclaimedRowsClaimer) FinalizeClaimed(_ context.Context, _ string, _ string, _ []uint64) error {
	c.finalizeCalls++
	c.drained = true
	return nil
}

func (c *preclaimedRowsClaimer) ReleaseStaleClaims(_ context.Context, _ time.Duration) (int64, error) {
	return 0, nil
}

type countingBlockWriter struct {
	writes int
}

func (w *countingBlockWriter) WriteBlock(_ context.Context, _ string, _ *storage.Block) error {
	w.writes++
	return nil
}

type duplicateAwareMetadataStore struct {
	blocks  map[string]storage.BlockMeta
	inserts int
}

func (m *duplicateAwareMetadataStore) InsertBlock(_ context.Context, meta storage.BlockMeta) error {
	m.inserts++
	key := meta.TenantID + "/" + meta.BlockID
	if _, ok := m.blocks[key]; ok {
		return storage.ErrBlockAlreadyExists
	}
	m.blocks[key] = meta
	return nil
}

func (m *duplicateAwareMetadataStore) ListBlocks(_ context.Context, tenantID string, from, to time.Time) ([]storage.BlockMeta, error) {
	out := make([]storage.BlockMeta, 0, len(m.blocks))
	for _, meta := range m.blocks {
		if meta.TenantID != tenantID {
			continue
		}
		if !from.IsZero() && meta.MaxTime.Before(from) {
			continue
		}
		if !to.IsZero() && meta.MinTime.After(to) {
			continue
		}
		out = append(out, meta)
	}
	return out, nil
}
