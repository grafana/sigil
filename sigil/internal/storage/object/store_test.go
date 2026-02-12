package object

import (
	"context"
	"fmt"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/thanos-io/objstore"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
