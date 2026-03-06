package query

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/object"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type stubFanOutReader struct {
	generations map[string]*sigilv1.Generation
}

func (r *stubFanOutReader) GetGenerationByID(_ context.Context, _, generationID string) (*sigilv1.Generation, error) {
	if gen, ok := r.generations[generationID]; ok {
		return gen, nil
	}
	return nil, nil
}

func (r *stubFanOutReader) ListConversationGenerations(_ context.Context, _, conversationID string) ([]*sigilv1.Generation, error) {
	var out []*sigilv1.Generation
	for _, gen := range r.generations {
		if gen.GetConversationId() == conversationID {
			out = append(out, gen)
		}
	}
	return out, nil
}

func TestBatchResolveGenerationTitles_NoConcurrentMapRace(t *testing.T) {
	base := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

	makeGeneration := func(id, convID string, ts time.Time, title string) *sigilv1.Generation {
		gen := &sigilv1.Generation{
			Id:             id,
			ConversationId: convID,
			CompletedAt:    timestamppb.New(ts),
		}
		if title != "" {
			gen.Metadata, _ = structpb.NewStruct(map[string]interface{}{
				"sigil.conversation.title": title,
			})
		}
		return gen
	}

	reader := &stubFanOutReader{
		generations: map[string]*sigilv1.Generation{
			"gen-1": makeGeneration("gen-1", "conv-1", base, "title-1"),
			"gen-2": makeGeneration("gen-2", "conv-2", base.Add(time.Second), "title-2"),
		},
	}

	candidates := make([]searchCandidate, 20)
	for i := range candidates {
		convID := "conv-1"
		genID := "gen-1"
		if i%2 == 1 {
			convID = "conv-2"
			genID = "gen-2"
		}
		candidates[i] = searchCandidate{
			conversationID: convID,
			aggregate: &tempoConversationAggregate{
				GenerationIDs: map[string]struct{}{genID: {}},
			},
			metadata: storage.Conversation{
				ConversationID:  convID,
				GenerationCount: 1,
			},
		}
	}

	service := NewService()
	cache := make(map[string]generationTitleSnapshot)

	titles := service.batchResolveGenerationTitles(context.Background(), "tenant-a", candidates, reader, cache)

	if len(titles) != len(candidates) {
		t.Fatalf("expected %d titles, got %d", len(candidates), len(titles))
	}
}

func TestSearchConversationsForTenantAppliesTempoAndMySQLFilters(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  5,
				CreatedAt:        base.Add(-20 * time.Minute),
				LastGenerationAt: base.Add(-10 * time.Minute),
				UpdatedAt:        base.Add(-10 * time.Minute),
			},
			"conv-2": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-2",
				GenerationCount:  1,
				CreatedAt:        base.Add(-15 * time.Minute),
				LastGenerationAt: base.Add(-5 * time.Minute),
				UpdatedAt:        base.Add(-5 * time.Minute),
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
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-1", feedback.OperatorIdentity{OperatorID: "operator-1"}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	service := NewServiceWithStores(conversationStore, feedbackStore)
	traceWithTitle := newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", "provider_error")
	traceWithTitle.SpanSets[0].Spans[0].Attributes = append(
		traceWithTitle.SpanSets[0].Spans[0].Attributes,
		TempoAttribute{Key: "sigil.conversation.title", Value: tempoStringValue("Escalation: billing outage")},
		TempoAttribute{Key: "user.id", Value: tempoStringValue("user-responder")},
	)
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				traceWithTitle,
				newTempoTrace("trace-2", base.Add(-1*time.Minute), "conv-2", "gen-2", "gpt-4o", "assistant", ""),
			},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o" generation_count >= 3`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}

	item := response.Conversations[0]
	if item.ConversationID != "conv-1" {
		t.Fatalf("expected conv-1, got %q", item.ConversationID)
	}
	if item.ConversationTitle != "Escalation: billing outage" {
		t.Fatalf("expected conversation title from tempo span, got %q", item.ConversationTitle)
	}
	if item.UserID != "user-responder" {
		t.Fatalf("expected user id from tempo span, got %q", item.UserID)
	}
	if item.GenerationCount != 5 {
		t.Fatalf("expected generation_count=5, got %d", item.GenerationCount)
	}
	if !item.HasErrors {
		t.Fatalf("expected has_errors=true due tempo error field")
	}
	if item.RatingSummary == nil || !item.RatingSummary.HasBadRating {
		t.Fatalf("expected rating summary with bad rating, got %#v", item.RatingSummary)
	}
	if item.AnnotationCount != 1 {
		t.Fatalf("expected annotation_count=1, got %d", item.AnnotationCount)
	}
}

func TestSearchConversationsForTenantUsesGenerationTitleWhenTempoTitleMissing(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
		},
	}

	generation := testGenerationPayload("gen-1", "conv-1", base.Add(-2*time.Minute))
	generation.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: generation-backed title"),
	}}
	walReader := &stubWALReader{
		byID: map[string]*sigilv1.Generation{
			"gen-1": generation,
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}
	if response.Conversations[0].ConversationTitle != "Incident: generation-backed title" {
		t.Fatalf("expected conversation title from generation metadata, got %q", response.Conversations[0].ConversationTitle)
	}
	if len(walReader.requestedGenerationIDs) == 0 || walReader.requestedGenerationIDs[0] != "gen-1" {
		t.Fatalf("expected generation title lookup via wal reader, got %#v", walReader.requestedGenerationIDs)
	}
}

