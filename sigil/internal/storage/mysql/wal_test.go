package mysql

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	testMySQLImage    = "mysql:8.4"
	testMySQLUser     = "sigil"
	testMySQLPassword = "sigil"
	testMySQLRootPass = "rootpass"
)

var (
	sharedMySQLOnce      sync.Once
	sharedMySQLContainer testcontainers.Container
	sharedMySQLHost      string
	sharedMySQLPort      string
	sharedMySQLErr       error
	testDatabaseSeq      atomic.Uint64
)

func TestMain(m *testing.M) {
	code := m.Run()
	if sharedMySQLContainer != nil {
		_ = sharedMySQLContainer.Terminate(context.Background())
	}
	os.Exit(code)
}

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
	if !migrator.HasTable(&AgentVersionModel{}) {
		t.Fatalf("expected agent_versions table")
	}
	if !migrator.HasTable(&AgentVersionModelUsageModel{}) {
		t.Fatalf("expected agent_version_models table")
	}
	if !migrator.HasTable(&AgentHeadModel{}) {
		t.Fatalf("expected agent_heads table")
	}
	if !migrator.HasTable(&EvalEnqueueEventModel{}) {
		t.Fatalf("expected eval_enqueue_events table")
	}
	if !migrator.HasTable(&ConversationRatingModel{}) {
		t.Fatalf("expected conversation_ratings table")
	}
	if !migrator.HasTable(&ConversationRatingSummaryModel{}) {
		t.Fatalf("expected conversation_rating_summaries table")
	}
	if !migrator.HasTable(&ConversationAnnotationModel{}) {
		t.Fatalf("expected conversation_annotations table")
	}
	if !migrator.HasTable(&ConversationAnnotationSummaryModel{}) {
		t.Fatalf("expected conversation_annotation_summaries table")
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
	if !migrator.HasIndex(&AgentVersionModel{}, "ux_agent_versions_tenant_name_version") {
		t.Fatalf("expected unique agent version index")
	}
	if !migrator.HasIndex(&AgentHeadModel{}, "ux_agent_heads_tenant_name") {
		t.Fatalf("expected unique agent head index")
	}
	if !migrator.HasIndex(&GenerationModel{}, "idx_generations_tenant_compacted_compacted_at_id") {
		t.Fatalf("expected truncate-supporting compacted_at index")
	}
	if !migrator.HasIndex(&EvalWorkItemModel{}, "idx_eval_work_items_status_scheduled_id") {
		t.Fatalf("expected global eval work item claim index")
	}
}

