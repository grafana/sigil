package mysql

import (
	"context"
	"fmt"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ evalpkg.CollectionStore = (*WALStore)(nil)

func (s *WALStore) CreateCollection(ctx context.Context, c evalpkg.Collection) error {
	now := time.Now().UTC()
	model := EvalCollectionModel{
		TenantID:     c.TenantID,
		CollectionID: c.CollectionID,
		Name:         c.Name,
		Description:  c.Description,
		CreatedBy:    c.CreatedBy,
		UpdatedBy:    c.UpdatedBy,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.db.WithContext(ctx).Create(&model).Error; err != nil {
		if isDuplicateKeyError(err) {
			return fmt.Errorf("%w: collection create conflict", evalpkg.ErrConflict)
		}
		return err
	}
	return nil
}

func (s *WALStore) GetCollection(ctx context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	var row EvalCollectionModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		First(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get collection: %w", err)
	}

	var count int64
	if err := s.db.WithContext(ctx).
		Model(&EvalCollectionMemberModel{}).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		Count(&count).Error; err != nil {
		return nil, fmt.Errorf("count collection members: %w", err)
	}

	entity := collectionModelToEntity(row, int(count))
	return &entity, nil
}

func (s *WALStore) ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]evalpkg.Collection, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("collection_id ASC").
		Limit(limit + 1)
	if cursor != "" {
		query = query.Where("collection_id > ?", cursor)
	}

	var rows []EvalCollectionModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, "", fmt.Errorf("list collections: %w", err)
	}

	nextCursor := ""
	if len(rows) > limit {
		nextCursor = rows[limit-1].CollectionID
		rows = rows[:limit]
	}

	if len(rows) == 0 {
		return []evalpkg.Collection{}, "", nil
	}

	// Batch count members for returned collections.
	collectionIDs := make([]string, len(rows))
	for i, r := range rows {
		collectionIDs[i] = r.CollectionID
	}

	type countResult struct {
		CollectionID string
		Cnt          int64
	}
	var counts []countResult
	if err := s.db.WithContext(ctx).
		Model(&EvalCollectionMemberModel{}).
		Select("collection_id, COUNT(*) as cnt").
		Where("tenant_id = ? AND collection_id IN ?", tenantID, collectionIDs).
		Group("collection_id").
		Find(&counts).Error; err != nil {
		return nil, "", fmt.Errorf("batch count collection members: %w", err)
	}

	countMap := make(map[string]int, len(counts))
	for _, c := range counts {
		countMap[c.CollectionID] = int(c.Cnt)
	}

	out := make([]evalpkg.Collection, 0, len(rows))
	for _, row := range rows {
		out = append(out, collectionModelToEntity(row, countMap[row.CollectionID]))
	}
	return out, nextCursor, nil
}

func (s *WALStore) UpdateCollection(ctx context.Context, tenantID, collectionID string, name, description, updatedBy *string) error {
	updates := map[string]any{}
	if name != nil {
		updates["name"] = *name
	}
	if description != nil {
		updates["description"] = *description
	}
	if updatedBy != nil {
		updates["updated_by"] = *updatedBy
	}
	if len(updates) == 0 {
		return nil
	}

	result := s.db.WithContext(ctx).
		Model(&EvalCollectionModel{}).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		Updates(updates)
	if result.Error != nil {
		return fmt.Errorf("update collection: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("%w: collection not found", evalpkg.ErrNotFound)
	}
	return nil
}

func (s *WALStore) DeleteCollection(ctx context.Context, tenantID, collectionID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
			Delete(&EvalCollectionMemberModel{}).Error; err != nil {
			return fmt.Errorf("delete collection members: %w", err)
		}
		if err := tx.
			Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
			Delete(&EvalCollectionModel{}).Error; err != nil {
			return fmt.Errorf("delete collection: %w", err)
		}
		return nil
	})
}