func TestSearchConversationsForTenantPrefersGenerationTitleOverTempoTitle(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
		},
	}

	generation := testGenerationPayload("gen-1", "conv-1", base.Add(-2*time.Minute))
	generation.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: generation title"),
	}}
	walReader := &stubWALReader{
		byID: map[string]*sigilv1.Generation{
			"gen-1": generation,
		},
	}

	trace := newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", "")
	trace.SpanSets[0].Spans[0].Attributes = append(
		trace.SpanSets[0].Spans[0].Attributes,
		TempoAttribute{Key: "sigil.conversation.title", Value: tempoStringValue("Incident: trace title")},
	)

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{trace},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}
	if response.Conversations[0].ConversationTitle != "Incident: generation title" {
		t.Fatalf("expected generation title to win over tempo title, got %q", response.Conversations[0].ConversationTitle)
	}
}

func TestSearchConversationsForTenantPrefersLatestGenerationTitleOverLatestSpanTitle(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  2,
				CreatedAt:        base.Add(-8 * time.Minute),
				LastGenerationAt: base.Add(-time.Minute),
				UpdatedAt:        base.Add(-time.Minute),
			},
		},
	}

	oldGeneration := testGenerationPayload("gen-1", "conv-1", base.Add(-5*time.Minute))
	oldGeneration.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: old generation title"),
	}}
	newGeneration := testGenerationPayload("gen-2", "conv-1", base.Add(-time.Minute))
	newGeneration.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: latest generation title"),
	}}

	walReader := &stubWALReader{
		byID: map[string]*sigilv1.Generation{
			"gen-1": oldGeneration,
			"gen-2": newGeneration,
		},
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {oldGeneration, newGeneration},
		},
	}

	trace := newTempoTrace("trace-1", base.Add(-30*time.Second), "conv-1", "gen-1", "gpt-4o", "assistant", "")
	trace.SpanSets[0].Spans[0].Attributes = append(
		trace.SpanSets[0].Spans[0].Attributes,
		TempoAttribute{Key: "sigil.conversation.title", Value: tempoStringValue("Incident: latest span title")},
	)

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{trace},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}
	if response.Conversations[0].ConversationTitle != "Incident: latest generation title" {
		t.Fatalf("expected latest generation title to win, got %q", response.Conversations[0].ConversationTitle)
	}
	if len(walReader.requestedConversationIDs) == 0 || walReader.requestedConversationIDs[0] != "conv-1" {
		t.Fatalf("expected conversation generation lookup, got %#v", walReader.requestedConversationIDs)
	}
}

func TestSearchConversationsForTenantPrefersStoredConversationTitle(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:          "tenant-a",
				ConversationID:    "conv-1",
				ConversationTitle: "Incident: stored title",
				GenerationCount:   1,
				CreatedAt:         base.Add(-5 * time.Minute),
				LastGenerationAt:  base.Add(-2 * time.Minute),
				UpdatedAt:         base.Add(-2 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}
	if response.Conversations[0].ConversationTitle != "Incident: stored title" {
		t.Fatalf("expected stored conversation title, got %q", response.Conversations[0].ConversationTitle)
	}
}

func TestSearchConversationsForTenantEmptyFilterUsesSDKNameGuard(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-5 * time.Minute),
				UpdatedAt:        base.Add(-5 * time.Minute),
			},
		},
	}

	tempoClient := &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-5*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}
	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = tempoClient

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  "",
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(response.Conversations))
	}

	if len(tempoClient.searchRequests) == 0 {
		t.Fatalf("expected at least one tempo search request")
	}
	traceQL := tempoClient.searchRequests[0].Query
	if !strings.Contains(traceQL, `span.sigil.sdk.name != ""`) {
		t.Fatalf("expected empty-filter query to use sdk-name guard, got %q", traceQL)
	}
	if strings.Contains(traceQL, `span.gen_ai.operation.name =~ "generateText|streamText"`) {
		t.Fatalf("empty-filter query should not hardcode operation names: %q", traceQL)
	}
}

func TestSearchConversationsForTenantRequiresConversationStore(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)

	service := NewService()
	service.tempoClient = &stubTempoClient{}

	_, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err == nil {
		t.Fatalf("expected conversation store configuration error")
	}
	if !strings.Contains(err.Error(), "conversation store is not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSearchConversationsForTenantCursorInvalidation(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {TenantID: "tenant-a", ConversationID: "conv-1", GenerationCount: 2, CreatedAt: base.Add(-time.Minute), LastGenerationAt: base.Add(-time.Minute), UpdatedAt: base.Add(-time.Minute)},
			"conv-2": {TenantID: "tenant-a", ConversationID: "conv-2", GenerationCount: 2, CreatedAt: base.Add(-2 * time.Minute), LastGenerationAt: base.Add(-2 * time.Minute), UpdatedAt: base.Add(-2 * time.Minute)},
		},
	}
	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
				newTempoTrace("trace-2", base.Add(-2*time.Minute), "conv-2", "gen-2", "gpt-4o", "assistant", ""),
			},
		}},
	}

	firstPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 1,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search first page: %v", err)
	}
	if !firstPage.HasMore || firstPage.NextCursor == "" {
		t.Fatalf("expected next cursor on first page: %#v", firstPage)
	}

	_, err = service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters: `model = "gpt-4o-mini"`,
		Cursor:  firstPage.NextCursor,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error for changed filters, got %v", err)
	}
}

