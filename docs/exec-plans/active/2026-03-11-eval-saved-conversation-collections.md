# Eval Saved Conversation Collections Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flat collections for grouping saved conversations via many-to-many, with CRUD APIs and GenerationPicker integration.

**Architecture:** Two new MySQL tables (`eval_collections`, `eval_collection_members`) with composite PKs. New `CollectionService` in the eval control layer with HTTP handlers. Plugin backend proxies collection routes to Sigil API. Frontend adds collection types, API methods, and a collection filter dropdown in the GenerationPicker's Saved tab.

**Tech Stack:** Go 1.26, GORM, `net/http`, TypeScript, React, Grafana UI, Emotion CSS

**Spec:** `docs/design-docs/2026-03-11-eval-saved-conversation-collections.md`

---

## File Structure

### Backend (Sigil)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `sigil/internal/eval/collection_types.go` | Domain types (`Collection`, `CollectionMember`) and `CollectionStore` interface |
| Modify | `sigil/internal/storage/mysql/models.go` | GORM models `EvalCollectionModel`, `EvalCollectionMemberModel` |
| Modify | `sigil/internal/storage/mysql/migrate.go` | Add new models to `AutoMigrate` |
| Create | `sigil/internal/storage/mysql/collection.go` | `CollectionStore` implementation on `WALStore` |
| Create | `sigil/internal/eval/control/collection_service.go` | `CollectionService` with business logic |
| Create | `sigil/internal/eval/control/http_collections.go` | HTTP handlers + `RegisterCollectionRoutes` |
| Modify | `sigil/internal/querier_module.go` | Wire `CollectionService` and register routes |

### Backend (Plugin proxy)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/plugin/pkg/plugin/resources.go` | Proxy handlers + route registration for `/eval/collections/...` |

### Frontend (Plugin)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/plugin/src/evaluation/types.ts` | Collection types |
| Modify | `apps/plugin/src/evaluation/api.ts` | Collection API methods on `EvaluationDataSource` |
| Modify | `apps/plugin/src/components/evaluation/GenerationPicker.tsx` | Collection filter dropdown in Saved tab |
| Modify | `apps/plugin/src/stories/evaluation/GenerationPicker.stories.tsx` | Updated stories with collection mocks |

### Tests

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `sigil/internal/eval/control/collection_service_test.go` | Service unit tests |
| Create | `sigil/internal/eval/control/http_collections_test.go` | HTTP handler tests |
| Create | `sigil/internal/storage/mysql/collection_test.go` | Storage integration tests |

---

## Chunk 1: Backend Domain Types + Storage

### Task 1: Domain Types

**Files:**
- Create: `sigil/internal/eval/collection_types.go`

- [ ] **Step 1: Create domain types and store interface**

```go
package eval

import (
	"context"
	"time"
)

// Collection is a named group of saved conversations.
type Collection struct {
	TenantID     string    `json:"tenant_id"`
	CollectionID string    `json:"collection_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	CreatedBy    string    `json:"created_by"`
	UpdatedBy    string    `json:"updated_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	MemberCount  int       `json:"member_count"`
}

// CollectionMember links a saved conversation to a collection.
type CollectionMember struct {
	TenantID     string    `json:"tenant_id"`
	CollectionID string    `json:"collection_id"`
	SavedID      string    `json:"saved_id"`
	AddedBy      string    `json:"added_by"`
	CreatedAt    time.Time `json:"created_at"`
}

// CollectionStore persists collection and membership data.
type CollectionStore interface {
	CreateCollection(ctx context.Context, c Collection) error
	GetCollection(ctx context.Context, tenantID, collectionID string) (*Collection, error)
	ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]Collection, string, error)
	UpdateCollection(ctx context.Context, tenantID, collectionID string, name, description, updatedBy *string) error
	DeleteCollection(ctx context.Context, tenantID, collectionID string) error

	AddCollectionMembers(ctx context.Context, tenantID, collectionID string, savedIDs []string, addedBy string) error
	RemoveCollectionMember(ctx context.Context, tenantID, collectionID, savedID string) error
	ListCollectionMembers(ctx context.Context, tenantID, collectionID string, limit int, cursor string) ([]SavedConversation, string, error)
	ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]Collection, error)
	DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go build ./internal/eval/...`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add sigil/internal/eval/collection_types.go
git commit -m "feat(eval): add collection domain types and store interface"
```

---

### Task 2: GORM Models + Migration

**Files:**
- Modify: `sigil/internal/storage/mysql/models.go` (after line 214)
- Modify: `sigil/internal/storage/mysql/migrate.go` (line 30, add to AutoMigrate list)

- [ ] **Step 1: Add GORM models to `models.go`**

Add after `EvalSavedConversationModel` (after line 214):

```go
type EvalCollectionModel struct {
	TenantID     string    `gorm:"size:128;not null;primaryKey"`
	CollectionID string    `gorm:"size:36;not null;primaryKey"`
	Name         string    `gorm:"size:255;not null"`
	Description  string    `gorm:"type:text"`
	CreatedBy    string    `gorm:"size:255;not null"`
	UpdatedBy    string    `gorm:"size:255;not null"`
	CreatedAt    time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt    time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalCollectionModel) TableName() string {
	return "eval_collections"
}

