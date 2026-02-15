package feedback

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

type MemoryStore struct {
	mu sync.RWMutex

	ratingsByTenantConversation       map[string][]ConversationRating
	ratingsByTenantAndRatingID        map[string]ConversationRating
	ratingSummaryByTenantConversation map[string]ConversationRatingSummary

	annotationsByTenantConversation       map[string][]ConversationAnnotation
	annotationsByTenantAndAnnotationID    map[string]ConversationAnnotation
	annotationSummaryByTenantConversation map[string]ConversationAnnotationSummary
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		ratingsByTenantConversation:           map[string][]ConversationRating{},
		ratingsByTenantAndRatingID:            map[string]ConversationRating{},
		ratingSummaryByTenantConversation:     map[string]ConversationRatingSummary{},
		annotationsByTenantConversation:       map[string][]ConversationAnnotation{},
		annotationsByTenantAndAnnotationID:    map[string]ConversationAnnotation{},
		annotationSummaryByTenantConversation: map[string]ConversationAnnotationSummary{},
	}
}

func (s *MemoryStore) CreateConversationRating(_ context.Context, tenantID, conversationID string, input CreateConversationRatingInput) (*ConversationRating, *ConversationRatingSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tenantRatingKey := tenantID + "::" + input.RatingID
	if existing, ok := s.ratingsByTenantAndRatingID[tenantRatingKey]; ok {
		if !sameRatingPayload(existing, conversationID, input) {
			return nil, nil, ErrConflict
		}
		summary := s.ratingSummaryByTenantConversation[tenantID+"::"+conversationID]
		cloned := cloneRating(existing)
		clonedSummary := cloneRatingSummary(summary)
		return &cloned, &clonedSummary, nil
	}

	createdAt := time.Now().UTC()
	rating := ConversationRating{
		RatingID:       input.RatingID,
		ConversationID: conversationID,
		GenerationID:   input.GenerationID,
		Rating:         input.Rating,
		Comment:        input.Comment,
		Metadata:       cloneAnyMap(input.Metadata),
		RaterID:        input.RaterID,
		Source:         input.Source,
		CreatedAt:      createdAt,
	}

	convKey := tenantID + "::" + conversationID
	s.ratingsByTenantConversation[convKey] = append([]ConversationRating{rating}, s.ratingsByTenantConversation[convKey]...)
	s.ratingsByTenantAndRatingID[tenantRatingKey] = rating

	summary := s.ratingSummaryByTenantConversation[convKey]
	summary.TotalCount++
	if input.Rating == RatingValueGood {
		summary.GoodCount++
	} else {
		summary.BadCount++
		summary.HasBadRating = true
		summary.LatestBadAt = createdAt
	}
	summary.LatestRating = input.Rating
	summary.LatestRatedAt = createdAt
	s.ratingSummaryByTenantConversation[convKey] = summary

	clonedRating := cloneRating(rating)
	clonedSummary := cloneRatingSummary(summary)
	return &clonedRating, &clonedSummary, nil
}

func (s *MemoryStore) ListConversationRatings(_ context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationRating, uint64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	convKey := tenantID + "::" + conversationID
	rows := s.ratingsByTenantConversation[convKey]
	if len(rows) == 0 {
		return nil, 0, nil
	}

	start := int(cursor)

	if start >= len(rows) {
		return nil, 0, nil
	}
	end := start + limit
	if end > len(rows) {
		end = len(rows)
	}
	selected := make([]ConversationRating, 0, end-start)
	for _, row := range rows[start:end] {
		selected = append(selected, cloneRating(row))
	}

	var nextCursor uint64
	if end < len(rows) {
		nextCursor = uint64(end)
	}
	return selected, nextCursor, nil
}

func (s *MemoryStore) GetConversationRatingSummary(_ context.Context, tenantID, conversationID string) (*ConversationRatingSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	summary, ok := s.ratingSummaryByTenantConversation[tenantID+"::"+conversationID]
	if !ok {
		return nil, nil
	}
	cloned := cloneRatingSummary(summary)
	return &cloned, nil
}

func (s *MemoryStore) ListConversationRatingSummaries(_ context.Context, tenantID string, conversationIDs []string) (map[string]ConversationRatingSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string]ConversationRatingSummary, len(conversationIDs))
	seen := make(map[string]struct{}, len(conversationIDs))
	for _, conversationID := range conversationIDs {
		trimmedConversationID := strings.TrimSpace(conversationID)
		if trimmedConversationID == "" {
			continue
		}
		if _, ok := seen[trimmedConversationID]; ok {
			continue
		}
		seen[trimmedConversationID] = struct{}{}
		summary, ok := s.ratingSummaryByTenantConversation[tenantID+"::"+trimmedConversationID]
		if !ok {
			continue
		}
		out[trimmedConversationID] = cloneRatingSummary(summary)
	}
	return out, nil
}