func TestSearchConversationsForTenantHasMoreFalseWhenExactPageIsExhausted(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-3 * time.Minute),
				LastGenerationAt: base.Add(-3 * time.Minute),
				UpdatedAt:        base.Add(-3 * time.Minute),
			},
			"conv-2": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-2",
				GenerationCount:  1,
				CreatedAt:        base.Add(-2 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-2", "gen-2", "gpt-4o", "assistant", ""),
				newTempoTrace("trace-2", base.Add(-3*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 2,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 2 {
		t.Fatalf("expected 2 conversations, got %d", len(response.Conversations))
	}
	if response.HasMore {
		t.Fatalf("expected has_more=false when result set is exhausted")
	}
	if response.NextCursor != "" {
		t.Fatalf("expected empty next cursor when result set is exhausted, got %q", response.NextCursor)
	}
}

func TestSearchConversationsForTenantCursorContinuesWithinSameWindow(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-1 * time.Minute),
				LastGenerationAt: base.Add(-1 * time.Minute),
				UpdatedAt:        base.Add(-1 * time.Minute),
			},
			"conv-2": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-2",
				GenerationCount:  1,
				CreatedAt:        base.Add(-2 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
			"conv-3": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-3",
				GenerationCount:  1,
				CreatedAt:        base.Add(-3 * time.Minute),
				LastGenerationAt: base.Add(-3 * time.Minute),
				UpdatedAt:        base.Add(-3 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-1*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
				newTempoTrace("trace-2", base.Add(-2*time.Minute), "conv-2", "gen-2", "gpt-4o", "assistant", ""),
				newTempoTrace("trace-3", base.Add(-3*time.Minute), "conv-3", "gen-3", "gpt-4o", "assistant", ""),
			},
		}},
	}

	firstPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 2,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search first page: %v", err)
	}
	if len(firstPage.Conversations) != 2 {
		t.Fatalf("expected 2 conversations on first page, got %d", len(firstPage.Conversations))
	}
	if !firstPage.HasMore || firstPage.NextCursor == "" {
		t.Fatalf("expected first page to expose continuation cursor, got %#v", firstPage)
	}

	secondPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters: `model = "gpt-4o"`,
		Cursor:  firstPage.NextCursor,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("search second page: %v", err)
	}
	if len(secondPage.Conversations) != 1 {
		t.Fatalf("expected one remaining conversation on second page, got %d", len(secondPage.Conversations))
	}
	if secondPage.Conversations[0].ConversationID != "conv-3" {
		t.Fatalf("expected remaining conversation conv-3, got %q", secondPage.Conversations[0].ConversationID)
	}
	if secondPage.HasMore {
		t.Fatalf("expected second page to be exhausted")
	}
	if secondPage.NextCursor != "" {
		t.Fatalf("expected empty cursor on exhausted second page, got %q", secondPage.NextCursor)
	}
}

func TestSearchConversationsForTenantPreservesCursorWhenIterationLimitReached(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-2 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
			"conv-2": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-2",
				GenerationCount:  1,
				CreatedAt:        base.Add(-4 * time.Minute),
				LastGenerationAt: base.Add(-4 * time.Minute),
				UpdatedAt:        base.Add(-4 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.maxSearchIterations = 1
	service.overfetchMultiplier = 1
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{
			{
				Traces: []TempoTrace{
					newTempoTrace("trace-1", base.Add(-1*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
					newTempoTrace("trace-2", base.Add(-2*time.Minute), "conv-1", "gen-2", "gpt-4o", "assistant", ""),
				},
			},
			{
				Traces: []TempoTrace{
					newTempoTrace("trace-3", base.Add(-4*time.Minute), "conv-2", "gen-3", "gpt-4o", "assistant", ""),
				},
			},
		},
	}

	firstPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 2,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search first page: %v", err)
	}
	if len(firstPage.Conversations) != 1 {
		t.Fatalf("expected one conversation on first page, got %d", len(firstPage.Conversations))
	}
	if !firstPage.HasMore {
		t.Fatalf("expected has_more=true when iteration limit is reached with remaining window")
	}
	if firstPage.NextCursor == "" {
		t.Fatalf("expected continuation cursor when iteration limit is reached")
	}

	secondPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		Cursor:   firstPage.NextCursor,
		PageSize: 2,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search second page: %v", err)
	}
	if len(secondPage.Conversations) != 1 || secondPage.Conversations[0].ConversationID != "conv-2" {
		t.Fatalf("expected second page to return conv-2, got %#v", secondPage.Conversations)
	}
}

func TestSearchConversationsForTenantPreservesCursorWhenIterationLimitReachedWithZeroPageResults(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-filtered": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-filtered",
				GenerationCount:  1,
				CreatedAt:        base.Add(-2 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
			"conv-match": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-match",
				GenerationCount:  5,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-5 * time.Minute),
				UpdatedAt:        base.Add(-5 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.maxSearchIterations = 1
	service.overfetchMultiplier = 1
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{
			{
				Traces: []TempoTrace{
					newTempoTrace("trace-filtered", base.Add(-1*time.Minute), "conv-filtered", "gen-1", "gpt-4o", "assistant", ""),
				},
			},
			{
				Traces: []TempoTrace{
					newTempoTrace("trace-match", base.Add(-5*time.Minute), "conv-match", "gen-2", "gpt-4o", "assistant", ""),
				},
			},
		},
	}

	firstPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o" generation_count >= 5`,
		PageSize: 1,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search first page: %v", err)
	}
	if len(firstPage.Conversations) != 0 {
		t.Fatalf("expected first page to be empty, got %d", len(firstPage.Conversations))
	}
	if !firstPage.HasMore {
		t.Fatalf("expected has_more=true for iteration-cap continuation with zero page results")
	}
	if firstPage.NextCursor == "" {
		t.Fatalf("expected continuation cursor for iteration-cap continuation with zero page results")
	}

	secondPage, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o" generation_count >= 5`,
		Cursor:   firstPage.NextCursor,
		PageSize: 1,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search second page: %v", err)
	}
	if len(secondPage.Conversations) != 1 {
		t.Fatalf("expected one conversation on second page, got %d", len(secondPage.Conversations))
	}
	if secondPage.Conversations[0].ConversationID != "conv-match" {
		t.Fatalf("expected conv-match on second page, got %q", secondPage.Conversations[0].ConversationID)
	}
}

