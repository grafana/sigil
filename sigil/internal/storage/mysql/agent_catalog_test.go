package mysql

import (
	"context"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestSaveBatchAgentCatalogNamedVersions(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC)
	generationA := generationForAgentCatalog("gen-agent-1", "conv-agent", "assistant", "v1", "You are concise.", base, "openai", "gpt-5", []*sigilv1.ToolDefinition{
		{Name: "weather", Description: "get weather", Type: "function", InputSchemaJson: []byte(`{"city":{"type":"string"}}`)},
	})
	generationAWhitespace := generationForAgentCatalog("gen-agent-2", "conv-agent", "assistant", "", "You   are concise.", base.Add(1*time.Minute), "openai", "gpt-5", []*sigilv1.ToolDefinition{
		{Name: "weather", Description: "get weather", Type: "function", InputSchemaJson: []byte(`{"city":{"type":"string"}}`)},
	})
	generationB := generationForAgentCatalog("gen-agent-3", "conv-agent", "assistant", "", "You are very concise.", base.Add(2*time.Minute), "openai", "gpt-5", []*sigilv1.ToolDefinition{
		{Name: "weather", Description: "get weather", Type: "function", InputSchemaJson: []byte(`{"city":{"type":"string"}}`)},
	})

	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generationA}))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generationAWhitespace}))
	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generationB}))

	var head AgentHeadModel
	if err := store.DB().Where("tenant_id = ? AND agent_name = ?", "tenant-a", "assistant").First(&head).Error; err != nil {
		t.Fatalf("load agent head: %v", err)
	}
	if head.GenerationCount != 3 {
		t.Fatalf("expected generation_count=3, got %d", head.GenerationCount)
	}
	if head.VersionCount != 2 {
		t.Fatalf("expected version_count=2, got %d", head.VersionCount)
	}
	if head.LatestEffectiveVersion == "" {
		t.Fatalf("expected latest effective version")
	}

	var versions []AgentVersionModel
	if err := store.DB().Where("tenant_id = ? AND agent_name = ?", "tenant-a", "assistant").Find(&versions).Error; err != nil {
		t.Fatalf("list versions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}

	var modelRows []AgentVersionModelUsageModel
	if err := store.DB().
		Where("tenant_id = ? AND agent_name = ?", "tenant-a", "assistant").
		Find(&modelRows).Error; err != nil {
		t.Fatalf("list model usage rows: %v", err)
	}
	if len(modelRows) != 2 {
		t.Fatalf("expected 2 model usage rows (one per effective version), got %d", len(modelRows))
	}
}

func TestSaveBatchAgentCatalogAnonymousBucket(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC)
	generationA := generationForAgentCatalog("gen-anon-1", "conv-anon", "", "", "Prompt A", base, "anthropic", "claude-sonnet-4-5", nil)
	generationB := generationForAgentCatalog("gen-anon-2", "conv-anon", "", "", "Prompt B", base.Add(time.Minute), "anthropic", "claude-sonnet-4-5", nil)

	requireNoBatchErrors(t, store.SaveBatch(context.Background(), "tenant-a", []*sigilv1.Generation{generationA, generationB}))

	var heads []AgentHeadModel
	if err := store.DB().Where("tenant_id = ?", "tenant-a").Find(&heads).Error; err != nil {
		t.Fatalf("list agent heads: %v", err)
	}
	if len(heads) != 1 {
		t.Fatalf("expected one anonymous head bucket, got %d", len(heads))
	}
	if heads[0].AgentName != "" {
		t.Fatalf("expected anonymous head name to be empty, got %q", heads[0].AgentName)
	}
	if heads[0].VersionCount != 2 {
		t.Fatalf("expected anonymous bucket version_count=2, got %d", heads[0].VersionCount)
	}
	if heads[0].GenerationCount != 2 {
		t.Fatalf("expected anonymous bucket generation_count=2, got %d", heads[0].GenerationCount)
	}
}

