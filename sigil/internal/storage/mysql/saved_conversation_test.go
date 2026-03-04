package mysql

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/proto"
)

func TestSavedConversationAutoMigrate(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	if !store.db.Migrator().HasTable(&EvalSavedConversationModel{}) {
		t.Fatal("expected eval_saved_conversations table to exist")
	}
	if !store.db.Migrator().HasColumn(&GenerationModel{}, "Source") {
		t.Fatal("expected generations.source column to exist")
	}
}

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

	// Verify payload is valid protobuf.
	var gen sigilv1.Generation
	if err := proto.Unmarshal(genRow.Payload, &gen); err != nil {
		t.Fatalf("unmarshal generation: %v", err)
	}
	if gen.Id != "gen-manual-001" {
		t.Errorf("unexpected generation id %q", gen.Id)
	}
	if gen.ConversationId != convID {
		t.Errorf("unexpected conversation id %q", gen.ConversationId)
	}
	if gen.Model.Provider != "openai" || gen.Model.Name != "gpt-4" {
		t.Errorf("unexpected model %v", gen.Model)
	}
}

func TestDeleteManualConversationData(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenant := "tenant-a"

	gens := []evalcontrol.ManualGeneration{
		{
			GenerationID:  "gen-del-001",
			OperationName: "chat",
			Mode:          "SYNC",
			Model:         evalcontrol.ManualModelRef{Provider: "openai", Name: "gpt-4"},
			Input:         []evalcontrol.ManualMessage{{Role: "user", Content: "Hello"}},
			Output:        []evalcontrol.ManualMessage{{Role: "assistant", Content: "Hi"}},
		},
	}
	if err := store.CreateManualConversation(ctx, tenant, "conv_del_test", gens); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := store.DeleteManualConversationData(ctx, tenant, "conv_del_test"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	conv, _ := store.GetConversation(ctx, tenant, "conv_del_test")
	if conv != nil {
		t.Error("expected conversation to be deleted")
	}

	var count int64
	store.db.Model(&GenerationModel{}).Where("tenant_id = ? AND conversation_id = ?", tenant, "conv_del_test").Count(&count)
	if count != 0 {
		t.Errorf("expected 0 generations, got %d", count)
	}
}
