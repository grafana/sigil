package mysql

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

func (s *WALStore) AutoMigrate(ctx context.Context) error {
	start := time.Now()
	migrator := s.db.WithContext(ctx).Migrator()

	// Hard cutover is only needed when upgrading from the old tenant-only lease schema.
	needsCompactorCutover := migrator.HasTable(&CompactorLeaseModel{}) && !migrator.HasColumn(&CompactorLeaseModel{}, "shard_id")
	if needsCompactorCutover {
		if err := migrator.DropTable(&CompactorLeaseModel{}); err != nil {
			observeWALMetrics("migrate", "error", start, 0)
			s.logger.Error("mysql lease table reset failed", "err", err)
			return fmt.Errorf("reset compactor_leases table: %w", err)
		}
	}

	err := s.db.WithContext(ctx).AutoMigrate(
		&GenerationModel{},
		&GenerationScoreModel{},
		&EvalEnqueueEventModel{},
		&EvalWorkItemModel{},
		&EvalEvaluatorModel{},
		&EvalRuleModel{},
		&EvalSavedConversationModel{},
		&EvalCollectionModel{},
		&EvalCollectionMemberModel{},
		&EvalTemplateModel{},
		&EvalTemplateVersionModel{},
		&ConversationModel{},
		&AgentVersionModel{},
		&AgentVersionModelUsageModel{},
		&AgentHeadModel{},
		&AgentVersionRatingModel{},
		&AgentPromptInsightsModel{},
		&ConversationRatingModel{},
		&ConversationRatingSummaryModel{},
		&ConversationAnnotationModel{},
		&ConversationAnnotationSummaryModel{},
		&CompactionBlockModel{},
		&CompactorLeaseModel{},
		&TenantSettingsModel{},
	)
	if err != nil {
		observeWALMetrics("migrate", "error", start, 0)
		s.logger.Error("mysql auto-migrate failed", "err", err)
		return fmt.Errorf("auto-migrate mysql storage: %w", err)
	}

	if err := s.ensureGenerationScoreStringText(ctx); err != nil {
		observeWALMetrics("migrate", "error", start, 0)
		s.logger.Error("mysql generation_scores score_string migration failed", "err", err)
		return err
	}

	if needsCompactorCutover {
		// One-time cutover cleanup after durable-claim schema is in place.
		if err := s.db.WithContext(ctx).
			Model(&GenerationModel{}).
			Where("claimed_by IS NOT NULL OR claimed_at IS NOT NULL").
			Updates(map[string]any{
				"claimed_by": nil,
				"claimed_at": nil,
			}).Error; err != nil {
			observeWALMetrics("migrate", "error", start, 0)
			s.logger.Error("mysql claim reset failed", "err", err)
			return fmt.Errorf("reset generation claims: %w", err)
		}
	}

	// Backfill first_generation_at for existing rows that still have the
	// column default (CURRENT_TIMESTAMP). Use last_generation_at as the best
	// available approximation — it equals the true first generation timestamp
	// for single-generation conversations and is at least a generation-clock
	// value (not server-clock) for multi-generation ones.
	if err := s.db.WithContext(ctx).Exec(
		"UPDATE conversations SET first_generation_at = last_generation_at WHERE first_generation_at > last_generation_at",
	).Error; err != nil {
		observeWALMetrics("migrate", "error", start, 0)
		s.logger.Error("mysql first_generation_at backfill failed", "err", err)
		return fmt.Errorf("backfill first_generation_at: %w", err)
	}

	observeWALMetrics("migrate", "success", start, 0)
	s.logger.Info("mysql auto-migrate completed")
	return nil
}

func (s *WALStore) ensureGenerationScoreStringText(ctx context.Context) error {
	dataType, err := columnDataType(ctx, s.db.WithContext(ctx), (&GenerationScoreModel{}).TableName(), "score_string")
	if err != nil {
		return fmt.Errorf("inspect generation_scores.score_string type: %w", err)
	}
	switch strings.ToLower(dataType) {
	case "text", "mediumtext", "longtext":
		return nil
	case "":
		return fmt.Errorf("inspect generation_scores.score_string type: column not found")
	}

	if err := s.db.WithContext(ctx).Exec(
		"ALTER TABLE generation_scores MODIFY COLUMN score_string TEXT NULL",
	).Error; err != nil {
		return fmt.Errorf("alter generation_scores.score_string to text: %w", err)
	}

	s.logger.Info("mysql generation_scores.score_string widened to text", "previous_type", dataType)
	return nil
}

func columnDataType(ctx context.Context, db *gorm.DB, tableName, columnName string) (string, error) {
	type columnTypeRow struct {
		DataType string
	}

	var row columnTypeRow
	if err := db.WithContext(ctx).Raw(
		`SELECT DATA_TYPE
		FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		tableName,
		columnName,
	).Scan(&row).Error; err != nil {
		return "", err
	}
	return row.DataType, nil
}