type EvalCollectionMemberModel struct {
	TenantID     string    `gorm:"size:128;not null;primaryKey"`
	CollectionID string    `gorm:"size:36;not null;primaryKey"`
	SavedID      string    `gorm:"size:128;not null;primaryKey;index:idx_eval_collection_members_saved,priority:2"`
	AddedBy      string    `gorm:"size:255;not null"`
	CreatedAt    time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (EvalCollectionMemberModel) TableName() string {
	return "eval_collection_members"
}
```

Note on the index tag: GORM composite index requires the `priority` tag on each column. For `idx_eval_collection_members_saved`, add `TenantID` as priority:1. Update:

```go
TenantID     string    `gorm:"size:128;not null;primaryKey;index:idx_eval_collection_members_saved,priority:1"`
```

- [ ] **Step 2: Add models to AutoMigrate in `migrate.go`**

In `migrate.go`, add `&EvalCollectionModel{}` and `&EvalCollectionMemberModel{}` to the `AutoMigrate` call, after `&EvalSavedConversationModel{}` (line 30):

```go
&EvalSavedConversationModel{},
&EvalCollectionModel{},
&EvalCollectionMemberModel{},
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go build ./internal/storage/mysql/...`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add sigil/internal/storage/mysql/models.go sigil/internal/storage/mysql/migrate.go
git commit -m "feat(storage): add GORM models and migration for eval collections"
```

---

### Task 3: Storage Implementation

**Files:**
- Create: `sigil/internal/storage/mysql/collection.go`

- [ ] **Step 1: Write storage tests**

Create `sigil/internal/storage/mysql/collection_test.go`:

```go
package mysql

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestCollectionStoreCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	require.NoError(t, store.AutoMigrate(context.Background()))

	ctx := context.Background()
	tenantID := "test-tenant"
	collectionID := uuid.New().String()

	// Create
	c := evalpkg.Collection{
		TenantID:     tenantID,
		CollectionID: collectionID,
		Name:         "Test Collection",
		Description:  "A test collection",
		CreatedBy:    "tester",
		UpdatedBy:    "tester",
	}
	require.NoError(t, store.CreateCollection(ctx, c))

	// Get
	got, err := store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, "Test Collection", got.Name)
	require.Equal(t, "A test collection", got.Description)
	require.Equal(t, 0, got.MemberCount)

	// List
	list, cursor, err := store.ListCollections(ctx, tenantID, 50, "")
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, "", cursor)

	// Update
	newName := "Updated Name"
	require.NoError(t, store.UpdateCollection(ctx, tenantID, collectionID, &newName, nil, &newName))
	got, err = store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.Equal(t, "Updated Name", got.Name)

	// Delete
	require.NoError(t, store.DeleteCollection(ctx, tenantID, collectionID))
	got, err = store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestCollectionMembership(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	require.NoError(t, store.AutoMigrate(context.Background()))

	ctx := context.Background()
	tenantID := "test-tenant"
	collectionID := uuid.New().String()

	// Create collection
	require.NoError(t, store.CreateCollection(ctx, evalpkg.Collection{
		TenantID:     tenantID,
		CollectionID: collectionID,
		Name:         "Members Test",
		CreatedBy:    "tester",
		UpdatedBy:    "tester",
	}))

	// Create a saved conversation to be a member
	sc := evalpkg.SavedConversation{
		TenantID:       tenantID,
		SavedID:        "saved-1",
		ConversationID: "conv-1",
		Name:           "Saved Conv 1",
		Source:         evalpkg.SavedConversationSourceTelemetry,
		Tags:           map[string]string{},
		SavedBy:        "tester",
	}
	require.NoError(t, store.CreateSavedConversation(ctx, sc))

	// Add member
	require.NoError(t, store.AddCollectionMembers(ctx, tenantID, collectionID, []string{"saved-1"}, "tester"))

	// Verify member count
	got, err := store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.Equal(t, 1, got.MemberCount)

	// List members
	members, cursor, err := store.ListCollectionMembers(ctx, tenantID, collectionID, 50, "")
	require.NoError(t, err)
	require.Len(t, members, 1)
	require.Equal(t, "saved-1", members[0].SavedID)
	require.Equal(t, "", cursor)

	// List collections for saved conversation
	collections, err := store.ListCollectionsForSavedConversation(ctx, tenantID, "saved-1")
	require.NoError(t, err)
	require.Len(t, collections, 1)
	require.Equal(t, collectionID, collections[0].CollectionID)

	// Add same member again (idempotent)
	require.NoError(t, store.AddCollectionMembers(ctx, tenantID, collectionID, []string{"saved-1"}, "tester"))
	got, err = store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.Equal(t, 1, got.MemberCount)

	// Remove member
	require.NoError(t, store.RemoveCollectionMember(ctx, tenantID, collectionID, "saved-1"))
	got, err = store.GetCollection(ctx, tenantID, collectionID)
	require.NoError(t, err)
	require.Equal(t, 0, got.MemberCount)

	// Delete collection cascades memberships
	require.NoError(t, store.AddCollectionMembers(ctx, tenantID, collectionID, []string{"saved-1"}, "tester"))
	require.NoError(t, store.DeleteCollection(ctx, tenantID, collectionID))
	collections, err = store.ListCollectionsForSavedConversation(ctx, tenantID, "saved-1")
	require.NoError(t, err)
	require.Len(t, collections, 0)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/storage/mysql/ -run TestCollectionStore -v -count=1`
Expected: compilation failure — `store.CreateCollection` does not exist

- [ ] **Step 3: Implement storage layer**

Create `sigil/internal/storage/mysql/collection.go`:

```go
package mysql

import (
	"context"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func (s *WALStore) CreateCollection(ctx context.Context, c evalpkg.Collection) error {
	m := EvalCollectionModel{
		TenantID:     c.TenantID,
		CollectionID: c.CollectionID,
		Name:         c.Name,
		Description:  c.Description,
		CreatedBy:    c.CreatedBy,
		UpdatedBy:    c.UpdatedBy,
	}
	if err := s.db.WithContext(ctx).Create(&m).Error; err != nil {
		if isDuplicateKeyError(err) {
			return fmt.Errorf("collection %q: %w", c.CollectionID, evalpkg.ErrConflict)
		}
		return fmt.Errorf("create collection: %w", err)
	}
	return nil
}

func (s *WALStore) GetCollection(ctx context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	var m EvalCollectionModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get collection: %w", err)
	}

	var count int64
	s.db.WithContext(ctx).Model(&EvalCollectionMemberModel{}).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		Count(&count)

	c := collectionModelToEntity(m)
	c.MemberCount = int(count)
	return &c, nil
}

func (s *WALStore) ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]evalpkg.Collection, string, error) {
	if limit <= 0 {
		limit = 50
	}

	q := s.db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("collection_id ASC").
		Limit(limit + 1)

	if cursor != "" {
		q = q.Where("collection_id > ?", cursor)
	}

	var models []EvalCollectionModel
	if err := q.Find(&models).Error; err != nil {
		return nil, "", fmt.Errorf("list collections: %w", err)
	}

	var nextCursor string
	if len(models) > limit {
		nextCursor = models[limit-1].CollectionID
		models = models[:limit]
	}

	// Batch count members for all collections
	collectionIDs := make([]string, len(models))
	for i, m := range models {
		collectionIDs[i] = m.CollectionID
	}

	type countResult struct {
		CollectionID string
		Count        int
	}
	var counts []countResult
	if len(collectionIDs) > 0 {
		s.db.WithContext(ctx).Model(&EvalCollectionMemberModel{}).
			Select("collection_id, COUNT(*) as count").
			Where("tenant_id = ? AND collection_id IN ?", tenantID, collectionIDs).
			Group("collection_id").
			Find(&counts)
	}
	countMap := make(map[string]int, len(counts))
	for _, c := range counts {
		countMap[c.CollectionID] = c.Count
	}

	result := make([]evalpkg.Collection, len(models))
	for i, m := range models {
		result[i] = collectionModelToEntity(m)
		result[i].MemberCount = countMap[m.CollectionID]
	}

	return result, nextCursor, nil
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

	result := s.db.WithContext(ctx).Model(&EvalCollectionModel{}).
		Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
		Updates(updates)
	if result.Error != nil {
		return fmt.Errorf("update collection: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return evalpkg.ErrNotFound
	}
	return nil
}

func (s *WALStore) DeleteCollection(ctx context.Context, tenantID, collectionID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Delete members first
		if err := tx.Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
			Delete(&EvalCollectionMemberModel{}).Error; err != nil {
			return fmt.Errorf("delete collection members: %w", err)
		}
		// Delete collection
		if err := tx.Where("tenant_id = ? AND collection_id = ?", tenantID, collectionID).
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

	models := make([]EvalCollectionMemberModel, len(savedIDs))
	for i, sid := range savedIDs {
		models[i] = EvalCollectionMemberModel{
			TenantID:     tenantID,
			CollectionID: collectionID,
			SavedID:      sid,
			AddedBy:      addedBy,
		}
	}

	// Use ON CONFLICT IGNORE for idempotent adds
	return s.db.WithContext(ctx).Clauses(clause.Insert{Modifier: "IGNORE"}).
		Create(&models).Error
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

	q := s.db.WithContext(ctx).
		Table("eval_collection_members m").
		Select("s.*").
		Joins("JOIN eval_saved_conversations s ON s.tenant_id = m.tenant_id AND s.saved_id = m.saved_id").
		Where("m.tenant_id = ? AND m.collection_id = ?", tenantID, collectionID).
		Order("m.saved_id ASC").
		Limit(limit + 1)

	if cursor != "" {
		q = q.Where("m.saved_id > ?", cursor)
	}

	var models []EvalSavedConversationModel
	if err := q.Find(&models).Error; err != nil {
		return nil, "", fmt.Errorf("list collection members: %w", err)
	}

	var nextCursor string
	if len(models) > limit {
		nextCursor = models[limit-1].SavedID
		models = models[:limit]
	}

	result := make([]evalpkg.SavedConversation, len(models))
	for i, m := range models {
		sc, err := savedConversationModelToEntity(m)
		if err != nil {
			return nil, "", fmt.Errorf("convert member %d: %w", i, err)
		}
		result[i] = sc
	}

	return result, nextCursor, nil
}

func (s *WALStore) ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error) {
	var models []EvalCollectionModel
	err := s.db.WithContext(ctx).
		Table("eval_collections c").
		Select("c.*").
		Joins("JOIN eval_collection_members m ON m.tenant_id = c.tenant_id AND m.collection_id = c.collection_id").
		Where("m.tenant_id = ? AND m.saved_id = ?", tenantID, savedID).
		Order("c.name ASC").
		Find(&models).Error
	if err != nil {
		return nil, fmt.Errorf("list collections for saved conversation: %w", err)
	}

	// Batch count members
	collectionIDs := make([]string, len(models))
	for i, m := range models {
		collectionIDs[i] = m.CollectionID
	}
	type countResult struct {
		CollectionID string
		Count        int
	}
	var counts []countResult
	if len(collectionIDs) > 0 {
		s.db.WithContext(ctx).Model(&EvalCollectionMemberModel{}).
			Select("collection_id, COUNT(*) as count").
			Where("tenant_id = ? AND collection_id IN ?", tenantID, collectionIDs).
			Group("collection_id").
			Find(&counts)
	}
	countMap := make(map[string]int, len(counts))
	for _, c := range counts {
		countMap[c.CollectionID] = c.Count
	}

	result := make([]evalpkg.Collection, len(models))
	for i, m := range models {
		result[i] = collectionModelToEntity(m)
		result[i].MemberCount = countMap[m.CollectionID]
	}
	return result, nil
}

// DeleteCollectionMembersBySavedID removes all membership rows for a saved conversation
// across all collections. Called when a saved conversation is deleted.
func (s *WALStore) DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error {
	return s.db.WithContext(ctx).
		Where("tenant_id = ? AND saved_id = ?", tenantID, savedID).
		Delete(&EvalCollectionMemberModel{}).Error
}

func collectionModelToEntity(m EvalCollectionModel) evalpkg.Collection {
	return evalpkg.Collection{
		TenantID:     m.TenantID,
		CollectionID: m.CollectionID,
		Name:         m.Name,
		Description:  m.Description,
		CreatedBy:    m.CreatedBy,
		UpdatedBy:    m.UpdatedBy,
		CreatedAt:    m.CreatedAt,
		UpdatedAt:    m.UpdatedAt,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/storage/mysql/ -run TestCollection -v -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/collection.go sigil/internal/storage/mysql/collection_test.go
git commit -m "feat(storage): implement CollectionStore for eval collections

Add CRUD operations for collections and many-to-many membership
management with saved conversations. Includes idempotent member
add/remove, cascade delete of memberships, and batch member count."
```

---

## Chunk 2: Backend Service + HTTP Handlers

### Task 4: Collection Service

**Files:**
- Create: `sigil/internal/eval/control/collection_service.go`
- Create: `sigil/internal/eval/control/collection_service_test.go`

- [ ] **Step 1: Write service tests**

Create `sigil/internal/eval/control/collection_service_test.go`:

```go
package evalcontrol

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type mockCollectionStore struct {
	mu          sync.Mutex
	collections map[string]*evalpkg.Collection
	members     map[string]map[string]bool // collectionID -> set of savedIDs
	createErr   error
}

func newMockCollectionStore() *mockCollectionStore {
	return &mockCollectionStore{
		collections: make(map[string]*evalpkg.Collection),
		members:     make(map[string]map[string]bool),
	}
}

func (m *mockCollectionStore) CreateCollection(_ context.Context, c evalpkg.Collection) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		return m.createErr
	}
	key := c.TenantID + "/" + c.CollectionID
	if _, ok := m.collections[key]; ok {
		return evalpkg.ErrConflict
	}
	m.collections[key] = &c
	return nil
}

func (m *mockCollectionStore) GetCollection(_ context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.collections[tenantID+"/"+collectionID]
	if !ok {
		return nil, nil
	}
	cp := *c
	if mems, ok := m.members[collectionID]; ok {
		cp.MemberCount = len(mems)
	}
	return &cp, nil
}

func (m *mockCollectionStore) ListCollections(_ context.Context, tenantID string, limit int, cursor string) ([]evalpkg.Collection, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result []evalpkg.Collection
	for _, c := range m.collections {
		if c.TenantID == tenantID {
			result = append(result, *c)
		}
	}
	return result, "", nil
}

func (m *mockCollectionStore) UpdateCollection(_ context.Context, tenantID, collectionID string, name, description, updatedBy *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := tenantID + "/" + collectionID
	c, ok := m.collections[key]
	if !ok {
		return evalpkg.ErrNotFound
	}
	if name != nil {
		c.Name = *name
	}
	if description != nil {
		c.Description = *description
	}
	if updatedBy != nil {
		c.UpdatedBy = *updatedBy
	}
	return nil
}

func (m *mockCollectionStore) DeleteCollection(_ context.Context, tenantID, collectionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.collections, tenantID+"/"+collectionID)
	delete(m.members, collectionID)
	return nil
}

func (m *mockCollectionStore) AddCollectionMembers(_ context.Context, tenantID, collectionID string, savedIDs []string, addedBy string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.members[collectionID]; !ok {
		m.members[collectionID] = make(map[string]bool)
	}
	for _, sid := range savedIDs {
		m.members[collectionID][sid] = true
	}
	return nil
}

func (m *mockCollectionStore) RemoveCollectionMember(_ context.Context, tenantID, collectionID, savedID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mems, ok := m.members[collectionID]; ok {
		delete(mems, savedID)
	}
	return nil
}

func (m *mockCollectionStore) ListCollectionMembers(_ context.Context, tenantID, collectionID string, limit int, cursor string) ([]evalpkg.SavedConversation, string, error) {
	return nil, "", nil
}

func (m *mockCollectionStore) DeleteCollectionMembersBySavedID(_ context.Context, tenantID, savedID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for cid, mems := range m.members {
		_ = cid
		delete(mems, savedID)
	}
	return nil
}

func (m *mockCollectionStore) ListCollectionsForSavedConversation(_ context.Context, tenantID, savedID string) ([]evalpkg.Collection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result []evalpkg.Collection
	for cid, mems := range m.members {
		if mems[savedID] {
			if c, ok := m.collections[tenantID+"/"+cid]; ok {
				result = append(result, *c)
			}
		}
	}
	return result, nil
}

func TestCollectionServiceCreate(t *testing.T) {
	store := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(store, scStore)

	t.Run("success", func(t *testing.T) {
		col, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
			Name:      "Test Collection",
			CreatedBy: "user-1",
		})
		require.NoError(t, err)
		require.Equal(t, "Test Collection", col.Name)
		require.NotEmpty(t, col.CollectionID)
		require.Equal(t, "user-1", col.CreatedBy)
	})

	t.Run("empty name", func(t *testing.T) {
		_, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
			Name:      "",
			CreatedBy: "user-1",
		})
		require.Error(t, err)
		require.True(t, isValidationError(err))
	})

	t.Run("empty tenant", func(t *testing.T) {
		_, err := svc.CreateCollection(context.Background(), "", CreateCollectionRequest{
			Name:      "Test",
			CreatedBy: "user-1",
		})
		require.Error(t, err)
		require.True(t, isValidationError(err))
	})
}

func TestCollectionServiceUpdate(t *testing.T) {
	store := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(store, scStore)

	col, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
		Name:      "Original",
		CreatedBy: "user-1",
	})
	require.NoError(t, err)

	t.Run("update name", func(t *testing.T) {
		newName := "Updated"
		updatedBy := "user-2"
		err := svc.UpdateCollection(context.Background(), "tenant-1", col.CollectionID, UpdateCollectionRequest{
			Name:      &newName,
			UpdatedBy: updatedBy,
		})
		require.NoError(t, err)
	})

	t.Run("not found", func(t *testing.T) {
		newName := "X"
		err := svc.UpdateCollection(context.Background(), "tenant-1", "nonexistent", UpdateCollectionRequest{
			Name:      &newName,
			UpdatedBy: "user-1",
		})
		require.Error(t, err)
		require.True(t, isNotFoundError(err))
	})
}

func TestCollectionServiceAddMembers(t *testing.T) {
	store := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(store, scStore)

	col, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
		Name:      "Test",
		CreatedBy: "user-1",
	})
	require.NoError(t, err)

	// Add saved conversation to mock so validation passes
	scStore.data["tenant-1/saved-1"] = &evalpkg.SavedConversation{
		TenantID: "tenant-1",
		SavedID:  "saved-1",
	}

	t.Run("success", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", col.CollectionID, AddMembersRequest{
			SavedIDs: []string{"saved-1"},
			AddedBy:  "user-1",
		})
		require.NoError(t, err)
	})

	t.Run("empty saved_ids", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", col.CollectionID, AddMembersRequest{
			SavedIDs: []string{},
			AddedBy:  "user-1",
		})
		require.Error(t, err)
		require.True(t, isValidationError(err))
	})

	t.Run("nonexistent saved_id", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", col.CollectionID, AddMembersRequest{
			SavedIDs: []string{"does-not-exist"},
			AddedBy:  "user-1",
		})
		require.Error(t, err)
		require.True(t, isValidationError(err))
	})
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/eval/control/ -run TestCollectionService -v -count=1`
Expected: compilation failure — `NewCollectionService` does not exist

- [ ] **Step 3: Implement collection service**

Create `sigil/internal/eval/control/collection_service.go`:

```go
package evalcontrol

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

// CreateCollectionRequest is the input for creating a collection.
type CreateCollectionRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	CreatedBy   string `json:"created_by"`
}

// UpdateCollectionRequest is the input for updating a collection.
type UpdateCollectionRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	UpdatedBy   string  `json:"updated_by"`
}

// AddMembersRequest adds saved conversations to a collection.
type AddMembersRequest struct {
	SavedIDs []string `json:"saved_ids"`
	AddedBy  string   `json:"added_by"`
}

// CollectionService manages collection CRUD and membership.
type CollectionService struct {
	store   evalpkg.CollectionStore
	scStore evalpkg.SavedConversationStore
}

// NewCollectionService creates a new CollectionService.
func NewCollectionService(store evalpkg.CollectionStore, scStore evalpkg.SavedConversationStore) *CollectionService {
	return &CollectionService{store: store, scStore: scStore}
}

// CreateCollection validates and creates a new collection.
func (s *CollectionService) CreateCollection(ctx context.Context, tenantID string, req CreateCollectionRequest) (*evalpkg.Collection, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, ValidationError("tenant_id is required")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, ValidationError("name is required")
	}
	createdBy := strings.TrimSpace(req.CreatedBy)
	if createdBy == "" {
		return nil, ValidationError("created_by is required")
	}

	c := evalpkg.Collection{
		TenantID:     tenantID,
		CollectionID: uuid.New().String(),
		Name:         name,
		Description:  strings.TrimSpace(req.Description),
		CreatedBy:    createdBy,
		UpdatedBy:    createdBy,
	}

	if err := s.store.CreateCollection(ctx, c); err != nil {
		return nil, fmt.Errorf("create collection: %w", err)
	}
	return &c, nil
}

// GetCollection returns a collection by ID.
func (s *CollectionService) GetCollection(ctx context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	c, err := s.store.GetCollection(ctx, tenantID, collectionID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, NotFoundError("collection not found")
	}
	return c, nil
}

// ListCollections returns paginated collections for a tenant.
func (s *CollectionService) ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]evalpkg.Collection, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	return s.store.ListCollections(ctx, tenantID, limit, cursor)
}

// UpdateCollection updates a collection's mutable fields.
func (s *CollectionService) UpdateCollection(ctx context.Context, tenantID, collectionID string, req UpdateCollectionRequest) error {
	updatedBy := strings.TrimSpace(req.UpdatedBy)
	if updatedBy == "" {
		return ValidationError("updated_by is required")
	}

	var name, description *string
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" {
			return ValidationError("name cannot be empty")
		}
		name = &n
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		description = &d
	}

	if err := s.store.UpdateCollection(ctx, tenantID, collectionID, name, description, &updatedBy); err != nil {
		if err == evalpkg.ErrNotFound {
			return NotFoundError("collection not found")
		}
		return err
	}
	return nil
}

// DeleteCollection deletes a collection and its memberships.
func (s *CollectionService) DeleteCollection(ctx context.Context, tenantID, collectionID string) error {
	return s.store.DeleteCollection(ctx, tenantID, collectionID)
}

// AddMembers adds saved conversations to a collection.
func (s *CollectionService) AddMembers(ctx context.Context, tenantID, collectionID string, req AddMembersRequest) error {
	if len(req.SavedIDs) == 0 {
		return ValidationError("saved_ids is required and must not be empty")
	}
	addedBy := strings.TrimSpace(req.AddedBy)
	if addedBy == "" {
		return ValidationError("added_by is required")
	}

	// Verify collection exists
	c, err := s.store.GetCollection(ctx, tenantID, collectionID)
	if err != nil {
		return err
	}
	if c == nil {
		return NotFoundError("collection not found")
	}

	// Validate all saved_ids exist
	for _, sid := range req.SavedIDs {
		sc, err := s.scStore.GetSavedConversation(ctx, tenantID, sid)
		if err != nil {
			return fmt.Errorf("lookup saved conversation %q: %w", sid, err)
		}
		if sc == nil {
			return ValidationError(fmt.Sprintf("saved conversation %q not found", sid))
		}
	}

	return s.store.AddCollectionMembers(ctx, tenantID, collectionID, req.SavedIDs, addedBy)
}

// RemoveMember removes a saved conversation from a collection.
func (s *CollectionService) RemoveMember(ctx context.Context, tenantID, collectionID, savedID string) error {
	return s.store.RemoveCollectionMember(ctx, tenantID, collectionID, savedID)
}

// ListMembers returns paginated saved conversations in a collection.
func (s *CollectionService) ListMembers(ctx context.Context, tenantID, collectionID string, limit int, cursor string) ([]evalpkg.SavedConversation, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	return s.store.ListCollectionMembers(ctx, tenantID, collectionID, limit, cursor)
}

// ListCollectionsForSavedConversation returns all collections containing a saved conversation.
func (s *CollectionService) ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error) {
	return s.store.ListCollectionsForSavedConversation(ctx, tenantID, savedID)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/eval/control/ -run TestCollectionService -v -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sigil/internal/eval/control/collection_service.go sigil/internal/eval/control/collection_service_test.go
git commit -m "feat(eval): add CollectionService with CRUD and membership management

Validates inputs, generates UUIDs for collection IDs, checks saved
conversation existence before adding members, and delegates to
CollectionStore for persistence."
```

---

### Task 5: HTTP Handlers

**Files:**
- Create: `sigil/internal/eval/control/http_collections.go`
- Create: `sigil/internal/eval/control/http_collections_test.go`

- [ ] **Step 1: Write HTTP handler tests**

Create `sigil/internal/eval/control/http_collections_test.go`:

```go
package evalcontrol

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func newCollectionMux(t *testing.T) (*http.ServeMux, *CollectionService) {
	t.Helper()
	store := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(store, scStore)
	mux := http.NewServeMux()
	RegisterCollectionRoutes(mux, svc, tenantauth.HTTPMiddleware("fake"))
	return mux, svc
}

func TestHTTPCollectionsCRUD(t *testing.T) {
	mux, _ := newCollectionMux(t)

	// Create
	body, _ := json.Marshal(CreateCollectionRequest{
		Name:        "Test Collection",
		Description: "A test",
		CreatedBy:   "user-1",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/collections", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var created evalpkg.Collection
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.Equal(t, "Test Collection", created.Name)
	require.NotEmpty(t, created.CollectionID)

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/collections", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/collections/"+created.CollectionID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/eval/collections/"+created.CollectionID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestHTTPCollectionsNilSafety(t *testing.T) {
	mux := http.NewServeMux()
	RegisterCollectionRoutes(mux, nil, nil)
	// Should not panic, routes should not be registered
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/eval/control/ -run TestHTTPCollections -v -count=1`
Expected: compilation failure — `RegisterCollectionRoutes` does not exist

- [ ] **Step 3: Implement HTTP handlers**

Create `sigil/internal/eval/control/http_collections.go`:

```go
package evalcontrol

import (
	"net/http"
	"strings"
)

// RegisterCollectionRoutes registers HTTP routes for collection management.
func RegisterCollectionRoutes(
	mux *http.ServeMux,
	svc *CollectionService,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	if mux == nil || svc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/collections", protectedMiddleware(http.HandlerFunc(svc.handleCollections)))
	mux.Handle("/api/v1/eval/collections/", protectedMiddleware(http.HandlerFunc(svc.handleCollectionRoutes)))
}

func (s *CollectionService) handleCollections(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		s.handleListCollections(w, req)
	case http.MethodPost:
		s.handleCreateCollection(w, req)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *CollectionService) handleCollectionRoutes(w http.ResponseWriter, req *http.Request) {
	// Path: /api/v1/eval/collections/{collection_id}[/members[/{saved_id}]]
	rest := strings.TrimPrefix(req.URL.Path, "/api/v1/eval/collections/")
	parts := strings.SplitN(rest, "/", 3)

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "collection_id required", http.StatusBadRequest)
		return
	}

	collectionID := parts[0]

	// /api/v1/eval/collections/{collection_id}
	if len(parts) == 1 {
		switch req.Method {
		case http.MethodGet:
			s.handleGetCollection(w, req, collectionID)
		case http.MethodPatch:
			s.handleUpdateCollection(w, req, collectionID)
		case http.MethodDelete:
			s.handleDeleteCollection(w, req, collectionID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// /api/v1/eval/collections/{collection_id}/members[/{saved_id}]
	if parts[1] == "members" {
		if len(parts) == 2 {
			switch req.Method {
			case http.MethodGet:
				s.handleListMembers(w, req, collectionID)
			case http.MethodPost:
				s.handleAddMembers(w, req, collectionID)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}
		if len(parts) == 3 && parts[2] != "" {
			savedID := parts[2]
			if req.Method == http.MethodDelete {
				s.handleRemoveMember(w, req, collectionID, savedID)
				return
			}
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
	}

	http.Error(w, "invalid collection path", http.StatusBadRequest)
}

func (s *CollectionService) handleCreateCollection(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var body CreateCollectionRequest
	if err := decodeJSONBody(req, &body); err != nil {
		writeControlWriteError(w, ValidationWrap(err))
		return
	}

	col, err := s.CreateCollection(req.Context(), tenantID, body)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (s *CollectionService) handleListCollections(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	limit, cursor, err := parseStringCursorPagination(req)
	if err != nil {
		writeControlWriteError(w, ValidationWrap(err))
		return
	}

	items, nextCursor, err := s.ListCollections(req.Context(), tenantID, limit, cursor)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": nextCursor,
	})
}

func (s *CollectionService) handleGetCollection(w http.ResponseWriter, req *http.Request, collectionID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	col, err := s.GetCollection(req.Context(), tenantID, collectionID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (s *CollectionService) handleUpdateCollection(w http.ResponseWriter, req *http.Request, collectionID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var body UpdateCollectionRequest
	if err := decodeJSONBody(req, &body); err != nil {
		writeControlWriteError(w, ValidationWrap(err))
		return
	}

	if err := s.UpdateCollection(req.Context(), tenantID, collectionID, body); err != nil {
		writeControlWriteError(w, err)
		return
	}

	col, err := s.GetCollection(req.Context(), tenantID, collectionID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (s *CollectionService) handleDeleteCollection(w http.ResponseWriter, req *http.Request, collectionID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	if err := s.DeleteCollection(req.Context(), tenantID, collectionID); err != nil {
		writeControlWriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *CollectionService) handleAddMembers(w http.ResponseWriter, req *http.Request, collectionID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var body AddMembersRequest
	if err := decodeJSONBody(req, &body); err != nil {
		writeControlWriteError(w, ValidationWrap(err))
		return
	}

	if err := s.AddMembers(req.Context(), tenantID, collectionID, body); err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *CollectionService) handleListMembers(w http.ResponseWriter, req *http.Request, collectionID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	limit, cursor, err := parseStringCursorPagination(req)
	if err != nil {
		writeControlWriteError(w, ValidationWrap(err))
		return
	}

	items, nextCursor, err := s.ListMembers(req.Context(), tenantID, collectionID, limit, cursor)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": nextCursor,
	})
}

func (s *CollectionService) handleRemoveMember(w http.ResponseWriter, req *http.Request, collectionID, savedID string) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	if err := s.RemoveMember(req.Context(), tenantID, collectionID, savedID); err != nil {
		writeControlWriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseStringCursorPagination parses limit and cursor (string-based) from query params.
func parseStringCursorPagination(req *http.Request) (int, string, error) {
	limit := 50
	if v := req.URL.Query().Get("limit"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			limit = n
		}
	}
	cursor := req.URL.Query().Get("cursor")
	return limit, cursor, nil
}
```

Note: The `parseStringCursorPagination` function needs `"fmt"` imported. Add it to the import block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/eval/control/ -run TestHTTPCollections -v -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sigil/internal/eval/control/http_collections.go sigil/internal/eval/control/http_collections_test.go
git commit -m "feat(eval): add HTTP handlers for collection endpoints

Register routes for CRUD operations on collections and membership
management. Routes follow existing pattern with nil-safe registration
and protected middleware."
```

---

### Task 6: Backend Wiring

**Files:**
- Modify: `sigil/internal/querier_module.go` (~line 244, after savedConvSvc creation)

- [ ] **Step 1: Wire CollectionService and register routes**

After the `savedConvSvc` block (line 244), add:

```go
	var collectionSvc *evalcontrol.CollectionService
	if colStore, ok := generationStore.(evalpkg.CollectionStore); ok {
		if scStore, ok := generationStore.(evalpkg.SavedConversationStore); ok {
			collectionSvc = evalcontrol.NewCollectionService(colStore, scStore)
		}
	}
```

Inside the `registry.RegisterHTTP` block (after line 267, after `RegisterSavedConversationRoutes`), add:

```go
			evalcontrol.RegisterCollectionRoutes(mux, collectionSvc, protectedMiddleware)
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go build ./...`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add sigil/internal/querier_module.go
git commit -m "feat(eval): wire CollectionService into querier module

Create CollectionService when the store implements CollectionStore
and register HTTP routes alongside saved conversation routes."
```

---

## Chunk 3: Plugin Proxy + Frontend

### Task 7: Plugin Proxy Routes

**Files:**
- Modify: `apps/plugin/pkg/plugin/resources.go`

- [ ] **Step 1: Add proxy handler methods**

Add these methods to the `App` struct in `resources.go`, before `registerRoutes`:

```go
func (a *App) handleEvalCollections(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/collections", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/collections", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalCollectionRoutes(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/eval/collections/")
	if rest == "" {
		http.Error(w, "invalid collection path", http.StatusBadRequest)
		return
	}
	path := "/api/v1/eval/collections/" + rest
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, path, http.MethodPost)
	case http.MethodPatch:
		a.handleProxy(w, req, path, http.MethodPatch)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
```

- [ ] **Step 2: Register routes in `registerRoutes`**

Add after the saved-conversations routes (after line 1209):

```go
	mux.HandleFunc("/eval/collections", a.withAuthorization(a.handleEvalCollections))
	mux.HandleFunc("/eval/collections/", a.withAuthorization(a.handleEvalCollectionRoutes))
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/apps/plugin && go build ./...`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/pkg/plugin/resources.go
git commit -m "feat(plugin): add proxy routes for eval collection endpoints

Proxy /eval/collections/* to the Sigil backend API, using the same
authorization wrapper as other eval routes."
```

---

### Task 8: Frontend Types

**Files:**
- Modify: `apps/plugin/src/evaluation/types.ts`

- [ ] **Step 1: Add collection types**

Add at the end of `types.ts` (before the closing of the file):

```typescript
export type Collection = {
  tenant_id: string;
  collection_id: string;
  name: string;
  description?: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  member_count: number;
};

export type CollectionListResponse = {
  items: Collection[];
  next_cursor: string;
};

export type CreateCollectionRequest = {
  name: string;
  description?: string;
  created_by: string;
};

export type UpdateCollectionRequest = {
  name?: string;
  description?: string;
  updated_by: string;
};

export type AddCollectionMembersRequest = {
  saved_ids: string[];
  added_by: string;
};

export type CollectionMembersResponse = {
  items: SavedConversation[];
  next_cursor: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/plugin/src/evaluation/types.ts
git commit -m "feat(plugin): add TypeScript types for eval collections"
```

---

### Task 9: Frontend API Methods

**Files:**
- Modify: `apps/plugin/src/evaluation/api.ts`

- [ ] **Step 1: Add collection imports to api.ts**

Add to the import block at the top of `api.ts`:

```typescript
import type {
  // ... existing imports ...
  AddCollectionMembersRequest,
  Collection,
  CollectionListResponse,
  CollectionMembersResponse,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from './types';
```

- [ ] **Step 2: Add collection methods to EvaluationDataSource type**

Add after `createManualConversation` in the `EvaluationDataSource` type:

```typescript
  listCollections: (limit?: number, cursor?: string) => Promise<CollectionListResponse>;
  createCollection: (request: CreateCollectionRequest) => Promise<Collection>;
  getCollection: (collectionID: string) => Promise<Collection>;
  updateCollection: (collectionID: string, request: UpdateCollectionRequest) => Promise<Collection>;
  deleteCollection: (collectionID: string) => Promise<void>;
  addCollectionMembers: (collectionID: string, request: AddCollectionMembersRequest) => Promise<void>;
  removeCollectionMember: (collectionID: string, savedID: string) => Promise<void>;
  listCollectionMembers: (collectionID: string, limit?: number, cursor?: string) => Promise<CollectionMembersResponse>;
  listCollectionsForSavedConversation: (savedID: string) => Promise<CollectionListResponse>;
```

- [ ] **Step 3: Add method implementations to defaultEvaluationDataSource**

Add after the `createManualConversation` implementation:

```typescript
  async listCollections(limit?: number, cursor?: string) {
    const params = new URLSearchParams();
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor) {
      params.set('cursor', cursor);
    }
    const qs = params.toString();
    const url = qs.length > 0 ? `${evalBasePath}/collections?${qs}` : `${evalBasePath}/collections`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<CollectionListResponse>({ method: 'GET', url })
    );
    return response.data;
  },

  async createCollection(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Collection>({
        method: 'POST',
        url: `${evalBasePath}/collections`,
        data: request,
      })
    );
    return response.data;
  },

  async getCollection(collectionID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Collection>({
        method: 'GET',
        url: `${evalBasePath}/collections/${encodeURIComponent(collectionID)}`,
      })
    );
    return response.data;
  },

  async updateCollection(collectionID, request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Collection>({
        method: 'PATCH',
        url: `${evalBasePath}/collections/${encodeURIComponent(collectionID)}`,
        data: request,
      })
    );
    return response.data;
  },

  async deleteCollection(collectionID) {
    await lastValueFrom(
      getBackendSrv().fetch<void>({
        method: 'DELETE',
        url: `${evalBasePath}/collections/${encodeURIComponent(collectionID)}`,
        responseType: 'text',
      })
    );
  },

  async addCollectionMembers(collectionID, request) {
    await lastValueFrom(
      getBackendSrv().fetch<void>({
        method: 'POST',
        url: `${evalBasePath}/collections/${encodeURIComponent(collectionID)}/members`,
        data: request,
      })
    );
  },

  async removeCollectionMember(collectionID, savedID) {
    await lastValueFrom(
      getBackendSrv().fetch<void>({
        method: 'DELETE',
        url: `${evalBasePath}/collections/${encodeURIComponent(collectionID)}/members/${encodeURIComponent(savedID)}`,
        responseType: 'text',
      })
    );
  },

  async listCollectionMembers(collectionID, limit?: number, cursor?: string) {
    const params = new URLSearchParams();
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor) {
      params.set('cursor', cursor);
    }
    const qs = params.toString();
    const url =
      qs.length > 0
        ? `${evalBasePath}/collections/${encodeURIComponent(collectionID)}/members?${qs}`
        : `${evalBasePath}/collections/${encodeURIComponent(collectionID)}/members`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<CollectionMembersResponse>({ method: 'GET', url })
    );
    return response.data;
  },

  async listCollectionsForSavedConversation(savedID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<CollectionListResponse>({
        method: 'GET',
        url: `${evalBasePath}/saved-conversations/${encodeURIComponent(savedID)}/collections`,
      })
    );
    return response.data;
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections && npx tsc --noEmit -p apps/plugin/tsconfig.json`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/plugin/src/evaluation/api.ts
git commit -m "feat(plugin): add collection API methods to EvaluationDataSource

Add listCollections, createCollection, getCollection, updateCollection,
deleteCollection, addCollectionMembers, removeCollectionMember,
listCollectionMembers, and listCollectionsForSavedConversation."
```

---

### Task 10: GenerationPicker Collection Filter

**Files:**
- Modify: `apps/plugin/src/components/evaluation/GenerationPicker.tsx`

- [ ] **Step 1: Add collection filter to GenerationPicker**

Add import for `Collection` type:

```typescript
import type { Collection, SavedConversation } from '../../evaluation/types';
```

Add `Select` to the Grafana UI imports:

```typescript
import { Button, Icon, Input, Select, Spinner, Text, useStyles2 } from '@grafana/ui';
```

Add state for collections after the `loadingSaved` state (line 141):

```typescript
const [collections, setCollections] = useState<Collection[]>([]);
const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);
```

Add a `useEffect` to load collections when the Saved tab is active. Add after the existing saved conversations `useEffect` (after line 229):

```typescript
  // Load collections when saved tab is active
  useEffect(() => {
    if (tab !== 'saved') {
      return;
    }
    let cancelled = false;
    evalDs
      .listCollections?.(100)
      .then((resp) => {
        if (!cancelled) {
          setCollections(resp.items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCollections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, evalDs]);
```

Modify the saved conversations loading `useEffect` (lines 201-229) to filter by collection when one is selected:

```typescript
  // Load saved conversations when the saved tab is active
  useEffect(() => {
    if (tab !== 'saved') {
      return;
    }
    let cancelled = false;
    setLoadingSaved(true);

    const load = selectedCollectionId
      ? evalDs.listCollectionMembers?.(selectedCollectionId, 50) ??
        Promise.resolve({ items: [], next_cursor: '' })
      : evalDs.listSavedConversations(undefined, 50);

    load
      .then((resp) => {
        if (!cancelled) {
          setSavedConversations((resp.items ?? []).slice().reverse());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedConversations([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSaved(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, evalDs, selectedCollectionId]);
```

Add the collection filter dropdown in the Saved tab UI. Replace the `{tab === 'saved' && (` block (lines 350-386) with:

```tsx
      {tab === 'saved' && (
        <>
          {collections.length > 0 && (
            <div className={styles.searchBox}>
              <Select
                options={[
                  { label: 'All saved conversations', value: undefined },
                  ...collections.map((c) => ({
                    label: `${c.name} (${c.member_count})`,
                    value: c.collection_id,
                  })),
                ]}
                value={selectedCollectionId}
                onChange={(v) => setSelectedCollectionId(v.value)}
                placeholder="Filter by collection..."
                isClearable
              />
            </div>
          )}
          <div className={styles.list}>
            {loadingSaved && (
              <div className={styles.empty}>
                <Spinner />
              </div>
            )}
            {!loadingSaved &&
              savedConversations.map((sc) => (
                <div
                  key={sc.saved_id}
                  className={styles.row}
                  onClick={() => handleConversationClick(sc.conversation_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleConversationClick(sc.conversation_id)}
                >
                  <Text variant="bodySmall" weight="medium" truncate>
                    {sc.name}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    <span className={styles.sourceBadge}>{sc.source}</span> &middot; {sc.saved_by} &middot;{' '}
                    {sc.created_at ? new Date(sc.created_at).toLocaleString() : '\u2014'}
                  </Text>
                </div>
              ))}
            {!loadingSaved && savedConversations.length === 0 && (
              <div className={styles.empty}>
                <Text variant="bodySmall" color="secondary">
                  {selectedCollectionId ? 'No conversations in this collection.' : 'No saved conversations.'}
                </Text>
              </div>
            )}
          </div>
        </>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections && npx tsc --noEmit -p apps/plugin/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Update Storybook stories**

Modify `apps/plugin/src/stories/evaluation/GenerationPicker.stories.tsx` to add collection mock methods to the `mockEvalDs` object:

```typescript
  listCollections: async () => ({ items: [
    { tenant_id: 't', collection_id: 'col-1', name: 'Auth Regression', description: '', created_by: 'user-1', updated_by: 'user-1', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z', member_count: 3 },
    { tenant_id: 't', collection_id: 'col-2', name: 'Streaming Edge Cases', description: '', created_by: 'user-1', updated_by: 'user-1', created_at: '2026-03-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z', member_count: 1 },
  ], next_cursor: '' }),
  createCollection: async () => ({} as any),
  getCollection: async () => ({} as any),
  updateCollection: async () => ({} as any),
  deleteCollection: async () => {},
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
  listCollectionMembers: async () => ({ items: mockSavedConversations.slice(0, 1), next_cursor: '' }),
  listCollectionsForSavedConversation: async () => ({ items: [], next_cursor: '' }),
```

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/src/components/evaluation/GenerationPicker.tsx apps/plugin/src/stories/evaluation/GenerationPicker.stories.tsx
git commit -m "feat(plugin): add collection filter dropdown to GenerationPicker

When collections exist, show a dropdown in the Saved tab to filter
saved conversations by collection. Defaults to showing all."
```

---

## Chunk 4: Reverse Lookup, Cascade Delete, Final Verification

### Task 11: Reverse Lookup + Saved Conversation Delete Cascade

Two things to wire up:

1. `GET /api/v1/eval/saved-conversations/{saved_id}/collections` — reverse lookup (matches spec URL)
2. When a saved conversation is deleted, cascade-delete its collection membership rows

**Files:**
- Modify: `sigil/internal/eval/control/saved_conversation_service.go` — add `CollectionLister` and `CollectionMemberCleaner` interfaces + options
- Modify: `sigil/internal/eval/control/http_saved_conversations.go` — extend path parsing for `{saved_id}/collections`
- Modify: `apps/plugin/pkg/plugin/resources.go` — extend proxy to handle the sub-path
- Modify: `sigil/internal/querier_module.go` — wire the new dependencies

- [ ] **Step 1: Add interfaces and options to `saved_conversation_service.go`**

Add to the file:

```go
// CollectionLister lists collections for a saved conversation.
type CollectionLister interface {
	ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error)
}

// CollectionMemberCleaner cleans up collection memberships for a saved conversation.
type CollectionMemberCleaner interface {
	DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error
}

func WithCollectionLister(cl CollectionLister) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.collectionLister = cl }
}

func WithCollectionMemberCleaner(c CollectionMemberCleaner) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.collectionCleaner = c }
}
```

Add fields to the `SavedConversationService` struct:

```go
collectionLister  CollectionLister
collectionCleaner CollectionMemberCleaner
```

In `DeleteSavedConversation`, add membership cleanup before or after the saved conversation delete:

```go
if s.collectionCleaner != nil {
	_ = s.collectionCleaner.DeleteCollectionMembersBySavedID(ctx, tenantID, savedID)
}
```

- [ ] **Step 2: Extend `handleSavedConversationByID` for the `/collections` sub-path**

In `http_saved_conversations.go`, modify the handler to parse the path and detect the `/collections` suffix. The existing handler uses `pathID` — replace it with manual path parsing:

```go
func (s *SavedConversationService) handleSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/api/v1/eval/saved-conversations/")

	// Handle {saved_id}/collections sub-path
	if strings.HasSuffix(rest, "/collections") {
		savedID := strings.TrimSuffix(rest, "/collections")
		if savedID == "" || strings.Contains(savedID, "/") {
			http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.handleListCollectionsForSaved(w, req, savedID)
		return
	}

	// Existing: {saved_id} only
	if rest == "" || strings.Contains(rest, "/") {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}
	savedID := rest
	switch req.Method {
	case http.MethodGet:
		// ... existing GET logic ...
	case http.MethodDelete:
		// ... existing DELETE logic ...
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SavedConversationService) handleListCollectionsForSaved(w http.ResponseWriter, req *http.Request, savedID string) {
	if s.collectionLister == nil {
		http.Error(w, "collections not available", http.StatusServiceUnavailable)
		return
	}
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}
	collections, err := s.collectionLister.ListCollectionsForSavedConversation(req.Context(), tenantID, savedID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":       collections,
		"next_cursor": "",
	})
}
```

- [ ] **Step 3: Extend plugin proxy**

In `resources.go`, modify `handleEvalSavedConversationByID` to allow the `/collections` sub-path:

```go
func (a *App) handleEvalSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/eval/saved-conversations/")
	if rest == "" {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}

	// Handle {saved_id}/collections sub-path
	if strings.HasSuffix(rest, "/collections") {
		savedID := strings.TrimSuffix(rest, "/collections")
		if savedID == "" || strings.Contains(savedID, "/") {
			http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/saved-conversations/%s/collections", savedID)
		a.handleProxy(w, req, path, http.MethodGet)
		return
	}

	// Existing behavior: {saved_id} only
	if strings.Contains(rest, "/") {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/saved-conversations/%s", rest)
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
```

No new route registration needed — the existing `/eval/saved-conversations/` route already captures this.

The frontend `listCollectionsForSavedConversation` URL in `api.ts` already uses the correct spec path:
```typescript
url: `${evalBasePath}/saved-conversations/${encodeURIComponent(savedID)}/collections`,
```

- [ ] **Step 4: Wire new dependencies in `querier_module.go`**

After `collectionSvc` is created, wire it into `savedConvSvc`:

```go
if collectionSvc != nil && savedConvSvc != nil {
	savedConvSvc.SetCollectionLister(collectionSvc)
}
if cleaner, ok := generationStore.(evalcontrol.CollectionMemberCleaner); ok && savedConvSvc != nil {
	scOpts = append(scOpts, evalcontrol.WithCollectionMemberCleaner(cleaner))
}
```

Note: Since `savedConvSvc` is created before `collectionSvc`, use a setter method (`SetCollectionLister`) rather than an option for the lister. For the cleaner, add it to `scOpts` before `savedConvSvc` construction since `WALStore` implements `CollectionMemberCleaner` directly.

Add the setter to `SavedConversationService`:
```go
func (s *SavedConversationService) SetCollectionLister(cl CollectionLister) {
	s.collectionLister = cl
}
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go build ./...
cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/apps/plugin && go build ./...
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add sigil/internal/eval/control/saved_conversation_service.go sigil/internal/eval/control/http_saved_conversations.go sigil/internal/storage/mysql/collection.go apps/plugin/pkg/plugin/resources.go sigil/internal/querier_module.go
git commit -m "feat(eval): add reverse lookup and cascade delete for collection memberships

Extend saved conversation handler to serve GET /{saved_id}/collections
using the spec URL. Clean up collection memberships when a saved
conversation is deleted. Extend plugin proxy for the sub-path."
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full Go test suite**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections/sigil && go test ./internal/eval/... ./internal/storage/mysql/ -v -count=1`
Expected: all tests pass

- [ ] **Step 2: Run linting**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections && mise run lint`
Expected: no errors (or only pre-existing warnings)

- [ ] **Step 3: Run TypeScript typecheck**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections && npx tsc --noEmit -p apps/plugin/tsconfig.json`
Expected: no errors

- [ ] **Step 4: Run full check suite**

Run: `cd /Users/aes/repos/sigil/.claude/worktrees/saved-conv-collections && mise run check`
Expected: pass

- [ ] **Step 5: Update design doc status**

In `docs/design-docs/2026-03-11-eval-saved-conversation-collections.md`, change frontmatter `status: draft` to `status: active`.

```bash
git add docs/design-docs/2026-03-11-eval-saved-conversation-collections.md
git commit -m "docs: update collections design doc status to active"
```

---

## Deferred Items

The following spec items are deliberately deferred from this plan:

- **Saved conversations list view integration** (add/remove from collections outside eval test panel) — will be added in a follow-up once the core collections CRUD and GenerationPicker integration are validated.
- **Enriched membership metadata** (`added_by`, membership `created_at`) in `ListCollectionMembers` response — the current implementation returns `SavedConversation` objects. Enrichment can be added when the UI needs it.
