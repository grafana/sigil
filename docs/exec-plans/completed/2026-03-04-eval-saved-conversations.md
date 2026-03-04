# Eval Saved Conversations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the ability to save/pin conversations for evaluation test runs, including bookmarking production conversations and creating user-authored test conversations via API.

**Architecture:** New `eval_saved_conversations` table with FK to `conversations`. New `source` column on `generations` table. Dedicated `SavedConversationService` in `sigil/internal/eval/control/` with CRUD handlers. Plugin proxy routes and frontend `GenerationPicker` extension. Manual creation path bypasses ingest pipeline (no enqueue, no agent catalog).

**Tech Stack:** Go (GORM, net/http), TypeScript/React (Grafana plugin), MySQL

**Design doc:** `docs/plans/2026-03-04-eval-saved-conversations-design.md`

---

### Task 1: Domain Types

**Files:**
- Modify: `sigil/internal/eval/types.go:251` (after EvalStore interface)

**Step 1: Write the failing test**

Create `sigil/internal/eval/saved_conversation_test.go`:

```go
package eval

import (
	"testing"
)

func TestSavedConversationSourceValidation(t *testing.T) {
	if !IsValidSavedConversationSource("telemetry") {
		t.Error("expected telemetry to be valid")
	}
	if !IsValidSavedConversationSource("manual") {
		t.Error("expected manual to be valid")
	}
	if IsValidSavedConversationSource("unknown") {
		t.Error("expected unknown to be invalid")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/ -run TestSavedConversationSource -v`
Expected: FAIL — `IsValidSavedConversationSource` not defined

**Step 3: Write domain types**

Add to `sigil/internal/eval/types.go` after the `EvalStore` interface (line ~251):

```go
// SavedConversationSource distinguishes telemetry-ingested from manually created conversations.
type SavedConversationSource string

const (
	SavedConversationSourceTelemetry SavedConversationSource = "telemetry"
	SavedConversationSourceManual    SavedConversationSource = "manual"
)

func IsValidSavedConversationSource(s string) bool {
	switch SavedConversationSource(s) {
	case SavedConversationSourceTelemetry, SavedConversationSourceManual:
		return true
	default:
		return false
	}
}

// SavedConversation is a bookmarked or manually created conversation for eval testing.
type SavedConversation struct {
	TenantID       string                  `json:"tenant_id"`
	SavedID        string                  `json:"saved_id"`
	ConversationID string                  `json:"conversation_id"`
	Name           string                  `json:"name"`
	Source         SavedConversationSource `json:"source"`
	Tags           map[string]string       `json:"tags"`
	SavedBy        string                  `json:"saved_by"`
	CreatedAt      time.Time               `json:"created_at"`
	UpdatedAt      time.Time               `json:"updated_at"`
}

// SavedConversationStore manages saved conversation persistence.
type SavedConversationStore interface {
	CreateSavedConversation(ctx context.Context, sc SavedConversation) error
	GetSavedConversation(ctx context.Context, tenantID, savedID string) (*SavedConversation, error)
	ListSavedConversations(ctx context.Context, tenantID string, source string, limit int, cursor uint64) ([]SavedConversation, uint64, error)
	DeleteSavedConversation(ctx context.Context, tenantID, savedID string) error
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/ -run TestSavedConversationSource -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/eval/types.go sigil/internal/eval/saved_conversation_test.go
git commit -m "feat(eval): add saved conversation domain types and store interface"
```

---

### Task 2: GORM Model and Migration

**Files:**
- Modify: `sigil/internal/storage/mysql/models.go:172` (after ConversationModel)
- Modify: `sigil/internal/storage/mysql/models.go:5-17` (add Source to GenerationModel)
- Modify: `sigil/internal/storage/mysql/migrate.go:23-43` (add to AutoMigrate)

**Step 1: Write the failing test**

Create `sigil/internal/storage/mysql/saved_conversation_test.go`:

```go
package mysql

import (
	"context"
	"testing"
)

func TestSavedConversationAutoMigrate(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Verify the table exists by checking the migrator.
	if !store.db.Migrator().HasTable(&EvalSavedConversationModel{}) {
		t.Fatal("expected eval_saved_conversations table to exist")
	}
	if !store.db.Migrator().HasColumn(&GenerationModel{}, "Source") {
		t.Fatal("expected generations.source column to exist")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestSavedConversationAutoMigrate -v`
Expected: FAIL — `EvalSavedConversationModel` not defined

**Step 3: Add GORM model and update GenerationModel**

Add `Source` field to `GenerationModel` in `sigil/internal/storage/mysql/models.go` (after the `CompactedAt` field at line 16):

```go
Source      string     `gorm:"size:16;not null;default:telemetry"`
```

Add after `ConversationModel` (line ~172) in `sigil/internal/storage/mysql/models.go`:

```go
type EvalSavedConversationModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_eval_saved_conversations_tenant_saved,priority:1;uniqueIndex:ux_eval_saved_conversations_tenant_conversation,priority:1;index:idx_eval_saved_conversations_tenant_source_updated,priority:1"`
	SavedID        string    `gorm:"size:128;not null;uniqueIndex:ux_eval_saved_conversations_tenant_saved,priority:2"`
	ConversationID string    `gorm:"size:255;not null;uniqueIndex:ux_eval_saved_conversations_tenant_conversation,priority:2"`
	Name           string    `gorm:"size:255;not null"`
	Source         string    `gorm:"size:16;not null;index:idx_eval_saved_conversations_tenant_source_updated,priority:2"`
	TagsJSON       []byte    `gorm:"type:json;not null"`
	SavedBy        string    `gorm:"size:255;not null"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"type:datetime(6);not null;autoUpdateTime;index:idx_eval_saved_conversations_tenant_source_updated,priority:3"`
}

