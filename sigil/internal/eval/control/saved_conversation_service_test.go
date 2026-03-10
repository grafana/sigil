package control

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- mocks ---

type mockSavedConversationStore struct {
	mu           sync.Mutex
	data         map[string]*evalpkg.SavedConversation // key: tenantID + "/" + savedID
	createErr    error
	createHook   func(evalpkg.SavedConversation)
	getErr       error
	getByConvErr error
}

func newMockSavedConversationStore() *mockSavedConversationStore {
	return &mockSavedConversationStore{data: make(map[string]*evalpkg.SavedConversation)}
}

func (m *mockSavedConversationStore) key(tenantID, savedID string) string {
	return tenantID + "/" + savedID
}

func (m *mockSavedConversationStore) CreateSavedConversation(_ context.Context, sc evalpkg.SavedConversation) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		if m.createHook != nil {
			m.createHook(sc)
		}
		return m.createErr
	}
	k := m.key(sc.TenantID, sc.SavedID)
	if _, exists := m.data[k]; exists {
		return fmt.Errorf("saved conversation %q already exists", sc.SavedID)
	}
	copied := sc
	m.data[k] = &copied
	return nil
}

func (m *mockSavedConversationStore) GetSavedConversation(_ context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getErr != nil {
		return nil, m.getErr
	}
	sc, ok := m.data[m.key(tenantID, savedID)]
	if !ok {
		return nil, nil
	}
	copied := *sc
	return &copied, nil
}

func (m *mockSavedConversationStore) GetSavedConversationByConversationID(_ context.Context, tenantID, conversationID string) (*evalpkg.SavedConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getByConvErr != nil {
		return nil, m.getByConvErr
	}
	for _, sc := range m.data {
		if sc.TenantID == tenantID && sc.ConversationID == conversationID {
			copied := *sc
			return &copied, nil
		}
	}
	return nil, nil
}

func (m *mockSavedConversationStore) ListSavedConversations(_ context.Context, tenantID, source string, limit int, _ uint64) ([]evalpkg.SavedConversation, uint64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []evalpkg.SavedConversation
	for _, sc := range m.data {
		if sc.TenantID != tenantID {
			continue
		}
		if source != "" && string(sc.Source) != source {
			continue
		}
		out = append(out, *sc)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, 0, nil
}

func (m *mockSavedConversationStore) DeleteSavedConversation(_ context.Context, tenantID, savedID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, m.key(tenantID, savedID))
	return nil
}

type mockConversationLookup struct {
	data map[string]*storage.Conversation // key: tenantID + "/" + conversationID
}

func newMockConversationLookup() *mockConversationLookup {
	return &mockConversationLookup{data: make(map[string]*storage.Conversation)}
}

func (m *mockConversationLookup) Add(tenantID, conversationID string) {
	m.data[tenantID+"/"+conversationID] = &storage.Conversation{
		TenantID:       tenantID,
		ConversationID: conversationID,
	}
}

func (m *mockConversationLookup) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	conv, ok := m.data[tenantID+"/"+conversationID]
	if !ok {
		return nil, nil
	}
	return conv, nil
}

type mockManualConversationWriter struct {
	mu    sync.Mutex
	calls map[string]bool // key: tenantID + "/" + conversationID
}

func newMockManualConversationWriter() *mockManualConversationWriter {
	return &mockManualConversationWriter{calls: make(map[string]bool)}
}

func (m *mockManualConversationWriter) CreateManualConversation(_ context.Context, tenantID, conversationID string, _ []ManualGeneration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls[tenantID+"/"+conversationID] = true
	return nil
}

func (m *mockManualConversationWriter) Called(tenantID, conversationID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[tenantID+"/"+conversationID]
}

type mockManualConversationDeleter struct {
	mu    sync.Mutex
	calls map[string]bool // key: tenantID + "/" + conversationID
	err   error
}

func newMockManualConversationDeleter() *mockManualConversationDeleter {
	return &mockManualConversationDeleter{calls: make(map[string]bool)}
}

func (m *mockManualConversationDeleter) DeleteManualConversationData(_ context.Context, tenantID, conversationID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls[tenantID+"/"+conversationID] = true
	return m.err
}

