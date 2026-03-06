package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/promptinsights"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ promptinsights.Store = (*WALStore)(nil)

func (s *WALStore) UpsertPromptInsights(ctx context.Context, tenantID, agentName, effectiveVersion string, insights promptinsights.PromptInsights) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return errors.New("tenant id is required")
	}

	trimmedVersion := strings.TrimSpace(effectiveVersion)
	if trimmedVersion == "" {
		return errors.New("effective version is required")
	}

	strengthsJSON, err := marshalInsights(insights.Strengths)
	if err != nil {
		return fmt.Errorf("marshal strengths: %w", err)
	}
	weaknessesJSON, err := marshalInsights(insights.Weaknesses)
	if err != nil {
		return fmt.Errorf("marshal weaknesses: %w", err)
	}

	now := time.Now().UTC()
	row := AgentPromptInsightsModel{
		TenantID:         trimmedTenantID,
		AgentName:        strings.TrimSpace(agentName),
		EffectiveVersion: trimmedVersion,
		Status:           promptinsights.NormalizeStatus(insights.Status),
		StrengthsJSON:    strengthsJSON,
		WeaknessesJSON:   weaknessesJSON,
		JudgeModel:       strings.TrimSpace(insights.JudgeModel),
		JudgeLatencyMs:   insights.JudgeLatencyMs,
		AnalyzedAt:       now,
	}

	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "tenant_id"},
			{Name: "agent_name"},
			{Name: "effective_version"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			"status":           row.Status,
			"strengths_json":   row.StrengthsJSON,
			"weaknesses_json":  row.WeaknessesJSON,
			"judge_model":      row.JudgeModel,
			"judge_latency_ms": row.JudgeLatencyMs,
			"analyzed_at":      row.AnalyzedAt,
			"updated_at":       now,
		}),
	}).Create(&row).Error; err != nil {
		return fmt.Errorf("upsert agent prompt insights: %w", err)
	}

	return nil
}

func (s *WALStore) GetPromptInsights(ctx context.Context, tenantID, agentName, effectiveVersion string) (*promptinsights.PromptInsights, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, errors.New("tenant id is required")
	}

	trimmedVersion := strings.TrimSpace(effectiveVersion)
	if trimmedVersion == "" {
		return nil, errors.New("effective version is required")
	}

	var row AgentPromptInsightsModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", trimmedTenantID, strings.TrimSpace(agentName), trimmedVersion).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get agent prompt insights: %w", err)
	}

	strengths, err := parseInsights(row.StrengthsJSON)
	if err != nil {
		return nil, fmt.Errorf("decode strengths: %w", err)
	}
	weaknesses, err := parseInsights(row.WeaknessesJSON)
	if err != nil {
		return nil, fmt.Errorf("decode weaknesses: %w", err)
	}

	return &promptinsights.PromptInsights{
		Status:         promptinsights.NormalizeStatus(row.Status),
		Strengths:      strengths,
		Weaknesses:     weaknesses,
		JudgeModel:     row.JudgeModel,
		JudgeLatencyMs: row.JudgeLatencyMs,
	}, nil
}

func marshalInsights(insights []promptinsights.Insight) (string, error) {
	if len(insights) == 0 {
		return "[]", nil
	}
	payload, err := json.Marshal(insights)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func parseInsights(raw string) ([]promptinsights.Insight, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return []promptinsights.Insight{}, nil
	}
	var insights []promptinsights.Insight
	if err := json.Unmarshal([]byte(trimmed), &insights); err != nil {
		return nil, err
	}
	if insights == nil {
		return []promptinsights.Insight{}, nil
	}
	return insights, nil
}
