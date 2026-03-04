package query

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestListAgentsForTenantWithCursor(t *testing.T) {
	store := &stubAgentCatalogStore{
		heads: []storage.AgentHead{
			{
				AgentName:                       "assistant",
				LatestEffectiveVersion:          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				LatestSeenAt:                    time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC),
				FirstSeenAt:                     time.Date(2026, 3, 4, 9, 0, 0, 0, time.UTC),
				GenerationCount:                 5,
				VersionCount:                    2,
				LatestToolCount:                 3,
				LatestSystemPromptPrefix:        "You are concise.",
				LatestTokenEstimateSystemPrompt: 5,
				LatestTokenEstimateToolsTotal:   7,
				LatestTokenEstimateTotal:        12,
			},
		},
		nextCursor: &storage.AgentHeadCursor{
			LatestSeenAt: time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC),
			AgentName:    "assistant",
			ID:           42,
		},
	}
	svc, err := NewServiceWithDependencies(ServiceDependencies{
		ConversationStore: nil,
		AgentCatalogStore: store,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	items, nextCursor, err := svc.ListAgentsForTenant(context.Background(), "tenant-a", 50, "", "")
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one agent item, got %d", len(items))
	}
	if nextCursor == "" {
		t.Fatalf("expected continuation cursor")
	}

	if store.lastLimit != 50 {
		t.Fatalf("expected list limit=50, got %d", store.lastLimit)
	}
}

func TestListAgentsForTenantRejectsCursorFilterMismatch(t *testing.T) {
	store := &stubAgentCatalogStore{}
	svc, err := NewServiceWithDependencies(ServiceDependencies{AgentCatalogStore: store})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	cursor, err := encodeAgentListCursor(agentListCursor{
		LatestSeenNanos: time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC).UnixNano(),
		AgentName:       "assistant",
		HeadID:          42,
		FilterHash:      buildAgentListFilterHash("different"),
	})
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}

	_, _, err = svc.ListAgentsForTenant(context.Background(), "tenant-a", 10, cursor, "assistant")
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error for mismatched cursor filter, got %v", err)
	}
}

func TestGetAgentDetailForTenantLatestVersion(t *testing.T) {
	version := &storage.AgentVersion{
		AgentName:                 "assistant",
		EffectiveVersion:          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		SystemPrompt:              "You are concise.",
		SystemPromptPrefix:        "You are concise.",
		ToolCount:                 1,
		TokenEstimateSystemPrompt: 4,
		TokenEstimateToolsTotal:   3,
		TokenEstimateTotal:        7,
		GenerationCount:           10,
		FirstSeenAt:               time.Date(2026, 3, 4, 9, 0, 0, 0, time.UTC),
		LastSeenAt:                time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
		ToolsJSON:                 `[{"name":"weather","description":"get weather","type":"function","input_schema_json":"{\"city\":{\"type\":\"string\"}}","token_estimate":3}]`,
	}
	store := &stubAgentCatalogStore{
		latestVersion: version,
		models: []storage.AgentVersionModel{
			{ModelProvider: "openai", ModelName: "gpt-4o", GenerationCount: 2},
			{ModelProvider: "anthropic", ModelName: "claude-sonnet-4-5", GenerationCount: 9},
		},
	}
	svc, err := NewServiceWithDependencies(ServiceDependencies{AgentCatalogStore: store})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	detail, found, err := svc.GetAgentDetailForTenant(context.Background(), "tenant-a", "assistant", "")
	if err != nil {
		t.Fatalf("get agent detail: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true")
	}
	if detail.EffectiveVersion != version.EffectiveVersion {
		t.Fatalf("unexpected effective version: got=%q want=%q", detail.EffectiveVersion, version.EffectiveVersion)
	}
	if len(detail.Tools) != 1 {
		t.Fatalf("expected one tool, got %d", len(detail.Tools))
	}
	if len(detail.Models) != 2 {
		t.Fatalf("expected two models, got %d", len(detail.Models))
	}
	if detail.Models[0].GenerationCount < detail.Models[1].GenerationCount {
		t.Fatalf("expected models sorted by generation_count desc")
	}
}

func TestGetAgentDetailForTenantRejectsInvalidVersion(t *testing.T) {
	svc, err := NewServiceWithDependencies(ServiceDependencies{
		AgentCatalogStore: &stubAgentCatalogStore{},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	_, _, err = svc.GetAgentDetailForTenant(context.Background(), "tenant-a", "assistant", "v1")
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error for invalid version, got %v", err)
	}
}

type stubAgentCatalogStore struct {
	heads         []storage.AgentHead
	nextCursor    *storage.AgentHeadCursor
	latestVersion *storage.AgentVersion
	version       *storage.AgentVersion
	models        []storage.AgentVersionModel
	lastLimit     int
}

func (s *stubAgentCatalogStore) ListAgentHeads(_ context.Context, _ string, limit int, _ *storage.AgentHeadCursor, _ string) ([]storage.AgentHead, *storage.AgentHeadCursor, error) {
	s.lastLimit = limit
	return s.heads, s.nextCursor, nil
}

func (s *stubAgentCatalogStore) GetAgentVersion(_ context.Context, _, _, _ string) (*storage.AgentVersion, error) {
	return s.version, nil
}

func (s *stubAgentCatalogStore) GetLatestAgentVersion(_ context.Context, _, _ string) (*storage.AgentVersion, error) {
	return s.latestVersion, nil
}

func (s *stubAgentCatalogStore) ListAgentVersionModels(_ context.Context, _, _, _ string) ([]storage.AgentVersionModel, error) {
	return s.models, nil
}