func (m *mockManualConversationDeleter) Called(tenantID, conversationID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[tenantID+"/"+conversationID]
}

// --- tests ---

func TestSavedConversationServiceBookmark(t *testing.T) {
	store := newMockSavedConversationStore()
	lookup := newMockConversationLookup()
	lookup.Add("tenant-1", "conv-abc")

	svc := NewSavedConversationService(store, lookup)

	t.Run("bookmark existing conversation", func(t *testing.T) {
		result, err := svc.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
			SavedID:        "saved-1",
			ConversationID: "conv-abc",
			Name:           "My Bookmark",
			Tags:           map[string]string{"env": "prod"},
			SavedBy:        "user-1",
		})

		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, "tenant-1", result.TenantID)
		assert.Equal(t, "saved-1", result.SavedID)
		assert.Equal(t, "conv-abc", result.ConversationID)
		assert.Equal(t, "My Bookmark", result.Name)
		assert.Equal(t, evalpkg.SavedConversationSourceTelemetry, result.Source)
		assert.Equal(t, map[string]string{"env": "prod"}, result.Tags)
		assert.Equal(t, "user-1", result.SavedBy)
	})

	t.Run("bookmark non-existent conversation", func(t *testing.T) {
		_, err := svc.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
			SavedID:        "saved-2",
			ConversationID: "conv-missing",
			Name:           "Bad Bookmark",
			SavedBy:        "user-1",
		})

		require.Error(t, err)
		assert.True(t, isNotFoundError(err), "expected not-found error, got: %v", err)
		assert.Contains(t, err.Error(), "conv-missing")
	})

	t.Run("bookmark nil tags defaults to empty map", func(t *testing.T) {
		lookup.Add("tenant-1", "conv-def")
		result, err := svc.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
			SavedID:        "saved-3",
			ConversationID: "conv-def",
			Name:           "No Tags",
			Tags:           nil,
			SavedBy:        "user-1",
		})

		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, map[string]string{}, result.Tags)
	})

	t.Run("validation errors", func(t *testing.T) {
		tests := []struct {
			name string
			req  SaveConversationRequest
		}{
			{name: "empty saved_id", req: SaveConversationRequest{SavedID: "", ConversationID: "conv-abc", Name: "x", SavedBy: "u"}},
			{name: "empty conversation_id", req: SaveConversationRequest{SavedID: "s", ConversationID: "", Name: "x", SavedBy: "u"}},
			{name: "empty name", req: SaveConversationRequest{SavedID: "s", ConversationID: "conv-abc", Name: "", SavedBy: "u"}},
			{name: "empty saved_by", req: SaveConversationRequest{SavedID: "s", ConversationID: "conv-abc", Name: "x", SavedBy: ""}},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := svc.SaveConversation(context.Background(), "tenant-1", tt.req)
				require.Error(t, err)
				assert.True(t, isValidationError(err), "expected validation error for %s, got: %v", tt.name, err)
			})
		}
	})

	t.Run("empty tenant_id", func(t *testing.T) {
		_, err := svc.SaveConversation(context.Background(), "", SaveConversationRequest{
			SavedID:        "saved-x",
			ConversationID: "conv-abc",
			Name:           "x",
			SavedBy:        "u",
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
	})

	t.Run("nil conversation lookup returns error instead of panic", func(t *testing.T) {
		svcNoLookup := NewSavedConversationService(store, nil)
		assert.NotPanics(t, func() {
			_, err := svcNoLookup.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
				SavedID:        "saved-no-lookup",
				ConversationID: "conv-abc",
				Name:           "No Lookup",
				SavedBy:        "user-1",
			})
			require.Error(t, err)
			assert.Contains(t, err.Error(), "conversation lookup is not configured")
		})
	})
}

