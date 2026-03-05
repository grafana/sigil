package object

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/thanos-io/objstore"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type delayedGetBucket struct {
	objstore.Bucket
	getDelay time.Duration
}

func (b *delayedGetBucket) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	timer := time.NewTimer(b.getDelay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	return b.Bucket.Get(ctx, name)
}

func TestStoreWriteReadRoundTrip(t *testing.T) {
	ctx := context.Background()
	bucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", bucket)

	block := &storage.Block{
		ID: "block-1",
		Generations: []storage.GenerationRecord{
			testRecord(t, "gen-1", "conv-1", time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)),
			testRecord(t, "gen-2", "conv-1", time.Date(2026, 2, 12, 19, 1, 0, 0, time.UTC)),
			testRecord(t, "gen-3", "conv-2", time.Date(2026, 2, 12, 19, 2, 0, 0, time.UTC)),
		},
	}

	if err := store.WriteBlock(ctx, "tenant-a", block); err != nil {
		t.Fatalf("write block: %v", err)
	}

	index, err := store.ReadIndex(ctx, "tenant-a", block.ID)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	if len(index.Entries) != 3 {
		t.Fatalf("expected 3 index entries, got %d", len(index.Entries))
	}

	allGenerations, err := store.ReadGenerations(ctx, "tenant-a", block.ID, index.Entries)
	if err != nil {
		t.Fatalf("read generations: %v", err)
	}
	if len(allGenerations) != 3 {
		t.Fatalf("expected 3 generations, got %d", len(allGenerations))
	}

	convEntries := FindEntriesByConversationID(index, "conv-1")
	if len(convEntries) != 2 {
		t.Fatalf("expected 2 conversation entries, got %d", len(convEntries))
	}
	convGenerations, err := store.ReadGenerations(ctx, "tenant-a", block.ID, convEntries)
	if err != nil {
		t.Fatalf("read conversation generations: %v", err)
	}
	if len(convGenerations) != 2 {
		t.Fatalf("expected 2 conversation generations, got %d", len(convGenerations))
	}
	for _, generation := range convGenerations {
		if generation.GetConversationId() != "conv-1" {
			t.Fatalf("expected conversation conv-1, got %q", generation.GetConversationId())
		}
	}

	dataExists, err := bucket.Exists(ctx, blockPath("tenant-a", block.ID, dataFileName))
	if err != nil {
		t.Fatalf("check data object exists: %v", err)
	}
	if !dataExists {
		t.Fatalf("expected data object to exist")
	}

	indexExists, err := bucket.Exists(ctx, blockPath("tenant-a", block.ID, indexFileName))
	if err != nil {
		t.Fatalf("check index object exists: %v", err)
	}
	if !indexExists {
		t.Fatalf("expected index object to exist")
	}
}

func TestStoreReadGenerationsMissingObject(t *testing.T) {
	ctx := context.Background()
	store := NewStoreWithBucket("sigil", objstore.NewInMemBucket())

	_, err := store.ReadIndex(ctx, "tenant-a", "missing-block")
	if err == nil {
		t.Fatalf("expected missing block error")
	}
}

func TestStoreReadIndexCacheHitAndMissMetrics(t *testing.T) {
	ctx := context.Background()
	bucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", bucket)

	block := &storage.Block{
		ID: "block-cache",
		Generations: []storage.GenerationRecord{
			testRecord(t, "gen-1", "conv-1", time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)),
		},
	}
	if err := store.WriteBlock(ctx, "tenant-a", block); err != nil {
		t.Fatalf("write block: %v", err)
	}

	hitsBefore := testutil.ToFloat64(queryColdIndexCacheHitsTotal)
	missesBefore := testutil.ToFloat64(queryColdIndexCacheMissesTotal)

	if _, err := store.ReadIndex(ctx, "tenant-a", block.ID); err != nil {
		t.Fatalf("first read index: %v", err)
	}
	if _, err := store.ReadIndex(ctx, "tenant-a", block.ID); err != nil {
		t.Fatalf("second read index: %v", err)
	}

	hitsAfter := testutil.ToFloat64(queryColdIndexCacheHitsTotal)
	missesAfter := testutil.ToFloat64(queryColdIndexCacheMissesTotal)
	if delta := hitsAfter - hitsBefore; delta != 1 {
		t.Fatalf("expected one cache hit, got %v", delta)
	}
	if delta := missesAfter - missesBefore; delta != 1 {
		t.Fatalf("expected one cache miss, got %v", delta)
	}
}

