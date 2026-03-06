package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	walOperationsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_wal_operations_total",
		Help: "Total number of WAL operations partitioned by operation and status.",
	}, []string{"op", "status"})
	walOperationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_wal_operation_duration_seconds",
		Help:    "WAL operation duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"op"})
	walRowsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_wal_rows_total",
		Help: "Total number of rows processed by WAL operations.",
	}, []string{"op"})
)

var _ storage.WALWriter = (*WALStore)(nil)

// EvalHook is a lightweight notifier invoked after successful generation saves.
//
// It must not perform heavy work inline; durable enqueue events are persisted
// transactionally in SaveBatch and processed asynchronously by dispatcher loops.
type EvalHook interface {
	OnGenerationsSaved(tenantID string)
}

func (s *WALStore) SaveBatch(ctx context.Context, tenantID string, generations []*sigilv1.Generation) []error {
	start := time.Now()
	errs := make([]error, len(generations))
	if len(generations) == 0 {
		observeWALMetrics("save_batch", "success", start, 0)
		return errs
	}
	if strings.TrimSpace(tenantID) == "" {
		for i := range errs {
			errs[i] = errors.New("tenant id is required")
		}
		observeWALMetrics("save_batch", "error", start, 0)
		return errs
	}

	successRows := 0
	for i, generation := range generations {
		generationRow, convRow, err := buildRows(tenantID, generation)
		if err != nil {
			errs[i] = err
			continue
		}
		agentProjection, err := buildAgentCatalogProjection(generationRow.CreatedAt, generation)
		if err != nil {
			errs[i] = err
			continue
		}

		txErr := runWithRetryableLockError(ctx, func() error {
			generationRow.ID = 0
			if convRow != nil {
				convRow.ID = 0
			}
			return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				if err := tx.Create(&generationRow).Error; err != nil {
					return wrapPersistError(err)
				}

				if convRow != nil {
					if err := upsertConversation(tx, convRow); err != nil {
						return err
					}
				}
				if err := upsertAgentCatalogTx(tx, tenantID, agentProjection); err != nil {
					return err
				}

				if !s.evalEnqueueEnable {
					return nil
				}

				return enqueueEvalGenerationTx(tx, generationRow)
			})
		})
		if txErr != nil {
			s.logger.Error("wal save failed",
				"tenant_id", tenantID,
				"generation_id", generation.GetId(),
				"err", txErr,
			)
			errs[i] = txErr
			continue
		}

		successRows++
	}

	s.triggerEvalHook(tenantID, successRows)

	status := "success"
	for _, err := range errs {
		if err != nil {
			status = "error"
			break
		}
	}
	observeWALMetrics("save_batch", status, start, successRows)

	return errs
}

func (s *WALStore) triggerEvalHook(tenantID string, savedRows int) {
	if s.evalHook == nil || savedRows == 0 {
		return
	}
	s.evalHook.OnGenerationsSaved(tenantID)
}

func buildRows(tenantID string, generation *sigilv1.Generation) (GenerationModel, *ConversationModel, error) {
	if generation == nil {
		return GenerationModel{}, nil, errors.New("generation is required")
	}
	if strings.TrimSpace(generation.GetId()) == "" {
		return GenerationModel{}, nil, errors.New("generation.id is required")
	}

	payload, err := proto.Marshal(generation)
	if err != nil {
		return GenerationModel{}, nil, fmt.Errorf("marshal generation %q: %w", generation.GetId(), err)
	}

	createdAt := generationCreatedAt(generation)
	conversationID := strings.TrimSpace(generation.GetConversationId())

	var conversationPtr *string
	var conversationRow *ConversationModel
	if conversationID != "" {
		conversationPtr = &conversationID
		now := time.Now().UTC()
		conversationTitle := storage.ConversationTitleFromGeneration(generation)
		var conversationTitlePtr *string
		var titleUpdatedAt *time.Time
		if conversationTitle != "" {
			conversationTitlePtr = &conversationTitle
			titleAt := createdAt
			titleUpdatedAt = &titleAt
		}
		conversationRow = &ConversationModel{
			TenantID:          tenantID,
			ConversationID:    conversationID,
			ConversationTitle: conversationTitlePtr,
			TitleUpdatedAt:    titleUpdatedAt,
			FirstGenerationAt: createdAt,
			LastGenerationAt:  createdAt,
			GenerationCount:   1,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
	}

	return GenerationModel{
		TenantID:         tenantID,
		GenerationID:     generation.GetId(),
		ConversationID:   conversationPtr,
		CreatedAt:        createdAt,
		Payload:          payload,
		PayloadSizeBytes: len(payload),
		Compacted:        false,
	}, conversationRow, nil
}

func upsertConversation(tx *gorm.DB, conversation *ConversationModel) error {
	if conversation == nil {
		return nil
	}

	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "conversation_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"generation_count":    gorm.Expr("generation_count + 1"),
			"first_generation_at": gorm.Expr("LEAST(first_generation_at, ?)", conversation.FirstGenerationAt),
			"last_generation_at":  gorm.Expr("GREATEST(last_generation_at, ?)", conversation.LastGenerationAt),
			"conversation_title": gorm.Expr(
				`CASE
					WHEN ? IS NOT NULL AND (title_updated_at IS NULL OR title_updated_at <= ?)
					THEN ?
					ELSE conversation_title
				END`,
				conversation.ConversationTitle,
				conversation.TitleUpdatedAt,
				conversation.ConversationTitle,
			),
			"title_updated_at": gorm.Expr(
				`CASE
					WHEN ? IS NOT NULL AND (title_updated_at IS NULL OR title_updated_at <= ?)
					THEN ?
					ELSE title_updated_at
				END`,
				conversation.ConversationTitle,
				conversation.TitleUpdatedAt,
				conversation.TitleUpdatedAt,
			),
			"updated_at": conversation.UpdatedAt,
		}),
	}).Create(conversation).Error
}

func generationCreatedAt(generation *sigilv1.Generation) time.Time {
	if generation.GetCompletedAt() != nil && generation.GetCompletedAt().AsTime().UnixNano() > 0 {
		return generation.GetCompletedAt().AsTime().UTC()
	}
	if generation.GetStartedAt() != nil && generation.GetStartedAt().AsTime().UnixNano() > 0 {
		return generation.GetStartedAt().AsTime().UTC()
	}
	return time.Now().UTC()
}

func wrapPersistError(err error) error {
	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return errors.New("generation already exists")
	}
	return fmt.Errorf("persist generation: %w", err)
}

func observeWALMetrics(op, status string, start time.Time, rows int) {
	walOperationsTotal.WithLabelValues(op, status).Inc()
	walOperationDuration.WithLabelValues(op).Observe(time.Since(start).Seconds())
	if rows > 0 {
		walRowsTotal.WithLabelValues(op).Add(float64(rows))
	}
}
