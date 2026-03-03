package query

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/storage"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestListConversationsForTenantAppliesFeedbackFilters(t *testing.T) {
	base := time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC)
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				LastGenerationAt: base.Add(-3 * time.Minute),
				GenerationCount:  1,
				CreatedAt:        base.Add(-5 * time.Minute),
				UpdatedAt:        base.Add(-3 * time.Minute),
			},
			{
				TenantID:         "tenant-a",
				ConversationID:   "conv-2",
				LastGenerationAt: base.Add(-2 * time.Minute),
				GenerationCount:  2,
				CreatedAt:        base.Add(-4 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
			{
				TenantID:         "tenant-a",
				ConversationID:   "conv-3",
				LastGenerationAt: base.Add(-1 * time.Minute),
				GenerationCount:  1,
				CreatedAt:        base.Add(-3 * time.Minute),
				UpdatedAt:        base.Add(-1 * time.Minute),
			},
		},
	}

	feedbackStore := feedback.NewMemoryStore()
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create bad rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "tenant-a", "conv-2", feedback.CreateConversationRatingInput{
		RatingID: "rat-2",
		Rating:   feedback.RatingValueGood,
	}); err != nil {
		t.Fatalf("create good rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-2", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	service := NewServiceWithStores(conversationStore, feedbackStore)

	t.Run("has_bad_rating_true", func(t *testing.T) {
		value := true
		items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{HasBadRating: &value})
		if err != nil {
			t.Fatalf("list conversations: %v", err)
		}
		if len(items) != 1 || items[0].ID != "conv-1" {
			t.Fatalf("expected only conv-1, got %#v", items)
		}
	})

	t.Run("has_bad_rating_false", func(t *testing.T) {
		value := false
		items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{HasBadRating: &value})
		if err != nil {
			t.Fatalf("list conversations: %v", err)
		}
		if len(items) != 2 {
			t.Fatalf("expected 2 conversations without bad ratings, got %d", len(items))
		}
	})

	t.Run("has_annotations_true", func(t *testing.T) {
		value := true
		items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{HasAnnotations: &value})
		if err != nil {
			t.Fatalf("list conversations: %v", err)
		}
		if len(items) != 1 || items[0].ID != "conv-2" {
			t.Fatalf("expected only conv-2, got %#v", items)
		}
	})

	t.Run("has_annotations_false", func(t *testing.T) {
		value := false
		items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{HasAnnotations: &value})
		if err != nil {
			t.Fatalf("list conversations: %v", err)
		}
		if len(items) != 2 {
			t.Fatalf("expected 2 conversations without annotations, got %d", len(items))
		}
	})
}

func TestGetConversationForTenantIncludesSummaries(t *testing.T) {
	base := time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC)
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				LastGenerationAt: base,
				GenerationCount:  1,
				CreatedAt:        base.Add(-time.Minute),
				UpdatedAt:        base,
			},
		},
	}

	feedbackStore := feedback.NewMemoryStore()
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-1", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	service := NewServiceWithStores(conversationStore, feedbackStore)
	item, found, err := service.GetConversationForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation to exist")
	}
	if item.RatingSummary == nil || !item.RatingSummary.HasBadRating {
		t.Fatalf("expected rating summary with has_bad_rating=true, got %#v", item.RatingSummary)
	}
	if item.AnnotationSummary == nil || item.AnnotationSummary.AnnotationCount != 1 {
		t.Fatalf("expected annotation summary count=1, got %#v", item.AnnotationSummary)
	}

	_, missing, err := service.GetConversationForTenant(context.Background(), "tenant-a", "conv-missing")
	if err != nil {
		t.Fatalf("get missing conversation: %v", err)
	}
	if missing {
		t.Fatalf("expected missing conversation")
	}
}

func TestListConversationsForTenantReturnsEmptySliceWhenNoRows(t *testing.T) {
	service := NewServiceWithStores(&testConversationStore{}, feedback.NewMemoryStore())

	items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{})
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if items == nil {
		t.Fatalf("expected non-nil empty slice")
	}
	if len(items) != 0 {
		t.Fatalf("expected empty list, got %d items", len(items))
	}
}

func TestListConversationsForTenantEmitsTracingSpan(t *testing.T) {
	base := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	service := NewServiceWithStores(&testConversationStore{
		items: []storage.Conversation{{
			TenantID:         "tenant-a",
			ConversationID:   "conv-1",
			LastGenerationAt: base,
			GenerationCount:  1,
			CreatedAt:        base.Add(-time.Minute),
			UpdatedAt:        base,
		}},
	}, feedback.NewMemoryStore())

	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spanRecorder))

	prevTracerProvider := otel.GetTracerProvider()
	prevPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tracerProvider.Shutdown(context.Background())
		otel.SetTracerProvider(prevTracerProvider)
		otel.SetTextMapPropagator(prevPropagator)
	})

	items, err := service.ListConversationsForTenant(context.Background(), "tenant-a", ConversationListFilter{})
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one conversation, got %d", len(items))
	}

	spans := spanRecorder.Ended()
	if len(spans) == 0 {
		t.Fatalf("expected tracing span")
	}
	found := false
	for _, span := range spans {
		if span.Name() == "sigil.query.list_conversations" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected sigil.query.list_conversations span")
	}
}

type testConversationStore struct {
	items []storage.Conversation
}

func (s *testConversationStore) ListConversations(_ context.Context, tenantID string) ([]storage.Conversation, error) {
	out := make([]storage.Conversation, 0, len(s.items))
	for _, item := range s.items {
		if item.TenantID != tenantID {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *testConversationStore) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	for _, item := range s.items {
		if item.TenantID != tenantID || item.ConversationID != conversationID {
			continue
		}
		copied := item
		return &copied, nil
	}
	return nil, nil
}