func TestGetConversationDetailForTenantMergesHotAndCold(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  3,
				CreatedAt:        base,
				LastGenerationAt: base.Add(3 * time.Minute),
				UpdatedAt:        base.Add(3 * time.Minute),
			},
		},
	}

	hotGeneration1 := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))
	hotGeneration2 := testGenerationPayload("gen-2", "conv-1", base.Add(2*time.Minute))
	coldGeneration2 := testGenerationPayload("gen-2", "conv-1", base.Add(30*time.Second))
	coldGeneration3 := testGenerationPayload("gen-3", "conv-1", base.Add(3*time.Minute))
	hotGeneration1.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		generationMetadataUserIDKey: structpb.NewStringValue("user-older"),
	}}
	coldGeneration3.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		generationMetadataLegacyUserIDKey: structpb.NewStringValue("user-final"),
	}}

	walReader := &stubWALReader{
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {hotGeneration1, hotGeneration2},
		},
		byID: map[string]*sigilv1.Generation{
			"gen-1": hotGeneration1,
			"gen-2": hotGeneration2,
		},
	}

	blockID, index, generationsByOffset := buildIndexedBlock(t, []*sigilv1.Generation{coldGeneration2, coldGeneration3})
	blockMetadataStore := &stubBlockMetadataStore{
		blocks: []storage.BlockMeta{{TenantID: "tenant-a", BlockID: blockID, MinTime: base.Add(-time.Minute), MaxTime: base.Add(4 * time.Minute)}},
	}
	blockReader := &stubBlockReader{indexes: map[string]*storage.BlockIndex{blockID: index}, generationsByOffset: map[string]map[int64]*sigilv1.Generation{blockID: generationsByOffset}}

	feedbackStore := feedback.NewMemoryStore()
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "tenant-a", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueGood,
	}); err != nil {
		t.Fatalf("create rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "tenant-a", "conv-1", feedback.OperatorIdentity{OperatorID: "operator-1"}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	service := NewServiceWithStores(conversationStore, feedbackStore)
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, blockMetadataStore, blockReader)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 3 {
		t.Fatalf("expected 3 merged generations, got %d", len(detail.Generations))
	}

	generationIDs := make([]string, 0, len(detail.Generations))
	for _, generation := range detail.Generations {
		generationID, _ := generation["generation_id"].(string)
		generationIDs = append(generationIDs, generationID)
	}
	sort.Strings(generationIDs)
	if generationIDs[0] != "gen-1" || generationIDs[1] != "gen-2" || generationIDs[2] != "gen-3" {
		t.Fatalf("unexpected generation ids: %#v", generationIDs)
	}
	if len(detail.Annotations) != 1 {
		t.Fatalf("expected one annotation, got %d", len(detail.Annotations))
	}
	if detail.RatingSummary == nil || detail.RatingSummary.TotalCount != 1 {
		t.Fatalf("expected rating summary total_count=1, got %#v", detail.RatingSummary)
	}
	if detail.UserID != "user-final" {
		t.Fatalf("expected latest user id in detail, got %q", detail.UserID)
	}
}

func TestGetConversationDetailForTenantIncludesStoredConversationTitle(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:          "tenant-a",
				ConversationID:    "conv-1",
				ConversationTitle: "Incident: stored title",
				GenerationCount:   1,
				CreatedAt:         base,
				LastGenerationAt:  base.Add(time.Minute),
				UpdatedAt:         base.Add(time.Minute),
			},
		},
	}

	generation := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))
	walReader := &stubWALReader{
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {generation},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if detail.ConversationTitle != "Incident: stored title" {
		t.Fatalf("expected stored conversation title, got %q", detail.ConversationTitle)
	}
}

func TestGetConversationDetailForTenantHotOnlyFanOut(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-hot": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-hot",
				GenerationCount:  2,
				CreatedAt:        base,
				LastGenerationAt: base.Add(2 * time.Minute),
				UpdatedAt:        base.Add(2 * time.Minute),
			},
		},
	}

	hotGeneration1 := testGenerationPayload("gen-1", "conv-hot", base.Add(time.Minute))
	hotGeneration2 := testGenerationPayload("gen-2", "conv-hot", base.Add(2*time.Minute))
	walReader := &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-hot": {hotGeneration1, hotGeneration2}},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-hot")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 2 {
		t.Fatalf("expected 2 hot generations, got %d", len(detail.Generations))
	}

	firstID, _ := detail.Generations[0]["generation_id"].(string)
	secondID, _ := detail.Generations[1]["generation_id"].(string)
	if firstID != "gen-1" || secondID != "gen-2" {
		t.Fatalf("unexpected generation order: %#v", detail.Generations)
	}
}

func TestGetConversationDetailForTenantIncludesAgentEffectiveVersion(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base,
				LastGenerationAt: base.Add(time.Minute),
				UpdatedAt:        base.Add(time.Minute),
			},
		},
	}

	generation := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))
	generation.AgentVersion = "v1"
	walReader := &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-1": {generation}},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 1 {
		t.Fatalf("expected one generation, got %d", len(detail.Generations))
	}

	payload := detail.Generations[0]
	agentVersion, ok := payload["agent_version"].(string)
	if !ok || agentVersion != "v1" {
		t.Fatalf("expected declared agent version to be preserved, got %#v", payload["agent_version"])
	}

	effectiveVersion, ok := payload["agent_effective_version"].(string)
	if !ok {
		t.Fatalf("expected agent_effective_version string, got %#v", payload["agent_effective_version"])
	}
	if !strings.HasPrefix(effectiveVersion, "sha256:") {
		t.Fatalf("expected agent_effective_version sha256 hash, got %q", effectiveVersion)
	}
	if effectiveVersion == agentVersion {
		t.Fatalf("expected effective version to differ from declared version, got %q", effectiveVersion)
	}
	if payload["agent_id"] != "assistant" {
		t.Fatalf("expected agent_id to match agent name, got %#v", payload["agent_id"])
	}
}

