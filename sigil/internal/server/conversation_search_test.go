package server

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestCanUseConversationProjectionFastPath(t *testing.T) {
	t.Run("allows mysql generation count filters only", func(t *testing.T) {
		parsedFilters, err := query.ParseFilterExpression(`generation_count >= 1`)
		if err != nil {
			t.Fatalf("parse filters: %v", err)
		}
		if !canUseConversationProjectionFastPath(parsedFilters, nil) {
			t.Fatal("expected generation_count-only search to use projection fast path")
		}
	})

	t.Run("rejects tempo metadata filters", func(t *testing.T) {
		parsedFilters, err := query.ParseFilterExpression(`provider = "openai"`)
		if err != nil {
			t.Fatalf("parse filters: %v", err)
		}
		if !canUseConversationProjectionFastPath(parsedFilters, nil) {
			t.Fatal("expected provider filter to use projection fast path")
		}
	})

	t.Run("allows projected token selected fields", func(t *testing.T) {
		selectFields, err := query.NormalizeSelectFields([]string{"span.gen_ai.usage.input_tokens"})
		if err != nil {
			t.Fatalf("normalize select fields: %v", err)
		}
		if !canUseConversationProjectionFastPath(query.ParsedFilters{}, selectFields) {
			t.Fatal("expected token selected fields to use projection fast path")
		}
	})
}

func TestProjectionStringSliceMatchesNotEqualExcludesMixedValues(t *testing.T) {
	term := query.FilterTerm{
		RawKey:   "provider",
		Operator: query.FilterOperatorNotEqual,
		Value:    "openai",
	}
	if projectionStringSliceMatches([]string{"openai", "anthropic"}, term) {
		t.Fatal("expected mixed values containing the excluded provider to fail the != match")
	}
	if !projectionStringSliceMatches([]string{"anthropic"}, term) {
		t.Fatal("expected values without the excluded provider to pass the != match")
	}
}

func TestProjectionStringSliceMatchesEmptyValues(t *testing.T) {
	tests := []struct {
		name     string
		operator query.FilterOperator
		want     bool
	}{
		{name: "equal on empty returns false", operator: query.FilterOperatorEqual, want: false},
		{name: "not_equal on empty returns true", operator: query.FilterOperatorNotEqual, want: true},
		{name: "regex on empty returns false", operator: query.FilterOperatorRegex, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			term := query.FilterTerm{
				RawKey:   "provider",
				Operator: tt.operator,
				Value:    "openai",
			}
			if got := projectionStringSliceMatches(nil, term); got != tt.want {
				t.Fatalf("projectionStringSliceMatches(nil, %v) = %v, want %v", tt.operator, got, tt.want)
			}
			if got := projectionStringSliceMatches([]string{}, term); got != tt.want {
				t.Fatalf("projectionStringSliceMatches([], %v) = %v, want %v", tt.operator, got, tt.want)
			}
		})
	}
}

type stubProjectionStatsConversationStore struct {
	page []storage.ConversationProjectionPageItem
}

func (s *stubProjectionStatsConversationStore) ListConversations(context.Context, string) ([]storage.Conversation, error) {
	return nil, nil
}

func (s *stubProjectionStatsConversationStore) GetConversation(context.Context, string, string) (*storage.Conversation, error) {
	return nil, nil
}

