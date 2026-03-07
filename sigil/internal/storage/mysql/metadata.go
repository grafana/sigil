package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
	"gorm.io/gorm"
)

var _ storage.BlockMetadataStore = (*WALStore)(nil)
var _ storage.ConversationStore = (*WALStore)(nil)

func (s *WALStore) InsertBlock(ctx context.Context, meta storage.BlockMeta) error {
	start := time.Now()
	if strings.TrimSpace(meta.TenantID) == "" {
		observeWALMetrics("insert_block_meta", "error", start, 0)
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(meta.BlockID) == "" {
		observeWALMetrics("insert_block_meta", "error", start, 0)
		return errors.New("block id is required")
	}

	model := CompactionBlockModel{
		TenantID:        meta.TenantID,
		BlockID:         meta.BlockID,
		MinTime:         meta.MinTime.UTC(),
		MaxTime:         meta.MaxTime.UTC(),
		GenerationCount: meta.GenerationCount,
		SizeBytes:       meta.SizeBytes,
		ObjectPath:      meta.ObjectPath,
		IndexPath:       meta.IndexPath,
		CreatedAt:       normalizedNow(meta.CreatedAt),
		Deleted:         meta.Deleted,
	}

	if err := s.db.WithContext(ctx).Create(&model).Error; err != nil {
		if isDuplicateKeyError(err) {
			observeWALMetrics("insert_block_meta", "already_exists", start, 0)
			return fmt.Errorf("%w: tenant_id=%s block_id=%s", storage.ErrBlockAlreadyExists, meta.TenantID, meta.BlockID)
		}
		observeWALMetrics("insert_block_meta", "error", start, 0)
		return fmt.Errorf("insert block metadata: %w", err)
	}

	observeWALMetrics("insert_block_meta", "success", start, 1)
	return nil
}

func (s *WALStore) ListBlocks(ctx context.Context, tenantID string, from, to time.Time) ([]storage.BlockMeta, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("list_blocks", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND deleted = ?", tenantID, false)

	if !from.IsZero() {
		query = query.Where("max_time >= ?", from.UTC())
	}
	if !to.IsZero() {
		query = query.Where("min_time <= ?", to.UTC())
	}

	var rows []CompactionBlockModel
	if err := query.Order("min_time ASC, id ASC").Find(&rows).Error; err != nil {
		observeWALMetrics("list_blocks", "error", start, 0)
		return nil, fmt.Errorf("list block metadata: %w", err)
	}

	out := make([]storage.BlockMeta, 0, len(rows))
	for _, row := range rows {
		out = append(out, storage.BlockMeta{
			TenantID:        row.TenantID,
			BlockID:         row.BlockID,
			MinTime:         row.MinTime.UTC(),
			MaxTime:         row.MaxTime.UTC(),
			GenerationCount: row.GenerationCount,
			SizeBytes:       row.SizeBytes,
			ObjectPath:      row.ObjectPath,
			IndexPath:       row.IndexPath,
			CreatedAt:       row.CreatedAt.UTC(),
			Deleted:         row.Deleted,
		})
	}

	observeWALMetrics("list_blocks", "success", start, len(out))
	return out, nil
}

func (s *WALStore) ListConversations(ctx context.Context, tenantID string) ([]storage.Conversation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("list_conversations", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}

	var rows []ConversationModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("updated_at DESC, id DESC").
		Find(&rows).Error; err != nil {
		observeWALMetrics("list_conversations", "error", start, 0)
		return nil, fmt.Errorf("list conversations: %w", err)
	}

	out := make([]storage.Conversation, 0, len(rows))
	for _, row := range rows {
		out = append(out, toConversation(row))
	}
	observeWALMetrics("list_conversations", "success", start, len(out))
	return out, nil
}

func (s *WALStore) ListConversationsWithFeedbackFilters(ctx context.Context, tenantID string, hasBadRating, hasAnnotations *bool) ([]storage.Conversation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("list_conversations", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}

	query := s.db.WithContext(ctx).
		Table("conversations AS c").
		Select("c.*").
		Where("c.tenant_id = ?", tenantID)

	if hasBadRating != nil {
		query = query.Joins("LEFT JOIN conversation_rating_summaries AS rs ON rs.tenant_id = c.tenant_id AND rs.conversation_id = c.conversation_id")
		if *hasBadRating {
			query = query.Where("COALESCE(rs.has_bad_rating, FALSE) = TRUE")
		} else {
			query = query.Where("COALESCE(rs.has_bad_rating, FALSE) = FALSE")
		}
	}

	if hasAnnotations != nil {
		query = query.Joins("LEFT JOIN conversation_annotation_summaries AS ann ON ann.tenant_id = c.tenant_id AND ann.conversation_id = c.conversation_id")
		if *hasAnnotations {
			query = query.Where("COALESCE(ann.annotation_count, 0) > 0")
		} else {
			query = query.Where("COALESCE(ann.annotation_count, 0) = 0")
		}
	}

	var rows []ConversationModel
	if err := query.
		Order("c.updated_at DESC, c.id DESC").
		Find(&rows).Error; err != nil {
		observeWALMetrics("list_conversations", "error", start, 0)
		return nil, fmt.Errorf("list conversations with feedback filters: %w", err)
	}

	out := make([]storage.Conversation, 0, len(rows))
	for _, row := range rows {
		out = append(out, toConversation(row))
	}
	observeWALMetrics("list_conversations", "success", start, len(out))
	return out, nil
}

func (s *WALStore) ListConversationProjectionPage(
	ctx context.Context,
	tenantID string,
	filter storage.ConversationProjectionPageQuery,
) ([]storage.ConversationProjectionPageItem, bool, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("list_conversation_projection_page", "error", start, 0)
		return nil, false, errors.New("tenant id is required")
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 20
	}

	type projectionRow struct {
		ConversationModel
		ActivityLatestCreatedAt *time.Time `gorm:"column:activity_latest_created_at"`
		ActivityLatestRowID     *uint64    `gorm:"column:activity_latest_row_id"`
		RatingTotalCount        *int       `gorm:"column:rating_total_count"`
		RatingGoodCount         *int       `gorm:"column:rating_good_count"`
		RatingBadCount          *int       `gorm:"column:rating_bad_count"`
		RatingLatestRating      *int       `gorm:"column:rating_latest_rating"`
		RatingLatestRatedAt     *time.Time `gorm:"column:rating_latest_rated_at"`
		RatingLatestBadAt       *time.Time `gorm:"column:rating_latest_bad_at"`
		RatingHasBad            *bool      `gorm:"column:rating_has_bad"`
		AnnotationCount         *int       `gorm:"column:annotation_count"`
		AnnotationLatestAt      *time.Time `gorm:"column:annotation_latest_at"`
		AnnotationLatestType    *string    `gorm:"column:annotation_latest_type"`
	}

	candidateQuery := s.db.WithContext(ctx).
		Table("generations AS g").
		Select(`
			g.conversation_id,
			MAX(g.created_at) AS activity_latest_created_at,
			MAX(g.id) AS activity_latest_row_id`).
		Where("g.tenant_id = ? AND g.conversation_id IS NOT NULL", tenantID)

	if !filter.From.IsZero() {
		candidateQuery = candidateQuery.Where("g.created_at >= ?", filter.From.UTC())
	}
	if !filter.To.IsZero() {
		candidateQuery = candidateQuery.Where("g.created_at <= ?", filter.To.UTC())
	}

	excluded := normalizeConversationIDs(filter.ExcludeConversationIDs)
	if len(excluded) > 0 {
		candidateQuery = candidateQuery.Where("g.conversation_id NOT IN ?", excluded)
	}

	candidateQuery = candidateQuery.
		Group("g.conversation_id").
		Order("activity_latest_created_at DESC, activity_latest_row_id DESC").
		Limit(limit + 1)

	query := s.db.WithContext(ctx).
		Table("(?) AS recent", candidateQuery).
		Select(`
			c.*,
			recent.activity_latest_created_at AS activity_latest_created_at,
			recent.activity_latest_row_id AS activity_latest_row_id,
			rs.total_count AS rating_total_count,
			rs.good_count AS rating_good_count,
			rs.bad_count AS rating_bad_count,
			rs.latest_rating AS rating_latest_rating,
			rs.latest_rated_at AS rating_latest_rated_at,
			rs.latest_bad_at AS rating_latest_bad_at,
			rs.has_bad_rating AS rating_has_bad,
			ann.annotation_count AS annotation_count,
			ann.latest_annotated_at AS annotation_latest_at,
			ann.latest_annotation_type AS annotation_latest_type`).
		Joins("JOIN conversations AS c ON c.tenant_id = ? AND c.conversation_id = recent.conversation_id", tenantID).
		Joins("LEFT JOIN conversation_rating_summaries AS rs ON rs.tenant_id = c.tenant_id AND rs.conversation_id = c.conversation_id").
		Joins("LEFT JOIN conversation_annotation_summaries AS ann ON ann.tenant_id = c.tenant_id AND ann.conversation_id = c.conversation_id")

	var rows []projectionRow
	if err := query.
		Order("recent.activity_latest_created_at DESC, recent.activity_latest_row_id DESC").
		Scan(&rows).Error; err != nil {
		observeWALMetrics("list_conversation_projection_page", "error", start, 0)
		return nil, false, fmt.Errorf("list conversation projection page: %w", err)
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	out := make([]storage.ConversationProjectionPageItem, 0, len(rows))
	for _, row := range rows {
		item := storage.ConversationProjectionPageItem{
			Conversation: toConversation(row.ConversationModel),
		}
		if row.RatingTotalCount != nil && row.RatingLatestRatedAt != nil {
			summary := toConversationRatingSummary(ConversationRatingSummaryModel{
				TenantID:       tenantID,
				ConversationID: row.ConversationID,
				TotalCount:     *row.RatingTotalCount,
				GoodCount:      valueOrZero(row.RatingGoodCount),
				BadCount:       valueOrZero(row.RatingBadCount),
				LatestRating:   valueOrZero(row.RatingLatestRating),
				LatestRatedAt:  row.RatingLatestRatedAt.UTC(),
				LatestBadAt:    row.RatingLatestBadAt,
				HasBadRating:   valueOrFalse(row.RatingHasBad),
			})
			item.RatingSummary = &summary
		}
		if row.AnnotationCount != nil {
			item.AnnotationCount = *row.AnnotationCount
		}
		out = append(out, item)
	}

	observeWALMetrics("list_conversation_projection_page", "success", start, len(out))
	return out, hasMore, nil
}

func (s *WALStore) GetConversations(ctx context.Context, tenantID string, conversationIDs []string) ([]storage.Conversation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("get_conversations", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}
	if len(conversationIDs) == 0 {
		return nil, nil
	}

	var rows []ConversationModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id IN ?", tenantID, conversationIDs).
		Find(&rows).Error; err != nil {
		observeWALMetrics("get_conversations", "error", start, 0)
		return nil, fmt.Errorf("get conversations: %w", err)
	}

	out := make([]storage.Conversation, 0, len(rows))
	for _, row := range rows {
		out = append(out, toConversation(row))
	}
	observeWALMetrics("get_conversations", "success", start, len(out))
	return out, nil
}

func (s *WALStore) GetConversation(ctx context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("get_conversation", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		observeWALMetrics("get_conversation", "error", start, 0)
		return nil, errors.New("conversation id is required")
	}

	var row ConversationModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		observeWALMetrics("get_conversation", "not_found", start, 0)
		return nil, nil
	}
	if err != nil {
		observeWALMetrics("get_conversation", "error", start, 0)
		return nil, fmt.Errorf("get conversation: %w", err)
	}

	conversation := toConversation(row)
	observeWALMetrics("get_conversation", "success", start, 1)
	return &conversation, nil
}

func normalizedNow(value time.Time) time.Time {
	if value.IsZero() {
		return time.Now().UTC()
	}
	return value.UTC()
}

func valueOrZero[T ~int](value *T) T {
	if value == nil {
		return 0
	}
	return *value
}

func valueOrFalse(value *bool) bool {
	if value == nil {
		return false
	}
	return *value
}

func toConversation(row ConversationModel) storage.Conversation {
	title := ""
	if row.ConversationTitle != nil {
		title = strings.TrimSpace(*row.ConversationTitle)
	}
	titleUpdatedAt := time.Time{}
	if row.TitleUpdatedAt != nil {
		titleUpdatedAt = row.TitleUpdatedAt.UTC()
	}
	userID := ""
	if row.UserID != nil {
		userID = strings.TrimSpace(*row.UserID)
	}
	userIDUpdatedAt := time.Time{}
	if row.UserIDUpdatedAt != nil {
		userIDUpdatedAt = row.UserIDUpdatedAt.UTC()
	}
	return storage.Conversation{
		TenantID:          row.TenantID,
		ConversationID:    row.ConversationID,
		ConversationTitle: title,
		TitleUpdatedAt:    titleUpdatedAt,
		UserID:            userID,
		UserIDUpdatedAt:   userIDUpdatedAt,
		FirstGenerationAt: row.FirstGenerationAt.UTC(),
		LastGenerationAt:  row.LastGenerationAt.UTC(),
		GenerationCount:   row.GenerationCount,
		Agents:            decodeStringSlice(row.AgentsJSON),
		Models:            decodeStringSlice(row.ModelsJSON),
		ModelProviders:    decodeStringMap(row.ModelProvidersJSON),
		ErrorCount:        row.ErrorCount,
		InputTokens:       row.InputTokens,
		OutputTokens:      row.OutputTokens,
		CacheReadTokens:   row.CacheReadTokens,
		CacheWriteTokens:  row.CacheWriteTokens,
		ReasoningTokens:   row.ReasoningTokens,
		TotalTokens:       row.TotalTokens,
		CreatedAt:         row.CreatedAt.UTC(),
		UpdatedAt:         row.UpdatedAt.UTC(),
	}
}

func decodeStringSlice(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
		return []string{}
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		normalized = append(normalized, item)
	}
	sort.Strings(normalized)
	return normalized
}

func decodeStringMap(raw string) map[string]string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return map[string]string{}
	}
	var values map[string]string
	if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
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

func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "duplicate entry") || strings.Contains(lower, "unique constraint failed")
}
