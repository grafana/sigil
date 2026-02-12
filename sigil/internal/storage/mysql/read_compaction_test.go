package mysql

import (
	"context"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestWALReaderGetByIDAndConversation(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-read-1", "conv-read", base),
		testGeneration("gen-read-2", "conv-read", base.Add(2*time.Minute)),
	}))

	generation, err := store.GetByID(context.Background(), "tenant-a", "gen-read-1")
	if err != nil {
		t.Fatalf("get by id: %v", err)
	}
	if generation == nil || generation.GetId() != "gen-read-1" {
		t.Fatalf("expected generation gen-read-1, got %#v", generation)
	}

	missing, err := store.GetByID(context.Background(), "tenant-b", "gen-read-1")
	if err != nil {
		t.Fatalf("get missing by id: %v", err)
	}
	if missing != nil {
		t.Fatalf("expected nil for missing generation, got %#v", missing)
	}

	byConversation, err := store.GetByConversationID(context.Background(), "tenant-a", "conv-read")
	if err != nil {
		t.Fatalf("get by conversation: %v", err)
	}
	if len(byConversation) != 2 {
		t.Fatalf("expected 2 generations, got %d", len(byConversation))
	}
	if byConversation[0].GetId() != "gen-read-1" || byConversation[1].GetId() != "gen-read-2" {
		t.Fatalf("unexpected generation order: %q, %q", byConversation[0].GetId(), byConversation[1].GetId())
	}
}

func TestWALCompactionAndTruncation(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-compact-1", "conv-compact", base),
		testGeneration("gen-compact-2", "conv-compact", base.Add(2*time.Minute)),
		testGeneration("gen-compact-3", "conv-compact", base.Add(4*time.Minute)),
	}))

	claimed, err := store.ClaimUncompacted(context.Background(), "tenant-a", base.Add(10*time.Minute), 2)
	if err != nil {
		t.Fatalf("claim uncompacted: %v", err)
	}
	if len(claimed) != 2 {
		t.Fatalf("expected 2 claimed rows, got %d", len(claimed))
	}

	if err := store.MarkCompacted(context.Background(), "tenant-a", []string{claimed[0].GetId(), claimed[1].GetId()}); err != nil {
		t.Fatalf("mark compacted: %v", err)
	}

	deletedRows, err := store.TruncateCompacted(context.Background(), "tenant-a", time.Now().UTC().Add(time.Hour), 1)
	if err != nil {
		t.Fatalf("truncate compacted: %v", err)
	}
	if deletedRows != 1 {
		t.Fatalf("expected 1 deleted row, got %d", deletedRows)
	}

	var remainingRows int64
	if err := store.DB().Model(&GenerationModel{}).Where("tenant_id = ?", "tenant-a").Count(&remainingRows).Error; err != nil {
		t.Fatalf("count remaining rows: %v", err)
	}
	if remainingRows != 2 {
		t.Fatalf("expected 2 remaining rows, got %d", remainingRows)
	}
}

func TestMetadataStores(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	rangeStart := time.Date(2026, 2, 12, 17, 0, 0, 0, time.UTC)
	rangeEnd := time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)

	err := store.InsertBlock(context.Background(), storage.BlockMeta{
		TenantID:        "tenant-a",
		BlockID:         "block-1",
		MinTime:         rangeStart,
		MaxTime:         rangeEnd,
		GenerationCount: 10,
		SizeBytes:       2048,
		ObjectPath:      "blocks/block-1/data.sigil",
		IndexPath:       "blocks/block-1/index.sigil",
	})
	if err != nil {
		t.Fatalf("insert block-1: %v", err)
	}

	err = store.InsertBlock(context.Background(), storage.BlockMeta{
		TenantID:        "tenant-a",
		BlockID:         "block-deleted",
		MinTime:         rangeStart,
		MaxTime:         rangeEnd,
		GenerationCount: 5,
		SizeBytes:       1024,
		ObjectPath:      "blocks/block-deleted/data.sigil",
		IndexPath:       "blocks/block-deleted/index.sigil",
		Deleted:         true,
	})
	if err != nil {
		t.Fatalf("insert deleted block: %v", err)
	}

	blocks, err := store.ListBlocks(context.Background(), "tenant-a", rangeStart.Add(time.Minute), rangeEnd.Add(-time.Minute))
	if err != nil {
		t.Fatalf("list blocks: %v", err)
	}
	if len(blocks) != 1 || blocks[0].BlockID != "block-1" {
		t.Fatalf("unexpected blocks result: %#v", blocks)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-meta-1", "conv-meta-1", base),
		testGeneration("gen-meta-2", "conv-meta-2", base.Add(time.Minute)),
	}))

	conversations, err := store.ListConversations(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if len(conversations) != 2 {
		t.Fatalf("expected 2 conversations, got %d", len(conversations))
	}

	conversation, err := store.GetConversation(context.Background(), "tenant-a", "conv-meta-1")
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if conversation == nil || conversation.ConversationID != "conv-meta-1" {
		t.Fatalf("unexpected conversation: %#v", conversation)
	}

	missingConversation, err := store.GetConversation(context.Background(), "tenant-a", "conv-missing")
	if err != nil {
		t.Fatalf("get missing conversation: %v", err)
	}
	if missingConversation != nil {
		t.Fatalf("expected nil missing conversation, got %#v", missingConversation)
	}
}
