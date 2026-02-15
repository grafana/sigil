package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ feedback.Store = (*WALStore)(nil)

const (
	ratingGoodInt = 1
	ratingBadInt  = 2
)

func (s *WALStore) CreateConversationRating(ctx context.Context, tenantID, conversationID string, input feedback.CreateConversationRatingInput) (*feedback.ConversationRating, *feedback.ConversationRatingSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, nil, feedbackValidationErr("conversation id is required")
	}

	createdAt := time.Now().UTC()
	metadataJSON, err := marshalJSON(input.Metadata)
	if err != nil {
		return nil, nil, feedbackValidationErr("metadata must be valid JSON")
	}

	ratingInt, err := ratingStringToInt(input.Rating)
	if err != nil {
		return nil, nil, err
	}

	row := ConversationRatingModel{
		TenantID:       strings.TrimSpace(tenantID),
		RatingID:       strings.TrimSpace(input.RatingID),
		ConversationID: strings.TrimSpace(conversationID),
		GenerationID:   stringPtr(strings.TrimSpace(input.GenerationID)),
		Rating:         ratingInt,
		Comment:        stringPtr(strings.TrimSpace(input.Comment)),
		MetadataJSON:   metadataJSON,
		RaterID:        stringPtr(strings.TrimSpace(input.RaterID)),
		Source:         stringPtr(strings.TrimSpace(input.Source)),
		CreatedAt:      createdAt,
	}

	var persisted ConversationRatingModel
	var summary ConversationRatingSummaryModel
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			if !isDuplicateKeyError(err) {
				return fmt.Errorf("insert rating: %w", err)
			}

			var existing ConversationRatingModel
			if err := tx.Where("tenant_id = ? AND rating_id = ?", row.TenantID, row.RatingID).First(&existing).Error; err != nil {
				return fmt.Errorf("load existing rating for idempotency: %w", err)
			}
			if !sameRatingModelPayload(existing, row) {
				return feedback.ErrConflict
			}
			persisted = existing

			existingSummary, err := loadOrRecomputeRatingSummary(tx, row.TenantID, row.ConversationID)
			if err != nil {
				return err
			}
			summary = existingSummary
			return nil
		}

		persisted = row
		if err := upsertRatingSummary(tx, row.TenantID, row.ConversationID, row.Rating, row.CreatedAt); err != nil {
			return err
		}
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", row.TenantID, row.ConversationID).First(&summary).Error; err != nil {
			return fmt.Errorf("load rating summary: %w", err)
		}
		return nil
	})
	if txErr != nil {
		if errors.Is(txErr, feedback.ErrConflict) {
			return nil, nil, feedback.ErrConflict
		}
		if feedback.IsValidationError(txErr) {
			return nil, nil, txErr
		}
		return nil, nil, fmt.Errorf("persist conversation rating: %w", txErr)
	}

	rating, err := toConversationRating(persisted)
	if err != nil {
		return nil, nil, err
	}
	outSummary := toConversationRatingSummary(summary)
	return &rating, &outSummary, nil
}

func (s *WALStore) ListConversationRatings(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]feedback.ConversationRating, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, 0, feedbackValidationErr("conversation id is required")
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		Order("id DESC").
		Limit(limit + 1)

	if cursor > 0 {
		query = query.Where("id < ?", cursor)
	}

	var rows []ConversationRatingModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list conversation ratings: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]feedback.ConversationRating, 0, len(rows))
	for _, row := range rows {
		rating, err := toConversationRating(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, rating)
	}
	return out, nextCursor, nil
}

func (s *WALStore) GetConversationRatingSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationRatingSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, feedbackValidationErr("conversation id is required")
	}

	var row ConversationRatingSummaryModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load conversation rating summary: %w", err)
	}

	summary := toConversationRatingSummary(row)
	return &summary, nil
}

func (s *WALStore) ListConversationRatingSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationRatingSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, feedbackValidationErr("tenant id is required")
	}

	normalizedConversationIDs := normalizeConversationIDs(conversationIDs)
	if len(normalizedConversationIDs) == 0 {
		return map[string]feedback.ConversationRatingSummary{}, nil
	}

	var rows []ConversationRatingSummaryModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id IN ?", tenantID, normalizedConversationIDs).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list conversation rating summaries: %w", err)
	}

	out := make(map[string]feedback.ConversationRatingSummary, len(rows))
	for _, row := range rows {
		out[row.ConversationID] = toConversationRatingSummary(row)
	}
	return out, nil
}