func TestStoreReadIndexCoalescedReadIgnoresCanceledCallerContext(t *testing.T) {
	baseBucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", &delayedGetBucket{
		Bucket:   baseBucket,
		getDelay: 40 * time.Millisecond,
	})

	block := &storage.Block{
		ID: "block-coalesced",
		Generations: []storage.GenerationRecord{
			testRecord(t, "gen-1", "conv-1", time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)),
		},
	}
	if err := store.WriteBlock(context.Background(), "tenant-a", block); err != nil {
		t.Fatalf("write block: %v", err)
	}

	type readResult struct {
		index *storage.BlockIndex
		err   error
	}

	firstCtx, cancelFirst := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancelFirst()
	secondCtx, cancelSecond := context.WithTimeout(context.Background(), time.Second)
	defer cancelSecond()

	firstResultCh := make(chan readResult, 1)
	secondResultCh := make(chan readResult, 1)

	go func() {
		index, err := store.ReadIndex(firstCtx, "tenant-a", block.ID)
		firstResultCh <- readResult{index: index, err: err}
	}()
	time.Sleep(5 * time.Millisecond)
	go func() {
		index, err := store.ReadIndex(secondCtx, "tenant-a", block.ID)
		secondResultCh <- readResult{index: index, err: err}
	}()

	firstResult := <-firstResultCh
	secondResult := <-secondResultCh

	if !errors.Is(firstResult.err, context.DeadlineExceeded) {
		t.Fatalf("expected first caller to fail on context deadline, got %v", firstResult.err)
	}
	if secondResult.err != nil {
		t.Fatalf("expected second caller to succeed despite first caller cancellation, got %v", secondResult.err)
	}
	if secondResult.index == nil || len(secondResult.index.Entries) != 1 {
		t.Fatalf("expected second caller to receive decoded index, got %#v", secondResult.index)
	}
}

func TestStoreReadIndexCacheHitReturnsDetachedCopy(t *testing.T) {
	ctx := context.Background()
	bucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", bucket)

	block := &storage.Block{
		ID: "block-detached-cache",
		Generations: []storage.GenerationRecord{
			testRecord(t, "gen-1", "conv-1", time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)),
		},
	}
	if err := store.WriteBlock(ctx, "tenant-a", block); err != nil {
		t.Fatalf("write block: %v", err)
	}

	first, err := store.ReadIndex(ctx, "tenant-a", block.ID)
	if err != nil {
		t.Fatalf("first read index: %v", err)
	}
	if len(first.Entries) != 1 {
		t.Fatalf("expected first read entry count 1, got %d", len(first.Entries))
	}
	originalOffset := first.Entries[0].Offset
	first.Entries[0].Offset = originalOffset + 1234

	second, err := store.ReadIndex(ctx, "tenant-a", block.ID)
	if err != nil {
		t.Fatalf("second read index: %v", err)
	}
	if len(second.Entries) != 1 {
		t.Fatalf("expected second read entry count 1, got %d", len(second.Entries))
	}
	if second.Entries[0].Offset != originalOffset {
		t.Fatalf("expected cached index copy to remain unchanged, got offset %d (want %d)", second.Entries[0].Offset, originalOffset)
	}
}