func TestAutoMigrateDoesNotResetClaimsOnSubsequentRuns(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate first run: %v", err)
	}

	base := time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC)
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-migrate", []*sigilv1.Generation{
		testGeneration("gen-migrate-1", "conv-migrate", base),
	}))

	claimedBy := "owner-before-restart"
	claimedAt := time.Now().UTC()
	if err := store.DB().Model(&GenerationModel{}).
		Where("tenant_id = ? AND generation_id = ?", "tenant-migrate", "gen-migrate-1").
		Updates(map[string]any{
			"claimed_by": claimedBy,
			"claimed_at": claimedAt,
		}).Error; err != nil {
		t.Fatalf("seed claimed row: %v", err)
	}

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate second run: %v", err)
	}

	var row GenerationModel
	if err := store.DB().
		Where("tenant_id = ? AND generation_id = ?", "tenant-migrate", "gen-migrate-1").
		First(&row).Error; err != nil {
		t.Fatalf("load generation row: %v", err)
	}
	if row.ClaimedBy == nil || *row.ClaimedBy != claimedBy {
		t.Fatalf("expected claimed_by=%q to be preserved, got %#v", claimedBy, row.ClaimedBy)
	}
	if row.ClaimedAt == nil {
		t.Fatalf("expected claimed_at to be preserved")
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

	var decoded sigilv1.Generation
	if err := proto.Unmarshal(row.Payload, &decoded); err != nil {
		t.Fatalf("unmarshal stored payload: %v", err)
	}
	if decoded.MaxTokens == nil || *decoded.MaxTokens != *generation.MaxTokens {
		t.Fatalf("expected max_tokens %v, got %v", generation.MaxTokens, decoded.MaxTokens)
	}
	if decoded.Temperature == nil || *decoded.Temperature != *generation.Temperature {
		t.Fatalf("expected temperature %v, got %v", generation.Temperature, decoded.Temperature)
	}
	if decoded.TopP == nil || *decoded.TopP != *generation.TopP {
		t.Fatalf("expected top_p %v, got %v", generation.TopP, decoded.TopP)
	}
	if decoded.ToolChoice == nil || *decoded.ToolChoice != *generation.ToolChoice {
		t.Fatalf("expected tool_choice %v, got %v", generation.ToolChoice, decoded.ToolChoice)
	}
	if decoded.ThinkingEnabled == nil || *decoded.ThinkingEnabled != *generation.ThinkingEnabled {
		t.Fatalf("expected thinking_enabled %v, got %v", generation.ThinkingEnabled, decoded.ThinkingEnabled)
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
	expectedFirst := generations[0].GetCompletedAt().AsTime().UTC()
	if !conversation.FirstGenerationAt.Equal(expectedFirst) {
		t.Fatalf("expected first_generation_at %v, got %v", expectedFirst, conversation.FirstGenerationAt)
	}
	expectedLast := generations[1].GetCompletedAt().AsTime().UTC()
	if !conversation.LastGenerationAt.Equal(expectedLast) {
		t.Fatalf("expected last_generation_at %v, got %v", expectedLast, conversation.LastGenerationAt)
	}
}

func TestSaveBatchConversationProjectionStoresLatestNonEmptyTitle(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	older := testGeneration("gen-1", "conv-title", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	older.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: earlier title"),
	}}
	blankLater := testGeneration("gen-2", "conv-title", time.Date(2026, 2, 12, 18, 5, 0, 0, time.UTC))
	blankLater.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("   "),
	}}
	latest := testGeneration("gen-3", "conv-title", time.Date(2026, 2, 12, 18, 8, 0, 0, time.UTC))
	latest.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: latest title"),
	}}
	outOfOrderOlder := testGeneration("gen-4", "conv-title", time.Date(2026, 2, 12, 18, 3, 0, 0, time.UTC))
	outOfOrderOlder.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{
		"sigil.conversation.title": structpb.NewStringValue("Incident: stale title"),
	}}

	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{older, blankLater, latest}))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{outOfOrderOlder}))

	var conversation ConversationModel
	err := store.DB().Where("tenant_id = ? AND conversation_id = ?", "tenant-a", "conv-title").First(&conversation).Error
	if err != nil {
		t.Fatalf("query conversation row: %v", err)
	}
	if conversation.ConversationTitle == nil || *conversation.ConversationTitle != "Incident: latest title" {
		t.Fatalf("expected latest non-empty title, got %#v", conversation.ConversationTitle)
	}
	if conversation.TitleUpdatedAt == nil || !conversation.TitleUpdatedAt.Equal(latest.GetCompletedAt().AsTime().UTC()) {
		t.Fatalf("expected title_updated_at %v, got %#v", latest.GetCompletedAt().AsTime().UTC(), conversation.TitleUpdatedAt)
	}
}

func TestSaveBatchRetriesOnDeadlock(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	const callbackName = "sigil:test:inject_deadlock_once"
	var injected atomic.Uint32
	if err := store.DB().Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Table != "generations" {
			return
		}
		if injected.CompareAndSwap(0, 1) {
			if err := tx.AddError(&mysqlDriver.MySQLError{
				Number:  1213,
				Message: "Deadlock found when trying to get lock; try restarting transaction",
			}); err == nil {
				t.Error("expected deadlock error to be recorded on transaction")
			}
		}
	}); err != nil {
		t.Fatalf("register deadlock callback: %v", err)
	}
	defer func() {
		if err := store.DB().Callback().Create().Remove(callbackName); err != nil {
			t.Errorf("remove deadlock callback: %v", err)
		}
	}()

	generation := testGeneration("gen-deadlock-retry", "conv-deadlock-retry", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation}))

	if injected.Load() != 1 {
		t.Fatalf("expected one injected deadlock, got %d", injected.Load())
	}

	var row GenerationModel
	if err := store.DB().
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", generation.GetId()).
		First(&row).Error; err != nil {
		t.Fatalf("expected persisted generation after retry: %v", err)
	}
}