func (s *WALStore) CreateConversationAnnotation(ctx context.Context, tenantID, conversationID string, operator feedback.OperatorIdentity, input feedback.CreateConversationAnnotationInput) (*feedback.ConversationAnnotation, *feedback.ConversationAnnotationSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, nil, feedbackValidationErr("conversation id is required")
	}
	if strings.TrimSpace(operator.OperatorID) == "" {
		return nil, nil, feedbackValidationErr("operator id header is required")
	}

	createdAt := time.Now().UTC()
	tagsJSON, err := marshalJSON(input.Tags)
	if err != nil {
		return nil, nil, feedbackValidationErr("tags must be valid JSON")
	}
	metadataJSON, err := marshalJSON(input.Metadata)
	if err != nil {
		return nil, nil, feedbackValidationErr("metadata must be valid JSON")
	}

	row := ConversationAnnotationModel{
		TenantID:       strings.TrimSpace(tenantID),
		AnnotationID:   strings.TrimSpace(input.AnnotationID),
		ConversationID: strings.TrimSpace(conversationID),
		GenerationID:   stringPtr(strings.TrimSpace(input.GenerationID)),
		AnnotationType: strings.TrimSpace(input.AnnotationType),
		Body:           stringPtr(strings.TrimSpace(input.Body)),
		TagsJSON:       tagsJSON,
		MetadataJSON:   metadataJSON,
		OperatorID:     strings.TrimSpace(operator.OperatorID),
		OperatorLogin:  stringPtr(strings.TrimSpace(operator.OperatorLogin)),
		OperatorName:   stringPtr(strings.TrimSpace(operator.OperatorName)),
		CreatedAt:      createdAt,
	}

	var persisted ConversationAnnotationModel
	var summary ConversationAnnotationSummaryModel
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			if !isDuplicateKeyError(err) {
				return fmt.Errorf("insert annotation: %w", err)
			}

			var existing ConversationAnnotationModel
			if err := tx.Where("tenant_id = ? AND annotation_id = ?", row.TenantID, row.AnnotationID).First(&existing).Error; err != nil {
				return fmt.Errorf("load existing annotation for idempotency: %w", err)
			}
			if !sameAnnotationModelPayload(existing, row) {
				return feedback.ErrConflict
			}
			persisted = existing

			existingSummary, err := loadOrRecomputeAnnotationSummary(tx, row.TenantID, row.ConversationID)
			if err != nil {
				return err
			}
			summary = existingSummary
			return nil
		}

		persisted = row
		if err := upsertAnnotationSummary(tx, row.TenantID, row.ConversationID, row.AnnotationType, row.CreatedAt); err != nil {
			return err
		}
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", row.TenantID, row.ConversationID).First(&summary).Error; err != nil {
			return fmt.Errorf("load annotation summary: %w", err)
		}
		return nil
	})
	if txErr != nil {
		if errors.Is(txErr, feedback.ErrConflict) {
			return nil, nil, feedback.ErrConflict
		}
		if feedback.IsValidationError(txErr) {
			return nil, nil, txErr
		}
		return nil, nil, fmt.Errorf("persist conversation annotation: %w", txErr)
	}

	annotation, err := toConversationAnnotation(persisted)
	if err != nil {
		return nil, nil, err
	}
	outSummary := toConversationAnnotationSummary(summary)
	return &annotation, &outSummary, nil
}

func (s *WALStore) ListConversationAnnotations(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]feedback.ConversationAnnotation, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, 0, feedbackValidationErr("conversation id is required")
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		Order("id DESC").
		Limit(limit + 1)

	if cursor > 0 {
		query = query.Where("id < ?", cursor)
	}

	var rows []ConversationAnnotationModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list conversation annotations: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]feedback.ConversationAnnotation, 0, len(rows))
	for _, row := range rows {
		annotation, err := toConversationAnnotation(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, annotation)
	}
	return out, nextCursor, nil
}

func (s *WALStore) GetConversationAnnotationSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationAnnotationSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, feedbackValidationErr("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, feedbackValidationErr("conversation id is required")
	}

	var row ConversationAnnotationSummaryModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load conversation annotation summary: %w", err)
	}

	summary := toConversationAnnotationSummary(row)
	return &summary, nil
}

