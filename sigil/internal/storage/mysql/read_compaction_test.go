package mysql

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestListRecentGenerations(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-recent-1", "conv-recent", base),
		testGeneration("gen-recent-2", "conv-recent", base.Add(1*time.Hour)),
		testGeneration("gen-recent-3", "conv-recent", base.Add(2*time.Hour)),
	}))

	since := base.Add(-1 * time.Hour)
	rows, err := store.ListRecentGenerations(context.Background(), "tenant-a", since, 10)
	if err != nil {
		t.Fatalf("list recent generations: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 generations, got %d", len(rows))
	}
	if rows[0].GenerationID != "gen-recent-3" {
		t.Fatalf("expected most recent first (gen-recent-3), got %q", rows[0].GenerationID)
	}
	if rows[0].ConversationID == nil || *rows[0].ConversationID != "conv-recent" {
		t.Fatalf("expected conversation_id conv-recent, got %v", rows[0].ConversationID)
	}
	if len(rows[0].Payload) == 0 {
		t.Fatalf("expected non-empty payload")
	}

	sinceExcluding := base.Add(30 * time.Minute)
	rowsFiltered, err := store.ListRecentGenerations(context.Background(), "tenant-a", sinceExcluding, 10)
	if err != nil {
		t.Fatalf("list recent generations filtered: %v", err)
	}
	if len(rowsFiltered) != 2 {
		t.Fatalf("expected 2 generations after since filter (gen-recent-2 at 19:00, gen-recent-3 at 20:00), got %d", len(rowsFiltered))
	}

	empty, err := store.ListRecentGenerations(context.Background(), "tenant-b", since, 10)
	if err != nil {
		t.Fatalf("list recent generations other tenant: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected 0 generations for tenant-b, got %d", len(empty))
	}
}

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

	pred := storage.ShardPredicate{ShardWindowSeconds: 60, ShardCount: 1, ShardID: 0}
	claimed, err := store.ClaimBatch(context.Background(), "tenant-a", "owner-a", pred, base.Add(10*time.Minute), 2)
	if err != nil {
		t.Fatalf("claim uncompacted: %v", err)
	}
	if claimed != 2 {
		t.Fatalf("expected 2 claimed rows, got %d", claimed)
	}
	_, ids, err := store.LoadClaimed(context.Background(), "tenant-a", "owner-a", pred, 2)
	if err != nil {
		t.Fatalf("load claimed rows: %v", err)
	}
	if err := store.FinalizeClaimed(context.Background(), "tenant-a", "owner-a", ids); err != nil {
		t.Fatalf("finalize claimed rows: %v", err)
	}

	deletedRows, err := store.TruncateCompacted(context.Background(), "tenant-a", pred, time.Now().UTC().Add(time.Hour), 1)
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

func TestInsertBlockDuplicateReturnsErrBlockAlreadyExists(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	rangeStart := time.Date(2026, 2, 12, 17, 0, 0, 0, time.UTC)
	rangeEnd := time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)

	meta := storage.BlockMeta{
		TenantID:        "tenant-a",
		BlockID:         "block-duplicate",
		MinTime:         rangeStart,
		MaxTime:         rangeEnd,
		GenerationCount: 10,
		SizeBytes:       2048,
		ObjectPath:      "blocks/block-duplicate/data.sigil",
		IndexPath:       "blocks/block-duplicate/index.sigil",
	}
	if err := store.InsertBlock(context.Background(), meta); err != nil {
		t.Fatalf("insert block first attempt: %v", err)
	}
	err := store.InsertBlock(context.Background(), meta)
	if !errors.Is(err, storage.ErrBlockAlreadyExists) {
		t.Fatalf("expected ErrBlockAlreadyExists, got %v", err)
	}
}

func TestListConversationsWithFeedbackFilters(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 20, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{
		testGeneration("gen-filter-1", "conv-filter-1", base),
		testGeneration("gen-filter-2", "conv-filter-2", base.Add(time.Minute)),
		testGeneration("gen-filter-3", "conv-filter-3", base.Add(2*time.Minute)),
	}))

	if _, _, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-filter-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-filter-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create bad rating: %v", err)
	}
	if _, _, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-filter-2", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-filter-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	trueValue := true
	falseValue := false

	hasBad, err := store.ListConversationsWithFeedbackFilters(context.Background(), "tenant-a", &trueValue, nil)
	if err != nil {
		t.Fatalf("list has_bad_rating=true: %v", err)
	}
	if len(hasBad) != 1 || hasBad[0].ConversationID != "conv-filter-1" {
		t.Fatalf("unexpected has_bad_rating=true result: %#v", hasBad)
	}

	hasAnnotations, err := store.ListConversationsWithFeedbackFilters(context.Background(), "tenant-a", nil, &trueValue)
	if err != nil {
		t.Fatalf("list has_annotations=true: %v", err)
	}
	if len(hasAnnotations) != 1 || hasAnnotations[0].ConversationID != "conv-filter-2" {
		t.Fatalf("unexpected has_annotations=true result: %#v", hasAnnotations)
	}

	noSignals, err := store.ListConversationsWithFeedbackFilters(context.Background(), "tenant-a", &falseValue, &falseValue)
	if err != nil {
		t.Fatalf("list has_bad_rating=false has_annotations=false: %v", err)
	}
	if len(noSignals) != 1 || noSignals[0].ConversationID != "conv-filter-3" {
		t.Fatalf("unexpected no-signals filter result: %#v", noSignals)
	}
}