func TestSaveBatchWithEvalHookPersistsEnqueueEventAndSignalsHook(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	store.SetEvalEnqueueEnabled(true)
	hook := &recordingEvalHook{}
	store.SetEvalHook(hook)

	generation := testGeneration("gen-hook-signal", "conv-hook-signal", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation}))

	if hook.calls != 1 {
		t.Fatalf("expected hook calls=1, got %d", hook.calls)
	}
	if len(hook.tenantIDs) != 1 || hook.tenantIDs[0] != "tenant-a" {
		t.Fatalf("expected hook tenant_ids=[tenant-a], got %v", hook.tenantIDs)
	}

	var event EvalEnqueueEventModel
	if err := store.DB().
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", generation.GetId()).
		First(&event).Error; err != nil {
		t.Fatalf("expected eval enqueue event: %v", err)
	}
	if event.Status != evalEnqueueStatusQueued {
		t.Fatalf("expected queued status, got %q", event.Status)
	}
	if len(event.Payload) == 0 {
		t.Fatalf("expected enqueue payload bytes")
	}
}

func newTestWALStore(t *testing.T) (*WALStore, func()) {
	t.Helper()

	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_test_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database %q: %v", dbName, err)
	}

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)
	store, err := NewWALStore(testDSN)
	if err != nil {
		if dropErr := dropTestDatabase(adminDSN, dbName); dropErr != nil {
			t.Logf("drop failed test database %q: %v", dbName, dropErr)
		}
		t.Fatalf("open wal store for %q: %v", dbName, err)
	}

	sqlDB, err := store.DB().DB()
	if err != nil {
		_ = dropTestDatabase(adminDSN, dbName)
		t.Fatalf("open sql db for %q: %v", dbName, err)
	}
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		_ = dropTestDatabase(adminDSN, dbName)
		t.Fatalf("ping sql db for %q: %v", dbName, err)
	}

	cleanup := func() {
		_ = sqlDB.Close()
		if err := dropTestDatabase(adminDSN, dbName); err != nil {
			t.Logf("drop test database %q: %v", dbName, err)
		}
	}
	return store, cleanup
}

func ensureSharedMySQLContainer(t *testing.T) (string, string) {
	t.Helper()

	sharedMySQLOnce.Do(func() {
		ctx := context.Background()
		container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        testMySQLImage,
				ExposedPorts: []string{"3306/tcp"},
				Env: map[string]string{
					"MYSQL_DATABASE":      "sigil",
					"MYSQL_USER":          testMySQLUser,
					"MYSQL_PASSWORD":      testMySQLPassword,
					"MYSQL_ROOT_PASSWORD": testMySQLRootPass,
				},
				WaitingFor: wait.ForListeningPort("3306/tcp").WithStartupTimeout(2 * time.Minute),
			},
			Started: true,
		})
		if err != nil {
			sharedMySQLErr = err
			return
		}

		host, err := container.Host(ctx)
		if err != nil {
			_ = container.Terminate(context.Background())
			sharedMySQLErr = err
			return
		}
		mappedPort, err := container.MappedPort(ctx, "3306/tcp")
		if err != nil {
			_ = container.Terminate(context.Background())
			sharedMySQLErr = err
			return
		}

		sharedMySQLContainer = container
		sharedMySQLHost = host
		sharedMySQLPort = mappedPort.Port()

		adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, sharedMySQLHost, sharedMySQLPort)
		var readyErr error
		for i := 0; i < 30; i++ {
			var adminStore *WALStore
			adminStore, readyErr = NewWALStore(adminDSN)
			if readyErr == nil {
				sqlDB, dbErr := adminStore.DB().DB()
				if dbErr == nil && sqlDB.Ping() == nil {
					_ = sqlDB.Close()
					readyErr = nil
					break
				}
				if dbErr == nil {
					_ = sqlDB.Close()
				}
				if dbErr != nil {
					readyErr = dbErr
				}
			}
			time.Sleep(time.Second)
		}
		if readyErr != nil {
			_ = container.Terminate(context.Background())
			sharedMySQLErr = readyErr
			sharedMySQLContainer = nil
		}
	})

	if sharedMySQLErr != nil {
		t.Skipf("skip mysql integration tests (shared container unavailable): %v", sharedMySQLErr)
	}
	if sharedMySQLContainer == nil {
		t.Skip("skip mysql integration tests (shared container unavailable)")
	}
	return sharedMySQLHost, sharedMySQLPort
}

