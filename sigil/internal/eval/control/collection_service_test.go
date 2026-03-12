package control

import (
	"context"
	"sync"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- mock collection store ---

type mockCollectionStore struct {
	mu          sync.Mutex
	collections map[string]*evalpkg.Collection // key: tenantID/collectionID
	members     map[string]map[string]bool     // key: collectionID -> set of savedIDs
	createErr   error
}

func newMockCollectionStore() *mockCollectionStore {
	return &mockCollectionStore{
		collections: make(map[string]*evalpkg.Collection),
		members:     make(map[string]map[string]bool),
	}
}

func (m *mockCollectionStore) key(tenantID, collectionID string) string {
	return tenantID + "/" + collectionID
}

func (m *mockCollectionStore) CreateCollection(_ context.Context, c evalpkg.Collection) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		return m.createErr
	}
	k := m.key(c.TenantID, c.CollectionID)
	copied := c
	m.collections[k] = &copied
	return nil
}

func (m *mockCollectionStore) GetCollection(_ context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.collections[m.key(tenantID, collectionID)]
	if !ok {
		return nil, nil
	}
	copied := *c
	return &copied, nil
}

func (m *mockCollectionStore) ListCollections(_ context.Context, tenantID string, limit int, _ string) ([]evalpkg.Collection, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []evalpkg.Collection
	for _, c := range m.collections {
		if c.TenantID != tenantID {
			continue
		}
		out = append(out, *c)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, "", nil
}

func (m *mockCollectionStore) UpdateCollection(_ context.Context, tenantID, collectionID string, name, description, updatedBy *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := m.key(tenantID, collectionID)
	c, ok := m.collections[k]
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
	delete(m.collections, m.key(tenantID, collectionID))
	delete(m.members, collectionID)
	return nil
}

func (m *mockCollectionStore) AddCollectionMembers(_ context.Context, _, collectionID string, savedIDs []string, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.members[collectionID] == nil {
		m.members[collectionID] = make(map[string]bool)
	}
	for _, id := range savedIDs {
		m.members[collectionID][id] = true
	}
	return nil
}

func (m *mockCollectionStore) RemoveCollectionMember(_ context.Context, _, collectionID, savedID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.members[collectionID]; ok {
		delete(s, savedID)
	}
	return nil
}

func (m *mockCollectionStore) ListCollectionMembers(_ context.Context, _, _ string, _ int, _ string) ([]evalpkg.SavedConversation, string, error) {
	return nil, "", nil
}

func (m *mockCollectionStore) ListCollectionsForSavedConversation(_ context.Context, _, _ string) ([]evalpkg.Collection, error) {
	return nil, nil
}

func (m *mockCollectionStore) DeleteCollectionMembersBySavedID(_ context.Context, _, _ string) error {
	return nil
}

// --- tests ---

func TestCollectionServiceCreate(t *testing.T) {
	cs := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(cs, scStore)

	t.Run("success", func(t *testing.T) {
		result, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
			Name:        "My Collection",
			Description: "A test collection",
			CreatedBy:   "user-1",
		})

		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, "tenant-1", result.TenantID)
		assert.Equal(t, "My Collection", result.Name)
		assert.Equal(t, "A test collection", result.Description)
		assert.Equal(t, "user-1", result.CreatedBy)
		assert.Equal(t, "user-1", result.UpdatedBy)
		assert.NotEmpty(t, result.CollectionID)
	})

	t.Run("empty name validation", func(t *testing.T) {
		_, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
			Name:      "  ",
			CreatedBy: "user-1",
		})

		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "name")
	})

	t.Run("empty tenant validation", func(t *testing.T) {
		_, err := svc.CreateCollection(context.Background(), "", CreateCollectionRequest{
			Name:      "Test",
			CreatedBy: "user-1",
		})

		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "tenant_id")
	})

	t.Run("empty created_by validation", func(t *testing.T) {
		_, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
			Name:      "Test",
			CreatedBy: "",
		})

		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "created_by")
	})
}