func (s *WALStore) ListConversationAnnotationSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationAnnotationSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, feedbackValidationErr("tenant id is required")
	}

	normalizedConversationIDs := normalizeConversationIDs(conversationIDs)
	if len(normalizedConversationIDs) == 0 {
		return map[string]feedback.ConversationAnnotationSummary{}, nil
	}

	var rows []ConversationAnnotationSummaryModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id IN ?", tenantID, normalizedConversationIDs).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list conversation annotation summaries: %w", err)
	}

	out := make(map[string]feedback.ConversationAnnotationSummary, len(rows))
	for _, row := range rows {
		out[row.ConversationID] = toConversationAnnotationSummary(row)
	}
	return out, nil
}

func upsertRatingSummary(tx *gorm.DB, tenantID, conversationID string, rating int, createdAt time.Time) error {
	isGood := 0
	isBad := 0
	var latestBadAt *time.Time
	switch rating {
	case ratingGoodInt:
		isGood = 1
	case ratingBadInt:
		isBad = 1
		latestBadAt = &createdAt
	}

	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "conversation_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"total_count":     gorm.Expr("total_count + 1"),
			"good_count":      gorm.Expr("good_count + ?", isGood),
			"bad_count":       gorm.Expr("bad_count + ?", isBad),
			"latest_rating":   gorm.Expr("IF(latest_rated_at <= ?, ?, latest_rating)", createdAt, rating),
			"latest_rated_at": gorm.Expr("GREATEST(latest_rated_at, ?)", createdAt),
			"latest_bad_at":   gorm.Expr("IF(? = 1 AND (latest_bad_at IS NULL OR latest_bad_at < ?), ?, latest_bad_at)", isBad, createdAt, createdAt),
			"has_bad_rating":  gorm.Expr("IF((bad_count + ?) > 0, TRUE, has_bad_rating)", isBad),
			"updated_at":      createdAt,
		}),
	}).Create(&ConversationRatingSummaryModel{
		TenantID:       tenantID,
		ConversationID: conversationID,
		TotalCount:     1,
		GoodCount:      isGood,
		BadCount:       isBad,
		LatestRating:   rating,
		LatestRatedAt:  createdAt,
		LatestBadAt:    latestBadAt,
		HasBadRating:   isBad == 1,
		UpdatedAt:      createdAt,
	}).Error
}

func upsertAnnotationSummary(tx *gorm.DB, tenantID, conversationID, annotationType string, createdAt time.Time) error {
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "conversation_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"annotation_count":       gorm.Expr("annotation_count + 1"),
			"latest_annotation_type": gorm.Expr("IF(latest_annotated_at <= ?, ?, latest_annotation_type)", createdAt, annotationType),
			"latest_annotated_at":    gorm.Expr("GREATEST(latest_annotated_at, ?)", createdAt),
			"updated_at":             createdAt,
		}),
	}).Create(&ConversationAnnotationSummaryModel{
		TenantID:             tenantID,
		ConversationID:       conversationID,
		AnnotationCount:      1,
		LatestAnnotationType: &annotationType,
		LatestAnnotatedAt:    createdAt,
		UpdatedAt:            createdAt,
	}).Error
}

func loadOrRecomputeRatingSummary(tx *gorm.DB, tenantID, conversationID string) (ConversationRatingSummaryModel, error) {
	var summary ConversationRatingSummaryModel
	err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).First(&summary).Error
	if err == nil {
		return summary, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return ConversationRatingSummaryModel{}, fmt.Errorf("load rating summary: %w", err)
	}

	var rows []ConversationRatingModel
	if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
		return ConversationRatingSummaryModel{}, fmt.Errorf("recompute rating summary rows: %w", err)
	}
	if len(rows) == 0 {
		return ConversationRatingSummaryModel{}, fmt.Errorf("rating summary not found")
	}

	recomputed := ConversationRatingSummaryModel{
		TenantID:       tenantID,
		ConversationID: conversationID,
	}
	for _, row := range rows {
		recomputed.TotalCount++
		if row.Rating == ratingGoodInt {
			recomputed.GoodCount++
		}
		if row.Rating == ratingBadInt {
			recomputed.BadCount++
			recomputed.HasBadRating = true
			if recomputed.LatestBadAt == nil || recomputed.LatestBadAt.Before(row.CreatedAt) {
				value := row.CreatedAt
				recomputed.LatestBadAt = &value
			}
		}
		if recomputed.LatestRatedAt.IsZero() || !recomputed.LatestRatedAt.After(row.CreatedAt) {
			recomputed.LatestRatedAt = row.CreatedAt
			recomputed.LatestRating = row.Rating
		}
	}
	recomputed.UpdatedAt = time.Now().UTC()
	if err := tx.Create(&recomputed).Error; err != nil {
		return ConversationRatingSummaryModel{}, fmt.Errorf("create recomputed rating summary: %w", err)
	}
	return recomputed, nil
}