func (s *stubProjectionStatsConversationStore) ListConversationProjectionPage(_ context.Context, _ string, filter storage.ConversationProjectionPageQuery) ([]storage.ConversationProjectionPageItem, bool, error) {
	excluded := make(map[string]struct{}, len(filter.ExcludeConversationIDs))
	for _, conversationID := range filter.ExcludeConversationIDs {
		excluded[conversationID] = struct{}{}
	}

	items := make([]storage.ConversationProjectionPageItem, 0, len(s.page))
	for _, item := range s.page {
		if _, skip := excluded[item.Conversation.ConversationID]; skip {
			continue
		}
		items = append(items, item)
	}

	limit := filter.Limit
	if limit <= 0 || limit > len(items) {
		limit = len(items)
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

func TestSearchConversationStatsUsesProjectionFastPathForBrowseSafeQueries(t *testing.T) {
	base := time.Date(2026, 3, 7, 12, 0, 0, 0, time.UTC)
	store := &stubProjectionStatsConversationStore{
		page: []storage.ConversationProjectionPageItem{
			{
				Conversation: storage.Conversation{
					TenantID:         "tenant-a",
					ConversationID:   "conv-1",
					GenerationCount:  3,
					LastGenerationAt: base.Add(-2 * time.Hour),
					TotalTokens:      120,
				},
				RatingSummary: &feedback.ConversationRatingSummary{
					TotalCount:   1,
					BadCount:     1,
					HasBadRating: true,
				},
			},
			{
				Conversation: storage.Conversation{
					TenantID:         "tenant-a",
					ConversationID:   "conv-2",
					GenerationCount:  1,
					LastGenerationAt: base.Add(-24 * time.Hour),
					TotalTokens:      30,
				},
			},
		},
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: store,
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	stats, err := searchConversationStats(context.Background(), querySvc, "tenant-a", query.ConversationSearchRequest{
		Filters: `generation_count >= 1`,
		TimeRange: query.ConversationSearchTimeRange{
			From: base.Add(-48 * time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversation stats: %v", err)
	}
	if stats.TotalConversations != 2 {
		t.Fatalf("expected 2 conversations, got %d", stats.TotalConversations)
	}
	if stats.TotalTokens != 150 {
		t.Fatalf("expected total tokens 150 from projection fast path, got %f", stats.TotalTokens)
	}
	if stats.AvgCallsPerConversation != 2 {
		t.Fatalf("expected avg calls per conversation 2, got %f", stats.AvgCallsPerConversation)
	}
	if stats.ActiveLast7d != 2 {
		t.Fatalf("expected 2 active conversations, got %d", stats.ActiveLast7d)
	}
	if stats.RatedConversations != 1 {
		t.Fatalf("expected 1 rated conversation, got %d", stats.RatedConversations)
	}
	if stats.BadRatedPct != 100 {
		t.Fatalf("expected bad rated pct 100, got %f", stats.BadRatedPct)
	}
}

func TestRunConversationSearchProjectionCursorDoesNotSkipOverflowConversation(t *testing.T) {
	base := time.Date(2026, 3, 7, 12, 0, 0, 0, time.UTC)
	store := &stubProjectionStatsConversationStore{
		page: []storage.ConversationProjectionPageItem{
			{Conversation: storage.Conversation{TenantID: "tenant-a", ConversationID: "conv-3", GenerationCount: 3, LastGenerationAt: base.Add(-time.Minute)}},
			{Conversation: storage.Conversation{TenantID: "tenant-a", ConversationID: "conv-2", GenerationCount: 2, LastGenerationAt: base.Add(-2 * time.Minute)}},
			{Conversation: storage.Conversation{TenantID: "tenant-a", ConversationID: "conv-1", GenerationCount: 1, LastGenerationAt: base.Add(-3 * time.Minute)}},
		},
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: store,
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	firstPage, err := runConversationSearch(context.Background(), querySvc, "tenant-a", query.ConversationSearchRequest{
		Filters:  `generation_count >= 1`,
		PageSize: 1,
		TimeRange: query.ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	}, nil)
	if err != nil {
		t.Fatalf("first page search: %v", err)
	}
	if len(firstPage.Conversations) != 1 || firstPage.Conversations[0].ConversationID != "conv-3" {
		t.Fatalf("unexpected first page: %#v", firstPage.Conversations)
	}
	if !firstPage.HasMore || firstPage.NextCursor == "" {
		t.Fatalf("expected continuation cursor on first page, got %#v", firstPage)
	}

	secondPage, err := runConversationSearch(context.Background(), querySvc, "tenant-a", query.ConversationSearchRequest{
		Filters:  `generation_count >= 1`,
		PageSize: 1,
		Cursor:   firstPage.NextCursor,
		TimeRange: query.ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	}, nil)
	if err != nil {
		t.Fatalf("second page search: %v", err)
	}
	if len(secondPage.Conversations) != 1 || secondPage.Conversations[0].ConversationID != "conv-2" {
		t.Fatalf("expected second page to return conv-2, got %#v", secondPage.Conversations)
	}
}

func TestRunConversationSearchRejectsInvalidProjectionRegex(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: &stubProjectionStatsConversationStore{},
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	_, err = runConversationSearch(context.Background(), querySvc, "tenant-a", query.ConversationSearchRequest{
		Filters:  `model =~ "["`,
		PageSize: 1,
		TimeRange: query.ConversationSearchTimeRange{
			From: time.Date(2026, 3, 7, 11, 0, 0, 0, time.UTC),
			To:   time.Date(2026, 3, 7, 12, 0, 0, 0, time.UTC),
		},
	}, nil)
	if err == nil {
		t.Fatal("expected validation error for invalid regex")
	}
	if !query.IsValidationError(err) {
		t.Fatalf("expected validation error, got %v", err)
	}
}
