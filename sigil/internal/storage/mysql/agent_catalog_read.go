package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/grafana/sigil/sigil/internal/storage"
	"gorm.io/gorm"
)

var _ storage.AgentCatalogStore = (*WALStore)(nil)

func (s *WALStore) ListAgentHeads(ctx context.Context, tenantID string, limit int, cursor *storage.AgentHeadCursor, namePrefix string) ([]storage.AgentHead, *storage.AgentHeadCursor, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	query := s.db.WithContext(ctx).Model(&AgentHeadModel{}).Where("tenant_id = ?", tenantID)
	trimmedPrefix := strings.TrimSpace(namePrefix)
	if trimmedPrefix != "" {
		escaped := strings.ToLower(escapeLikePattern(trimmedPrefix))
		query = query.Where("LOWER(agent_name) LIKE ?", "%"+escaped+"%")
	}
	if cursor != nil && !cursor.LatestSeenAt.IsZero() {
		query = query.Where(
			"(latest_seen_at < ?) OR (latest_seen_at = ? AND agent_name > ?) OR (latest_seen_at = ? AND agent_name = ? AND id > ?)",
			cursor.LatestSeenAt.UTC(),
			cursor.LatestSeenAt.UTC(),
			cursor.AgentName,
			cursor.LatestSeenAt.UTC(),
			cursor.AgentName,
			cursor.ID,
		)
	}

	var rows []AgentHeadModel
	if err := query.
		Order("latest_seen_at DESC").
		Order("agent_name ASC").
		Order("id ASC").
		Limit(limit + 1).
		Find(&rows).Error; err != nil {
		return nil, nil, fmt.Errorf("list agent heads: %w", err)
	}

	var nextCursor *storage.AgentHeadCursor
	if len(rows) > limit {
		last := rows[limit-1]
		nextCursor = &storage.AgentHeadCursor{
			LatestSeenAt: last.LatestSeenAt.UTC(),
			AgentName:    last.AgentName,
			ID:           last.ID,
		}
		rows = rows[:limit]
	}

	items := make([]storage.AgentHead, 0, len(rows))
	for _, row := range rows {
		items = append(items, storage.AgentHead{
			ID:                              row.ID,
			TenantID:                        row.TenantID,
			AgentName:                       row.AgentName,
			LatestEffectiveVersion:          row.LatestEffectiveVersion,
			LatestDeclaredVersion:           stringPtrValue(row.LatestDeclaredVersion),
			LatestSeenAt:                    row.LatestSeenAt.UTC(),
			FirstSeenAt:                     row.FirstSeenAt.UTC(),
			GenerationCount:                 row.GenerationCount,
			VersionCount:                    row.VersionCount,
			LatestToolCount:                 row.LatestToolCount,
			LatestSystemPromptPrefix:        row.LatestSystemPromptPrefix,
			LatestTokenEstimateSystemPrompt: row.LatestTokenEstimateSystemPrompt,
			LatestTokenEstimateToolsTotal:   row.LatestTokenEstimateToolsTotal,
			LatestTokenEstimateTotal:        row.LatestTokenEstimateTotal,
		})
	}
	return items, nextCursor, nil
}

func (s *WALStore) GetAgentVersion(ctx context.Context, tenantID, agentName, effectiveVersion string) (*storage.AgentVersion, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	var row AgentVersionModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", tenantID, agentName, effectiveVersion).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get agent version: %w", err)
	}
	return toStorageAgentVersion(row), nil
}

func (s *WALStore) GetLatestAgentVersion(ctx context.Context, tenantID, agentName string) (*storage.AgentVersion, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	var row AgentVersionModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND agent_name = ?", tenantID, agentName).
		Order("last_seen_at DESC").
		Order("id DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get latest agent version: %w", err)
	}
	return toStorageAgentVersion(row), nil
}