func createTestDatabase(adminDSN, dbName string) error {
	adminStore, err := NewWALStore(adminDSN)
	if err != nil {
		return err
	}
	sqlDB, err := adminStore.DB().DB()
	if err != nil {
		return err
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	query := fmt.Sprintf(
		"CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
		dbName,
	)
	return adminStore.DB().Exec(query).Error
}

func dropTestDatabase(adminDSN, dbName string) error {
	adminStore, err := NewWALStore(adminDSN)
	if err != nil {
		return err
	}
	sqlDB, err := adminStore.DB().DB()
	if err != nil {
		return err
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	query := fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", dbName)
	return adminStore.DB().Exec(query).Error
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
		Id:              id,
		ConversationId:  conversationID,
		Mode:            sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:           &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		StartedAt:       timestamppb.New(completedAt.Add(-time.Second)),
		CompletedAt:     timestamppb.New(completedAt),
		MaxTokens:       proto.Int64(1024),
		Temperature:     proto.Float64(0.25),
		TopP:            proto.Float64(0.9),
		ToolChoice:      proto.String("required"),
		ThinkingEnabled: proto.Bool(true),
	}
}

func TestSaveBatchWithoutEvalHookPersistsEnqueueEvent(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	store.SetEvalEnqueueEnabled(true)

	generation := testGeneration("gen-hook-disabled", "conv-hook-disabled", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation}))

	var count int64
	if err := store.DB().Model(&EvalEnqueueEventModel{}).Count(&count).Error; err != nil {
		t.Fatalf("count eval enqueue events: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected enqueue event without hook, got %d", count)
	}
}

func TestSaveBatchWithEvalEnqueueDisabledSkipsEnqueueEvent(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	store.SetEvalEnqueueEnabled(false)

	generation := testGeneration("gen-hook-disabled-enqueue", "conv-hook-disabled-enqueue", time.Date(2026, 2, 12, 18, 0, 0, 0, time.UTC))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generation}))

	var generationCount int64
	if err := store.DB().Model(&GenerationModel{}).Count(&generationCount).Error; err != nil {
		t.Fatalf("count generations: %v", err)
	}
	if generationCount != 1 {
		t.Fatalf("expected generation row, got %d", generationCount)
	}

	var enqueueCount int64
	if err := store.DB().Model(&EvalEnqueueEventModel{}).Count(&enqueueCount).Error; err != nil {
		t.Fatalf("count eval enqueue events: %v", err)
	}
	if enqueueCount != 0 {
		t.Fatalf("expected no enqueue events when disabled, got %d", enqueueCount)
	}

	var convCount int64
	if err := store.DB().Model(&ConversationModel{}).Count(&convCount).Error; err != nil {
		t.Fatalf("count conversations: %v", err)
	}
	if convCount != 1 {
		t.Fatalf("expected conversation row even when eval enqueue disabled, got %d", convCount)
	}
}

type recordingEvalHook struct {
	calls     int
	tenantIDs []string
}

func (h *recordingEvalHook) OnGenerationsSaved(tenantID string) {
	h.calls++
	h.tenantIDs = append(h.tenantIDs, tenantID)
}