func (EvalSavedConversationModel) TableName() string {
	return "eval_saved_conversations"
}
```

Add `&EvalSavedConversationModel{}` to AutoMigrate list in `sigil/internal/storage/mysql/migrate.go` (after `&EvalRuleModel{}`):

```go
&EvalSavedConversationModel{},
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestSavedConversationAutoMigrate -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/models.go sigil/internal/storage/mysql/migrate.go sigil/internal/storage/mysql/saved_conversation_test.go
git commit -m "feat(eval): add EvalSavedConversationModel and source column on generations"
```

---

### Task 3: Storage Layer CRUD

**Files:**
- Create: `sigil/internal/storage/mysql/saved_conversation.go`
- Modify: `sigil/internal/storage/mysql/saved_conversation_test.go`

**Step 1: Write the failing test**

Extend `sigil/internal/storage/mysql/saved_conversation_test.go`:

```go
func TestSavedConversationCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-a"

	// Create
	sc := evalpkg.SavedConversation{
		TenantID:       tenant,
		SavedID:        "sc-test-1",
		ConversationID: "conv-abc-123",
		Name:           "Test conversation",
		Source:         evalpkg.SavedConversationSourceTelemetry,
		Tags:           map[string]string{"use_case": "support"},
		SavedBy:        "operator-jane",
	}
	if err := store.CreateSavedConversation(ctx, sc); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Get
	got, err := store.GetSavedConversation(ctx, tenant, "sc-test-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil {
		t.Fatal("expected saved conversation")
	}
	if got.Name != "Test conversation" {
		t.Errorf("unexpected name %q", got.Name)
	}
	if got.Tags["use_case"] != "support" {
		t.Errorf("unexpected tags %v", got.Tags)
	}

	// List (no filter)
	items, nextCursor, err := store.ListSavedConversations(ctx, tenant, "", 10, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Errorf("expected 1 item, got %d", len(items))
	}
	if nextCursor != 0 {
		t.Errorf("expected no next cursor, got %d", nextCursor)
	}

	// List (with source filter)
	items, _, err = store.ListSavedConversations(ctx, tenant, "manual", 10, 0)
	if err != nil {
		t.Fatalf("list filtered: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("expected 0 items for manual filter, got %d", len(items))
	}

	// Delete
	if err := store.DeleteSavedConversation(ctx, tenant, "sc-test-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	got, err = store.GetSavedConversation(ctx, tenant, "sc-test-1")
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if got != nil {
		t.Error("expected nil after delete")
	}

	// Idempotent delete
	if err := store.DeleteSavedConversation(ctx, tenant, "sc-test-1"); err != nil {
		t.Fatalf("idempotent delete: %v", err)
	}
}
```

Add import: `evalpkg "github.com/grafana/sigil/sigil/internal/eval"` to the test file.

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestSavedConversationCRUD -v`
Expected: FAIL — `CreateSavedConversation` not defined on `WALStore`

**Step 3: Implement storage layer**

Create `sigil/internal/storage/mysql/saved_conversation.go`:

```go
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
	if strings.TrimSpace(sc.Name) == "" {
		return errors.New("name is required")
	}
	if !evalpkg.IsValidSavedConversationSource(string(sc.Source)) {
		return errors.New("source must be telemetry or manual")
	}
	if strings.TrimSpace(sc.SavedBy) == "" {
		return errors.New("saved_by is required")
	}

	tagsJSON, err := json.Marshal(sc.Tags)
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
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
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
	var tags map[string]string
	if len(m.TagsJSON) > 0 {
		if err := json.Unmarshal(m.TagsJSON, &tags); err != nil {
			return evalpkg.SavedConversation{}, fmt.Errorf("unmarshal tags: %w", err)
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
		CreatedAt:      m.CreatedAt,
		UpdatedAt:      m.UpdatedAt,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestSavedConversation -v`
Expected: PASS (both AutoMigrate and CRUD tests)

**Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/saved_conversation.go sigil/internal/storage/mysql/saved_conversation_test.go
git commit -m "feat(eval): implement saved conversation storage layer CRUD"
```

---

### Task 4: Service Layer — Bookmark Telemetry Conversations

**Files:**
- Create: `sigil/internal/eval/control/saved_conversation_service.go`

This service handles the bookmark flow (saving an existing production conversation). It validates the conversation exists before saving.

**Step 1: Write the failing test**

Create `sigil/internal/eval/control/saved_conversation_service_test.go`:

```go
package control

import (
	"context"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/storage"
)

type mockSavedConversationStore struct {
	items map[string]evalpkg.SavedConversation
}

func newMockSavedConversationStore() *mockSavedConversationStore {
	return &mockSavedConversationStore{items: make(map[string]evalpkg.SavedConversation)}
}

func (m *mockSavedConversationStore) CreateSavedConversation(_ context.Context, sc evalpkg.SavedConversation) error {
	m.items[sc.TenantID+"/"+sc.SavedID] = sc
	return nil
}

func (m *mockSavedConversationStore) GetSavedConversation(_ context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	sc, ok := m.items[tenantID+"/"+savedID]
	if !ok {
		return nil, nil
	}
	return &sc, nil
}

func (m *mockSavedConversationStore) ListSavedConversations(_ context.Context, tenantID string, source string, limit int, cursor uint64) ([]evalpkg.SavedConversation, uint64, error) {
	var out []evalpkg.SavedConversation
	for _, sc := range m.items {
		if sc.TenantID != tenantID {
			continue
		}
		if source != "" && string(sc.Source) != source {
			continue
		}
		out = append(out, sc)
	}
	return out, 0, nil
}

func (m *mockSavedConversationStore) DeleteSavedConversation(_ context.Context, tenantID, savedID string) error {
	delete(m.items, tenantID+"/"+savedID)
	return nil
}

type mockConversationLookup struct {
	convs map[string]*storage.Conversation
}

func (m *mockConversationLookup) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	c, ok := m.convs[tenantID+"/"+conversationID]
	if !ok {
		return nil, nil
	}
	return c, nil
}

