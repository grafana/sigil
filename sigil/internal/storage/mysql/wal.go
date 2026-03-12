package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
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

var ErrGenerationAlreadyExists = errors.New("generation already exists")

const (
	conversationProjectionUserIDKey       = "sigil.user.id"
	conversationProjectionLegacyUserIDKey = "user.id"
	conversationProjectionErrorTypeTag    = "span.error.type"
)

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
			consecutiveFailures, degraded, becameDegraded := s.writeHealth.ObserveFailure(txErr)
			s.logger.Error("wal save failed",
				"tenant_id", tenantID,
				"generation_id", generation.GetId(),
				"timeout", errors.Is(txErr, context.DeadlineExceeded),
				"canceled", errors.Is(txErr, context.Canceled),
				"err", txErr,
				"consecutive_failures", consecutiveFailures,
				"degraded", degraded,
			)
			if becameDegraded {
				s.logger.Error("wal write readiness degraded",
					"tenant_id", tenantID,
					"generation_id", generation.GetId(),
					"consecutive_failures", consecutiveFailures,
					"err", txErr,
				)
			}
			errs[i] = txErr
			continue
		}

		if s.writeHealth.ObserveSuccess() {
			s.logger.Info("wal write readiness recovered")
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
		userID := latestConversationProjectionUserID(generation)
		var userIDPtr *string
		var userIDUpdatedAt *time.Time
		if userID != "" {
			userIDPtr = &userID
			userAt := createdAt
			userIDUpdatedAt = &userAt
		}

		modelName := strings.TrimSpace(generation.GetModel().GetName())
		modelProvider := strings.TrimSpace(generation.GetModel().GetProvider())
		modelProviders := map[string]string{}
		if modelName != "" && modelProvider != "" {
			modelProviders[modelName] = modelProvider
		}

		inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens := conversationProjectionTokenUsage(generation)
		errorCount := 0
		if generationHasConversationProjectionError(generation) {
			errorCount = 1
		}

		conversationRow = &ConversationModel{
			TenantID:           tenantID,
			ConversationID:     conversationID,
			ConversationTitle:  conversationTitlePtr,
			TitleUpdatedAt:     titleUpdatedAt,
			UserID:             userIDPtr,
			UserIDUpdatedAt:    userIDUpdatedAt,
			FirstGenerationAt:  createdAt,
			LastGenerationAt:   createdAt,
			GenerationCount:    1,
			AgentsJSON:         mustEncodeStringSlice(nonEmptyStrings(generation.GetAgentName())),
			ModelsJSON:         mustEncodeStringSlice(nonEmptyStrings(modelName)),
			ModelProvidersJSON: mustEncodeStringMap(modelProviders),
			ErrorCount:         errorCount,
			InputTokens:        inputTokens,
			OutputTokens:       outputTokens,
			CacheReadTokens:    cacheReadTokens,
			CacheWriteTokens:   cacheWriteTokens,
			ReasoningTokens:    reasoningTokens,
			TotalTokens:        totalTokens,
			CreatedAt:          now,
			UpdatedAt:          now,
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

	createResult := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "conversation_id"}},
		DoNothing: true,
	}).Create(conversation)
	if createResult.Error != nil {
		return createResult.Error
	}
	if createResult.RowsAffected > 0 {
		return nil
	}

	var existing ConversationModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("tenant_id = ? AND conversation_id = ?", conversation.TenantID, conversation.ConversationID).
		First(&existing).Error; err != nil {
		return err
	}

	mergeConversationProjection(&existing, conversation)
	return tx.Save(&existing).Error
}

