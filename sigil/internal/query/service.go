package query

import (
	"context"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/storage"
)

type Conversation struct {
	ID                string                                  `json:"id"`
	Title             string                                  `json:"title,omitempty"`
	LastGenerationAt  time.Time                               `json:"last_generation_at"`
	GenerationCount   int                                     `json:"generation_count"`
	CreatedAt         time.Time                               `json:"created_at"`
	UpdatedAt         time.Time                               `json:"updated_at"`
	RatingSummary     *feedback.ConversationRatingSummary     `json:"rating_summary,omitempty"`
	AnnotationSummary *feedback.ConversationAnnotationSummary `json:"annotation_summary,omitempty"`
}

type ConversationListFilter struct {
	HasBadRating   *bool
	HasAnnotations *bool
}

type Completion struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	Model          string    `json:"model"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Trace struct {
	ID            string   `json:"id"`
	GenerationIDs []string `json:"generationIds"`
}

type ratingSummaryStore interface {
	GetConversationRatingSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationRatingSummary, error)
	ListConversationRatingSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationRatingSummary, error)
}

type annotationSummaryStore interface {
	GetConversationAnnotationSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationAnnotationSummary, error)
	ListConversationAnnotationSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationAnnotationSummary, error)
}

type filteredConversationStore interface {
	ListConversationsWithFeedbackFilters(ctx context.Context, tenantID string, hasBadRating, hasAnnotations *bool) ([]storage.Conversation, error)
}

type Service struct {
	conversationStore      storage.ConversationStore
	ratingSummaryStore     ratingSummaryStore
	annotationSummaryStore annotationSummaryStore
	nowFn                  func() time.Time
}

func NewService() *Service {
	return &Service{
		nowFn: time.Now,
	}
}

func NewServiceWithStores(conversationStore storage.ConversationStore, feedbackStore feedback.Store) *Service {
	service := NewService()
	service.conversationStore = conversationStore
	if store, ok := feedbackStore.(ratingSummaryStore); ok {
		service.ratingSummaryStore = store
	}
	if store, ok := feedbackStore.(annotationSummaryStore); ok {
		service.annotationSummaryStore = store
	}
	return service
}

func (s *Service) ListConversationsForTenant(ctx context.Context, tenantID string, filter ConversationListFilter) ([]Conversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if s.conversationStore == nil || trimmedTenantID == "" {
		return s.bootstrapConversations(), nil
	}

	var (
		rows       []storage.Conversation
		err        error
		filteredDB bool
	)
	if filteredStore, ok := s.conversationStore.(filteredConversationStore); ok {
		rows, err = filteredStore.ListConversationsWithFeedbackFilters(ctx, trimmedTenantID, filter.HasBadRating, filter.HasAnnotations)
		filteredDB = true
	} else {
		rows, err = s.conversationStore.ListConversations(ctx, trimmedTenantID)
	}
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []Conversation{}, nil
	}

	conversationIDs := make([]string, 0, len(rows))
	items := make([]Conversation, 0, len(rows))
	for _, row := range rows {
		items = append(items, toConversation(row))
		conversationIDs = append(conversationIDs, row.ConversationID)
	}

	if s.ratingSummaryStore != nil {
		ratingSummaries, err := s.ratingSummaryStore.ListConversationRatingSummaries(ctx, trimmedTenantID, conversationIDs)
		if err != nil {
			return nil, err
		}
		for idx := range items {
			summary, ok := ratingSummaries[items[idx].ID]
			if !ok {
				continue
			}
			copied := summary
			items[idx].RatingSummary = &copied
		}
	}

	if s.annotationSummaryStore != nil {
		annotationSummaries, err := s.annotationSummaryStore.ListConversationAnnotationSummaries(ctx, trimmedTenantID, conversationIDs)
		if err != nil {
			return nil, err
		}
		for idx := range items {
			summary, ok := annotationSummaries[items[idx].ID]
			if !ok {
				continue
			}
			copied := summary
			items[idx].AnnotationSummary = &copied
		}
	}

	if !filteredDB && (filter.HasBadRating != nil || filter.HasAnnotations != nil) {
		filtered := make([]Conversation, 0, len(items))
		for _, item := range items {
			if !matchesConversationFilter(item, filter) {
				continue
			}
			filtered = append(filtered, item)
		}
		return filtered, nil
	}

	return items, nil
}

func (s *Service) GetConversationForTenant(ctx context.Context, tenantID, id string) (Conversation, bool, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(id)
	if trimmedConversationID == "" {
		return Conversation{}, false, nil
	}
	if s.conversationStore == nil || trimmedTenantID == "" {
		return s.bootstrapConversation(trimmedConversationID), true, nil
	}

	row, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return Conversation{}, false, err
	}
	if row == nil {
		return Conversation{}, false, nil
	}

	out := toConversation(*row)
	if s.ratingSummaryStore != nil {
		summary, err := s.ratingSummaryStore.GetConversationRatingSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			return Conversation{}, false, err
		}
		if summary != nil {
			copied := *summary
			out.RatingSummary = &copied
		}
	}
	if s.annotationSummaryStore != nil {
		summary, err := s.annotationSummaryStore.GetConversationAnnotationSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			return Conversation{}, false, err
		}
		if summary != nil {
			copied := *summary
			out.AnnotationSummary = &copied
		}
	}

	return out, true, nil
}

func (s *Service) ListConversations() []Conversation {
	items, err := s.ListConversationsForTenant(context.Background(), "", ConversationListFilter{})
	if err != nil {
		return s.bootstrapConversations()
	}
	return items
}

func (s *Service) GetConversation(id string) Conversation {
	item, found, err := s.GetConversationForTenant(context.Background(), "", id)
	if err != nil || !found {
		return s.bootstrapConversation(id)
	}
	return item
}

func (s *Service) ListCompletions() []Completion {
	return []Completion{{
		ID:             "cmp-bootstrap",
		ConversationID: "c-bootstrap",
		Model:          "placeholder-model",
		CreatedAt:      s.now().UTC(),
	}}
}

func (s *Service) GetTrace(id string) Trace {
	return Trace{ID: id, GenerationIDs: []string{"gen-bootstrap"}}
}

func (s *Service) bootstrapConversations() []Conversation {
	return []Conversation{s.bootstrapConversation("c-bootstrap")}
}

func (s *Service) bootstrapConversation(id string) Conversation {
	now := s.now().UTC()
	return Conversation{
		ID:               id,
		Title:            "Sigil bootstrap conversation",
		LastGenerationAt: now,
		GenerationCount:  0,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
}

func (s *Service) now() time.Time {
	if s != nil && s.nowFn != nil {
		return s.nowFn()
	}
	return time.Now()
}

func toConversation(row storage.Conversation) Conversation {
	return Conversation{
		ID:               row.ConversationID,
		Title:            row.ConversationID,
		LastGenerationAt: row.LastGenerationAt.UTC(),
		GenerationCount:  row.GenerationCount,
		CreatedAt:        row.CreatedAt.UTC(),
		UpdatedAt:        row.UpdatedAt.UTC(),
	}
}

func matchesConversationFilter(item Conversation, filter ConversationListFilter) bool {
	if filter.HasBadRating != nil {
		hasBad := item.RatingSummary != nil && item.RatingSummary.HasBadRating
		if hasBad != *filter.HasBadRating {
			return false
		}
	}
	if filter.HasAnnotations != nil {
		hasAnnotations := item.AnnotationSummary != nil && item.AnnotationSummary.AnnotationCount > 0
		if hasAnnotations != *filter.HasAnnotations {
			return false
		}
	}
	return true
}