func loadOrRecomputeAnnotationSummary(tx *gorm.DB, tenantID, conversationID string) (ConversationAnnotationSummaryModel, error) {
	var summary ConversationAnnotationSummaryModel
	err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).First(&summary).Error
	if err == nil {
		return summary, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return ConversationAnnotationSummaryModel{}, fmt.Errorf("load annotation summary: %w", err)
	}

	var rows []ConversationAnnotationModel
	if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
		return ConversationAnnotationSummaryModel{}, fmt.Errorf("recompute annotation summary rows: %w", err)
	}
	if len(rows) == 0 {
		return ConversationAnnotationSummaryModel{}, fmt.Errorf("annotation summary not found")
	}

	recomputed := ConversationAnnotationSummaryModel{
		TenantID:       tenantID,
		ConversationID: conversationID,
	}
	for _, row := range rows {
		recomputed.AnnotationCount++
		if recomputed.LatestAnnotatedAt.IsZero() || !recomputed.LatestAnnotatedAt.After(row.CreatedAt) {
			recomputed.LatestAnnotatedAt = row.CreatedAt
			value := row.AnnotationType
			recomputed.LatestAnnotationType = &value
		}
	}
	recomputed.UpdatedAt = time.Now().UTC()
	if err := tx.Create(&recomputed).Error; err != nil {
		return ConversationAnnotationSummaryModel{}, fmt.Errorf("create recomputed annotation summary: %w", err)
	}
	return recomputed, nil
}

func toConversationRating(row ConversationRatingModel) (feedback.ConversationRating, error) {
	metadata, err := parseAnyMap(row.MetadataJSON)
	if err != nil {
		return feedback.ConversationRating{}, fmt.Errorf("decode rating metadata: %w", err)
	}
	ratingValue, err := ratingIntToString(row.Rating)
	if err != nil {
		return feedback.ConversationRating{}, err
	}
	return feedback.ConversationRating{
		RatingID:       row.RatingID,
		ConversationID: row.ConversationID,
		GenerationID:   derefOptionalString(row.GenerationID),
		Rating:         ratingValue,
		Comment:        derefOptionalString(row.Comment),
		Metadata:       metadata,
		RaterID:        derefOptionalString(row.RaterID),
		Source:         derefOptionalString(row.Source),
		CreatedAt:      row.CreatedAt.UTC(),
	}, nil
}

func toConversationRatingSummary(row ConversationRatingSummaryModel) feedback.ConversationRatingSummary {
	out := feedback.ConversationRatingSummary{
		TotalCount:    row.TotalCount,
		GoodCount:     row.GoodCount,
		BadCount:      row.BadCount,
		LatestRating:  "",
		LatestRatedAt: row.LatestRatedAt.UTC(),
		HasBadRating:  row.HasBadRating,
	}
	if ratingValue, err := ratingIntToString(row.LatestRating); err == nil {
		out.LatestRating = ratingValue
	}
	if row.LatestBadAt != nil {
		out.LatestBadAt = row.LatestBadAt.UTC()
	}
	return out
}

func toConversationAnnotation(row ConversationAnnotationModel) (feedback.ConversationAnnotation, error) {
	metadata, err := parseAnyMap(row.MetadataJSON)
	if err != nil {
		return feedback.ConversationAnnotation{}, fmt.Errorf("decode annotation metadata: %w", err)
	}
	tags, err := parseStringMap(row.TagsJSON)
	if err != nil {
		return feedback.ConversationAnnotation{}, fmt.Errorf("decode annotation tags: %w", err)
	}
	return feedback.ConversationAnnotation{
		AnnotationID:   row.AnnotationID,
		ConversationID: row.ConversationID,
		GenerationID:   derefOptionalString(row.GenerationID),
		AnnotationType: row.AnnotationType,
		Body:           derefOptionalString(row.Body),
		Tags:           tags,
		Metadata:       metadata,
		OperatorID:     row.OperatorID,
		OperatorLogin:  derefOptionalString(row.OperatorLogin),
		OperatorName:   derefOptionalString(row.OperatorName),
		CreatedAt:      row.CreatedAt.UTC(),
	}, nil
}