func TestGetConversationDetailForTenantOmitsAgentFieldsWithoutAgentName(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base,
				LastGenerationAt: base.Add(time.Minute),
				UpdatedAt:        base.Add(time.Minute),
			},
		},
	}

	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		TraceId:        "trace-gen-1",
		SpanId:         "span-gen-1",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
		CompletedAt:    timestamppb.New(base.Add(time.Minute)),
	}
	walReader := &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-1": {generation}},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 1 {
		t.Fatalf("expected one generation, got %d", len(detail.Generations))
	}

	payload := detail.Generations[0]
	if _, ok := payload["agent_effective_version"]; ok {
		t.Fatalf("expected agent_effective_version to be absent for non-agent generation, got %#v", payload["agent_effective_version"])
	}
	if _, ok := payload["agent_id"]; ok {
		t.Fatalf("expected agent_id to be absent for non-agent generation, got %#v", payload["agent_id"])
	}
}

func TestGetConversationDetailForTenantDoesNotUseConversationCreatedAtAsLowerBound(t *testing.T) {
	ingestTime := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	backfillTime := ingestTime.Add(-45 * time.Minute)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-backfill": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-backfill",
				GenerationCount:  1,
				CreatedAt:        ingestTime,
				LastGenerationAt: ingestTime,
				UpdatedAt:        ingestTime,
			},
		},
	}

	coldGeneration := testGenerationPayload("gen-backfill", "conv-backfill", backfillTime)
	blockID, index, generationsByOffset := buildIndexedBlock(t, []*sigilv1.Generation{coldGeneration})
	blockMetadataStore := &boundedRangeBlockMetadataStore{
		blocks: []storage.BlockMeta{{
			TenantID: "tenant-a",
			BlockID:  blockID,
			MinTime:  backfillTime.Add(-time.Minute),
			MaxTime:  backfillTime.Add(time.Minute),
		}},
	}
	blockReader := &stubBlockReader{
		indexes:             map[string]*storage.BlockIndex{blockID: index},
		generationsByOffset: map[string]map[int64]*sigilv1.Generation{blockID: generationsByOffset},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.walReader = &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-backfill": []*sigilv1.Generation{}},
		},
	}
	service.fanOutStore = storage.NewFanOutStore(service.walReader, blockMetadataStore, blockReader)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-backfill")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 1 {
		t.Fatalf("expected backfilled cold generation to be returned, got %d", len(detail.Generations))
	}
	if detail.Generations[0]["generation_id"] != "gen-backfill" {
		t.Fatalf("unexpected generation payload: %#v", detail.Generations[0])
	}
}

func TestGetConversationDetailForTenantFanOutTenantIsolation(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-shared": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-shared",
				GenerationCount:  1,
				CreatedAt:        base,
				LastGenerationAt: base.Add(time.Minute),
				UpdatedAt:        base.Add(time.Minute),
			},
		},
	}

	hotGenerationTenantA := testGenerationPayload("gen-a-hot", "conv-shared", base.Add(time.Minute))
	hotGenerationTenantB := testGenerationPayload("gen-b-hot", "conv-shared", base.Add(2*time.Minute))
	walReader := &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-shared": {hotGenerationTenantA}},
			"tenant-b": {"conv-shared": {hotGenerationTenantB}},
		},
	}

	coldGenerationTenantB := testGenerationPayload("gen-b-cold", "conv-shared", base.Add(3*time.Minute))
	blockIDTenantB, indexTenantB, generationsByOffsetTenantB := buildIndexedBlock(t, []*sigilv1.Generation{coldGenerationTenantB})
	blockMetadataStore := &stubBlockMetadataStore{
		blocksByTenant: map[string][]storage.BlockMeta{
			"tenant-a": {},
			"tenant-b": {{TenantID: "tenant-b", BlockID: blockIDTenantB}},
		},
	}
	blockReader := &stubBlockReader{
		indexesByTenant: map[string]map[string]*storage.BlockIndex{
			"tenant-b": {blockIDTenantB: indexTenantB},
		},
		generationsByOffsetByTenant: map[string]map[string]map[int64]*sigilv1.Generation{
			"tenant-b": {blockIDTenantB: generationsByOffsetTenantB},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, blockMetadataStore, blockReader)

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-shared")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Generations) != 1 {
		t.Fatalf("expected tenant-scoped fan-out to return one generation, got %d", len(detail.Generations))
	}
	if detail.Generations[0]["generation_id"] != "gen-a-hot" {
		t.Fatalf("unexpected generation payload: %#v", detail.Generations[0])
	}
}

func TestGetConversationDetailForTenantLoadsAllAnnotationPages(t *testing.T) {
	base := time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  0,
				CreatedAt:        base,
				LastGenerationAt: base,
				UpdatedAt:        base,
			},
		},
	}

	const totalPages = 70
	pages := make([][]feedback.ConversationAnnotation, 0, totalPages)
	expectedIDs := make(map[string]struct{}, totalPages)
	for i := 0; i < totalPages; i++ {
		annotationID := "ann-" + strconv.Itoa(i)
		expectedIDs[annotationID] = struct{}{}
		pages = append(pages, []feedback.ConversationAnnotation{{
			AnnotationID:   annotationID,
			ConversationID: "conv-1",
			AnnotationType: feedback.AnnotationTypeNote,
			CreatedAt:      base.Add(time.Duration(totalPages-i) * time.Second),
		}})
	}
	annotationStore := &stubAnnotationEventStore{pages: pages}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = &stubWALReader{}
	service.annotationEventStore = annotationStore

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail to be found")
	}
	if len(detail.Annotations) != totalPages {
		t.Fatalf("expected %d annotations, got %d", totalPages, len(detail.Annotations))
	}
	for _, annotation := range detail.Annotations {
		delete(expectedIDs, annotation.AnnotationID)
	}
	if len(expectedIDs) != 0 {
		t.Fatalf("expected all annotation ids to be returned, %d missing", len(expectedIDs))
	}
	if annotationStore.calls != totalPages {
		t.Fatalf("expected %d annotation page calls, got %d", totalPages, annotationStore.calls)
	}
	for _, limit := range annotationStore.limits {
		if limit != feedback.MaxPageLimit {
			t.Fatalf("expected page limit %d, got %d", feedback.MaxPageLimit, limit)
		}
	}
}

