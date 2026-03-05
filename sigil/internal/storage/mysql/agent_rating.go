package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/agentrating"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ agentrating.LatestStore = (*WALStore)(nil)

func (s *WALStore) UpsertAgentVersionRating(ctx context.Context, tenantID, agentName, effectiveVersion string, rating agentrating.Rating) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return errors.New("tenant id is required")
	}

	trimmedVersion := strings.TrimSpace(effectiveVersion)
	if trimmedVersion == "" {
		return errors.New("effective version is required")
	}

	suggestionsJSON, err := marshalAgentRatingSuggestions(rating.Suggestions)
	if err != nil {
		return fmt.Errorf("marshal agent rating suggestions: %w", err)
	}

	now := time.Now().UTC()
	row := AgentVersionRatingModel{
		TenantID:         trimmedTenantID,
		AgentName:        strings.TrimSpace(agentName),
		EffectiveVersion: trimmedVersion,
		Status:           agentrating.NormalizeRatingStatus(rating.Status),
		Score:            rating.Score,
		Summary:          strings.TrimSpace(rating.Summary),
		SuggestionsJSON:  suggestionsJSON,
		TokenWarning:     nonEmptyStringPtr(rating.TokenWarning),
		JudgeModel:       strings.TrimSpace(rating.JudgeModel),
		JudgeLatencyMs:   rating.JudgeLatencyMs,
		RatedAt:          now,
	}

	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "tenant_id"},
			{Name: "agent_name"},
			{Name: "effective_version"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			"status":           row.Status,
			"score":            row.Score,
			"summary":          row.Summary,
			"suggestions_json": row.SuggestionsJSON,
			"token_warning":    row.TokenWarning,
			"judge_model":      row.JudgeModel,
			"judge_latency_ms": row.JudgeLatencyMs,
			"rated_at":         row.RatedAt,
			"updated_at":       now,
		}),
	}).Create(&row).Error; err != nil {
		return fmt.Errorf("upsert agent version rating: %w", err)
	}

	return nil
}

func (s *WALStore) GetAgentVersionRating(ctx context.Context, tenantID, agentName, effectiveVersion string) (*agentrating.Rating, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, errors.New("tenant id is required")
	}

	trimmedVersion := strings.TrimSpace(effectiveVersion)
	if trimmedVersion == "" {
		return nil, errors.New("effective version is required")
	}

	var row AgentVersionRatingModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", trimmedTenantID, strings.TrimSpace(agentName), trimmedVersion).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get agent version rating: %w", err)
	}

	suggestions, err := parseAgentRatingSuggestions(row.SuggestionsJSON)
	if err != nil {
		return nil, fmt.Errorf("decode agent rating suggestions: %w", err)
	}

	rating := agentrating.Rating{
		Status:         agentrating.NormalizeRatingStatus(row.Status),
		Score:          row.Score,
		Summary:        row.Summary,
		Suggestions:    suggestions,
		TokenWarning:   derefOptionalString(row.TokenWarning),
		JudgeModel:     row.JudgeModel,
		JudgeLatencyMs: row.JudgeLatencyMs,
	}
	return &rating, nil
}

func marshalAgentRatingSuggestions(suggestions []agentrating.Suggestion) (string, error) {
	if len(suggestions) == 0 {
		return "[]", nil
	}
	payload, err := json.Marshal(suggestions)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func parseAgentRatingSuggestions(raw string) ([]agentrating.Suggestion, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return []agentrating.Suggestion{}, nil
	}
	var suggestions []agentrating.Suggestion
	if err := json.Unmarshal([]byte(trimmed), &suggestions); err != nil {
		return nil, err
	}
	if suggestions == nil {
		return []agentrating.Suggestion{}, nil
	}
	return suggestions, nil
}

func nonEmptyStringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
