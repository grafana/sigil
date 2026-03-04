package mysql

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/grafana/sigil/sigil/internal/agentmeta"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"gorm.io/gorm"
)

type agentCatalogProjection struct {
	AgentName                 string
	DeclaredVersion           string
	EffectiveVersion          string
	SystemPrompt              string
	SystemPromptPrefix        string
	ToolsJSON                 string
	ToolCount                 int
	TokenEstimateSystemPrompt int
	TokenEstimateToolsTotal   int
	TokenEstimateTotal        int
	ModelProvider             string
	ModelName                 string
	SeenAt                    time.Time
}

const (
	agentCatalogNameMaxLen          = 191
	agentCatalogModelProviderMaxLen = 128
	agentCatalogModelNameMaxLen     = 191
	agentCatalogDeclaredVersionLen  = 255
)

func buildAgentCatalogProjection(createdAt time.Time, generation *sigilv1.Generation) (agentCatalogProjection, error) {
	descriptor, err := agentmeta.BuildDescriptor(generation)
	if err != nil {
		return agentCatalogProjection{}, fmt.Errorf("build agent metadata: %w", err)
	}

	seenAt := createdAt.UTC()
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}

	return agentCatalogProjection{
		AgentName:                 clampRunes(descriptor.AgentName, agentCatalogNameMaxLen),
		DeclaredVersion:           clampRunes(descriptor.DeclaredVersion, agentCatalogDeclaredVersionLen),
		EffectiveVersion:          descriptor.EffectiveVersion,
		SystemPrompt:              descriptor.SystemPrompt,
		SystemPromptPrefix:        descriptor.SystemPromptPrefix,
		ToolsJSON:                 descriptor.ToolsJSON,
		ToolCount:                 descriptor.ToolCount,
		TokenEstimateSystemPrompt: descriptor.TokenEstimateSystemPrompt,
		TokenEstimateToolsTotal:   descriptor.TokenEstimateToolsTotal,
		TokenEstimateTotal:        descriptor.TokenEstimateTotal,
		ModelProvider:             clampRunes(descriptor.ModelProvider, agentCatalogModelProviderMaxLen),
		ModelName:                 clampRunes(descriptor.ModelName, agentCatalogModelNameMaxLen),
		SeenAt:                    seenAt,
	}, nil
}

func upsertAgentCatalogTx(tx *gorm.DB, tenantID string, projection agentCatalogProjection) error {
	declaredLatest, err := upsertAgentVersionTx(tx, tenantID, projection)
	if err != nil {
		return err
	}
	if err := upsertAgentVersionModelUsageTx(tx, tenantID, projection); err != nil {
		return err
	}
	if err := upsertAgentHeadTx(tx, tenantID, projection, declaredLatest); err != nil {
		return err
	}
	return nil
}

