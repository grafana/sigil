package mysql

import (
	"context"
	"fmt"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestAutoMigrateCreatesSchema(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	migrator := store.DB().Migrator()
	if !migrator.HasTable(&GenerationModel{}) {
		t.Fatalf("expected generations table")
	}
	if !migrator.HasTable(&ConversationModel{}) {
		t.Fatalf("expected conversations table")
	}
	if !migrator.HasTable(&CompactionBlockModel{}) {
		t.Fatalf("expected compaction_blocks table")
	}
	if !migrator.HasTable(&CompactorLeaseModel{}) {
		t.Fatalf("expected compactor_leases table")
	}
	if !migrator.HasIndex(&GenerationModel{}, "ux_generations_tenant_generation") {
		t.Fatalf("expected unique generation index")
	}
	if !migrator.HasIndex(&ConversationModel{}, "ux_conversations_tenant_conversation") {
		t.Fatalf("expected unique conversation index")
	}
}

func TestSaveBatchStoresPayloadAndProjection(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	generation := testGeneration("gen-1", "conv-1", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	errs := store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation})
	requireNoBatchErrors(t, errs)

	var row GenerationModel
	err := store.DB().Where("tenant_id = ? AND generation_id = ?", "tenant-a", "gen-1").First(&row).Error
	if err != nil {
		t.Fatalf("query generation row: %v", err)
	}

	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}
	if row.PayloadSizeBytes != len(payload) {
		t.Fatalf("expected payload size %d, got %d", len(payload), row.PayloadSizeBytes)
	}
	if len(row.Payload) == 0 {
		t.Fatalf("expected payload bytes")
	}

	var conversation ConversationModel
	err = store.DB().Where("tenant_id = ? AND conversation_id = ?", "tenant-a", "conv-1").First(&conversation).Error
	if err != nil {
		t.Fatalf("query conversation row: %v", err)
	}
	if conversation.GenerationCount != 1 {
		t.Fatalf("expected generation_count 1, got %d", conversation.GenerationCount)
	}
}

func TestSaveBatchDuplicateGenerationIDIsTenantScoped(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	generation := testGeneration("gen-dup", "conv-dup", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))

	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation}))

	errs := store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation})
	if errs[0] == nil || errs[0].Error() != "generation already exists" {
		t.Fatalf("expected duplicate error, got %v", errs[0])
	}

	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-b", []*sigilv1.Generation{generation}))
}

func TestSaveBatchConversationProjectionUpsert(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	generations := []*sigilv1.Generation{
		testGeneration("gen-1", "conv-upsert", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)),
		testGeneration("gen-2", "conv-upsert", time.Date(2026, 2, 12, 18, 5, 0, 0, time.UTC)),
	}
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", generations))

	var conversation ConversationModel
	err := store.DB().Where("tenant_id = ? AND conversation_id = ?", "tenant-a", "conv-upsert").First(&conversation).Error
	if err != nil {
		t.Fatalf("query conversation row: %v", err)
	}
	if conversation.GenerationCount != 2 {
		t.Fatalf("expected generation_count 2, got %d", conversation.GenerationCount)
	}
	expectedLast := generations[1].GetCompletedAt().AsTime().UTC()
	if !conversation.LastGenerationAt.Equal(expectedLast) {
		t.Fatalf("expected last_generation_at %v, got %v", expectedLast, conversation.LastGenerationAt)
	}
}

func newTestWALStore(t *testing.T) (*WALStore, func()) {
	t.Helper()

	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "mysql:8.4",
			ExposedPorts: []string{"3306/tcp"},
			Env: map[string]string{
				"MYSQL_DATABASE":      "sigil",
				"MYSQL_USER":          "sigil",
				"MYSQL_PASSWORD":      "sigil",
				"MYSQL_ROOT_PASSWORD": "rootpass",
			},
			WaitingFor: wait.ForListeningPort("3306/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("skip mysql integration tests (container start failed): %v", err)
	}

	cleanup := func() {
		_ = container.Terminate(context.Background())
	}

	host, err := container.Host(ctx)
	if err != nil {
		cleanup()
		t.Fatalf("container host: %v", err)
	}

	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		cleanup()
		t.Fatalf("mapped port: %v", err)
	}

	dsn := fmt.Sprintf("sigil:sigil@tcp(%s:%s)/sigil?parseTime=true", host, port.Port())

	var store *WALStore
	for i := 0; i < 30; i++ {
		store, err = NewWALStore(dsn)
		if err == nil {
			sqlDB, dbErr := store.DB().DB()
			if dbErr == nil && sqlDB.Ping() == nil {
				return store, cleanup
			}
		}
		time.Sleep(time.Second)
	}

	cleanup()
	t.Skipf("skip mysql integration tests (database not ready): %v", err)
	return nil, func() {}
}

func requireNoBatchErrors(t *testing.T, errs []error) {
	t.Helper()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("unexpected error at index %d: %v", i, err)
		}
	}
}

func testGeneration(id, conversationID string, completedAt time.Time) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             id,
		ConversationId: conversationID,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		StartedAt:      timestamppb.New(completedAt.Add(-time.Second)),
		CompletedAt:    timestamppb.New(completedAt),
	}
}