func TestSavedConversationServiceManualCreate(t *testing.T) {
	store := newMockSavedConversationStore()
	lookup := newMockConversationLookup()
	writer := newMockManualConversationWriter()

	svc := NewSavedConversationService(store, lookup, WithManualWriter(writer))

	t.Run("create manual conversation", func(t *testing.T) {
		deleter := newMockManualConversationDeleter()
		svcWithDeleter := NewSavedConversationService(store, lookup, WithManualWriter(writer), WithManualDeleter(deleter))
		result, err := svcWithDeleter.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-1",
			Name:    "Test Conversation",
			Tags:    map[string]string{"suite": "regression"},
			SavedBy: "user-1",
			Generations: []ManualGeneration{
				{
					GenerationID: "gen-1",
					Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
					Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
					Output:       []ManualMessage{{Role: "assistant", Content: "Hi there"}},
				},
			},
		})

		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, "tenant-1", result.TenantID)
		assert.Equal(t, "manual-1", result.SavedID)
		assert.Equal(t, "conv_manual_manual-1", result.ConversationID)
		assert.Equal(t, evalpkg.SavedConversationSourceManual, result.Source)
		assert.Equal(t, "Test Conversation", result.Name)
		assert.Equal(t, map[string]string{"suite": "regression"}, result.Tags)
		assert.Equal(t, "user-1", result.SavedBy)

		assert.True(t, writer.Called("tenant-1", "conv_manual_manual-1"), "expected manual writer to be called")
	})

	t.Run("validation: no generations", func(t *testing.T) {
		_, err := svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID:     "manual-2",
			Name:        "Empty",
			SavedBy:     "user-1",
			Generations: nil,
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
	})

	t.Run("validation: generation missing id", func(t *testing.T) {
		_, err := svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-3",
			Name:    "Bad Gen",
			SavedBy: "user-1",
			Generations: []ManualGeneration{
				{
					GenerationID: "",
					Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
					Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
					Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
				},
			},
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "generation_id")
	})

	t.Run("validation: generation missing input", func(t *testing.T) {
		_, err := svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-4",
			Name:    "No Input",
			SavedBy: "user-1",
			Generations: []ManualGeneration{
				{
					GenerationID: "gen-1",
					Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
					Input:        nil,
					Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
				},
			},
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "input")
	})

	t.Run("validation: generation missing output", func(t *testing.T) {
		_, err := svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-5",
			Name:    "No Output",
			SavedBy: "user-1",
			Generations: []ManualGeneration{
				{
					GenerationID: "gen-1",
					Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
					Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
					Output:       nil,
				},
			},
		})
		require.Error(t, err)
		assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		assert.Contains(t, err.Error(), "output")
	})

	t.Run("no writer configured returns error", func(t *testing.T) {
		svcNoWriter := NewSavedConversationService(store, lookup)
		_, err := svcNoWriter.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-6",
			Name:    "No Writer",
			SavedBy: "user-1",
			Generations: []ManualGeneration{
				{
					GenerationID: "gen-1",
					Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
					Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
					Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
				},
			},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "manual conversation writer is not configured")
	})

	t.Run("no deleter configured returns error", func(t *testing.T) {
		svcNoDeleter := NewSavedConversationService(store, lookup, WithManualWriter(writer))
		_, err := svcNoDeleter.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-no-deleter",
			Name:    "No Deleter",
			SavedBy: "user-1",
			Generations: []ManualGeneration{{
				GenerationID: "gen-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
			}},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "manual conversation deleter is not configured")
	})

	t.Run("rolls back manual conversation data when saved conversation insert fails", func(t *testing.T) {
		failingStore := newMockSavedConversationStore()
		failingStore.createErr = evalpkg.ErrConflict
		writer := newMockManualConversationWriter()
		deleter := newMockManualConversationDeleter()
		svcWithRollback := NewSavedConversationService(failingStore, lookup, WithManualWriter(writer), WithManualDeleter(deleter))

		_, err := svcWithRollback.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-rollback",
			Name:    "Rollback",
			SavedBy: "user-1",
			Generations: []ManualGeneration{{
				GenerationID: "gen-rollback-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
			}},
		})

		require.Error(t, err)
		assert.True(t, isConflictError(err), "expected conflict error, got: %v", err)
		assert.True(t, writer.Called("tenant-1", "conv_manual_manual-rollback"))
		assert.True(t, deleter.Called("tenant-1", "conv_manual_manual-rollback"))
	})

	t.Run("conflict keeps detailed message when rollback also fails", func(t *testing.T) {
		failingStore := newMockSavedConversationStore()
		failingStore.createErr = evalpkg.ErrConflict
		failingStore.createHook = func(_ evalpkg.SavedConversation) {
			failingStore.data[failingStore.key("tenant-1", "saved-existing")] = &evalpkg.SavedConversation{
				TenantID:       "tenant-1",
				SavedID:        "saved-existing",
				ConversationID: "conv_manual_manual-rollback",
			}
		}
		writer := newMockManualConversationWriter()
		deleter := newMockManualConversationDeleter()
		deleter.err = errors.New("rollback failed")
		svcWithRollback := NewSavedConversationService(failingStore, lookup, WithManualWriter(writer), WithManualDeleter(deleter))

		_, err := svcWithRollback.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-rollback",
			Name:    "Rollback",
			SavedBy: "user-1",
			Generations: []ManualGeneration{{
				GenerationID: "gen-rollback-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
			}},
		})

		require.Error(t, err)
		assert.True(t, isConflictError(err), "expected conflict error, got: %v", err)
		assert.Contains(t, err.Error(), `conversation "conv_manual_manual-rollback" is already saved as "saved-existing"`)
		assert.Contains(t, err.Error(), "rollback manual conversation data: rollback failed")
	})

	t.Run("conflict lookup failure still returns conflict", func(t *testing.T) {
		failingStore := newMockSavedConversationStore()
		failingStore.createErr = evalpkg.ErrConflict
		failingStore.createHook = func(evalpkg.SavedConversation) {
			failingStore.getByConvErr = errors.New("lookup failed")
		}
		writer := newMockManualConversationWriter()
		deleter := newMockManualConversationDeleter()
		svcWithRollback := NewSavedConversationService(failingStore, lookup, WithManualWriter(writer), WithManualDeleter(deleter))

		_, err := svcWithRollback.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
			SavedID: "manual-rollback",
			Name:    "Rollback",
			SavedBy: "user-1",
			Generations: []ManualGeneration{{
				GenerationID: "gen-rollback-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
			}},
		})

		require.Error(t, err)
		assert.True(t, isConflictError(err), "expected conflict error, got: %v", err)
		assert.Equal(t, "saved conversation already exists", err.Error())
	})

	t.Run("duplicate conversation conflict reports existing saved id", func(t *testing.T) {
		conflictStore := newMockSavedConversationStore()
		conflictStore.createErr = evalpkg.ErrConflict
		conflictStore.createHook = func(_ evalpkg.SavedConversation) {
			conflictStore.data[conflictStore.key("tenant-1", "saved-existing")] = &evalpkg.SavedConversation{
				TenantID:       "tenant-1",
				SavedID:        "saved-existing",
				ConversationID: "conv-shared",
			}
		}
		lookup.Add("tenant-1", "conv-shared")
		svcWithConflict := NewSavedConversationService(conflictStore, lookup)

		_, err := svcWithConflict.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
			SavedID:        "saved-new",
			ConversationID: "conv-shared",
			Name:           "Shared",
			SavedBy:        "user-1",
		})

		require.Error(t, err)
		assert.True(t, isConflictError(err), "expected conflict error, got: %v", err)
		assert.Contains(t, err.Error(), `conversation "conv-shared" is already saved as "saved-existing"`)
	})
}

