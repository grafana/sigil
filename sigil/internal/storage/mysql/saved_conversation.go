package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm"
)

var _ evalpkg.SavedConversationStore = (*WALStore)(nil)

func (s *WALStore) CreateSavedConversation(ctx context.Context, sc evalpkg.SavedConversation) error {
	if strings.TrimSpace(sc.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(sc.SavedID) == "" {
		return errors.New("saved id is required")
	}
	if strings.TrimSpace(sc.ConversationID) == "" {
		return errors.New("conversation id is required")
	}

	tags := sc.Tags
	if tags == nil {
		tags = map[string]string{}
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return fmt.Errorf("marshal tags: %w", err)
	}

	now := time.Now().UTC()
	model := EvalSavedConversationModel{
		TenantID:       strings.TrimSpace(sc.TenantID),
		SavedID:        strings.TrimSpace(sc.SavedID),
		ConversationID: strings.TrimSpace(sc.ConversationID),
		Name:           strings.TrimSpace(sc.Name),
		Source:         string(sc.Source),
		TagsJSON:       tagsJSON,
		SavedBy:        strings.TrimSpace(sc.SavedBy),
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	return s.db.WithContext(ctx).Create(&model).Error
}

func (s *WALStore) GetSavedConversation(ctx context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(savedID) == "" {
		return nil, errors.New("saved id is required")
	}

	var row EvalSavedConversationModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND saved_id = ?", tenantID, savedID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get saved conversation: %w", err)
	}

	out, err := savedConversationModelToEntity(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) ListSavedConversations(ctx context.Context, tenantID string, source string, limit int, cursor uint64) ([]evalpkg.SavedConversation, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}
	if strings.TrimSpace(source) != "" {
		query = query.Where("source = ?", strings.TrimSpace(source))
	}

	var rows []EvalSavedConversationModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list saved conversations: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.SavedConversation, 0, len(rows))
	for _, row := range rows {
		item, err := savedConversationModelToEntity(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, nextCursor, nil
}

func (s *WALStore) DeleteSavedConversation(ctx context.Context, tenantID, savedID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(savedID) == "" {
		return errors.New("saved id is required")
	}

	return s.db.WithContext(ctx).
		Where("tenant_id = ? AND saved_id = ?", tenantID, savedID).
		Delete(&EvalSavedConversationModel{}).Error
}

func savedConversationModelToEntity(m EvalSavedConversationModel) (evalpkg.SavedConversation, error) {
	tags := map[string]string{}
	if len(m.TagsJSON) > 0 {
		if err := json.Unmarshal(m.TagsJSON, &tags); err != nil {
			return evalpkg.SavedConversation{}, fmt.Errorf("decode saved conversation tags: %w", err)
		}
	}
	return evalpkg.SavedConversation{
		TenantID:       m.TenantID,
		SavedID:        m.SavedID,
		ConversationID: m.ConversationID,
		Name:           m.Name,
		Source:         evalpkg.SavedConversationSource(m.Source),
		Tags:           tags,
		SavedBy:        m.SavedBy,
		CreatedAt:      m.CreatedAt.UTC(),
		UpdatedAt:      m.UpdatedAt.UTC(),
	}, nil
}
