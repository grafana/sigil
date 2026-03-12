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

	items, nextCursor, err := svc.ListAgentsForTenant(context.Background(), "tenant-a", 50, "", AgentListFilter{})
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
		FilterHash:      buildAgentListFilterHash("different", time.Time{}, time.Time{}),
	})
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}

	_, _, err = svc.ListAgentsForTenant(context.Background(), "tenant-a", 10, cursor, AgentListFilter{NamePrefix: "assistant"})
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
		ToolsJSON:                 `[{"name":"weather","description":"get weather","type":"function","input_schema_json":"{\"city\":{\"type\":\"string\"}}","deferred":true,"token_estimate":3}]`,
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
	if !detail.Tools[0].Deferred {
		t.Fatalf("expected deferred=true on decoded agent tool")
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

func TestListAgentVersionsForTenantWithCursor(t *testing.T) {
	store := &stubAgentCatalogStore{
		versions: []storage.AgentVersionSummary{
			{
				EffectiveVersion:          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
				DeclaredVersionFirst:      stringPtr("1.0.0"),
				DeclaredVersionLatest:     stringPtr("1.0.2"),
				SystemPromptPrefix:        "You are concise.",
				ToolCount:                 2,
				TokenEstimateSystemPrompt: 6,
				TokenEstimateToolsTotal:   4,
				TokenEstimateTotal:        10,
				GenerationCount:           7,
				FirstSeenAt:               time.Date(2026, 3, 4, 9, 0, 0, 0, time.UTC),
				LastSeenAt:                time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
			},
		},
		nextVersionCursor: &storage.AgentVersionCursor{
			LastSeenAt: time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
			ID:         99,
		},
	}
	svc, err := NewServiceWithDependencies(ServiceDependencies{AgentCatalogStore: store})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	items, nextCursor, err := svc.ListAgentVersionsForTenant(context.Background(), "tenant-a", "assistant", 25, "")
	if err != nil {
		t.Fatalf("list agent versions: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one version item, got %d", len(items))
	}
	if items[0].EffectiveVersion == "" {
		t.Fatalf("expected effective version")
	}
	if nextCursor == "" {
		t.Fatalf("expected continuation cursor")
	}
	if store.lastVersionsLimit != 25 {
		t.Fatalf("expected version list limit=25, got %d", store.lastVersionsLimit)
	}
}

func TestListAgentVersionsForTenantRejectsCursorFilterMismatch(t *testing.T) {
	store := &stubAgentCatalogStore{}
	svc, err := NewServiceWithDependencies(ServiceDependencies{AgentCatalogStore: store})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	cursor, err := encodeAgentVersionListCursor(agentVersionListCursor{
		LastSeenNanos: time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC).UnixNano(),
		VersionID:     42,
		FilterHash:    buildAgentVersionsFilterHash("different"),
	})
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}

	_, _, err = svc.ListAgentVersionsForTenant(context.Background(), "tenant-a", "assistant", 10, cursor)
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error for mismatched cursor filter, got %v", err)
	}
}

type stubAgentCatalogStore struct {
	heads         []storage.AgentHead
	nextCursor    *storage.AgentHeadCursor
	latestVersion *storage.AgentVersion
	version       *storage.AgentVersion
	models        []storage.AgentVersionModel
	versions      []storage.AgentVersionSummary

	nextVersionCursor *storage.AgentVersionCursor
	lastLimit         int
	lastVersionsLimit int
}

func (s *stubAgentCatalogStore) ListAgentHeads(_ context.Context, _ string, limit int, _ *storage.AgentHeadCursor, _ storage.AgentHeadFilter) ([]storage.AgentHead, *storage.AgentHeadCursor, error) {
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

func (s *stubAgentCatalogStore) ListAgentVersions(_ context.Context, _, _ string, limit int, _ *storage.AgentVersionCursor) ([]storage.AgentVersionSummary, *storage.AgentVersionCursor, error) {
	s.lastVersionsLimit = limit
	return s.versions, s.nextVersionCursor, nil
}

func stringPtr(value string) *string {
	v := value
	return &v
}

func TestValidateCursorFilterHash(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name       string
		filterHash string
		expectErr  bool
	}{
		{
			name:       "valid hash",
			filterHash: "abc123",
			expectErr:  false,
		},
		{
			name:       "empty",
			filterHash: "",
			expectErr:  true,
		},
		{
			name:       "whitespace only",
			filterHash: "   ",
			expectErr:  true,
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			err := validateCursorFilterHash(testCase.filterHash)
			if testCase.expectErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				if err.Error() != "cursor filter_hash is required" {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
		})
	}
}