func TestSavedConversationServiceBookmark(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := &mockConversationLookup{
		convs: map[string]*storage.Conversation{
			"tenant-a/conv-123": {
				TenantID:       "tenant-a",
				ConversationID: "conv-123",
				GenerationCount: 3,
				CreatedAt:       time.Now(),
			},
		},
	}

	svc := NewSavedConversationService(store, convLookup)

	// Bookmark existing conversation
	sc, err := svc.SaveConversation(context.Background(), "tenant-a", SaveConversationRequest{
		SavedID:        "sc-1",
		ConversationID: "conv-123",
		Name:           "My test conv",
		Tags:           map[string]string{"env": "prod"},
		SavedBy:        "operator-jane",
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if sc.Source != evalpkg.SavedConversationSourceTelemetry {
		t.Errorf("expected source telemetry, got %q", sc.Source)
	}

	// Bookmark non-existent conversation
	_, err = svc.SaveConversation(context.Background(), "tenant-a", SaveConversationRequest{
		SavedID:        "sc-2",
		ConversationID: "conv-nonexistent",
		Name:           "Ghost",
		SavedBy:        "operator-jane",
	})
	if err == nil {
		t.Fatal("expected error for non-existent conversation")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestSavedConversationServiceBookmark -v`
Expected: FAIL — `NewSavedConversationService` not defined

**Step 3: Implement service**

Create `sigil/internal/eval/control/saved_conversation_service.go`:

```go
package control

import (
	"context"
	"fmt"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/storage"
)

// ConversationLookup resolves whether a conversation exists.
type ConversationLookup interface {
	GetConversation(ctx context.Context, tenantID, conversationID string) (*storage.Conversation, error)
}

// SavedConversationService manages saved conversations for eval testing.
type SavedConversationService struct {
	store      evalpkg.SavedConversationStore
	convLookup ConversationLookup
}

func NewSavedConversationService(store evalpkg.SavedConversationStore, convLookup ConversationLookup) *SavedConversationService {
	return &SavedConversationService{store: store, convLookup: convLookup}
}

type SaveConversationRequest struct {
	SavedID        string            `json:"saved_id"`
	ConversationID string            `json:"conversation_id"`
	Name           string            `json:"name"`
	Tags           map[string]string `json:"tags"`
	SavedBy        string            `json:"saved_by"`
}

// SaveConversation bookmarks an existing telemetry conversation.
func (s *SavedConversationService) SaveConversation(ctx context.Context, tenantID string, req SaveConversationRequest) (*evalpkg.SavedConversation, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, newValidationError("tenant id is required")
	}
	if strings.TrimSpace(req.SavedID) == "" {
		return nil, newValidationError("saved_id is required")
	}
	if strings.TrimSpace(req.ConversationID) == "" {
		return nil, newValidationError("conversation_id is required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, newValidationError("name is required")
	}
	if strings.TrimSpace(req.SavedBy) == "" {
		return nil, newValidationError("saved_by is required")
	}

	// Verify conversation exists.
	conv, err := s.convLookup.GetConversation(ctx, tenantID, req.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("lookup conversation: %w", err)
	}
	if conv == nil {
		return nil, newValidationError("conversation not found")
	}

	sc := evalpkg.SavedConversation{
		TenantID:       tenantID,
		SavedID:        strings.TrimSpace(req.SavedID),
		ConversationID: strings.TrimSpace(req.ConversationID),
		Name:           strings.TrimSpace(req.Name),
		Source:         evalpkg.SavedConversationSourceTelemetry,
		Tags:           req.Tags,
		SavedBy:        strings.TrimSpace(req.SavedBy),
	}
	if sc.Tags == nil {
		sc.Tags = map[string]string{}
	}

	if err := s.store.CreateSavedConversation(ctx, sc); err != nil {
		return nil, fmt.Errorf("create saved conversation: %w", err)
	}

	return s.store.GetSavedConversation(ctx, tenantID, sc.SavedID)
}

// GetSavedConversation returns a saved conversation by ID.
func (s *SavedConversationService) GetSavedConversation(ctx context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, newValidationError("tenant id is required")
	}
	if strings.TrimSpace(savedID) == "" {
		return nil, newValidationError("saved_id is required")
	}
	return s.store.GetSavedConversation(ctx, tenantID, savedID)
}

// ListSavedConversations returns paginated saved conversations, optionally filtered by source.
func (s *SavedConversationService) ListSavedConversations(ctx context.Context, tenantID, source string, limit int, cursor uint64) ([]evalpkg.SavedConversation, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, newValidationError("tenant id is required")
	}
	if source != "" && !evalpkg.IsValidSavedConversationSource(source) {
		return nil, 0, newValidationError("source must be telemetry or manual")
	}
	return s.store.ListSavedConversations(ctx, tenantID, source, limit, cursor)
}

// DeleteSavedConversation removes a saved conversation. Hard delete.
func (s *SavedConversationService) DeleteSavedConversation(ctx context.Context, tenantID, savedID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return newValidationError("tenant id is required")
	}
	if strings.TrimSpace(savedID) == "" {
		return newValidationError("saved_id is required")
	}
	return s.store.DeleteSavedConversation(ctx, tenantID, savedID)
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestSavedConversationService -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/eval/control/saved_conversation_service.go sigil/internal/eval/control/saved_conversation_service_test.go
git commit -m "feat(eval): add SavedConversationService with bookmark flow"
```

---

### Task 5: Service Layer — Manual Conversation Creation

**Files:**
- Modify: `sigil/internal/eval/control/saved_conversation_service.go`
- Modify: `sigil/internal/eval/control/saved_conversation_service_test.go`

The manual creation flow needs to create conversation + generation rows and the saved conversation entry in one operation. It needs access to the generation WAL store for writing.

**Step 1: Write the failing test**

Add to `sigil/internal/eval/control/saved_conversation_service_test.go`:

```go
func TestSavedConversationServiceManualCreate(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := &mockConversationLookup{convs: make(map[string]*storage.Conversation)}
	manualWriter := &mockManualConversationWriter{created: make(map[string]bool)}

	svc := NewSavedConversationService(store, convLookup, WithManualWriter(manualWriter))

	sc, err := svc.CreateManualConversation(context.Background(), "tenant-a", CreateManualConversationRequest{
		SavedID: "sc-manual-1",
		Name:    "Edge case test",
		Tags:    map[string]string{"category": "edge_case"},
		SavedBy: "operator-jane",
		Generations: []ManualGeneration{
			{
				GenerationID:  "gen-manual-001",
				OperationName: "chat",
				Mode:          "SYNC",
				Model:         ManualModelRef{Provider: "openai", Name: "gpt-4"},
				Input:         []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:        []ManualMessage{{Role: "assistant", Content: "Hi there"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("create manual: %v", err)
	}
	if sc.Source != evalpkg.SavedConversationSourceManual {
		t.Errorf("expected source manual, got %q", sc.Source)
	}
	if sc.ConversationID != "conv_manual_sc-manual-1" {
		t.Errorf("unexpected conversation_id %q", sc.ConversationID)
	}
	if !manualWriter.created["tenant-a/conv_manual_sc-manual-1"] {
		t.Error("expected manual writer to be called")
	}
}
```

Also add the mock:

```go
type mockManualConversationWriter struct {
	created map[string]bool
}

func (m *mockManualConversationWriter) CreateManualConversation(_ context.Context, tenantID, conversationID string, generations []ManualGeneration) error {
	m.created[tenantID+"/"+conversationID] = true
	return nil
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestSavedConversationServiceManualCreate -v`
Expected: FAIL — `CreateManualConversation` not defined

**Step 3: Add manual creation to service**

Add to `sigil/internal/eval/control/saved_conversation_service.go`:

```go
// ManualConversationWriter creates conversation and generation rows for manual test data.
type ManualConversationWriter interface {
	CreateManualConversation(ctx context.Context, tenantID, conversationID string, generations []ManualGeneration) error
}

type ManualGeneration struct {
	GenerationID  string          `json:"generation_id"`
	OperationName string          `json:"operation_name"`
	Mode          string          `json:"mode"`
	Model         ManualModelRef  `json:"model"`
	Input         []ManualMessage `json:"input"`
	Output        []ManualMessage `json:"output"`
	StartedAt     *time.Time      `json:"started_at,omitempty"`
	CompletedAt   *time.Time      `json:"completed_at,omitempty"`
}

type ManualModelRef struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
}

type ManualMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type CreateManualConversationRequest struct {
	SavedID     string            `json:"saved_id"`
	Name        string            `json:"name"`
	Tags        map[string]string `json:"tags"`
	SavedBy     string            `json:"saved_by"`
	Generations []ManualGeneration `json:"generations"`
}

// WithManualWriter is a service option to enable manual conversation creation.
func WithManualWriter(w ManualConversationWriter) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.manualWriter = w }
}

type SavedConversationServiceOption func(*SavedConversationService)
```

Update `NewSavedConversationService` to accept options:

```go
func NewSavedConversationService(store evalpkg.SavedConversationStore, convLookup ConversationLookup, opts ...SavedConversationServiceOption) *SavedConversationService {
	s := &SavedConversationService{store: store, convLookup: convLookup}
	for _, opt := range opts {
		opt(s)
	}
	return s
}
```

Add `manualWriter` field to the service struct and the `CreateManualConversation` method:

```go
// CreateManualConversation creates a user-authored test conversation with inline generations.
func (s *SavedConversationService) CreateManualConversation(ctx context.Context, tenantID string, req CreateManualConversationRequest) (*evalpkg.SavedConversation, error) {
	if s.manualWriter == nil {
		return nil, newValidationError("manual conversation creation not configured")
	}
	if strings.TrimSpace(tenantID) == "" {
		return nil, newValidationError("tenant id is required")
	}
	if strings.TrimSpace(req.SavedID) == "" {
		return nil, newValidationError("saved_id is required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, newValidationError("name is required")
	}
	if strings.TrimSpace(req.SavedBy) == "" {
		return nil, newValidationError("saved_by is required")
	}
	if len(req.Generations) == 0 {
		return nil, newValidationError("at least one generation is required")
	}
	for i, gen := range req.Generations {
		if strings.TrimSpace(gen.GenerationID) == "" {
			return nil, newValidationError(fmt.Sprintf("generation[%d]: generation_id is required", i))
		}
		if len(gen.Input) == 0 {
			return nil, newValidationError(fmt.Sprintf("generation[%d]: at least one input message is required", i))
		}
		if len(gen.Output) == 0 {
			return nil, newValidationError(fmt.Sprintf("generation[%d]: at least one output message is required", i))
		}
	}

	conversationID := fmt.Sprintf("conv_manual_%s", strings.TrimSpace(req.SavedID))

	if err := s.manualWriter.CreateManualConversation(ctx, tenantID, conversationID, req.Generations); err != nil {
		return nil, fmt.Errorf("create manual conversation: %w", err)
	}

	sc := evalpkg.SavedConversation{
		TenantID:       tenantID,
		SavedID:        strings.TrimSpace(req.SavedID),
		ConversationID: conversationID,
		Name:           strings.TrimSpace(req.Name),
		Source:         evalpkg.SavedConversationSourceManual,
		Tags:           req.Tags,
		SavedBy:        strings.TrimSpace(req.SavedBy),
	}
	if sc.Tags == nil {
		sc.Tags = map[string]string{}
	}

	if err := s.store.CreateSavedConversation(ctx, sc); err != nil {
		return nil, fmt.Errorf("create saved conversation: %w", err)
	}

	return s.store.GetSavedConversation(ctx, tenantID, sc.SavedID)
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestSavedConversationService -v`
Expected: PASS (both bookmark and manual tests)

**Step 5: Commit**

```bash
git add sigil/internal/eval/control/saved_conversation_service.go sigil/internal/eval/control/saved_conversation_service_test.go
git commit -m "feat(eval): add manual conversation creation to SavedConversationService"
```

---

### Task 6: Manual Writer Implementation (MySQL)

**Files:**
- Create: `sigil/internal/storage/mysql/saved_conversation_manual.go`
- Modify: `sigil/internal/storage/mysql/saved_conversation_test.go`

This implements the `ManualConversationWriter` interface — it creates conversation + generation rows in a single transaction with `source=manual`.

**Step 1: Write the failing test**

Add to `sigil/internal/storage/mysql/saved_conversation_test.go`:

```go
func TestManualConversationWriter(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-a"
	convID := "conv_manual_test"

	gens := []evalcontrol.ManualGeneration{
		{
			GenerationID:  "gen-manual-001",
			OperationName: "chat",
			Mode:          "SYNC",
			Model:         evalcontrol.ManualModelRef{Provider: "openai", Name: "gpt-4"},
			Input:         []evalcontrol.ManualMessage{{Role: "user", Content: "Hello"}},
			Output:        []evalcontrol.ManualMessage{{Role: "assistant", Content: "Hi"}},
		},
	}

	if err := store.CreateManualConversation(ctx, tenant, convID, gens); err != nil {
		t.Fatalf("create manual conversation: %v", err)
	}

	// Verify conversation was created.
	conv, err := store.GetConversation(ctx, tenant, convID)
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if conv == nil {
		t.Fatal("expected conversation to exist")
	}
	if conv.GenerationCount != 1 {
		t.Errorf("expected generation count 1, got %d", conv.GenerationCount)
	}

	// Verify generation was created with source=manual.
	var genRow GenerationModel
	err = store.db.Where("tenant_id = ? AND generation_id = ?", tenant, "gen-manual-001").First(&genRow).Error
	if err != nil {
		t.Fatalf("get generation row: %v", err)
	}
	if genRow.Source != "manual" {
		t.Errorf("expected source manual, got %q", genRow.Source)
	}
}
```

Add import: `evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"`.

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestManualConversationWriter -v`
Expected: FAIL — `CreateManualConversation` not defined on `WALStore`

**Step 3: Implement manual writer**

Create `sigil/internal/storage/mysql/saved_conversation_manual.go`:

```go
package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	sigilv1 "github.com/grafana/sigil/sigil/proto/sigil/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

var _ evalcontrol.ManualConversationWriter = (*WALStore)(nil)

func (s *WALStore) CreateManualConversation(ctx context.Context, tenantID, conversationID string, generations []evalcontrol.ManualGeneration) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return errors.New("conversation id is required")
	}
	if len(generations) == 0 {
		return errors.New("at least one generation is required")
	}

	now := time.Now().UTC()

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Create conversation row.
		convModel := ConversationModel{
			TenantID:         tenantID,
			ConversationID:   conversationID,
			LastGenerationAt: now,
			GenerationCount:  len(generations),
		}
		if err := tx.Create(&convModel).Error; err != nil {
			return fmt.Errorf("create conversation: %w", err)
		}

		// Create generation rows.
		for _, gen := range generations {
			pbGen := manualGenerationToProto(conversationID, gen, now)
			payload, err := proto.Marshal(pbGen)
			if err != nil {
				return fmt.Errorf("marshal generation %s: %w", gen.GenerationID, err)
			}

			convIDStr := conversationID
			genModel := GenerationModel{
				TenantID:         tenantID,
				GenerationID:     gen.GenerationID,
				ConversationID:   &convIDStr,
				CreatedAt:        now,
				Payload:          payload,
				PayloadSizeBytes: len(payload),
				Source:           "manual",
			}
			if err := tx.Create(&genModel).Error; err != nil {
				return fmt.Errorf("create generation %s: %w", gen.GenerationID, err)
			}
		}

		return nil
	})
}

func manualGenerationToProto(conversationID string, gen evalcontrol.ManualGeneration, now time.Time) *sigilv1.Generation {
	pbGen := &sigilv1.Generation{
		Id:             gen.GenerationID,
		ConversationId: conversationID,
		OperationName:  gen.OperationName,
		Model: &sigilv1.ModelRef{
			Provider: gen.Model.Provider,
			Name:     gen.Model.Name,
		},
		StartedAt:   timestamppb.New(now),
		CompletedAt: timestamppb.New(now),
	}

	switch strings.ToUpper(gen.Mode) {
	case "SYNC":
		pbGen.Mode = sigilv1.GenerationMode_GENERATION_MODE_SYNC
	case "STREAM":
		pbGen.Mode = sigilv1.GenerationMode_GENERATION_MODE_STREAM
	}

	if gen.StartedAt != nil {
		pbGen.StartedAt = timestamppb.New(*gen.StartedAt)
	}
	if gen.CompletedAt != nil {
		pbGen.CompletedAt = timestamppb.New(*gen.CompletedAt)
	}

	for _, msg := range gen.Input {
		pbGen.Input = append(pbGen.Input, &sigilv1.Message{
			Role:    msg.Role,
			Content: []*sigilv1.ContentPart{{Part: &sigilv1.ContentPart_Text{Text: msg.Content}}},
		})
	}
	for _, msg := range gen.Output {
		pbGen.Output = append(pbGen.Output, &sigilv1.Message{
			Role:    msg.Role,
			Content: []*sigilv1.ContentPart{{Part: &sigilv1.ContentPart_Text{Text: msg.Content}}},
		})
	}

	return pbGen
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestManualConversationWriter -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/saved_conversation_manual.go sigil/internal/storage/mysql/saved_conversation_test.go
git commit -m "feat(eval): implement ManualConversationWriter for MySQL storage"
```

---

### Task 7: HTTP Handlers

**Files:**
- Create: `sigil/internal/eval/control/http_saved_conversations.go`
- Modify: `sigil/internal/eval/control/http.go:46-72` (register routes)

**Step 1: Write the failing test**

Create `sigil/internal/eval/control/http_saved_conversations_test.go` with a basic roundtrip test using `httptest`:

```go
package control

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestHTTPSavedConversationsRoundtrip(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := &mockConversationLookup{
		convs: map[string]*storage.Conversation{
			"fake/conv-abc": {
				TenantID:       "fake",
				ConversationID: "conv-abc",
				GenerationCount: 3,
				CreatedAt:       time.Now(),
			},
		},
	}
	svc := NewSavedConversationService(store, convLookup)

	mux := http.NewServeMux()
	RegisterSavedConversationRoutes(mux, svc, nil)

	// Create
	body, _ := json.Marshal(SaveConversationRequest{
		SavedID:        "sc-1",
		ConversationID: "conv-abc",
		Name:           "Test",
		SavedBy:        "operator",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/saved-conversations", bytes.NewReader(body))
	req.Header.Set("X-Scope-OrgID", "fake")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/saved-conversations", nil)
	req.Header.Set("X-Scope-OrgID", "fake")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/saved-conversations/sc-1", nil)
	req.Header.Set("X-Scope-OrgID", "fake")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/eval/saved-conversations/sc-1", nil)
	req.Header.Set("X-Scope-OrgID", "fake")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", w.Code, w.Body.String())
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestHTTPSavedConversationsRoundtrip -v`
Expected: FAIL — `RegisterSavedConversationRoutes` not defined

**Step 3: Implement HTTP handlers**

Create `sigil/internal/eval/control/http_saved_conversations.go`:

```go
package control

import (
	"encoding/json"
	"net/http"
	"strings"
)

func RegisterSavedConversationRoutes(mux *http.ServeMux, svc *SavedConversationService, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || svc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/saved-conversations", protectedMiddleware(http.HandlerFunc(svc.handleSavedConversations)))
	mux.Handle("/api/v1/eval/saved-conversations/", protectedMiddleware(http.HandlerFunc(svc.handleSavedConversationByID)))
	mux.Handle("POST /api/v1/eval/saved-conversations:manual", protectedMiddleware(http.HandlerFunc(svc.handleCreateManualConversation)))
}

func (s *SavedConversationService) handleSavedConversations(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		var createReq SaveConversationRequest
		if err := json.NewDecoder(req.Body).Decode(&createReq); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		sc, err := s.SaveConversation(req.Context(), tenantID, createReq)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sc)

	case http.MethodGet:
		limit, cursor, err := parsePagination(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		source := req.URL.Query().Get("source")
		items, nextCursor, err := s.ListSavedConversations(req.Context(), tenantID, source, limit, cursor)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": nextCursor,
		})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SavedConversationService) handleSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	id := strings.TrimPrefix(req.URL.Path, "/api/v1/eval/saved-conversations/")
	if id == "" {
		http.Error(w, "saved_id is required", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodGet:
		sc, err := s.GetSavedConversation(req.Context(), tenantID, id)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		if sc == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, sc)

	case http.MethodDelete:
		if err := s.DeleteSavedConversation(req.Context(), tenantID, id); err != nil {
			writeControlWriteError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SavedConversationService) handleCreateManualConversation(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var createReq CreateManualConversationRequest
	if err := json.NewDecoder(req.Body).Decode(&createReq); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	sc, err := s.CreateManualConversation(req.Context(), tenantID, createReq)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sc)
}
```

Add route registration to `RegisterHTTPRoutes` in `sigil/internal/eval/control/http.go`. After the testService block (line ~71), add a `savedConvSvc` parameter and registration.

Actually — the cleaner approach matching the existing pattern is to keep `RegisterSavedConversationRoutes` separate and call it from the querier module alongside `RegisterHTTPRoutes`. This avoids modifying the existing `RegisterHTTPRoutes` signature.

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestHTTPSavedConversationsRoundtrip -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/eval/control/http_saved_conversations.go sigil/internal/eval/control/http_saved_conversations_test.go
git commit -m "feat(eval): add HTTP handlers for saved conversations CRUD"
```

---

### Task 8: Querier Module Wiring

**Files:**
- Modify: `sigil/internal/querier_module.go:110-210`

**Step 1: Wire the saved conversation service**

In `sigil/internal/querier_module.go`, after the existing eval service wiring (around line 155), add:

```go
var savedConvSvc *evalcontrol.SavedConversationService
if scStore, ok := generationStore.(evalpkg.SavedConversationStore); ok {
    convStore, _ := generationStore.(evalcontrol.ConversationLookup)
    var scOpts []evalcontrol.SavedConversationServiceOption
    if manualWriter, ok := generationStore.(evalcontrol.ManualConversationWriter); ok {
        scOpts = append(scOpts, evalcontrol.WithManualWriter(manualWriter))
    }
    savedConvSvc = evalcontrol.NewSavedConversationService(scStore, convStore, scOpts...)
}
```

Then near line 210, after `evalcontrol.RegisterHTTPRoutes(...)`, add:

```go
evalcontrol.RegisterSavedConversationRoutes(mux, savedConvSvc, protectedMiddleware)
```

**Step 2: Run existing tests**

Run: `cd sigil && go build ./...`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add sigil/internal/querier_module.go
git commit -m "feat(eval): wire saved conversation service in querier module"
```

---

### Task 9: Plugin Backend Proxy Routes

**Files:**
- Modify: `apps/plugin/pkg/plugin/resources.go:117-119` (RBAC)
- Modify: `apps/plugin/pkg/plugin/resources.go:695-706` (route registration)
- Modify: `apps/plugin/pkg/plugin/resources_test.go` (add test cases)

**Step 1: Add proxy handler functions**

Add to `apps/plugin/pkg/plugin/resources.go` after existing eval handlers:

```go
func (a *App) handleEvalSavedConversations(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/saved-conversations", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/saved-conversations", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/eval/saved-conversations/")
	if id == "" {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/saved-conversations/%s", id)
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalSavedConversationsManual(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval/saved-conversations:manual", http.MethodPost)
}
```

Register in `registerResourceRoutes` (after eval/templates/ line):

```go
mux.HandleFunc("/eval/saved-conversations", a.withAuthorization(a.handleEvalSavedConversations))
mux.HandleFunc("/eval/saved-conversations/", a.withAuthorization(a.handleEvalSavedConversationByID))
mux.HandleFunc("/eval/saved-conversations:manual", a.withAuthorization(a.handleEvalSavedConversationsManual))
```

The existing `permissionForEvalRoute` already handles `/eval/` prefix routes correctly (GET→dataRead, POST/DELETE→evalWrite).

**Step 2: Add test cases to resources_test.go**

Add to the eval read routes test list:

```go
{method: http.MethodGet, path: "/eval/saved-conversations"},
{method: http.MethodGet, path: "/eval/saved-conversations/sc-1"},
```

Add to the eval write routes test list:

```go
{method: http.MethodPost, path: "/eval/saved-conversations"},
{method: http.MethodPost, path: "/eval/saved-conversations:manual"},
{method: http.MethodDelete, path: "/eval/saved-conversations/sc-1"},
```

**Step 3: Run tests**

Run: `cd apps/plugin && go test ./pkg/plugin/ -v`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/plugin/pkg/plugin/resources.go apps/plugin/pkg/plugin/resources_test.go
git commit -m "feat(plugin): add proxy routes for saved conversations"
```

---

### Task 10: TypeScript Types and API Client

**Files:**
- Modify: `apps/plugin/src/evaluation/types.ts`
- Modify: `apps/plugin/src/evaluation/api.ts`

**Step 1: Add types**

Add to `apps/plugin/src/evaluation/types.ts`:

```typescript
export type SavedConversation = {
  tenant_id: string;
  saved_id: string;
  conversation_id: string;
  name: string;
  source: 'telemetry' | 'manual';
  tags: Record<string, string>;
  saved_by: string;
  created_at: string;
  updated_at: string;
};

export type SavedConversationListResponse = {
  items: SavedConversation[];
  next_cursor: number;
};

export type SaveConversationRequest = {
  saved_id: string;
  conversation_id: string;
  name: string;
  tags?: Record<string, string>;
  saved_by: string;
};

export type CreateManualConversationRequest = {
  saved_id: string;
  name: string;
  tags?: Record<string, string>;
  saved_by: string;
  generations: ManualGeneration[];
};

export type ManualGeneration = {
  generation_id: string;
  operation_name: string;
  mode: 'SYNC' | 'STREAM';
  model: { provider: string; name: string };
  input: ManualMessage[];
  output: ManualMessage[];
  started_at?: string;
  completed_at?: string;
};

export type ManualMessage = {
  role: string;
  content: string;
};
```

**Step 2: Add API methods**

Add to the `EvaluationDataSource` type in `apps/plugin/src/evaluation/api.ts`:

```typescript
listSavedConversations: (source?: string, limit?: number, cursor?: string) => Promise<SavedConversationListResponse>;
saveConversation: (request: SaveConversationRequest) => Promise<SavedConversation>;
getSavedConversation: (savedID: string) => Promise<SavedConversation>;
deleteSavedConversation: (savedID: string) => Promise<void>;
createManualConversation: (request: CreateManualConversationRequest) => Promise<SavedConversation>;
```

Implement in `defaultEvaluationDataSource`:

```typescript
async listSavedConversations(source?: string, limit?: number, cursor?: string) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  const url = qs.length > 0 ? `${evalBasePath}/saved-conversations?${qs}` : `${evalBasePath}/saved-conversations`;
  const response = await lastValueFrom(
    getBackendSrv().fetch<SavedConversationListResponse>({ method: 'GET', url })
  );
  return response.data;
},

async saveConversation(request: SaveConversationRequest) {
  const response = await lastValueFrom(
    getBackendSrv().fetch<SavedConversation>({
      method: 'POST',
      url: `${evalBasePath}/saved-conversations`,
      data: request,
    })
  );
  return response.data;
},

async getSavedConversation(savedID: string) {
  const response = await lastValueFrom(
    getBackendSrv().fetch<SavedConversation>({
      method: 'GET',
      url: `${evalBasePath}/saved-conversations/${savedID}`,
    })
  );
  return response.data;
},

async deleteSavedConversation(savedID: string) {
  await lastValueFrom(
    getBackendSrv().fetch<void>({
      method: 'DELETE',
      url: `${evalBasePath}/saved-conversations/${savedID}`,
    })
  );
},

async createManualConversation(request: CreateManualConversationRequest) {
  const response = await lastValueFrom(
    getBackendSrv().fetch<SavedConversation>({
      method: 'POST',
      url: `${evalBasePath}/saved-conversations:manual`,
      data: request,
    })
  );
  return response.data;
},
```

**Step 3: Verify build**

Run: `cd apps/plugin && npm run build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add apps/plugin/src/evaluation/types.ts apps/plugin/src/evaluation/api.ts
git commit -m "feat(plugin): add saved conversations TypeScript types and API client"
```

---

### Task 11: GenerationPicker Saved Tab

**Files:**
- Modify: `apps/plugin/src/components/evaluation/GenerationPicker.tsx`
- Modify: `apps/plugin/src/components/evaluation/EvalTestPanel.tsx`

**Step 1: Add saved conversations tab to GenerationPicker**

The `GenerationPicker` component needs:
1. A new `evaluationDataSource` prop for fetching saved conversations.
2. A tab toggle: "Saved" | "Recent" | "Search".
3. When "Saved" is active, fetch and display saved conversations.
4. Selecting a saved conversation loads its generations (existing flow).

Modify `GenerationPicker` to accept `evaluationDataSource` prop:

```typescript
export type GenerationPickerProps = {
  onSelect: (generationId: string | undefined) => void;
  selectedGenerationId?: string;
  conversationsDataSource?: ConversationsDataSource;
  evaluationDataSource?: EvaluationDataSource;
};
```

Add state for:
```typescript
const [tab, setTab] = useState<'saved' | 'recent' | 'search'>('saved');
const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
```

Add effect to load saved conversations when tab is "saved":
```typescript
useEffect(() => {
  if (tab !== 'saved' || !evaluationDataSource) return;
  let cancelled = false;
  evaluationDataSource.listSavedConversations(undefined, 50).then((resp) => {
    if (!cancelled) setSavedConversations(resp.items ?? []);
  });
  return () => { cancelled = true; };
}, [tab, evaluationDataSource]);
```

Render tab bar and saved conversation list with name, source badge, generation count indicator. When a saved conversation is selected, load its generations using existing `conversationsDataSource.getConversationDetail(savedConv.conversation_id)`.

**Step 2: Pass evaluationDataSource from EvalTestPanel**

In `EvalTestPanel.tsx`, pass the data source to `GenerationPicker`:

```typescript
<GenerationPicker
  onSelect={setSelectedGenerationId}
  selectedGenerationId={selectedGenerationId}
  conversationsDataSource={conversationsDataSource}
  evaluationDataSource={dataSource}
/>
```

**Step 3: Verify build**

Run: `cd apps/plugin && npm run build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add apps/plugin/src/components/evaluation/GenerationPicker.tsx apps/plugin/src/components/evaluation/EvalTestPanel.tsx
git commit -m "feat(plugin): add saved conversations tab to GenerationPicker"
```

---

### Task 12: Delete Cascade for Manual Conversations

**Files:**
- Modify: `sigil/internal/eval/control/saved_conversation_service.go`
- Modify: `sigil/internal/storage/mysql/saved_conversation.go`
- Modify: `sigil/internal/storage/mysql/saved_conversation_test.go`

**Step 1: Write the failing test**

Add to `sigil/internal/storage/mysql/saved_conversation_test.go`:

```go
func TestDeleteManualConversationCascade(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-a"

	// Create manual conversation first.
	gens := []evalcontrol.ManualGeneration{
		{
			GenerationID:  "gen-cascade-001",
			OperationName: "chat",
			Mode:          "SYNC",
			Model:         evalcontrol.ManualModelRef{Provider: "openai", Name: "gpt-4"},
			Input:         []evalcontrol.ManualMessage{{Role: "user", Content: "Hello"}},
			Output:        []evalcontrol.ManualMessage{{Role: "assistant", Content: "Hi"}},
		},
	}
	if err := store.CreateManualConversation(ctx, tenant, "conv_manual_cascade", gens); err != nil {
		t.Fatalf("create manual: %v", err)
	}

	// Cascade delete.
	if err := store.DeleteManualConversationData(ctx, tenant, "conv_manual_cascade"); err != nil {
		t.Fatalf("cascade delete: %v", err)
	}

	// Verify conversation gone.
	conv, _ := store.GetConversation(ctx, tenant, "conv_manual_cascade")
	if conv != nil {
		t.Error("expected conversation to be deleted")
	}

	// Verify generation gone.
	var count int64
	store.db.Model(&GenerationModel{}).
		Where("tenant_id = ? AND conversation_id = ?", tenant, "conv_manual_cascade").
		Count(&count)
	if count != 0 {
		t.Errorf("expected 0 generation rows, got %d", count)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestDeleteManualConversationCascade -v`
Expected: FAIL — `DeleteManualConversationData` not defined

**Step 3: Implement cascade delete**

Add to `sigil/internal/storage/mysql/saved_conversation.go`:

```go
func (s *WALStore) DeleteManualConversationData(ctx context.Context, tenantID, conversationID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
			Delete(&GenerationModel{}).Error; err != nil {
			return fmt.Errorf("delete generations: %w", err)
		}
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
			Delete(&ConversationModel{}).Error; err != nil {
			return fmt.Errorf("delete conversation: %w", err)
		}
		return nil
	})
}
```

Add interface for the cascade delete in `sigil/internal/eval/control/saved_conversation_service.go`:

```go
// ManualConversationDeleter removes conversation and generation rows for manual test data.
type ManualConversationDeleter interface {
	DeleteManualConversationData(ctx context.Context, tenantID, conversationID string) error
}
```

Update `DeleteSavedConversation` in the service to cascade for manual sources:

```go
func (s *SavedConversationService) DeleteSavedConversation(ctx context.Context, tenantID, savedID string) error {
	// ... existing validation ...

	// Look up the saved conversation to check source.
	sc, err := s.store.GetSavedConversation(ctx, tenantID, savedID)
	if err != nil {
		return fmt.Errorf("get saved conversation: %w", err)
	}
	if sc == nil {
		return nil // Already gone, idempotent.
	}

	// For manual conversations, cascade delete the underlying data.
	if sc.Source == evalpkg.SavedConversationSourceManual && s.manualDeleter != nil {
		if err := s.manualDeleter.DeleteManualConversationData(ctx, tenantID, sc.ConversationID); err != nil {
			return fmt.Errorf("delete manual conversation data: %w", err)
		}
	}

	return s.store.DeleteSavedConversation(ctx, tenantID, savedID)
}
```

Add `manualDeleter` field and `WithManualDeleter` option.

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestDeleteManualConversation -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/saved_conversation.go sigil/internal/storage/mysql/saved_conversation_test.go sigil/internal/eval/control/saved_conversation_service.go
git commit -m "feat(eval): add cascade delete for manual conversations"
```

---

### Task 13: Quality Checks and Final Verification

**Step 1: Run full test suite**

```bash
cd /Users/aes/repos/sigil && mise run check
```

**Step 2: Run format and lint**

```bash
mise run format && mise run lint
```

**Step 3: Fix any issues**

Address any lint/format/test failures.

**Step 4: Final commit if needed**

```bash
git add -A && git commit -m "fix: address lint and format issues"
```
