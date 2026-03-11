package mysql

import (
	"context"
	"fmt"
	"time"
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
	status := "success"
	if err != nil {
		status = "error"
	}
	observeWALMetrics("migrate", status, start, 0)

	if err != nil {
		s.logger.Error("mysql auto-migrate failed", "err", err)
		return fmt.Errorf("auto-migrate mysql storage: %w", err)
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
		s.logger.Error("mysql first_generation_at backfill failed", "err", err)
		return fmt.Errorf("backfill first_generation_at: %w", err)
	}

	s.logger.Info("mysql auto-migrate completed")
	return nil
}
