package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	evalEnqueueStatusQueued  = "queued"
	evalEnqueueStatusClaimed = "claimed"
	evalEnqueueStatusFailed  = "failed"

	defaultEvalEnqueueClaimTTL = 2 * time.Minute
)

// EvalEnqueueEvent is a durable generation event waiting for rule-engine enqueueing.
type EvalEnqueueEvent struct {
	TenantID       string
	GenerationID   string
	ConversationID *string
	Payload        []byte
	Attempts       int
}

func enqueueEvalGenerationTx(tx *gorm.DB, generation GenerationModel) error {
	now := time.Now().UTC()
	event := EvalEnqueueEventModel{
		TenantID:       generation.TenantID,
		GenerationID:   generation.GenerationID,
		ConversationID: generation.ConversationID,
		Payload:        generation.Payload,
		ScheduledAt:    now,
		Status:         evalEnqueueStatusQueued,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "generation_id"}},
		DoNothing: true,
	}).Create(&event).Error
}

// ClaimEvalEnqueueEvents claims due enqueue events for dispatcher processing.
//
// Claiming is distributed-safe (`FOR UPDATE SKIP LOCKED`) and also recovers
// stale claims older than claimTTL.
func (s *WALStore) ClaimEvalEnqueueEvents(ctx context.Context, now time.Time, limit int, claimTTL time.Duration) ([]EvalEnqueueEvent, error) {
	if limit <= 0 {
		return []EvalEnqueueEvent{}, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if claimTTL <= 0 {
		claimTTL = defaultEvalEnqueueClaimTTL
	}

	claimed := make([]EvalEnqueueEventModel, 0, limit)
	err := runWithRetryableLockError(ctx, func() error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			staleBefore := now.Add(-claimTTL)
			if err := tx.Model(&EvalEnqueueEventModel{}).
				Where("status = ? AND claimed_at IS NOT NULL AND claimed_at < ?", evalEnqueueStatusClaimed, staleBefore).
				Updates(map[string]any{
					"status":     evalEnqueueStatusQueued,
					"claimed_at": nil,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}

			var ids []uint64
			if err := tx.Model(&EvalEnqueueEventModel{}).
				Select("id").
				Where("status = ? AND scheduled_at <= ?", evalEnqueueStatusQueued, now).
				Order("scheduled_at ASC, id ASC").
				Limit(limit).
				Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Scan(&ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				claimed = claimed[:0]
				return nil
			}

			if err := tx.Model(&EvalEnqueueEventModel{}).
				Where("id IN ?", ids).
				Updates(map[string]any{
					"status":     evalEnqueueStatusClaimed,
					"claimed_at": now,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}

			return tx.Where("id IN ?", ids).
				Order("scheduled_at ASC, id ASC").
				Find(&claimed).Error
		})
	})
	if err != nil {
		return nil, fmt.Errorf("claim eval enqueue events: %w", err)
	}

	out := make([]EvalEnqueueEvent, 0, len(claimed))
	for _, row := range claimed {
		out = append(out, EvalEnqueueEvent{
			TenantID:       row.TenantID,
			GenerationID:   row.GenerationID,
			ConversationID: row.ConversationID,
			Payload:        append([]byte(nil), row.Payload...),
			Attempts:       row.Attempts,
		})
	}
	return out, nil
}

// CompleteEvalEnqueueEvent removes an enqueue event after successful dispatch.
func (s *WALStore) CompleteEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		return errors.New("generation id is required")
	}

	result := s.db.WithContext(ctx).
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		Delete(&EvalEnqueueEventModel{})
	if result.Error != nil {
		return fmt.Errorf("complete eval enqueue event: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return evalpkg.ErrNotFound
	}
	return nil
}

// RequeueClaimedEvalEnqueueEvent releases a claimed enqueue event back to queued
// without consuming retry attempts.
func (s *WALStore) RequeueClaimedEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		return errors.New("generation id is required")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&EvalEnqueueEventModel{}).
		Where("tenant_id = ? AND generation_id = ? AND status = ?", tenantID, generationID, evalEnqueueStatusClaimed).
		Updates(map[string]any{
			"status":     evalEnqueueStatusQueued,
			"claimed_at": nil,
			"updated_at": now,
		})
	if result.Error != nil {
		return fmt.Errorf("requeue claimed eval enqueue event: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		return nil
	}

	var existing EvalEnqueueEventModel
	err := s.db.WithContext(ctx).
		Select("status").
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return evalpkg.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("requeue claimed eval enqueue event: %w", err)
	}
	return nil
}

// FailEvalEnqueueEvent records a dispatch failure and either requeues or fails.
func (s *WALStore) FailEvalEnqueueEvent(ctx context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	if strings.TrimSpace(tenantID) == "" {
		return false, errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		return false, errors.New("generation id is required")
	}
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	if retryAt.IsZero() {
		retryAt = time.Now().UTC()
	}

	requeue := false
	err := runWithRetryableLockError(ctx, func() error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var row EvalEnqueueEventModel
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
				First(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return evalpkg.ErrNotFound
			}
			if err != nil {
				return err
			}
			if row.Status != evalEnqueueStatusClaimed {
				return nil
			}

			attempts := row.Attempts + 1
			now := time.Now().UTC()
			trimmedErr := strings.TrimSpace(lastError)
			if trimmedErr == "" {
				trimmedErr = "unknown enqueue error"
			}
			updates := map[string]any{
				"attempts":   attempts,
				"last_error": trimmedErr,
				"claimed_at": nil,
				"updated_at": now,
			}

			requeue = !permanent && attempts < maxAttempts
			if requeue {
				updates["status"] = evalEnqueueStatusQueued
				updates["scheduled_at"] = retryAt.UTC()
			} else {
				updates["status"] = evalEnqueueStatusFailed
			}

			return tx.Model(&EvalEnqueueEventModel{}).
				Where("id = ?", row.ID).
				Updates(updates).Error
		})
	})
	if err != nil {
		return false, fmt.Errorf("fail eval enqueue event: %w", err)
	}
	return requeue, nil
}

// CountEvalEnqueueEventsByStatus counts durable enqueue events by status.
func (s *WALStore) CountEvalEnqueueEventsByStatus(ctx context.Context, status string) (int64, error) {
	if strings.TrimSpace(status) == "" {
		return 0, errors.New("status is required")
	}
	var count int64
	if err := s.db.WithContext(ctx).
		Model(&EvalEnqueueEventModel{}).
		Where("status = ?", status).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count eval enqueue events by status: %w", err)
	}
	return count, nil
}