func (s *MemoryStore) CreateConversationAnnotation(_ context.Context, tenantID, conversationID string, operator OperatorIdentity, input CreateConversationAnnotationInput) (*ConversationAnnotation, *ConversationAnnotationSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tenantAnnotationKey := tenantID + "::" + input.AnnotationID
	if existing, ok := s.annotationsByTenantAndAnnotationID[tenantAnnotationKey]; ok {
		if !sameAnnotationPayload(existing, conversationID, operator, input) {
			return nil, nil, ErrConflict
		}
		summary := s.annotationSummaryByTenantConversation[tenantID+"::"+conversationID]
		cloned := cloneAnnotation(existing)
		clonedSummary := cloneAnnotationSummary(summary)
		return &cloned, &clonedSummary, nil
	}

	createdAt := time.Now().UTC()
	annotation := ConversationAnnotation{
		AnnotationID:   input.AnnotationID,
		ConversationID: conversationID,
		GenerationID:   input.GenerationID,
		AnnotationType: input.AnnotationType,
		Body:           input.Body,
		Tags:           cloneStringMap(input.Tags),
		Metadata:       cloneAnyMap(input.Metadata),
		OperatorID:     operator.OperatorID,
		OperatorLogin:  operator.OperatorLogin,
		OperatorName:   operator.OperatorName,
		CreatedAt:      createdAt,
	}

	convKey := tenantID + "::" + conversationID
	s.annotationsByTenantConversation[convKey] = append([]ConversationAnnotation{annotation}, s.annotationsByTenantConversation[convKey]...)
	s.annotationsByTenantAndAnnotationID[tenantAnnotationKey] = annotation

	summary := s.annotationSummaryByTenantConversation[convKey]
	summary.AnnotationCount++
	summary.LatestAnnotationType = annotation.AnnotationType
	summary.LatestAnnotatedAt = createdAt
	s.annotationSummaryByTenantConversation[convKey] = summary

	cloned := cloneAnnotation(annotation)
	clonedSummary := cloneAnnotationSummary(summary)
	return &cloned, &clonedSummary, nil
}

func (s *MemoryStore) ListConversationAnnotations(_ context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationAnnotation, uint64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	convKey := tenantID + "::" + conversationID
	rows := s.annotationsByTenantConversation[convKey]
	if len(rows) == 0 {
		return nil, 0, nil
	}

	start := int(cursor)

	if start >= len(rows) {
		return nil, 0, nil
	}
	end := start + limit
	if end > len(rows) {
		end = len(rows)
	}
	selected := make([]ConversationAnnotation, 0, end-start)
	for _, row := range rows[start:end] {
		selected = append(selected, cloneAnnotation(row))
	}

	var nextCursor uint64
	if end < len(rows) {
		nextCursor = uint64(end)
	}
	return selected, nextCursor, nil
}

func (s *MemoryStore) GetConversationAnnotationSummary(_ context.Context, tenantID, conversationID string) (*ConversationAnnotationSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	summary, ok := s.annotationSummaryByTenantConversation[tenantID+"::"+conversationID]
	if !ok {
		return nil, nil
	}
	cloned := cloneAnnotationSummary(summary)
	return &cloned, nil
}

func (s *MemoryStore) ListConversationAnnotationSummaries(_ context.Context, tenantID string, conversationIDs []string) (map[string]ConversationAnnotationSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string]ConversationAnnotationSummary, len(conversationIDs))
	seen := make(map[string]struct{}, len(conversationIDs))
	for _, conversationID := range conversationIDs {
		trimmedConversationID := strings.TrimSpace(conversationID)
		if trimmedConversationID == "" {
			continue
		}
		if _, ok := seen[trimmedConversationID]; ok {
			continue
		}
		seen[trimmedConversationID] = struct{}{}
		summary, ok := s.annotationSummaryByTenantConversation[tenantID+"::"+trimmedConversationID]
		if !ok {
			continue
		}
		out[trimmedConversationID] = cloneAnnotationSummary(summary)
	}
	return out, nil
}

func sameRatingPayload(existing ConversationRating, conversationID string, input CreateConversationRatingInput) bool {
	return existing.ConversationID == conversationID &&
		existing.GenerationID == input.GenerationID &&
		existing.Rating == input.Rating &&
		existing.Comment == input.Comment &&
		existing.RaterID == input.RaterID &&
		existing.Source == input.Source &&
		sameJSON(existing.Metadata, input.Metadata)
}

func sameAnnotationPayload(existing ConversationAnnotation, conversationID string, operator OperatorIdentity, input CreateConversationAnnotationInput) bool {
	return existing.ConversationID == conversationID &&
		existing.GenerationID == input.GenerationID &&
		existing.AnnotationType == input.AnnotationType &&
		existing.Body == input.Body &&
		existing.OperatorID == operator.OperatorID &&
		existing.OperatorLogin == operator.OperatorLogin &&
		existing.OperatorName == operator.OperatorName &&
		sameJSON(existing.Metadata, input.Metadata) &&
		sameJSON(existing.Tags, input.Tags)
}

func cloneRating(in ConversationRating) ConversationRating {
	return ConversationRating{
		RatingID:       in.RatingID,
		ConversationID: in.ConversationID,
		GenerationID:   in.GenerationID,
		Rating:         in.Rating,
		Comment:        in.Comment,
		Metadata:       cloneAnyMap(in.Metadata),
		RaterID:        in.RaterID,
		Source:         in.Source,
		CreatedAt:      in.CreatedAt,
	}
}

func cloneRatingSummary(in ConversationRatingSummary) ConversationRatingSummary {
	return in
}

func cloneAnnotation(in ConversationAnnotation) ConversationAnnotation {
	return ConversationAnnotation{
		AnnotationID:   in.AnnotationID,
		ConversationID: in.ConversationID,
		GenerationID:   in.GenerationID,
		AnnotationType: in.AnnotationType,
		Body:           in.Body,
		Tags:           cloneStringMap(in.Tags),
		Metadata:       cloneAnyMap(in.Metadata),
		OperatorID:     in.OperatorID,
		OperatorLogin:  in.OperatorLogin,
		OperatorName:   in.OperatorName,
		CreatedAt:      in.CreatedAt,
	}
}

func cloneAnnotationSummary(in ConversationAnnotationSummary) ConversationAnnotationSummary {
	return in
}

func cloneAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	payload, err := json.Marshal(in)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil
	}
	return out
}

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func sameJSON(left, right any) bool {
	leftPayload, err := json.Marshal(left)
	if err != nil {
		return false
	}
	rightPayload, err := json.Marshal(right)
	if err != nil {
		return false
	}
	return string(leftPayload) == string(rightPayload)
}