func toConversationAnnotationSummary(row ConversationAnnotationSummaryModel) feedback.ConversationAnnotationSummary {
	return feedback.ConversationAnnotationSummary{
		AnnotationCount:      row.AnnotationCount,
		LatestAnnotationType: derefOptionalString(row.LatestAnnotationType),
		LatestAnnotatedAt:    row.LatestAnnotatedAt.UTC(),
	}
}

func ratingStringToInt(value string) (int, error) {
	switch strings.TrimSpace(value) {
	case feedback.RatingValueGood:
		return ratingGoodInt, nil
	case feedback.RatingValueBad:
		return ratingBadInt, nil
	default:
		return 0, feedbackValidationErr("rating must be CONVERSATION_RATING_VALUE_GOOD or CONVERSATION_RATING_VALUE_BAD")
	}
}

func ratingIntToString(value int) (string, error) {
	switch value {
	case ratingGoodInt:
		return feedback.RatingValueGood, nil
	case ratingBadInt:
		return feedback.RatingValueBad, nil
	case 0:
		return "", nil
	default:
		return "", feedbackValidationErr("unknown rating value")
	}
}

func sameRatingModelPayload(existing, incoming ConversationRatingModel) bool {
	return existing.TenantID == incoming.TenantID &&
		existing.RatingID == incoming.RatingID &&
		existing.ConversationID == incoming.ConversationID &&
		derefOptionalString(existing.GenerationID) == derefOptionalString(incoming.GenerationID) &&
		existing.Rating == incoming.Rating &&
		derefOptionalString(existing.Comment) == derefOptionalString(incoming.Comment) &&
		sameJSONString(existing.MetadataJSON, incoming.MetadataJSON) &&
		derefOptionalString(existing.RaterID) == derefOptionalString(incoming.RaterID) &&
		derefOptionalString(existing.Source) == derefOptionalString(incoming.Source)
}

func sameAnnotationModelPayload(existing, incoming ConversationAnnotationModel) bool {
	return existing.TenantID == incoming.TenantID &&
		existing.AnnotationID == incoming.AnnotationID &&
		existing.ConversationID == incoming.ConversationID &&
		derefOptionalString(existing.GenerationID) == derefOptionalString(incoming.GenerationID) &&
		existing.AnnotationType == incoming.AnnotationType &&
		derefOptionalString(existing.Body) == derefOptionalString(incoming.Body) &&
		sameJSONString(existing.TagsJSON, incoming.TagsJSON) &&
		sameJSONString(existing.MetadataJSON, incoming.MetadataJSON) &&
		existing.OperatorID == incoming.OperatorID &&
		derefOptionalString(existing.OperatorLogin) == derefOptionalString(incoming.OperatorLogin) &&
		derefOptionalString(existing.OperatorName) == derefOptionalString(incoming.OperatorName)
}

func marshalJSON(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	if len(payload) == 0 || string(payload) == "null" {
		return "{}", nil
	}
	return string(payload), nil
}

func parseAnyMap(raw string) (map[string]any, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" || trimmed == "null" {
		return nil, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(trimmed), &out); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func parseStringMap(raw string) (map[string]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" || trimmed == "null" {
		return nil, nil
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(trimmed), &out); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func normalizeConversationIDs(conversationIDs []string) []string {
	if len(conversationIDs) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(conversationIDs))
	out := make([]string, 0, len(conversationIDs))
	for _, conversationID := range conversationIDs {
		trimmedConversationID := strings.TrimSpace(conversationID)
		if trimmedConversationID == "" {
			continue
		}
		if _, ok := seen[trimmedConversationID]; ok {
			continue
		}
		seen[trimmedConversationID] = struct{}{}
		out = append(out, trimmedConversationID)
	}
	return out
}

func sameJSONString(left, right string) bool {
	var leftValue any
	if err := json.Unmarshal([]byte(strings.TrimSpace(left)), &leftValue); err != nil {
		return false
	}
	var rightValue any
	if err := json.Unmarshal([]byte(strings.TrimSpace(right)), &rightValue); err != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func derefOptionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func feedbackValidationErr(msg string) error {
	return feedback.NewValidationError(msg)
}