func upsertAgentVersionTx(tx *gorm.DB, tenantID string, projection agentCatalogProjection) (*string, error) {
	declaredVersion := strings.TrimSpace(projection.DeclaredVersion)

	for attempt := 0; attempt < 2; attempt++ {
		var existing AgentVersionModel
		err := tx.
			Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", tenantID, projection.AgentName, projection.EffectiveVersion).
			Take(&existing).Error
		if err == nil {
			updateValues := map[string]any{
				"generation_count": gorm.Expr("generation_count + 1"),
				"first_seen_at":    gorm.Expr("LEAST(first_seen_at, ?)", projection.SeenAt),
				"last_seen_at":     gorm.Expr("GREATEST(last_seen_at, ?)", projection.SeenAt),
				"updated_at":       time.Now().UTC(),
			}
			declaredLatest := existing.DeclaredVersionLatest
			if declaredVersion != "" {
				updateValues["declared_version_latest"] = declaredVersion
				updateValues["declared_version_first"] = gorm.Expr("CASE WHEN declared_version_first IS NULL OR declared_version_first = '' THEN ? ELSE declared_version_first END", declaredVersion)
				declaredLatest = stringPtr(declaredVersion)
			}
			if err := tx.Model(&AgentVersionModel{}).
				Where("tenant_id = ? AND agent_name = ? AND effective_version = ?", tenantID, projection.AgentName, projection.EffectiveVersion).
				Updates(updateValues).Error; err != nil {
				return nil, fmt.Errorf("update agent version: %w", err)
			}
			return declaredLatest, nil
		}
		if !isRecordNotFound(err) {
			return nil, fmt.Errorf("load agent version: %w", err)
		}

		row := AgentVersionModel{
			TenantID:                  tenantID,
			AgentName:                 projection.AgentName,
			EffectiveVersion:          projection.EffectiveVersion,
			DeclaredVersionFirst:      stringPtr(declaredVersion),
			DeclaredVersionLatest:     stringPtr(declaredVersion),
			SystemPrompt:              projection.SystemPrompt,
			SystemPromptPrefix:        projection.SystemPromptPrefix,
			ToolsJSON:                 projection.ToolsJSON,
			ToolCount:                 projection.ToolCount,
			TokenEstimateSystemPrompt: projection.TokenEstimateSystemPrompt,
			TokenEstimateToolsTotal:   projection.TokenEstimateToolsTotal,
			TokenEstimateTotal:        projection.TokenEstimateTotal,
			GenerationCount:           1,
			FirstSeenAt:               projection.SeenAt,
			LastSeenAt:                projection.SeenAt,
		}
		if row.DeclaredVersionFirst != nil && strings.TrimSpace(*row.DeclaredVersionFirst) == "" {
			row.DeclaredVersionFirst = nil
			row.DeclaredVersionLatest = nil
		}

		if err := tx.Create(&row).Error; err != nil {
			if isDuplicateKeyError(err) {
				continue
			}
			return nil, fmt.Errorf("insert agent version: %w", err)
		}
		return row.DeclaredVersionLatest, nil
	}
	return nil, fmt.Errorf("upsert agent version exceeded retries")
}

func upsertAgentVersionModelUsageTx(tx *gorm.DB, tenantID string, projection agentCatalogProjection) error {
	for attempt := 0; attempt < 2; attempt++ {
		var existing AgentVersionModelUsageModel
		err := tx.
			Where(
				"tenant_id = ? AND agent_name = ? AND effective_version = ? AND model_provider = ? AND model_name = ?",
				tenantID,
				projection.AgentName,
				projection.EffectiveVersion,
				projection.ModelProvider,
				projection.ModelName,
			).
			Take(&existing).Error
		if err == nil {
			if err := tx.Model(&AgentVersionModelUsageModel{}).
				Where(
					"tenant_id = ? AND agent_name = ? AND effective_version = ? AND model_provider = ? AND model_name = ?",
					tenantID,
					projection.AgentName,
					projection.EffectiveVersion,
					projection.ModelProvider,
					projection.ModelName,
				).
				Updates(map[string]any{
					"generation_count": gorm.Expr("generation_count + 1"),
					"first_seen_at":    gorm.Expr("LEAST(first_seen_at, ?)", projection.SeenAt),
					"last_seen_at":     gorm.Expr("GREATEST(last_seen_at, ?)", projection.SeenAt),
					"updated_at":       time.Now().UTC(),
				}).Error; err != nil {
				return fmt.Errorf("update agent version model usage: %w", err)
			}
			return nil
		}
		if !isRecordNotFound(err) {
			return fmt.Errorf("load agent version model usage: %w", err)
		}

		if err := tx.Create(&AgentVersionModelUsageModel{
			TenantID:         tenantID,
			AgentName:        projection.AgentName,
			EffectiveVersion: projection.EffectiveVersion,
			ModelProvider:    projection.ModelProvider,
			ModelName:        projection.ModelName,
			GenerationCount:  1,
			FirstSeenAt:      projection.SeenAt,
			LastSeenAt:       projection.SeenAt,
		}).Error; err != nil {
			if isDuplicateKeyError(err) {
				continue
			}
			return fmt.Errorf("insert agent version model usage: %w", err)
		}
		return nil
	}
	return fmt.Errorf("upsert agent version model usage exceeded retries")
}