func TestSavedConversationServiceDeleteManualCascade(t *testing.T) {
	store := newMockSavedConversationStore()
	lookup := newMockConversationLookup()
	writer := newMockManualConversationWriter()
	deleter := newMockManualConversationDeleter()

	svc := NewSavedConversationService(store, lookup,
		WithManualWriter(writer),
		WithManualDeleter(deleter),
	)

	// Create a manual conversation first.
	created, err := svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
		SavedID: "manual-del",
		Name:    "To Delete",
		SavedBy: "user-1",
		Generations: []ManualGeneration{
			{
				GenerationID: "gen-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi"}},
			},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, created)

	conversationID := created.ConversationID
	assert.Equal(t, "conv_manual_manual-del", conversationID)

	t.Run("delete cascades to manual data", func(t *testing.T) {
		err := svc.DeleteSavedConversation(context.Background(), "tenant-1", "manual-del")
		require.NoError(t, err)

		assert.True(t, deleter.Called("tenant-1", conversationID),
			"expected manual deleter to be called for %s", conversationID)

		// Verify the saved conversation row is gone.
		got, err := svc.GetSavedConversation(context.Background(), "tenant-1", "manual-del")
		require.NoError(t, err)
		assert.Nil(t, got, "expected saved conversation to be deleted")
	})

	t.Run("delete already-deleted is idempotent", func(t *testing.T) {
		err := svc.DeleteSavedConversation(context.Background(), "tenant-1", "manual-del")
		require.NoError(t, err)
	})

	t.Run("delete telemetry does not cascade", func(t *testing.T) {
		// Create a telemetry bookmark.
		lookup.Add("tenant-1", "conv-telem")
		_, err := svc.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
			SavedID:        "telem-1",
			ConversationID: "conv-telem",
			Name:           "Telemetry Bookmark",
			SavedBy:        "user-1",
		})
		require.NoError(t, err)

		err = svc.DeleteSavedConversation(context.Background(), "tenant-1", "telem-1")
		require.NoError(t, err)

		assert.False(t, deleter.Called("tenant-1", "conv-telem"),
			"manual deleter should not be called for telemetry conversations")
	})
}