func TestStoreReadIndexCoalescedCallersReceiveDetachedCopies(t *testing.T) {
	baseBucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", &delayedGetBucket{
		Bucket:   baseBucket,
		getDelay: 40 * time.Millisecond,
	})

	block := &storage.Block{
		ID: "block-detached-coalesced",
		Generations: []storage.GenerationRecord{
			testRecord(t, "gen-1", "conv-1", time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)),
		},
	}
	if err := store.WriteBlock(context.Background(), "tenant-a", block); err != nil {
		t.Fatalf("write block: %v", err)
	}

	type readResult struct {
		index *storage.BlockIndex
		err   error
	}
	firstResultCh := make(chan readResult, 1)
	secondResultCh := make(chan readResult, 1)

	go func() {
		index, err := store.ReadIndex(context.Background(), "tenant-a", block.ID)
		firstResultCh <- readResult{index: index, err: err}
	}()
	time.Sleep(5 * time.Millisecond)
	go func() {
		index, err := store.ReadIndex(context.Background(), "tenant-a", block.ID)
		secondResultCh <- readResult{index: index, err: err}
	}()

	firstResult := <-firstResultCh
	secondResult := <-secondResultCh

	if firstResult.err != nil || secondResult.err != nil {
		t.Fatalf("expected coalesced reads to succeed, got first=%v second=%v", firstResult.err, secondResult.err)
	}
	if firstResult.index == nil || secondResult.index == nil {
		t.Fatalf("expected both indexes to be non-nil, got first=%#v second=%#v", firstResult.index, secondResult.index)
	}
	if firstResult.index == secondResult.index {
		t.Fatalf("expected detached index pointers for coalesced callers")
	}
	originalOffset := secondResult.index.Entries[0].Offset
	firstResult.index.Entries[0].Offset = originalOffset + 4321
	if secondResult.index.Entries[0].Offset != originalOffset {
		t.Fatalf("expected coalesced caller mutation isolation, got offset %d (want %d)", secondResult.index.Entries[0].Offset, originalOffset)
	}
}

func testRecord(t *testing.T, generationID, conversationID string, createdAt time.Time) storage.GenerationRecord {
	t.Helper()

	generation := &sigilv1.Generation{
		Id:             generationID,
		ConversationId: conversationID,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		StartedAt:      timestamppb.New(createdAt.Add(-time.Second)),
		CompletedAt:    timestamppb.New(createdAt),
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation %q: %v", generationID, err)
	}

	return storage.GenerationRecord{
		GenerationID:   generationID,
		ConversationID: conversationID,
		CreatedAt:      createdAt.UTC(),
		Payload:        payload,
	}
}

func BenchmarkWriteBlock(b *testing.B) {
	ctx := context.Background()
	bucket := objstore.NewInMemBucket()
	store := NewStoreWithBucket("sigil", bucket)
	block := benchmarkBlock(b, "bench-write", 100)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		block.ID = fmt.Sprintf("bench-write-%d", i)
		if err := store.WriteBlock(ctx, "tenant-bench", block); err != nil {
			b.Fatalf("write block: %v", err)
		}
	}
}

func benchmarkBlock(t testing.TB, blockID string, size int) *storage.Block {
	t.Helper()

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	records := make([]storage.GenerationRecord, 0, size)
	for i := 0; i < size; i++ {
		records = append(records, testRecordFromTB(t, fmt.Sprintf("gen-%d", i), fmt.Sprintf("conv-%d", i%4), base.Add(time.Duration(i)*time.Second)))
	}
	return &storage.Block{
		ID:          blockID,
		Generations: records,
	}
}

func testRecordFromTB(t testing.TB, generationID, conversationID string, createdAt time.Time) storage.GenerationRecord {
	t.Helper()

	generation := &sigilv1.Generation{
		Id:             generationID,
		ConversationId: conversationID,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		StartedAt:      timestamppb.New(createdAt.Add(-time.Second)),
		CompletedAt:    timestamppb.New(createdAt),
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation %q: %v", generationID, err)
	}

	return storage.GenerationRecord{
		GenerationID:   generationID,
		ConversationID: conversationID,
		CreatedAt:      createdAt.UTC(),
		Payload:        payload,
	}
}