func mergeConversationProjection(existing *ConversationModel, incoming *ConversationModel) {
	if existing == nil || incoming == nil {
		return
	}

	existing.GenerationCount += incoming.GenerationCount
	if existing.FirstGenerationAt.IsZero() || incoming.FirstGenerationAt.Before(existing.FirstGenerationAt) {
		existing.FirstGenerationAt = incoming.FirstGenerationAt
	}
	if incoming.LastGenerationAt.After(existing.LastGenerationAt) {
		existing.LastGenerationAt = incoming.LastGenerationAt
	}

	existing.ConversationTitle, existing.TitleUpdatedAt = mergeLatestStringField(
		existing.ConversationTitle,
		existing.TitleUpdatedAt,
		incoming.ConversationTitle,
		incoming.TitleUpdatedAt,
	)
	existing.UserID, existing.UserIDUpdatedAt = mergeLatestStringField(
		existing.UserID,
		existing.UserIDUpdatedAt,
		incoming.UserID,
		incoming.UserIDUpdatedAt,
	)
	existing.AgentsJSON = mergeEncodedStringSlice(existing.AgentsJSON, incoming.AgentsJSON)
	existing.ModelsJSON = mergeEncodedStringSlice(existing.ModelsJSON, incoming.ModelsJSON)
	existing.ModelProvidersJSON = mergeEncodedStringMap(existing.ModelProvidersJSON, incoming.ModelProvidersJSON)
	existing.ErrorCount += incoming.ErrorCount
	existing.InputTokens += incoming.InputTokens
	existing.OutputTokens += incoming.OutputTokens
	existing.CacheReadTokens += incoming.CacheReadTokens
	existing.CacheWriteTokens += incoming.CacheWriteTokens
	existing.ReasoningTokens += incoming.ReasoningTokens
	existing.TotalTokens += incoming.TotalTokens
	existing.UpdatedAt = incoming.UpdatedAt
}

func mergeLatestStringField(
	existingValue *string,
	existingUpdatedAt *time.Time,
	incomingValue *string,
	incomingUpdatedAt *time.Time,
) (*string, *time.Time) {
	if incomingValue == nil || incomingUpdatedAt == nil {
		return existingValue, existingUpdatedAt
	}
	normalized := strings.TrimSpace(*incomingValue)
	if normalized == "" {
		return existingValue, existingUpdatedAt
	}
	if existingUpdatedAt != nil && incomingUpdatedAt.Before(existingUpdatedAt.UTC()) {
		return existingValue, existingUpdatedAt
	}
	updatedAt := incomingUpdatedAt.UTC()
	return &normalized, &updatedAt
}

func latestConversationProjectionUserID(generation *sigilv1.Generation) string {
	return storage.GenerationMetadataFirstString(
		generation,
		conversationProjectionUserIDKey,
		conversationProjectionLegacyUserIDKey,
	)
}

func generationHasConversationProjectionError(generation *sigilv1.Generation) bool {
	if strings.TrimSpace(generation.GetCallError()) != "" {
		return true
	}
	if strings.TrimSpace(generation.GetTags()[conversationProjectionErrorTypeTag]) != "" {
		return true
	}
	return storage.GenerationMetadataString(generation, conversationProjectionErrorTypeTag) != ""
}

func conversationProjectionTokenUsage(generation *sigilv1.Generation) (int64, int64, int64, int64, int64, int64) {
	usage := generation.GetUsage()
	if usage == nil {
		return 0, 0, 0, 0, 0, 0
	}

	inputTokens := usage.GetInputTokens()
	outputTokens := usage.GetOutputTokens()
	cacheReadTokens := usage.GetCacheReadInputTokens()
	cacheWriteTokens := usage.GetCacheWriteInputTokens()
	reasoningTokens := usage.GetReasoningTokens()
	totalTokens := inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + reasoningTokens
	if totalTokens <= 0 && usage.GetTotalTokens() > 0 {
		totalTokens = usage.GetTotalTokens()
	}
	return inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens
}

func mergeEncodedStringSlice(existingRaw string, incomingRaw string) string {
	values := append(decodeStringSlice(existingRaw), decodeStringSlice(incomingRaw)...)
	return mustEncodeStringSlice(nonEmptyStrings(values...))
}

func mergeEncodedStringMap(existingRaw string, incomingRaw string) string {
	merged := decodeStringMap(existingRaw)
	for key, value := range decodeStringMap(incomingRaw) {
		if _, exists := merged[key]; exists {
			continue
		}
		merged[key] = value
	}
	return mustEncodeStringMap(merged)
}

func mustEncodeStringSlice(values []string) string {
	encoded, err := json.Marshal(nonEmptyStrings(values...))
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func mustEncodeStringMap(values map[string]string) string {
	encoded, err := json.Marshal(nonEmptyProviderMap(values))
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func nonEmptyStrings(values ...string) []string {
	if len(values) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func nonEmptyProviderMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(key)
		normalizedValue := strings.TrimSpace(value)
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		out[normalizedKey] = normalizedValue
	}
	return out
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
		return ErrGenerationAlreadyExists
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
