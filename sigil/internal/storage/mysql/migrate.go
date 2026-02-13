package mysql

import (
	"context"
	"fmt"
	"time"
)

func (s *WALStore) AutoMigrate(ctx context.Context) error {
	start := time.Now()

	err := s.db.WithContext(ctx).AutoMigrate(
		&GenerationModel{},
		&ConversationModel{},
		&CompactionBlockModel{},
		&CompactorLeaseModel{},
		&ModelCardModel{},
		&ModelCardAliasModel{},
		&ModelCardRefreshRunModel{},
		&ModelCardRefreshLeaseModel{},
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

	s.logger.Info("mysql auto-migrate completed")
	return nil
}