func TestCollectionServiceUpdate(t *testing.T) {
	cs := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(cs, scStore)

	// Seed a collection.
	created, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
		Name:      "Original",
		CreatedBy: "user-1",
	})
	require.NoError(t, err)
	collectionID := created.CollectionID

	t.Run("update name success", func(t *testing.T) {
		newName := "Updated Name"
		err := svc.UpdateCollection(context.Background(), "tenant-1", collectionID, UpdateCollectionRequest{
			Name:      &newName,
			UpdatedBy: "user-2",
		})
		require.NoError(t, err)

		updated, err := svc.GetCollection(context.Background(), "tenant-1", collectionID)
		require.NoError(t, err)
		assert.Equal(t, "Updated Name", updated.Name)
		assert.Equal(t, "user-2", updated.UpdatedBy)
	})

	t.Run("not found error", func(t *testing.T) {
		newName := "Doesn't Matter"
		err := svc.UpdateCollection(context.Background(), "tenant-1", "nonexistent-id", UpdateCollectionRequest{
			Name:      &newName,
			UpdatedBy: "user-1",
		})
		require.Error(t, err)
		assert.True(t, isNotFoundError(err), "expected not-found error, got: %v", err)
	})

	t.Run("empty updated_by validation", func(t *testing.T) {
		newName := "Test"
		err := svc.UpdateCollection(context.Background(), "tenant-1", collectionID, UpdateCollectionRequest{
			Name:      &newName,
			UpdatedBy: "",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
	})

	t.Run("empty name after trim validation", func(t *testing.T) {
		emptyName := "   "
		err := svc.UpdateCollection(context.Background(), "tenant-1", collectionID, UpdateCollectionRequest{
			Name:      &emptyName,
			UpdatedBy: "user-1",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "name")
	})
}

func TestCollectionServiceAddMembers(t *testing.T) {
	cs := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(cs, scStore)

	// Seed a collection.
	created, err := svc.CreateCollection(context.Background(), "tenant-1", CreateCollectionRequest{
		Name:      "Test Collection",
		CreatedBy: "user-1",
	})
	require.NoError(t, err)
	collectionID := created.CollectionID

	// Seed saved conversations in the scStore mock.
	scStore.data["tenant-1/saved-a"] = &evalpkg.SavedConversation{
		TenantID: "tenant-1",
		SavedID:  "saved-a",
		Name:     "Saved A",
	}
	scStore.data["tenant-1/saved-b"] = &evalpkg.SavedConversation{
		TenantID: "tenant-1",
		SavedID:  "saved-b",
		Name:     "Saved B",
	}

	t.Run("success", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", collectionID, AddMembersRequest{
			SavedIDs: []string{"saved-a", "saved-b"},
			AddedBy:  "user-1",
		})
		require.NoError(t, err)

		// Verify members were added to the mock store.
		cs.mu.Lock()
		assert.True(t, cs.members[collectionID]["saved-a"])
		assert.True(t, cs.members[collectionID]["saved-b"])
		cs.mu.Unlock()
	})

	t.Run("empty saved_ids validation", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", collectionID, AddMembersRequest{
			SavedIDs: nil,
			AddedBy:  "user-1",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "saved_ids")
	})

	t.Run("nonexistent saved_id validation", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", collectionID, AddMembersRequest{
			SavedIDs: []string{"saved-a", "saved-missing"},
			AddedBy:  "user-1",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "saved-missing")
	})

	t.Run("nonexistent collection", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", "no-such-collection", AddMembersRequest{
			SavedIDs: []string{"saved-a"},
			AddedBy:  "user-1",
		})
		require.Error(t, err)
		assert.True(t, isNotFoundError(err), "expected not-found error, got: %v", err)
	})

	t.Run("empty added_by validation", func(t *testing.T) {
		err := svc.AddMembers(context.Background(), "tenant-1", collectionID, AddMembersRequest{
			SavedIDs: []string{"saved-a"},
			AddedBy:  "",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "added_by")
	})
}
