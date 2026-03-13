package query

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/agentmeta"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func TestSearchAgentsForTenantAppliesAttributeFilters(t *testing.T) {
	base := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	store := &stubAgentCatalogStore{
		heads: []storage.AgentHead{
			{
				ID:                              1,
				AgentName:                       "assistant",
				LatestEffectiveVersion:          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				LatestSeenAt:                    base.Add(-5 * time.Minute),
				FirstSeenAt:                     base.Add(-2 * time.Hour),
				GenerationCount:                 5,
				VersionCount:                    2,
				LatestToolCount:                 1,
				LatestSystemPromptPrefix:        "You are concise.",
				LatestTokenEstimateSystemPrompt: 5,
				LatestTokenEstimateToolsTotal:   2,
				LatestTokenEstimateTotal:        7,
			},
			{
				ID:                              2,
				AgentName:                       "builder",
				LatestEffectiveVersion:          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				LatestSeenAt:                    base.Add(-10 * time.Minute),
				FirstSeenAt:                     base.Add(-3 * time.Hour),
				GenerationCount:                 3,
				VersionCount:                    1,
				LatestToolCount:                 2,
				LatestSystemPromptPrefix:        "You are a builder.",
				LatestTokenEstimateSystemPrompt: 4,
				LatestTokenEstimateToolsTotal:   4,
				LatestTokenEstimateTotal:        8,
			},
		},
	}
	tempoClient := &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				{
					TraceID:           "trace-1",
					StartTimeUnixNano: strconvFormatInt(base.Add(-15 * time.Minute).UnixNano()),
					SpanSets: []TempoSpanSet{{
						Spans: []TempoSpan{
							{
								SpanID:            "span-1",
								StartTimeUnixNano: strconvFormatInt(base.Add(-15 * time.Minute).UnixNano()),
								DurationNanos:     strconvFormatInt((2 * time.Second).Nanoseconds()),
								Attributes: []TempoAttribute{
									stringTempoAttr("span.gen_ai.conversation.id", "conv-1"),
									stringTempoAttr("span.sigil.generation.id", "gen-1"),
									stringTempoAttr("span.gen_ai.agent.name", "assistant"),
									stringTempoAttr("resource.k8s.namespace.name", "prod"),
								},
							},
						},
					}},
				},
			},
		}},
	}
	svc, err := NewServiceWithDependencies(ServiceDependencies{
		AgentCatalogStore: store,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	svc.SetTempoClient(tempoClient)

	items, nextCursor, err := svc.SearchAgentsForTenant(context.Background(), "tenant-a", AgentSearchRequest{
		Filters:   `resource.k8s.namespace.name = "prod"`,
		TimeRange: ConversationSearchTimeRange{From: base.Add(-24 * time.Hour), To: base},
		PageSize:  10,
	})
	if err != nil {
		t.Fatalf("search agents: %v", err)
	}
	if nextCursor != "" {
		t.Fatalf("expected no continuation cursor, got %q", nextCursor)
	}
	if len(items) != 1 {
		t.Fatalf("expected one matching agent, got %d", len(items))
	}
	if items[0].AgentName != "assistant" {
		t.Fatalf("unexpected matching agent %#v", items[0])
	}
	if len(tempoClient.searchRequests) != 1 {
		t.Fatalf("expected one tempo search request, got %d", len(tempoClient.searchRequests))
	}
	if !strings.Contains(tempoClient.searchRequests[0].Query, `resource.k8s.namespace.name = "prod"`) {
		t.Fatalf("expected namespace filter in query, got %q", tempoClient.searchRequests[0].Query)
	}
}

func TestSearchAgentsForTenantRejectsNonAttributeFilters(t *testing.T) {
	svc, err := NewServiceWithDependencies(ServiceDependencies{
		AgentCatalogStore: &stubAgentCatalogStore{},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	svc.SetTempoClient(&stubTempoClient{})

	_, _, err = svc.SearchAgentsForTenant(context.Background(), "tenant-a", AgentSearchRequest{
		Filters:   `service = "sigil-api"`,
		TimeRange: ConversationSearchTimeRange{From: time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC), To: time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)},
		PageSize:  10,
	})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestGetAgentRuntimeContextForTenantFiltersByEffectiveVersion(t *testing.T) {
	base := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	firstGeneration := &sigilv1.Generation{
		Id:           "gen-1",
		AgentName:    "assistant",
		SystemPrompt: "Prompt A",
		CompletedAt:  timestamppb.New(base.Add(-30 * time.Minute)),
	}
	secondGeneration := &sigilv1.Generation{
		Id:           "gen-2",
		AgentName:    "assistant",
		SystemPrompt: "Prompt B",
		CompletedAt:  timestamppb.New(base.Add(-20 * time.Minute)),
	}
	firstDescriptor, err := agentmeta.BuildDescriptor(firstGeneration)
	if err != nil {
		t.Fatalf("first descriptor: %v", err)
	}

	tempoClient := &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				{
					TraceID:           "trace-1",
					StartTimeUnixNano: strconvFormatInt(base.Add(-30 * time.Minute).UnixNano()),
					SpanSets: []TempoSpanSet{{
						Spans: []TempoSpan{
							{
								SpanID:            "span-1",
								StartTimeUnixNano: strconvFormatInt(base.Add(-30 * time.Minute).UnixNano()),
								DurationNanos:     strconvFormatInt((time.Second).Nanoseconds()),
								Attributes: []TempoAttribute{
									stringTempoAttr("span.gen_ai.conversation.id", "conv-1"),
									stringTempoAttr("span.sigil.generation.id", "gen-1"),
									stringTempoAttr("span.gen_ai.agent.name", "assistant"),
									stringTempoAttr("resource.k8s.namespace.name", "prod"),
									stringTempoAttr("resource.k8s.cluster.name", "cluster-a"),
									stringTempoAttr("resource.service.name", "sigil-api"),
								},
							},
						},
					}},
				},
				{
					TraceID:           "trace-2",
					StartTimeUnixNano: strconvFormatInt(base.Add(-20 * time.Minute).UnixNano()),
					SpanSets: []TempoSpanSet{{
						Spans: []TempoSpan{
							{
								SpanID:            "span-2",
								StartTimeUnixNano: strconvFormatInt(base.Add(-20 * time.Minute).UnixNano()),
								DurationNanos:     strconvFormatInt((time.Second).Nanoseconds()),
								Attributes: []TempoAttribute{
									stringTempoAttr("span.gen_ai.conversation.id", "conv-2"),
									stringTempoAttr("span.sigil.generation.id", "gen-2"),
									stringTempoAttr("span.gen_ai.agent.name", "assistant"),
									stringTempoAttr("resource.k8s.namespace.name", "dev"),
									stringTempoAttr("resource.k8s.cluster.name", "cluster-b"),
									stringTempoAttr("resource.service.name", "sigil-worker"),
								},
							},
						},
					}},
				},
			},
		}},
	}
	walReader := &stubWALReader{
		byID: map[string]*sigilv1.Generation{
			"gen-1": firstGeneration,
			"gen-2": secondGeneration,
		},
	}
	svc, err := NewServiceWithDependencies(ServiceDependencies{
		WALReader: walReader,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	svc.SetTempoClient(tempoClient)

	response, err := svc.GetAgentRuntimeContextForTenant(context.Background(), "tenant-a", AgentRuntimeContextRequest{
		AgentName:        "assistant",
		EffectiveVersion: firstDescriptor.EffectiveVersion,
		TimeRange:        ConversationSearchTimeRange{From: base.Add(-24 * time.Hour), To: base},
	})
	if err != nil {
		t.Fatalf("agent runtime context: %v", err)
	}
	if response.MatchingGenerationCount != 1 {
		t.Fatalf("expected one matching generation, got %d", response.MatchingGenerationCount)
	}
	if len(response.Groups) == 0 {
		t.Fatalf("expected runtime context groups")
	}
	namespaceGroup := response.Groups[0]
	if namespaceGroup.Key != "resource.k8s.namespace.name" {
		t.Fatalf("unexpected first group key %q", namespaceGroup.Key)
	}
	if len(namespaceGroup.Values) != 1 || namespaceGroup.Values[0].Value != "prod" || namespaceGroup.Values[0].Count != 1 {
		t.Fatalf("unexpected namespace group %#v", namespaceGroup.Values)
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

func stringTempoAttr(key, value string) TempoAttribute {
	return TempoAttribute{Key: key, Value: tempoStringValue(value)}
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