func (s *WALStore) AddCollectionMembers(ctx context.Context, tenantID, collectionID string, savedIDs []string, addedBy string) error {
	if len(savedIDs) == 0 {
		return nil
	}

	now := time.Now().UTC()
	members := make([]EvalCollectionMemberModel, len(savedIDs))
	for i, sid := range savedIDs {
		members[i] = EvalCollectionMemberModel{
			TenantID:     tenantID,
			CollectionID: collectionID,
			SavedID:      sid,
			AddedBy:      addedBy,
			CreatedAt:    now,
		}
	}

	return s.db.WithContext(ctx).
		Clauses(clause.Insert{Modifier: "IGNORE"}).
		Create(&members).Error
}

func (s *WALStore) RemoveCollectionMember(ctx context.Context, tenantID, collectionID, savedID string) error {
	return s.db.WithContext(ctx).
		Where("tenant_id = ? AND collection_id = ? AND saved_id = ?", tenantID, collectionID, savedID).
		Delete(&EvalCollectionMemberModel{}).Error
}

func (s *WALStore) ListCollectionMembers(ctx context.Context, tenantID, collectionID string, limit int, cursor string) ([]evalpkg.SavedConversation, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Table("eval_collection_members m").
		Select("s.*").
		Joins("JOIN eval_saved_conversations s ON s.tenant_id = m.tenant_id AND s.saved_id = m.saved_id").
		Where("m.tenant_id = ? AND m.collection_id = ?", tenantID, collectionID).
		Order("m.saved_id ASC").
		Limit(limit + 1)
	if cursor != "" {
		query = query.Where("m.saved_id > ?", cursor)
	}

	var rows []EvalSavedConversationModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, "", fmt.Errorf("list collection members: %w", err)
	}

	nextCursor := ""
	if len(rows) > limit {
		nextCursor = rows[limit-1].SavedID
		rows = rows[:limit]
	}

	out := make([]evalpkg.SavedConversation, 0, len(rows))
	for _, row := range rows {
		entity, err := savedConversationModelToEntity(row)
		if err != nil {
			return nil, "", err
		}
		out = append(out, entity)
	}
	return out, nextCursor, nil
}

func (s *WALStore) ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error) {
	var rows []EvalCollectionModel
	if err := s.db.WithContext(ctx).
		Table("eval_collection_members m").
		Select("c.*").
		Joins("JOIN eval_collections c ON c.tenant_id = m.tenant_id AND c.collection_id = m.collection_id").
		Where("m.tenant_id = ? AND m.saved_id = ?", tenantID, savedID).
		Order("c.collection_id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list collections for saved conversation: %w", err)
	}

	if len(rows) == 0 {
		return []evalpkg.Collection{}, nil
	}

	// Batch count members for returned collections.
	collectionIDs := make([]string, len(rows))
	for i, r := range rows {
		collectionIDs[i] = r.CollectionID
	}

	type countResult struct {
		CollectionID string
		Cnt          int64
	}
	var counts []countResult
	if err := s.db.WithContext(ctx).
		Model(&EvalCollectionMemberModel{}).
		Select("collection_id, COUNT(*) as cnt").
		Where("tenant_id = ? AND collection_id IN ?", tenantID, collectionIDs).
		Group("collection_id").
		Find(&counts).Error; err != nil {
		return nil, fmt.Errorf("batch count collection members: %w", err)
	}

	countMap := make(map[string]int, len(counts))
	for _, c := range counts {
		countMap[c.CollectionID] = int(c.Cnt)
	}

	out := make([]evalpkg.Collection, 0, len(rows))
	for _, row := range rows {
		out = append(out, collectionModelToEntity(row, countMap[row.CollectionID]))
	}
	return out, nil
}

func (s *WALStore) DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error {
	return s.db.WithContext(ctx).
		Where("tenant_id = ? AND saved_id = ?", tenantID, savedID).
		Delete(&EvalCollectionMemberModel{}).Error
}

func collectionModelToEntity(m EvalCollectionModel, memberCount int) evalpkg.Collection {
	return evalpkg.Collection{
		TenantID:     m.TenantID,
		CollectionID: m.CollectionID,
		Name:         m.Name,
		Description:  m.Description,
		CreatedBy:    m.CreatedBy,
		UpdatedBy:    m.UpdatedBy,
		CreatedAt:    m.CreatedAt.UTC(),
		UpdatedAt:    m.UpdatedAt.UTC(),
		MemberCount:  memberCount,
	}
}