func upsertAgentHeadTx(tx *gorm.DB, tenantID string, projection agentCatalogProjection, latestDeclaredVersion *string) error {
	versionCountExpr := gorm.Expr("(SELECT COUNT(*) FROM agent_versions WHERE tenant_id = ? AND agent_name = ?)", tenantID, projection.AgentName)

	for attempt := 0; attempt < 2; attempt++ {
		var existing AgentHeadModel
		err := tx.
			Where("tenant_id = ? AND agent_name = ?", tenantID, projection.AgentName).
			Take(&existing).Error
		if err == nil {
			updateValues := map[string]any{
				"generation_count": gorm.Expr("generation_count + 1"),
				"first_seen_at":    gorm.Expr("LEAST(first_seen_at, ?)", projection.SeenAt),
				"latest_seen_at":   gorm.Expr("GREATEST(latest_seen_at, ?)", projection.SeenAt),
				"version_count":    versionCountExpr,
				"updated_at":       time.Now().UTC(),
			}
			if !projection.SeenAt.Before(existing.LatestSeenAt) {
				updateValues["latest_effective_version"] = projection.EffectiveVersion
				updateValues["latest_declared_version"] = latestDeclaredVersion
				updateValues["latest_tool_count"] = projection.ToolCount
				updateValues["latest_system_prompt_prefix"] = projection.SystemPromptPrefix
				updateValues["latest_token_estimate_system_prompt"] = projection.TokenEstimateSystemPrompt
				updateValues["latest_token_estimate_tools_total"] = projection.TokenEstimateToolsTotal
				updateValues["latest_token_estimate_total"] = projection.TokenEstimateTotal
			}
			if err := tx.Model(&AgentHeadModel{}).
				Where("tenant_id = ? AND agent_name = ?", tenantID, projection.AgentName).
				Updates(updateValues).Error; err != nil {
				return fmt.Errorf("update agent head: %w", err)
			}
			return nil
		}
		if !isRecordNotFound(err) {
			return fmt.Errorf("load agent head: %w", err)
		}

		versionCount, err := countAgentVersionsTx(tx, tenantID, projection.AgentName)
		if err != nil {
			return err
		}
		if versionCount <= 0 {
			versionCount = 1
		}
		if err := tx.Create(&AgentHeadModel{
			TenantID:                        tenantID,
			AgentName:                       projection.AgentName,
			LatestEffectiveVersion:          projection.EffectiveVersion,
			LatestDeclaredVersion:           latestDeclaredVersion,
			LatestSeenAt:                    projection.SeenAt,
			FirstSeenAt:                     projection.SeenAt,
			GenerationCount:                 1,
			VersionCount:                    versionCount,
			LatestToolCount:                 projection.ToolCount,
			LatestSystemPromptPrefix:        projection.SystemPromptPrefix,
			LatestTokenEstimateSystemPrompt: projection.TokenEstimateSystemPrompt,
			LatestTokenEstimateToolsTotal:   projection.TokenEstimateToolsTotal,
			LatestTokenEstimateTotal:        projection.TokenEstimateTotal,
		}).Error; err != nil {
			if isDuplicateKeyError(err) {
				continue
			}
			return fmt.Errorf("insert agent head: %w", err)
		}
		return nil
	}
	return fmt.Errorf("upsert agent head exceeded retries")
}

func countAgentVersionsTx(tx *gorm.DB, tenantID, agentName string) (int, error) {
	var count int64
	if err := tx.Model(&AgentVersionModel{}).
		Where("tenant_id = ? AND agent_name = ?", tenantID, agentName).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count agent versions: %w", err)
	}
	return int(count), nil
}

func isRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

func clampRunes(value string, maxLen int) string {
	trimmed := strings.TrimSpace(value)
	if maxLen <= 0 || trimmed == "" {
		return ""
	}
	if utf8.RuneCountInString(trimmed) <= maxLen {
		return trimmed
	}
	return string([]rune(trimmed)[:maxLen])
}
