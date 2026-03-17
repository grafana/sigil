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

	if err := s.db.WithContext(ctx).Create(&model).Error; err != nil {
		if isDuplicateKeyError(err) {
			return fmt.Errorf("%w: saved conversation create conflict", evalpkg.ErrConflict)
		}
		return err
	}
	return nil
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

func (s *WALStore) GetSavedConversationByConversationID(ctx context.Context, tenantID, conversationID string) (*evalpkg.SavedConversation, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, errors.New("conversation id is required")
	}

	var row EvalSavedConversationModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get saved conversation by conversation id: %w", err)
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

	if err := enrichSavedConversationsStats(ctx, s.db, tenantID, out); err != nil {
		return nil, 0, err
	}

	return out, nextCursor, nil
}

func (s *WALStore) CountSavedConversations(ctx context.Context, tenantID string, source string) (int64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return 0, errors.New("tenant id is required")
	}

	query := s.db.WithContext(ctx).Model(&EvalSavedConversationModel{}).
		Where("tenant_id = ?", tenantID)
	if strings.TrimSpace(source) != "" {
		query = query.Where("source = ?", strings.TrimSpace(source))
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count saved conversations: %w", err)
	}
	return count, nil
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

// enrichSavedConversationsStats fetches generation_count, total_tokens, and
// agent_names from the conversations table for each item and populates the
// enrichment fields in-place. Unknown conversation IDs are silently skipped.
func enrichSavedConversationsStats(ctx context.Context, db *gorm.DB, tenantID string, items []evalpkg.SavedConversation) error {
	if len(items) == 0 {
		return nil
	}
	convIDs := make([]string, len(items))
	for i, sc := range items {
		convIDs[i] = sc.ConversationID
	}

	type statsRow struct {
		ConversationID  string `gorm:"column:conversation_id"`
		GenerationCount int    `gorm:"column:generation_count"`
		TotalTokens     int64  `gorm:"column:total_tokens"`
		AgentsJSON      string `gorm:"column:agents_json"`
	}
	var stats []statsRow
	if err := db.WithContext(ctx).
		Model(&ConversationModel{}).
		Select("conversation_id, generation_count, total_tokens, agents_json").
		Where("tenant_id = ? AND conversation_id IN ?", tenantID, convIDs).
		Find(&stats).Error; err != nil {
		return fmt.Errorf("enrich saved conversations stats: %w", err)
	}

	statsMap := make(map[string]statsRow, len(stats))
	for _, s := range stats {
		statsMap[s.ConversationID] = s
	}

	for i := range items {
		s, ok := statsMap[items[i].ConversationID]
		if !ok {
			continue
		}
		items[i].GenerationCount = s.GenerationCount
		items[i].TotalTokens = s.TotalTokens
		if s.AgentsJSON != "" && s.AgentsJSON != "null" {
			var agents []string
			if err := json.Unmarshal([]byte(s.AgentsJSON), &agents); err == nil {
				items[i].AgentNames = agents
			}
		}
	}
	return nil
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
