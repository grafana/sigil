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
	return storage.Conversation{
		TenantID:         row.TenantID,
		ConversationID:   row.ConversationID,
		LastGenerationAt: row.LastGenerationAt.UTC(),
		GenerationCount:  row.GenerationCount,
		CreatedAt:        row.CreatedAt.UTC(),
		UpdatedAt:        row.UpdatedAt.UTC(),
	}
}
