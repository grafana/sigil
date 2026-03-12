package mysql

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestCollectionStoreCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-coll"
	collID := uuid.New().String()

	// Create
	c := evalpkg.Collection{
		TenantID:     tenant,
		CollectionID: collID,
		Name:         "My Collection",
		Description:  "A test collection",
		CreatedBy:    "user-1",
		UpdatedBy:    "user-1",
	}
	if err := store.CreateCollection(ctx, c); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Duplicate create returns conflict
	err := store.CreateCollection(ctx, c)
	if err == nil || !errors.Is(err, evalpkg.ErrConflict) {
		t.Fatalf("expected conflict error, got %v", err)
	}

	// Get
	got, err := store.GetCollection(ctx, tenant, collID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil {
		t.Fatal("expected collection")
	}
	if got.Name != "My Collection" {
		t.Errorf("unexpected name %q", got.Name)
	}
	if got.Description != "A test collection" {
		t.Errorf("unexpected description %q", got.Description)
	}
	if got.MemberCount != 0 {
		t.Errorf("expected 0 members, got %d", got.MemberCount)
	}

	// Get not found
	missing, err := store.GetCollection(ctx, tenant, "nonexistent")
	if err != nil {
		t.Fatalf("get missing: %v", err)
	}
	if missing != nil {
		t.Fatal("expected nil for missing collection")
	}

	// List
	items, nextCursor, err := store.ListCollections(ctx, tenant, 10, "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Errorf("expected 1 item, got %d", len(items))
	}
	if nextCursor != "" {
		t.Errorf("expected empty cursor, got %q", nextCursor)
	}

	// Update
	newName := "Renamed Collection"
	newDesc := "Updated description"
	newUpdatedBy := "user-2"
	if err := store.UpdateCollection(ctx, tenant, collID, &newName, &newDesc, &newUpdatedBy); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err = store.GetCollection(ctx, tenant, collID)
	if err != nil {
		t.Fatalf("get after update: %v", err)
	}
	if got.Name != "Renamed Collection" {
		t.Errorf("expected updated name, got %q", got.Name)
	}
	if got.Description != "Updated description" {
		t.Errorf("expected updated description, got %q", got.Description)
	}
	if got.UpdatedBy != "user-2" {
		t.Errorf("expected updated_by user-2, got %q", got.UpdatedBy)
	}

	// Update not found
	err = store.UpdateCollection(ctx, tenant, "nonexistent", &newName, nil, nil)
	if err == nil || !errors.Is(err, evalpkg.ErrNotFound) {
		t.Fatalf("expected not found error, got %v", err)
	}

	// Delete
	if err := store.DeleteCollection(ctx, tenant, collID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	got, err = store.GetCollection(ctx, tenant, collID)
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if got != nil {
		t.Error("expected nil after delete")
	}
}

func TestCollectionMembership(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-mem"
	collID := uuid.New().String()

	// Create collection
	c := evalpkg.Collection{
		TenantID:     tenant,
		CollectionID: collID,
		Name:         "Membership Test",
		CreatedBy:    "user-1",
		UpdatedBy:    "user-1",
	}
	if err := store.CreateCollection(ctx, c); err != nil {
		t.Fatalf("create collection: %v", err)
	}

	// Create a saved conversation
	sc := evalpkg.SavedConversation{
		TenantID:       tenant,
		SavedID:        "sc-mem-1",
		ConversationID: "conv-mem-1",
		Name:           "Saved Conv 1",
		Source:         evalpkg.SavedConversationSourceTelemetry,
		Tags:           map[string]string{},
		SavedBy:        "user-1",
	}
	if err := store.CreateSavedConversation(ctx, sc); err != nil {
		t.Fatalf("create saved conversation: %v", err)
	}

	// Add member
	if err := store.AddCollectionMembers(ctx, tenant, collID, []string{"sc-mem-1"}, "user-1"); err != nil {
		t.Fatalf("add member: %v", err)
	}

	// Verify member count via GetCollection
	got, err := store.GetCollection(ctx, tenant, collID)
	if err != nil {
		t.Fatalf("get collection: %v", err)
	}
	if got.MemberCount != 1 {
		t.Errorf("expected 1 member, got %d", got.MemberCount)
	}

	// List members
	members, nextCursor, err := store.ListCollectionMembers(ctx, tenant, collID, 10, "")
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	if len(members) != 1 {
		t.Errorf("expected 1 member, got %d", len(members))
	}
	if nextCursor != "" {
		t.Errorf("expected empty cursor, got %q", nextCursor)
	}
	if members[0].SavedID != "sc-mem-1" {
		t.Errorf("unexpected saved id %q", members[0].SavedID)
	}

	// List collections for saved conversation
	collections, err := store.ListCollectionsForSavedConversation(ctx, tenant, "sc-mem-1")
	if err != nil {
		t.Fatalf("list collections for saved conversation: %v", err)
	}
	if len(collections) != 1 {
		t.Errorf("expected 1 collection, got %d", len(collections))
	}
	if collections[0].CollectionID != collID {
		t.Errorf("unexpected collection id %q", collections[0].CollectionID)
	}
	if collections[0].MemberCount != 1 {
		t.Errorf("expected member count 1, got %d", collections[0].MemberCount)
	}

	// Idempotent add (should not error)
	if err := store.AddCollectionMembers(ctx, tenant, collID, []string{"sc-mem-1"}, "user-1"); err != nil {
		t.Fatalf("idempotent add: %v", err)
	}
	got, _ = store.GetCollection(ctx, tenant, collID)
	if got.MemberCount != 1 {
		t.Errorf("expected still 1 member after idempotent add, got %d", got.MemberCount)
	}

	// Remove member
	if err := store.RemoveCollectionMember(ctx, tenant, collID, "sc-mem-1"); err != nil {
		t.Fatalf("remove member: %v", err)
	}
	got, _ = store.GetCollection(ctx, tenant, collID)
	if got.MemberCount != 0 {
		t.Errorf("expected 0 members after remove, got %d", got.MemberCount)
	}

	// Re-add member then delete collection to test cascade
	if err := store.AddCollectionMembers(ctx, tenant, collID, []string{"sc-mem-1"}, "user-1"); err != nil {
		t.Fatalf("re-add member: %v", err)
	}
	if err := store.DeleteCollection(ctx, tenant, collID); err != nil {
		t.Fatalf("delete collection: %v", err)
	}

	// Verify membership rows are gone
	var count int64
	store.db.Model(&EvalCollectionMemberModel{}).
		Where("tenant_id = ? AND collection_id = ?", tenant, collID).
		Count(&count)
	if count != 0 {
		t.Errorf("expected 0 membership rows after cascade delete, got %d", count)
	}

	// Test DeleteCollectionMembersBySavedID
	collID2 := uuid.New().String()
	c2 := evalpkg.Collection{
		TenantID:     tenant,
		CollectionID: collID2,
		Name:         "Second Collection",
		CreatedBy:    "user-1",
		UpdatedBy:    "user-1",
	}
	if err := store.CreateCollection(ctx, c2); err != nil {
		t.Fatalf("create second collection: %v", err)
	}
	if err := store.AddCollectionMembers(ctx, tenant, collID2, []string{"sc-mem-1"}, "user-1"); err != nil {
		t.Fatalf("add member to second collection: %v", err)
	}
	if err := store.DeleteCollectionMembersBySavedID(ctx, tenant, "sc-mem-1"); err != nil {
		t.Fatalf("delete members by saved id: %v", err)
	}
	store.db.Model(&EvalCollectionMemberModel{}).
		Where("tenant_id = ? AND saved_id = ?", tenant, "sc-mem-1").
		Count(&count)
	if count != 0 {
		t.Errorf("expected 0 membership rows after delete by saved id, got %d", count)
	}
}