func (s *WALStore) ListAgentVersions(ctx context.Context, tenantID, agentName string, limit int, cursor *storage.AgentVersionCursor) ([]storage.AgentVersionSummary, *storage.AgentVersionCursor, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	query := s.db.WithContext(ctx).Model(&AgentVersionModel{}).Where("tenant_id = ? AND agent_name = ?", tenantID, agentName)
	if cursor != nil && !cursor.LastSeenAt.IsZero() {
		query = query.Where(
			"(last_seen_at < ?) OR (last_seen_at = ? AND id < ?)",
			cursor.LastSeenAt.UTC(),
			cursor.LastSeenAt.UTC(),
			cursor.ID,
		)
	}

	var rows []AgentVersionModel
	if err := query.
		Order("last_seen_at DESC").
		Order("id DESC").
		Limit(limit + 1).
		Find(&rows).Error; err != nil {
		return nil, nil, fmt.Errorf("list agent versions: %w", err)
	}

	var nextCursor *storage.AgentVersionCursor
	if len(rows) > limit {
		last := rows[limit-1]
		nextCursor = &storage.AgentVersionCursor{
			LastSeenAt: last.LastSeenAt.UTC(),
			ID:         last.ID,
		}
		rows = rows[:limit]
	}

	items := make([]storage.AgentVersionSummary, 0, len(rows))
	for _, row := range rows {
		items = append(items, storage.AgentVersionSummary{
			ID:                        row.ID,
			TenantID:                  row.TenantID,
			AgentName:                 row.AgentName,
			EffectiveVersion:          row.EffectiveVersion,
			DeclaredVersionFirst:      stringPtrValue(row.DeclaredVersionFirst),
			DeclaredVersionLatest:     stringPtrValue(row.DeclaredVersionLatest),
			SystemPromptPrefix:        row.SystemPromptPrefix,
			ToolCount:                 row.ToolCount,
			TokenEstimateSystemPrompt: row.TokenEstimateSystemPrompt,
			TokenEstimateToolsTotal:   row.TokenEstimateToolsTotal,
			TokenEstimateTotal:        row.TokenEstimateTotal,
			GenerationCount:           row.GenerationCount,
			FirstSeenAt:               row.FirstSeenAt.UTC(),
			LastSeenAt:                row.LastSeenAt.UTC(),
		})
	}
	return items, nextCursor, nil
}

func (s *WALStore) ListAgentVersionModels(ctx context.Context, tenantID, agentName, effectiveVersion string) ([]storage.AgentVersionModel, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	var rows []AgentVersionModelUsageModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", tenantID, agentName, effectiveVersion).
		Order("generation_count DESC").
		Order("model_provider ASC").
		Order("model_name ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list agent version models: %w", err)
	}

	models := make([]storage.AgentVersionModel, 0, len(rows))
	for _, row := range rows {
		models = append(models, storage.AgentVersionModel{
			ModelProvider:   row.ModelProvider,
			ModelName:       row.ModelName,
			GenerationCount: row.GenerationCount,
			FirstSeenAt:     row.FirstSeenAt.UTC(),
			LastSeenAt:      row.LastSeenAt.UTC(),
		})
	}
	return models, nil
}

func toStorageAgentVersion(row AgentVersionModel) *storage.AgentVersion {
	return &storage.AgentVersion{
		TenantID:                  row.TenantID,
		AgentName:                 row.AgentName,
		EffectiveVersion:          row.EffectiveVersion,
		DeclaredVersionFirst:      stringPtrValue(row.DeclaredVersionFirst),
		DeclaredVersionLatest:     stringPtrValue(row.DeclaredVersionLatest),
		SystemPrompt:              row.SystemPrompt,
		SystemPromptPrefix:        row.SystemPromptPrefix,
		ToolsJSON:                 row.ToolsJSON,
		ToolCount:                 row.ToolCount,
		TokenEstimateSystemPrompt: row.TokenEstimateSystemPrompt,
		TokenEstimateToolsTotal:   row.TokenEstimateToolsTotal,
		TokenEstimateTotal:        row.TokenEstimateTotal,
		GenerationCount:           row.GenerationCount,
		FirstSeenAt:               row.FirstSeenAt.UTC(),
		LastSeenAt:                row.LastSeenAt.UTC(),
	}
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func escapeLikePattern(s string) string {
	return likeEscaper.Replace(s)
}

func stringPtrValue(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
