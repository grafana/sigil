package mysql

import (
	"context"
	"errors"
	"fmt"
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

func toConversation(row ConversationModel) storage.Conversation {
	title := ""
	if row.ConversationTitle != nil {
		title = strings.TrimSpace(*row.ConversationTitle)
	}
	titleUpdatedAt := time.Time{}
	if row.TitleUpdatedAt != nil {
		titleUpdatedAt = row.TitleUpdatedAt.UTC()
	}
	return storage.Conversation{
		TenantID:          row.TenantID,
		ConversationID:    row.ConversationID,
		ConversationTitle: title,
		TitleUpdatedAt:    titleUpdatedAt,
		FirstGenerationAt: row.FirstGenerationAt.UTC(),
		LastGenerationAt:  row.LastGenerationAt.UTC(),
		GenerationCount:   row.GenerationCount,
		CreatedAt:         row.CreatedAt.UTC(),
		UpdatedAt:         row.UpdatedAt.UTC(),
	}
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