func TestSavedConversationServiceListAndGet(t *testing.T) {
	store := newMockSavedConversationStore()
	lookup := newMockConversationLookup()
	lookup.Add("tenant-1", "conv-1")
	lookup.Add("tenant-1", "conv-2")
	writer := newMockManualConversationWriter()
	deleter := newMockManualConversationDeleter()

	svc := NewSavedConversationService(store, lookup, WithManualWriter(writer), WithManualDeleter(deleter))

	// Seed data: one telemetry bookmark and one manual conversation.
	_, err := svc.SaveConversation(context.Background(), "tenant-1", SaveConversationRequest{
		SavedID: "saved-t", ConversationID: "conv-1", Name: "Telemetry", SavedBy: "u",
	})
	require.NoError(t, err)

	_, err = svc.CreateManualConversation(context.Background(), "tenant-1", CreateManualConversationRequest{
		SavedID: "saved-m", Name: "Manual", SavedBy: "u",
		Generations: []ManualGeneration{{
			GenerationID: "g1",
			Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
			Input:        []ManualMessage{{Role: "user", Content: "hi"}},
			Output:       []ManualMessage{{Role: "assistant", Content: "hey"}},
		}},
	})
	require.NoError(t, err)

	t.Run("list all", func(t *testing.T) {
		items, _, err := svc.ListSavedConversations(context.Background(), "tenant-1", "", 100, 0)
		require.NoError(t, err)
		assert.Len(t, items, 2)
	})

	t.Run("list filtered by source", func(t *testing.T) {
		items, _, err := svc.ListSavedConversations(context.Background(), "tenant-1", "telemetry", 100, 0)
		require.NoError(t, err)
		assert.Len(t, items, 1)
		assert.Equal(t, evalpkg.SavedConversationSourceTelemetry, items[0].Source)
	})

	t.Run("list with invalid source", func(t *testing.T) {
		_, _, err := svc.ListSavedConversations(context.Background(), "tenant-1", "unknown", 100, 0)
		require.Error(t, err)
		assert.True(t, isValidationError(err))
	})

	t.Run("list with empty tenant", func(t *testing.T) {
		_, _, err := svc.ListSavedConversations(context.Background(), "", "", 100, 0)
		require.Error(t, err)
		assert.True(t, isValidationError(err))
	})

	t.Run("get by id", func(t *testing.T) {
		got, err := svc.GetSavedConversation(context.Background(), "tenant-1", "saved-t")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "saved-t", got.SavedID)
	})

	t.Run("get with empty saved_id", func(t *testing.T) {
		_, err := svc.GetSavedConversation(context.Background(), "tenant-1", "")
		require.Error(t, err)
		assert.True(t, isValidationError(err))
	})

	t.Run("get with empty tenant_id", func(t *testing.T) {
		_, err := svc.GetSavedConversation(context.Background(), "", "saved-t")
		require.Error(t, err)
		assert.True(t, isValidationError(err))
	})
}
