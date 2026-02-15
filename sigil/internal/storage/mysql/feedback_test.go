package mysql

import (
	"context"
	"errors"
	"testing"

	"github.com/grafana/sigil/sigil/internal/feedback"
)

func TestCreateConversationRatingAndReplay(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	input := feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
		Comment:  "bad answer",
		Metadata: map[string]any{"channel": "assistant"},
	}
	rating, summary, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", input)
	if err != nil {
		t.Fatalf("create rating: %v", err)
	}
	if rating.RatingID != "rat-1" {
		t.Fatalf("expected rating id rat-1, got %q", rating.RatingID)
	}
	if !summary.HasBadRating || summary.BadCount != 1 {
		t.Fatalf("unexpected summary: %#v", summary)
	}

	replayRating, replaySummary, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", input)
	if err != nil {
		t.Fatalf("replay rating: %v", err)
	}
	if replayRating.RatingID != rating.RatingID {
		t.Fatalf("expected replay rating id %q, got %q", rating.RatingID, replayRating.RatingID)
	}
	if replaySummary.TotalCount != 1 {
		t.Fatalf("expected replay summary total_count=1, got %d", replaySummary.TotalCount)
	}
}

func TestCreateConversationRatingConflict(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	_, _, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-conflict",
		Rating:   feedback.RatingValueGood,
	})
	if err != nil {
		t.Fatalf("create rating: %v", err)
	}

	_, _, err = store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-conflict",
		Rating:   feedback.RatingValueBad,
	})
	if !errors.Is(err, feedback.ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
}

func TestListConversationRatingsPagination(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	for _, id := range []string{"rat-1", "rat-2", "rat-3"} {
		if _, _, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
			RatingID: id,
			Rating:   feedback.RatingValueGood,
		}); err != nil {
			t.Fatalf("create rating %s: %v", id, err)
		}
	}

	firstPage, cursor, err := store.ListConversationRatings(context.Background(), "tenant-a", "conv-1", 2, 0)
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("expected first page length 2, got %d", len(firstPage))
	}
	if cursor == 0 {
		t.Fatalf("expected non-zero next cursor")
	}

	secondPage, secondCursor, err := store.ListConversationRatings(context.Background(), "tenant-a", "conv-1", 2, cursor)
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}
	if len(secondPage) != 1 {
		t.Fatalf("expected second page length 1, got %d", len(secondPage))
	}
	if secondCursor != 0 {
		t.Fatalf("expected second cursor=0, got %d", secondCursor)
	}
}

func TestCreateConversationAnnotationAndReplay(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	operator := feedback.OperatorIdentity{
		OperatorID:    "operator-1",
		OperatorLogin: "alice",
		OperatorName:  "Alice",
	}
	input := feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
		Body:           "needs review",
		Tags:           map[string]string{"status": "needs_review"},
	}

	annotation, summary, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-ann", operator, input)
	if err != nil {
		t.Fatalf("create annotation: %v", err)
	}
	if annotation.AnnotationID != "ann-1" {
		t.Fatalf("expected annotation id ann-1, got %q", annotation.AnnotationID)
	}
	if summary.AnnotationCount != 1 {
		t.Fatalf("expected annotation_count=1, got %d", summary.AnnotationCount)
	}

	replayAnnotation, replaySummary, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-ann", operator, input)
	if err != nil {
		t.Fatalf("replay annotation: %v", err)
	}
	if replayAnnotation.AnnotationID != annotation.AnnotationID {
		t.Fatalf("expected replay annotation id %q, got %q", annotation.AnnotationID, replayAnnotation.AnnotationID)
	}
	if replaySummary.AnnotationCount != 1 {
		t.Fatalf("expected replay annotation_count=1, got %d", replaySummary.AnnotationCount)
	}
}

func TestCreateConversationAnnotationConflict(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	operator := feedback.OperatorIdentity{OperatorID: "operator-1"}
	_, _, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-ann", operator, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-conflict",
		AnnotationType: feedback.AnnotationTypeNote,
		Body:           "one",
	})
	if err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	_, _, err = store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-ann", operator, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-conflict",
		AnnotationType: feedback.AnnotationTypeNote,
		Body:           "two",
	})
	if !errors.Is(err, feedback.ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
}

func TestListConversationAnnotationsPagination(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	operator := feedback.OperatorIdentity{OperatorID: "operator-1"}
	for _, id := range []string{"ann-1", "ann-2", "ann-3"} {
		if _, _, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-ann-page", operator, feedback.CreateConversationAnnotationInput{
			AnnotationID:   id,
			AnnotationType: feedback.AnnotationTypeNote,
			Body:           id,
		}); err != nil {
			t.Fatalf("create annotation %s: %v", id, err)
		}
	}

	firstPage, cursor, err := store.ListConversationAnnotations(context.Background(), "tenant-a", "conv-ann-page", 2, 0)
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("expected first page length 2, got %d", len(firstPage))
	}
	if cursor == 0 {
		t.Fatalf("expected non-zero next cursor")
	}

	secondPage, secondCursor, err := store.ListConversationAnnotations(context.Background(), "tenant-a", "conv-ann-page", 2, cursor)
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}
	if len(secondPage) != 1 {
		t.Fatalf("expected second page length 1, got %d", len(secondPage))
	}
	if secondCursor != 0 {
		t.Fatalf("expected second cursor=0, got %d", secondCursor)
	}
}

func TestConversationFeedbackSummaryLookups(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	if _, _, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create bad rating: %v", err)
	}
	if _, _, err := store.CreateConversationRating(context.Background(), "tenant-a", "conv-2", feedback.CreateConversationRatingInput{
		RatingID: "rat-2",
		Rating:   feedback.RatingValueGood,
	}); err != nil {
		t.Fatalf("create good rating: %v", err)
	}
	if _, _, err := store.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-2", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	ratingSummary, err := store.GetConversationRatingSummary(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get rating summary: %v", err)
	}
	if ratingSummary == nil || !ratingSummary.HasBadRating {
		t.Fatalf("expected has_bad_rating=true for conv-1, got %#v", ratingSummary)
	}

	ratingSummaries, err := store.ListConversationRatingSummaries(context.Background(), "tenant-a", []string{"conv-1", "conv-2", "conv-missing"})
	if err != nil {
		t.Fatalf("list rating summaries: %v", err)
	}
	if len(ratingSummaries) != 2 {
		t.Fatalf("expected 2 rating summaries, got %d", len(ratingSummaries))
	}

	annotationSummary, err := store.GetConversationAnnotationSummary(context.Background(), "tenant-a", "conv-2")
	if err != nil {
		t.Fatalf("get annotation summary: %v", err)
	}
	if annotationSummary == nil || annotationSummary.AnnotationCount != 1 {
		t.Fatalf("expected annotation count=1 for conv-2, got %#v", annotationSummary)
	}

	annotationSummaries, err := store.ListConversationAnnotationSummaries(context.Background(), "tenant-a", []string{"conv-1", "conv-2"})
	if err != nil {
		t.Fatalf("list annotation summaries: %v", err)
	}
	if len(annotationSummaries) != 1 {
		t.Fatalf("expected 1 annotation summary, got %d", len(annotationSummaries))
	}
}