func TestGetConversationDetailForTenantRequiresWALReader(t *testing.T) {
	service := NewServiceWithStores(&stubConversationStore{}, feedback.NewMemoryStore())

	_, _, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err == nil {
		t.Fatalf("expected wal reader configuration error")
	}
	if !strings.Contains(err.Error(), "wal reader is not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGetGenerationDetailForTenantFallsBackToColdStorage(t *testing.T) {
	generation := testGenerationPayload("gen-cold", "conv-cold", time.Date(2026, 2, 15, 8, 0, 0, 0, time.UTC))
	blockID, index, generationsByOffset := buildIndexedBlock(t, []*sigilv1.Generation{generation})

	service := NewService()
	service.walReader = &stubWALReader{byID: map[string]*sigilv1.Generation{}}
	service.fanOutStore = storage.NewFanOutStore(
		service.walReader,
		&stubBlockMetadataStore{blocks: []storage.BlockMeta{{TenantID: "tenant-a", BlockID: blockID}}},
		&stubBlockReader{indexes: map[string]*storage.BlockIndex{blockID: index}, generationsByOffset: map[string]map[int64]*sigilv1.Generation{blockID: generationsByOffset}},
	)

	payload, found, err := service.GetGenerationDetailForTenant(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("get generation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected generation detail found")
	}
	if payload["generation_id"] != "gen-cold" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGetGenerationDetailForTenantRequiresWALReader(t *testing.T) {
	service := NewService()

	_, _, err := service.GetGenerationDetailForTenant(context.Background(), "tenant-a", "gen-1")
	if err == nil {
		t.Fatalf("expected wal reader configuration error")
	}
	if !strings.Contains(err.Error(), "wal reader is not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestListSearchTagsAndValues(t *testing.T) {
	service := NewService()
	tempoClient := &stubTempoClient{
		tagsByScope: map[string][]string{
			"span":     {"gen_ai.request.model", "gen_ai.agent.name"},
			"resource": {"k8s.namespace.name"},
		},
		tagValues: map[string][]string{
			"span.gen_ai.request.model": {"gpt-4o", "gpt-4o-mini"},
		},
	}
	service.tempoClient = tempoClient

	tags, err := service.ListSearchTagsForTenant(context.Background(), "tenant-a", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("list search tags: %v", err)
	}
	if len(tags) == 0 {
		t.Fatalf("expected non-empty tags")
	}

	values, err := service.ListSearchTagValuesForTenant(context.Background(), "tenant-a", "model", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("list tag values: %v", err)
	}
	if len(values) != 2 {
		t.Fatalf("expected 2 values, got %d", len(values))
	}

	numericValues, err := service.ListSearchTagValuesForTenant(context.Background(), "tenant-a", "generation_count", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("list generation_count values: %v", err)
	}
	if len(numericValues) != 0 {
		t.Fatalf("expected empty generation_count values, got %#v", numericValues)
	}
	if len(tempoClient.searchTagValuesTags) != 1 {
		t.Fatalf("expected one tempo tag-values call after model and mysql-only lookups, got %d", len(tempoClient.searchTagValuesTags))
	}
	if tempoClient.searchTagValuesTags[0] != "span.gen_ai.request.model" {
		t.Fatalf("expected scoped tempo tag lookup, got %q", tempoClient.searchTagValuesTags[0])
	}

	_, err = service.ListSearchTagValuesForTenant(context.Background(), "tenant-a", "span.", time.Time{}, time.Time{})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error for malformed span tag, got %v", err)
	}
	if len(tempoClient.searchTagValuesTags) != 1 {
		t.Fatalf("expected malformed span tag to be rejected before tempo call, got %d calls", len(tempoClient.searchTagValuesTags))
	}
}

func TestListConversationBatchMetadataForTenant(t *testing.T) {
	base := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  3,
				CreatedAt:        base.Add(-time.Hour),
				LastGenerationAt: base.Add(-5 * time.Minute),
				UpdatedAt:        base.Add(-5 * time.Minute),
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
	items, missing, err := service.ListConversationBatchMetadataForTenant(context.Background(), "tenant-a", []string{"conv-1", "conv-missing"})
	if err != nil {
		t.Fatalf("list batch metadata: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one metadata item, got %d", len(items))
	}
	if len(missing) != 1 || missing[0] != "conv-missing" {
		t.Fatalf("unexpected missing ids: %#v", missing)
	}

	item := items[0]
	if item.ConversationID != "conv-1" {
		t.Fatalf("unexpected conversation id: %q", item.ConversationID)
	}
	if item.GenerationCount != 3 {
		t.Fatalf("unexpected generation count: %d", item.GenerationCount)
	}
	if item.AnnotationCount != 1 {
		t.Fatalf("unexpected annotation count: %d", item.AnnotationCount)
	}
	if item.RatingSummary == nil || !item.RatingSummary.HasBadRating {
		t.Fatalf("expected bad rating summary, got %#v", item.RatingSummary)
	}
	if conversationStore.getConversationsCalls != 1 {
		t.Fatalf("expected one batch conversation lookup, got %d", conversationStore.getConversationsCalls)
	}
	if conversationStore.getConversationCalls != 0 {
		t.Fatalf("expected no per-id conversation lookups, got %d", conversationStore.getConversationCalls)
	}
}

type stubTempoClient struct {
	searchResponses     []*TempoSearchResponse
	searchRequests      []TempoSearchRequest
	searchCalls         int
	tagsByScope         map[string][]string
	tagValues           map[string][]string
	searchTagValuesTags []string
}

func (s *stubTempoClient) Search(_ context.Context, request TempoSearchRequest) (*TempoSearchResponse, error) {
	s.searchRequests = append(s.searchRequests, request)
	if len(s.searchResponses) == 0 {
		return &TempoSearchResponse{Traces: []TempoTrace{}}, nil
	}
	idx := s.searchCalls
	if idx >= len(s.searchResponses) {
		idx = len(s.searchResponses) - 1
	}
	s.searchCalls++
	return s.searchResponses[idx], nil
}

func (s *stubTempoClient) SearchTags(_ context.Context, _ string, scope string, _ time.Time, _ time.Time) ([]string, error) {
	if s.tagsByScope == nil {
		return []string{}, nil
	}
	return s.tagsByScope[scope], nil
}

func (s *stubTempoClient) SearchTagValues(_ context.Context, _ string, tag string, _ time.Time, _ time.Time) ([]string, error) {
	s.searchTagValuesTags = append(s.searchTagValuesTags, tag)
	if s.tagValues == nil {
		return []string{}, nil
	}
	return s.tagValues[tag], nil
}

type stubConversationStore struct {
	items                 map[string]storage.Conversation
	getConversationCalls  int
	getConversationsCalls int
}

func (s *stubConversationStore) ListConversations(_ context.Context, tenantID string) ([]storage.Conversation, error) {
	out := make([]storage.Conversation, 0, len(s.items))
	for _, item := range s.items {
		if item.TenantID != tenantID {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *stubConversationStore) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	s.getConversationCalls++
	item, ok := s.items[conversationID]
	if !ok {
		return nil, nil
	}
	if item.TenantID != tenantID {
		return nil, nil
	}
	copy := item
	return &copy, nil
}

func (s *stubConversationStore) GetConversations(_ context.Context, tenantID string, conversationIDs []string) ([]storage.Conversation, error) {
	s.getConversationsCalls++
	out := make([]storage.Conversation, 0, len(conversationIDs))
	for _, id := range conversationIDs {
		item, ok := s.items[id]
		if !ok || item.TenantID != tenantID {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

type stubWALReader struct {
	byID                     map[string]*sigilv1.Generation
	byConversation           map[string][]*sigilv1.Generation
	byIDByTenant             map[string]map[string]*sigilv1.Generation
	byConversationByTenant   map[string]map[string][]*sigilv1.Generation
	requestedGenerationIDs   []string
	requestedConversationIDs []string
	requestedTenants         []string
}

func (s *stubWALReader) GetByID(_ context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	s.requestedTenants = append(s.requestedTenants, tenantID)
	s.requestedGenerationIDs = append(s.requestedGenerationIDs, generationID)
	if s.byIDByTenant != nil {
		tenantItems, ok := s.byIDByTenant[tenantID]
		if !ok {
			return nil, nil
		}
		return tenantItems[generationID], nil
	}
	if s.byID == nil {
		return nil, nil
	}
	return s.byID[generationID], nil
}

func (s *stubWALReader) GetByConversationID(_ context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	s.requestedTenants = append(s.requestedTenants, tenantID)
	s.requestedConversationIDs = append(s.requestedConversationIDs, conversationID)
	if s.byConversationByTenant != nil {
		tenantItems, ok := s.byConversationByTenant[tenantID]
		if !ok {
			return []*sigilv1.Generation{}, nil
		}
		return tenantItems[conversationID], nil
	}
	if s.byConversation == nil {
		return []*sigilv1.Generation{}, nil
	}
	return s.byConversation[conversationID], nil
}

type stubBlockMetadataStore struct {
	blocks         []storage.BlockMeta
	blocksByTenant map[string][]storage.BlockMeta
}

func (s *stubBlockMetadataStore) InsertBlock(_ context.Context, _ storage.BlockMeta) error {
	return errors.New("not implemented")
}

func (s *stubBlockMetadataStore) ListBlocks(_ context.Context, tenantID string, _, _ time.Time) ([]storage.BlockMeta, error) {
	if s.blocksByTenant != nil {
		return append([]storage.BlockMeta(nil), s.blocksByTenant[tenantID]...), nil
	}
	out := make([]storage.BlockMeta, 0, len(s.blocks))
	for _, block := range s.blocks {
		if strings.TrimSpace(block.TenantID) != "" && block.TenantID != tenantID {
			continue
		}
		out = append(out, block)
	}
	return out, nil
}

type boundedRangeBlockMetadataStore struct {
	blocks []storage.BlockMeta
}

func (s *boundedRangeBlockMetadataStore) InsertBlock(_ context.Context, _ storage.BlockMeta) error {
	return errors.New("not implemented")
}

func (s *boundedRangeBlockMetadataStore) ListBlocks(_ context.Context, tenantID string, from, to time.Time) ([]storage.BlockMeta, error) {
	out := make([]storage.BlockMeta, 0, len(s.blocks))
	for _, block := range s.blocks {
		if strings.TrimSpace(block.TenantID) != "" && block.TenantID != tenantID {
			continue
		}
		if !from.IsZero() && block.MaxTime.Before(from.UTC()) {
			continue
		}
		if !to.IsZero() && block.MinTime.After(to.UTC()) {
			continue
		}
		out = append(out, block)
	}
	return out, nil
}

type stubBlockReader struct {
	indexes                     map[string]*storage.BlockIndex
	indexesByTenant             map[string]map[string]*storage.BlockIndex
	generationsByOffset         map[string]map[int64]*sigilv1.Generation
	generationsByOffsetByTenant map[string]map[string]map[int64]*sigilv1.Generation
}

func (s *stubBlockReader) ReadIndex(_ context.Context, tenantID, blockID string) (*storage.BlockIndex, error) {
	if s.indexesByTenant != nil {
		tenantIndexes, ok := s.indexesByTenant[tenantID]
		if !ok {
			return nil, errors.New("missing tenant indexes")
		}
		index, ok := tenantIndexes[blockID]
		if !ok {
			return nil, errors.New("missing index")
		}
		return index, nil
	}
	index, ok := s.indexes[blockID]
	if !ok {
		return nil, errors.New("missing index")
	}
	return index, nil
}

func (s *stubBlockReader) ReadGenerations(_ context.Context, tenantID, blockID string, entries []storage.IndexEntry) ([]*sigilv1.Generation, error) {
	var (
		byOffset map[int64]*sigilv1.Generation
		ok       bool
	)
	if s.generationsByOffsetByTenant != nil {
		tenantGenerations, tenantOK := s.generationsByOffsetByTenant[tenantID]
		if !tenantOK {
			return nil, errors.New("missing tenant generations")
		}
		byOffset, ok = tenantGenerations[blockID]
	} else {
		byOffset, ok = s.generationsByOffset[blockID]
	}
	if !ok {
		return nil, errors.New("missing block generations")
	}
	out := make([]*sigilv1.Generation, 0, len(entries))
	for _, entry := range entries {
		generation, ok := byOffset[entry.Offset]
		if !ok {
			continue
		}
		out = append(out, generation)
	}
	return out, nil
}

type stubAnnotationEventStore struct {
	pages   [][]feedback.ConversationAnnotation
	calls   int
	limits  []int
	cursors []uint64
}

func (s *stubAnnotationEventStore) ListConversationAnnotations(_ context.Context, _ string, _ string, limit int, cursor uint64) ([]feedback.ConversationAnnotation, uint64, error) {
	s.calls++
	s.limits = append(s.limits, limit)
	s.cursors = append(s.cursors, cursor)

	page := int(cursor)
	if page >= len(s.pages) {
		return []feedback.ConversationAnnotation{}, 0, nil
	}

	batch := append([]feedback.ConversationAnnotation(nil), s.pages[page]...)
	var nextCursor uint64
	if page+1 < len(s.pages) {
		nextCursor = uint64(page + 1)
	}
	return batch, nextCursor, nil
}

func newTempoTrace(traceID string, start time.Time, conversationID string, generationID string, model string, agent string, errorType string) TempoTrace {
	attributes := []TempoAttribute{
		{Key: "gen_ai.conversation.id", Value: tempoStringValue(conversationID)},
		{Key: "sigil.generation.id", Value: tempoStringValue(generationID)},
		{Key: "gen_ai.request.model", Value: tempoStringValue(model)},
		{Key: "gen_ai.agent.name", Value: tempoStringValue(agent)},
	}
	if strings.TrimSpace(errorType) != "" {
		attributes = append(attributes, TempoAttribute{Key: "error.type", Value: tempoStringValue(errorType)})
	}
	return TempoTrace{
		TraceID:           traceID,
		StartTimeUnixNano: strconv.FormatInt(start.UnixNano(), 10),
		SpanSets: []TempoSpanSet{{
			Spans: []TempoSpan{{
				SpanID:            "span-1",
				StartTimeUnixNano: strconv.FormatInt(start.UnixNano(), 10),
				DurationNanos:     strconv.FormatInt((time.Second).Nanoseconds(), 10),
				Attributes:        attributes,
			}},
		}},
	}
}

func testGenerationPayload(generationID string, conversationID string, completedAt time.Time) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             generationID,
		ConversationId: conversationID,
		TraceId:        "trace-" + generationID,
		SpanId:         "span-" + generationID,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
		CompletedAt:    timestamppb.New(completedAt),
		AgentName:      "assistant",
	}
}

func buildIndexedBlock(t *testing.T, generations []*sigilv1.Generation) (string, *storage.BlockIndex, map[int64]*sigilv1.Generation) {
	t.Helper()
	records := make([]storage.GenerationRecord, 0, len(generations))
	for _, generation := range generations {
		payload, err := proto.Marshal(generation)
		if err != nil {
			t.Fatalf("marshal generation: %v", err)
		}
		records = append(records, storage.GenerationRecord{
			GenerationID:   generation.GetId(),
			ConversationID: generation.GetConversationId(),
			CreatedAt:      generationTimestamp(generation),
			Payload:        payload,
		})
	}
	_, _, index, err := object.EncodeBlock(&storage.Block{ID: "block-test", Generations: records})
	if err != nil {
		t.Fatalf("encode block: %v", err)
	}
	sortedGenerations := append([]*sigilv1.Generation(nil), generations...)
	sort.SliceStable(sortedGenerations, func(i, j int) bool {
		left := generationTimestamp(sortedGenerations[i])
		right := generationTimestamp(sortedGenerations[j])
		if left.Equal(right) {
			return sortedGenerations[i].GetId() < sortedGenerations[j].GetId()
		}
		return left.Before(right)
	})
	byOffset := make(map[int64]*sigilv1.Generation, len(index.Entries))
	for i, entry := range index.Entries {
		byOffset[entry.Offset] = sortedGenerations[i]
	}
	return "block-test", index, byOffset
}