func TestUpsertAgentHeadTxConcurrentWritersKeepNewestLatestFields(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	tenantID := "tenant-race"
	agentName := "assistant"
	baseSeenAt := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	if err := store.DB().Create(&AgentHeadModel{
		TenantID:                 tenantID,
		AgentName:                agentName,
		LatestEffectiveVersion:   "sha256:base",
		LatestDeclaredVersion:    stringPtr("base"),
		LatestSeenAt:             baseSeenAt,
		FirstSeenAt:              baseSeenAt,
		GenerationCount:          1,
		VersionCount:             1,
		LatestToolCount:          1,
		LatestSystemPromptPrefix: "base",
	}).Error; err != nil {
		t.Fatalf("seed agent head: %v", err)
	}

	newerSeenAt := baseSeenAt.Add(2 * time.Minute)
	olderSeenAt := baseSeenAt.Add(1 * time.Minute)
	newerProjection := agentCatalogProjection{
		AgentName:                 agentName,
		DeclaredVersion:           "v-new",
		EffectiveVersion:          "sha256:new",
		SystemPromptPrefix:        "new-prefix",
		ToolCount:                 4,
		TokenEstimateSystemPrompt: 12,
		TokenEstimateToolsTotal:   34,
		TokenEstimateTotal:        46,
		SeenAt:                    newerSeenAt,
	}
	olderProjection := agentCatalogProjection{
		AgentName:                 agentName,
		DeclaredVersion:           "v-old",
		EffectiveVersion:          "sha256:old",
		SystemPromptPrefix:        "old-prefix",
		ToolCount:                 2,
		TokenEstimateSystemPrompt: 9,
		TokenEstimateToolsTotal:   11,
		TokenEstimateTotal:        20,
		SeenAt:                    olderSeenAt,
	}

	txNew := store.DB().Begin()
	if txNew.Error != nil {
		t.Fatalf("begin newer transaction: %v", txNew.Error)
	}
	if err := upsertAgentHeadTx(txNew, tenantID, newerProjection, stringPtr("v-new")); err != nil {
		_ = txNew.Rollback().Error
		t.Fatalf("upsert newer projection: %v", err)
	}

	startedOld := make(chan struct{}, 1)
	doneOld := make(chan error, 1)
	go func() {
		startedOld <- struct{}{}
		txOld := store.DB().Begin()
		if txOld.Error != nil {
			doneOld <- txOld.Error
			return
		}
		if err := upsertAgentHeadTx(txOld, tenantID, olderProjection, stringPtr("v-old")); err != nil {
			_ = txOld.Rollback().Error
			doneOld <- err
			return
		}
		doneOld <- txOld.Commit().Error
	}()

	select {
	case <-startedOld:
	case <-time.After(2 * time.Second):
		_ = txNew.Rollback().Error
		t.Fatalf("old writer did not start")
	}
	// Give the old writer time to reach the lock boundary while the newer transaction is still open.
	time.Sleep(200 * time.Millisecond)

	if err := txNew.Commit().Error; err != nil {
		t.Fatalf("commit newer transaction: %v", err)
	}
	select {
	case err := <-doneOld:
		if err != nil {
			t.Fatalf("commit older transaction: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for older transaction")
	}

	var head AgentHeadModel
	if err := store.DB().
		Where("tenant_id = ? AND agent_name = ?", tenantID, agentName).
		Take(&head).Error; err != nil {
		t.Fatalf("load updated agent head: %v", err)
	}

	if head.LatestEffectiveVersion != newerProjection.EffectiveVersion {
		t.Fatalf("expected latest effective version %q, got %q", newerProjection.EffectiveVersion, head.LatestEffectiveVersion)
	}
	if head.LatestDeclaredVersion == nil || *head.LatestDeclaredVersion != "v-new" {
		t.Fatalf("expected latest declared version v-new, got %v", head.LatestDeclaredVersion)
	}
	if !head.LatestSeenAt.UTC().Equal(newerSeenAt) {
		t.Fatalf("expected latest seen at %s, got %s", newerSeenAt.UTC(), head.LatestSeenAt.UTC())
	}
	if head.LatestSystemPromptPrefix != newerProjection.SystemPromptPrefix {
		t.Fatalf("expected latest system prompt prefix %q, got %q", newerProjection.SystemPromptPrefix, head.LatestSystemPromptPrefix)
	}
}

func generationForAgentCatalog(
	id string,
	conversationID string,
	agentName string,
	agentVersion string,
	systemPrompt string,
	completedAt time.Time,
	modelProvider string,
	modelName string,
	tools []*sigilv1.ToolDefinition,
) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             id,
		ConversationId: conversationID,
		AgentName:      agentName,
		AgentVersion:   agentVersion,
		SystemPrompt:   systemPrompt,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: modelProvider, Name: modelName},
		Tools:          tools,
		StartedAt:      timestamppb.New(completedAt.Add(-time.Second)),
		CompletedAt:    timestamppb.New(completedAt),
	}
}
