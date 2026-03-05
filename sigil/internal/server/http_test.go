package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestExportGenerationsHTTPParity(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	request := &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-http",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}}
	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewReader(payload))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, resp.Code)
	}

	var response sigilv1.ExportGenerationsResponse
	if err := protojson.Unmarshal(resp.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId != "gen-http" {
		t.Fatalf("expected generation id gen-http, got %q", response.Results[0].GenerationId)
	}
}

func TestExportGenerationsHTTPRejectsInvalid(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewBufferString(`{"generations":[{"id":"gen-http-invalid","mode":"GENERATION_MODE_SYNC","model":{"name":"gpt-5"}}]}`))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, resp.Code)
	}

	var response sigilv1.ExportGenerationsResponse
	if err := protojson.Unmarshal(resp.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error != "generation.model.provider is required" {
		t.Fatalf("unexpected error: %q", response.Results[0].Error)
	}
}

func TestRegisterIngestRoutesOwnsGenerationExportPath(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterCoreRoutes(mux)
	RegisterIngestRoutes(mux, generationingest.NewService(generationingest.NewMemoryStore()), protected)

	request := &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-ingester-only",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}}
	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	exportReq := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewReader(payload))
	exportResp := httptest.NewRecorder()
	mux.ServeHTTP(exportResp, exportReq)
	if exportResp.Code != http.StatusAccepted {
		t.Fatalf("expected export status %d, got %d", http.StatusAccepted, exportResp.Code)
	}

	queryReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	queryResp := httptest.NewRecorder()
	mux.ServeHTTP(queryResp, queryReq)
	if queryResp.Code != http.StatusNotFound {
		t.Fatalf("expected query route to be unregistered and return 404, got %d", queryResp.Code)
	}
}

func TestRegisterQueryRoutesOwnsQueryPaths(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterCoreRoutes(mux)
	RegisterQueryRoutes(
		mux,
		query.NewService(),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	queryReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	queryResp := httptest.NewRecorder()
	mux.ServeHTTP(queryResp, queryReq)
	if queryResp.Code != http.StatusOK {
		t.Fatalf("expected query status %d, got %d body=%s", http.StatusOK, queryResp.Code, queryResp.Body.String())
	}

	exportReq := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewBufferString(`{}`))
	exportResp := httptest.NewRecorder()
	mux.ServeHTTP(exportResp, exportReq)
	if exportResp.Code != http.StatusNotFound {
		t.Fatalf("expected ingest route to be unregistered and return 404, got %d", exportResp.Code)
	}
}

func TestRecordsEndpointsAreRemoved(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), nil)

	for _, path := range []string{"/api/v1/records", "/api/v1/records/rec-1"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)

		if resp.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for %s, got %d", path, resp.Code)
		}
	}
}

func TestPlaceholderQueryEndpointsAreRemoved(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), nil)

	for _, path := range []string{"/api/v1/completions", "/api/v1/traces/t-1"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)

		if resp.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for %s, got %d", path, resp.Code)
		}
	}
}

func TestConversationBatchMetadataEndpoint(t *testing.T) {
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "fake",
				ConversationID:   "conv-1",
				LastGenerationAt: time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC),
				GenerationCount:  2,
				CreatedAt:        time.Date(2026, 2, 15, 8, 0, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 2, 15, 9, 0, 0, 0, time.UTC),
			},
		},
	}
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: conversationStore,
		FeedbackStore:     feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations:batch-metadata", bytes.NewBufferString(`{
		"conversation_ids":["conv-1","conv-missing"]
	}`))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"conversation_id":"conv-1"`) {
		t.Fatalf("expected conversation metadata in response, body=%s", resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"missing_conversation_ids":["conv-missing"]`) {
		t.Fatalf("expected missing conversation ids in response, body=%s", resp.Body.String())
	}
}

func TestGenerationDetailEndpoint(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		TraceId:        "trace-1",
		SpanId:         "span-1",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
	}
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		WALReader: &testWALReader{
			byID: map[string]*sigilv1.Generation{
				"gen-1": generation,
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/generations/gen-1", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"generation_id":"gen-1"`) {
		t.Fatalf("expected generation payload, body=%s", resp.Body.String())
	}
}

func TestGenerationDetailEndpointRejectsInvalidReadPlanHints(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		WALReader: &testWALReader{
			byID: map[string]*sigilv1.Generation{
				"gen-1": {Id: "gen-1", ConversationId: "conv-1"},
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/generations/gen-1?from=not-a-timestamp&to=2026-03-05T10:00:00Z", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestGenerationScoresEndpoint(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		WALReader: &testWALReader{
			byID: map[string]*sigilv1.Generation{
				"gen-1": {
					Id:             "gen-1",
					ConversationId: "conv-1",
					Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
					Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
				},
			},
		},
		ScoreStore: &testScoreStore{
			scores: []evalpkg.GenerationScore{
				{ScoreID: "sc-1", GenerationID: "gen-1", EvaluatorID: "sigil.helpfulness", EvaluatorVersion: "2026-02-17", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.2), CreatedAt: time.Now().UTC()},
				{ScoreID: "sc-2", GenerationID: "gen-1", EvaluatorID: "sigil.helpfulness", EvaluatorVersion: "2026-02-17", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.8), CreatedAt: time.Now().UTC()},
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/generations/gen-1/scores?limit=1", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"items":[`) {
		t.Fatalf("expected items array in response, body=%s", resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"next_cursor":"1"`) {
		t.Fatalf("expected next_cursor in response, body=%s", resp.Body.String())
	}
}

func TestListAgentsEndpoint(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		AgentCatalogStore: &testAgentCatalogStore{
			heads: []storage.AgentHead{
				{
					AgentName:                       "assistant",
					LatestEffectiveVersion:          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					LatestSeenAt:                    time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
					FirstSeenAt:                     time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC),
					GenerationCount:                 3,
					VersionCount:                    2,
					LatestToolCount:                 1,
					LatestSystemPromptPrefix:        "You are concise.",
					LatestTokenEstimateSystemPrompt: 4,
					LatestTokenEstimateToolsTotal:   5,
					LatestTokenEstimateTotal:        9,
				},
			},
			nextCursor: &storage.AgentHeadCursor{
				LatestSeenAt: time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
				AgentName:    "assistant",
				ID:           123,
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents?limit=10", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"agent_name":"assistant"`) {
		t.Fatalf("expected agent payload, body=%s", resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"next_cursor":"`) {
		t.Fatalf("expected next cursor in response, body=%s", resp.Body.String())
	}
}

func TestLookupAgentEndpoint(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		AgentCatalogStore: &testAgentCatalogStore{
			latestVersion: &storage.AgentVersion{
				AgentName:             "",
				EffectiveVersion:      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				SystemPrompt:          "anonymous prompt",
				SystemPromptPrefix:    "anonymous prompt",
				ToolCount:             0,
				TokenEstimateTotal:    4,
				GenerationCount:       2,
				FirstSeenAt:           time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC),
				LastSeenAt:            time.Date(2026, 3, 4, 11, 0, 0, 0, time.UTC),
				DeclaredVersionFirst:  nil,
				DeclaredVersionLatest: nil,
				ToolsJSON:             "[]",
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	missingNameReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents:lookup", nil)
	missingNameResp := httptest.NewRecorder()
	mux.ServeHTTP(missingNameResp, missingNameReq)
	if missingNameResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing name query key, got %d", missingNameResp.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents:lookup?name=", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200 for anonymous lookup, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"effective_version":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"`) {
		t.Fatalf("expected effective version in response, body=%s", resp.Body.String())
	}
}

func TestListAgentVersionsEndpoint(t *testing.T) {
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		AgentCatalogStore: &testAgentCatalogStore{
			versions: []storage.AgentVersionSummary{
				{
					EffectiveVersion:          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
					DeclaredVersionFirst:      stringPtr("1.0.0"),
					DeclaredVersionLatest:     stringPtr("1.0.2"),
					SystemPromptPrefix:        "You are concise.",
					ToolCount:                 3,
					TokenEstimateSystemPrompt: 8,
					TokenEstimateToolsTotal:   7,
					TokenEstimateTotal:        15,
					GenerationCount:           11,
					FirstSeenAt:               time.Date(2026, 3, 4, 8, 0, 0, 0, time.UTC),
					LastSeenAt:                time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC),
				},
			},
			nextVersionCursor: &storage.AgentVersionCursor{
				LastSeenAt: time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC),
				ID:         77,
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		querySvc,
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	missingNameReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents:versions", nil)
	missingNameResp := httptest.NewRecorder()
	mux.ServeHTTP(missingNameResp, missingNameReq)
	if missingNameResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing name query key, got %d", missingNameResp.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents:versions?name=assistant&limit=10", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"effective_version":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"`) {
		t.Fatalf("expected version payload, body=%s", resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"next_cursor":"`) {
		t.Fatalf("expected next cursor in response, body=%s", resp.Body.String())
	}
}

func TestProtectedRoutesRequireTenantHeaderWhenAuthEnabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}

	authorizedReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	authorizedReq.Header.Set("X-Scope-OrgID", "tenant-a")
	authorizedResp := httptest.NewRecorder()
	mux.ServeHTTP(authorizedResp, authorizedReq)
	if authorizedResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", authorizedResp.Code)
	}

	ratingReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/c-1/ratings", nil)
	ratingResp := httptest.NewRecorder()
	mux.ServeHTTP(ratingResp, ratingReq)
	if ratingResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for protected ratings route, got %d", ratingResp.Code)
	}
}

func TestHealthRouteIsExemptFromTenantHeader(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestMetricsRouteIsExemptFromTenantHeader(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	if !strings.Contains(resp.Body.String(), "sigil_") {
		t.Fatalf("expected prometheus payload, body=%s", resp.Body.String())
	}
}

func TestModelCardsListAndLookup(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"source_path":"snapshot_fallback"`) {
		t.Fatalf("expected snapshot fallback source path, body=%s", listResp.Body.String())
	}
	if !strings.Contains(listResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected seeded model key in list response")
	}

	lookupReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards:lookup?model_key=openrouter:test/model", nil)
	lookupResp := httptest.NewRecorder()
	mux.ServeHTTP(lookupResp, lookupReq)
	if lookupResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", lookupResp.Code)
	}
	if !strings.Contains(lookupResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected model key in lookup response")
	}
}

func TestModelCardsListSupportsRegexFilter(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	regexReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?regex=^openrouter:test/model$", nil)
	regexResp := httptest.NewRecorder()
	mux.ServeHTTP(regexResp, regexReq)

	if regexResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", regexResp.Code)
	}
	if !strings.Contains(regexResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected regex-matched model key in response body=%s", regexResp.Body.String())
	}
}

func TestModelCardsListRejectsInvalidRegex(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	regexReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?regex=[", nil)
	regexResp := httptest.NewRecorder()
	mux.ServeHTTP(regexResp, regexReq)

	if regexResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", regexResp.Code)
	}
}

func TestModelCardsListSupportsResolvePairs(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?resolve_pair=test:model&resolve_pair=test:unknown", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}

	var payload struct {
		Resolved  []modelcards.ResolveResult `json:"resolved"`
		Freshness modelcards.Freshness       `json:"freshness"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode resolve payload: %v", err)
	}
	if len(payload.Resolved) != 2 {
		t.Fatalf("expected 2 resolved entries, got %d", len(payload.Resolved))
	}
	if payload.Resolved[0].Status != modelcards.ResolveStatusResolved {
		t.Fatalf("expected first result to resolve, got %q", payload.Resolved[0].Status)
	}
	if payload.Resolved[0].Card == nil || payload.Resolved[0].Card.ModelKey != "openrouter:test/model" {
		t.Fatalf("expected first result to map to test model card, got %#v", payload.Resolved[0].Card)
	}
	if payload.Resolved[1].Status != modelcards.ResolveStatusUnresolved {
		t.Fatalf("expected second result unresolved, got %q", payload.Resolved[1].Status)
	}
	if payload.Resolved[1].Reason != modelcards.ResolveReasonNotFound {
		t.Fatalf("expected second reason not_found, got %q", payload.Resolved[1].Reason)
	}
	if payload.Freshness.SourcePath != modelcards.SourcePathSnapshotFallback {
		t.Fatalf("expected snapshot fallback source path, got %q", payload.Freshness.SourcePath)
	}
}

func TestModelCardsResolvePairsRejectsMixedQueryParams(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?resolve_pair=test:model&limit=10", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}

func TestModelCardsResolvePairsRejectsInvalidPair(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?resolve_pair=test-model", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}

func TestModelCardsRefreshEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	refreshReq := httptest.NewRequest(http.MethodPost, "/api/v1/model-cards:refresh", bytes.NewBufferString(`{"source":"openrouter"}`))
	refreshResp := httptest.NewRecorder()
	mux.ServeHTTP(refreshResp, refreshReq)
	if refreshResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", refreshResp.Code)
	}
	if !strings.Contains(refreshResp.Body.String(), `"run_mode":"fallback"`) {
		t.Fatalf("expected fallback run mode, body=%s", refreshResp.Body.String())
	}
}

func TestConversationRatingsCreateAndList(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-1/ratings", bytes.NewBufferString(`{"rating_id":"rat-1","rating":"CONVERSATION_RATING_VALUE_BAD","comment":"wrong answer","metadata":{"channel":"assistant"}}`))
	createResp := httptest.NewRecorder()
	mux.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"rating_id":"rat-1"`) {
		t.Fatalf("expected rating id in response, body=%s", createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"has_bad_rating":true`) {
		t.Fatalf("expected has_bad_rating=true in response, body=%s", createResp.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-rating-1/ratings?limit=10", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"rating_id":"rat-1"`) {
		t.Fatalf("expected rating in list response, body=%s", listResp.Body.String())
	}
}

func TestConversationRatingsRejectIdempotencyConflict(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	firstReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-2/ratings", bytes.NewBufferString(`{"rating_id":"rat-conflict","rating":"CONVERSATION_RATING_VALUE_GOOD"}`))
	firstResp := httptest.NewRecorder()
	mux.ServeHTTP(firstResp, firstReq)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("expected first write to succeed, got %d", firstResp.Code)
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-2/ratings", bytes.NewBufferString(`{"rating_id":"rat-conflict","rating":"CONVERSATION_RATING_VALUE_BAD"}`))
	secondResp := httptest.NewRecorder()
	mux.ServeHTTP(secondResp, secondReq)
	if secondResp.Code != http.StatusConflict {
		t.Fatalf("expected conflict status, got %d body=%s", secondResp.Code, secondResp.Body.String())
	}
}

func TestConversationAnnotationsRequireOperatorHeaders(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	noOperatorReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-ann-1/annotations", bytes.NewBufferString(`{"annotation_id":"ann-1","annotation_type":"NOTE","body":"triage note"}`))
	noOperatorResp := httptest.NewRecorder()
	mux.ServeHTTP(noOperatorResp, noOperatorReq)
	if noOperatorResp.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request when operator headers are missing, got %d", noOperatorResp.Code)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-ann-1/annotations", bytes.NewBufferString(`{"annotation_id":"ann-1","annotation_type":"NOTE","body":"triage note","tags":{"status":"needs_review"}}`))
	createReq.Header.Set(feedback.HeaderOperatorID, "operator-1")
	createReq.Header.Set(feedback.HeaderOperatorLogin, "alice")
	createReq.Header.Set(feedback.HeaderOperatorName, "Alice")
	createResp := httptest.NewRecorder()
	mux.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"operator_id":"operator-1"`) {
		t.Fatalf("expected operator id in response, body=%s", createResp.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-ann-1/annotations", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"annotation_id":"ann-1"`) {
		t.Fatalf("expected annotation in list response, body=%s", listResp.Body.String())
	}
}

func TestConversationFeedbackPaginationValidation(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-rating-3/ratings?cursor=abc", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid cursor, got %d", resp.Code)
	}
}

func TestConversationFeedbackRoutesCanBeDisabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		false,
		false,
		newTestModelCardService(t),
		protected,
	)

	ratingsReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-disable/ratings", nil)
	ratingsResp := httptest.NewRecorder()
	mux.ServeHTTP(ratingsResp, ratingsReq)
	if ratingsResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when ratings are disabled, got %d", ratingsResp.Code)
	}

	annotationsReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-disable/annotations", nil)
	annotationsResp := httptest.NewRecorder()
	mux.ServeHTTP(annotationsResp, annotationsReq)
	if annotationsResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when annotations are disabled, got %d", annotationsResp.Code)
	}
}

func TestListConversationsSupportsFeedbackFilters(t *testing.T) {
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "fake",
				ConversationID:   "conv-1",
				LastGenerationAt: time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC),
				GenerationCount:  1,
				CreatedAt:        time.Date(2026, 2, 13, 11, 55, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC),
			},
			{
				TenantID:         "fake",
				ConversationID:   "conv-2",
				LastGenerationAt: time.Date(2026, 2, 13, 12, 1, 0, 0, time.UTC),
				GenerationCount:  2,
				CreatedAt:        time.Date(2026, 2, 13, 11, 56, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 2, 13, 12, 1, 0, 0, time.UTC),
			},
		},
	}

	feedbackStore := feedback.NewMemoryStore()
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "fake", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create bad rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "fake", "conv-2", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewServiceWithStores(conversationStore, feedbackStore),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedbackStore),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	badResp := httptest.NewRecorder()
	mux.ServeHTTP(badResp, httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_bad_rating=true", nil))
	if badResp.Code != http.StatusOK {
		t.Fatalf("expected 200 for has_bad_rating filter, got %d body=%s", badResp.Code, badResp.Body.String())
	}
	var badPayload struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(badResp.Body.Bytes(), &badPayload); err != nil {
		t.Fatalf("decode has_bad_rating payload: %v", err)
	}
	if len(badPayload.Items) != 1 || badPayload.Items[0].ID != "conv-1" {
		t.Fatalf("unexpected has_bad_rating payload: %s", badResp.Body.String())
	}

	annotationResp := httptest.NewRecorder()
	mux.ServeHTTP(annotationResp, httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_annotations=true", nil))
	if annotationResp.Code != http.StatusOK {
		t.Fatalf("expected 200 for has_annotations filter, got %d body=%s", annotationResp.Code, annotationResp.Body.String())
	}
	var annotationPayload struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(annotationResp.Body.Bytes(), &annotationPayload); err != nil {
		t.Fatalf("decode has_annotations payload: %v", err)
	}
	if len(annotationPayload.Items) != 1 || annotationPayload.Items[0].ID != "conv-2" {
		t.Fatalf("unexpected has_annotations payload: %s", annotationResp.Body.String())
	}
}

func TestListConversationsRejectsInvalidFeedbackFilters(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_bad_rating=maybe", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid has_bad_rating filter, got %d", resp.Code)
	}
}

func TestListConversationsReturnsEmptyItemsArray(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewServiceWithStores(&testConversationStore{}, feedback.NewMemoryStore()),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"items":[]`) {
		t.Fatalf("expected items to be encoded as empty array, body=%s", resp.Body.String())
	}
}

func TestRemovedSearchAndProxyRoutesReturnNotFound(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	removedRoutes := []struct {
		method string
		path   string
		status int
	}{
		{method: http.MethodPost, path: "/api/v1/conversations/search", status: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/api/v1/search/tags", status: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v1/search/tag/model/values", status: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v1/proxy/prometheus/api/v1/query?query=up", status: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v1/proxy/tempo/api/search", status: http.StatusNotFound},
	}

	for _, route := range removedRoutes {
		req := httptest.NewRequest(route.method, route.path, nil)
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)
		if resp.Code != route.status {
			t.Fatalf("expected %d for removed route %s %s, got %d", route.status, route.method, route.path, resp.Code)
		}
	}
}

func newTestModelCardService(t *testing.T) *modelcards.Service {
	t.Helper()

	ctx := context.Background()
	store := modelcards.NewMemoryStore()
	if err := store.AutoMigrate(ctx); err != nil {
		t.Fatalf("auto migrate memory store: %v", err)
	}

	now := time.Now().UTC()
	contextLength := 128000
	card := modelcards.Card{
		ModelKey:      "openrouter:test/model",
		Source:        modelcards.SourceOpenRouter,
		SourceModelID: "test/model",
		Name:          "Test Model",
		Provider:      "test",
		ContextLength: &contextLength,
		Pricing: modelcards.Pricing{
			PromptUSDPerToken:     float64Ptr(0),
			CompletionUSDPerToken: float64Ptr(0),
		},
		IsFree:      true,
		FirstSeenAt: now,
		LastSeenAt:  now,
		RefreshedAt: now,
	}
	snapshot := modelcards.SnapshotFromCards(modelcards.SourceOpenRouter, now, []modelcards.Card{card})

	return modelcards.NewService(
		store,
		modelcards.NewStaticErrorSource(errors.New("live source disabled in tests")),
		&snapshot,
		modelcards.Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     2 * time.Hour,
			StaleHard:     24 * time.Hour,
			BootstrapMode: modelcards.BootstrapModeSnapshotFirst,
			OwnerID:       "test-owner",
		},
		nil,
	)
}

func float64Ptr(value float64) *float64 {
	v := value
	return &v
}

type testConversationStore struct {
	items []storage.Conversation
}

func (s *testConversationStore) ListConversations(_ context.Context, tenantID string) ([]storage.Conversation, error) {
	out := make([]storage.Conversation, 0, len(s.items))
	for _, item := range s.items {
		if item.TenantID != tenantID {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *testConversationStore) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	for _, item := range s.items {
		if item.TenantID != tenantID || item.ConversationID != conversationID {
			continue
		}
		copied := item
		return &copied, nil
	}
	return nil, nil
}

type testWALReader struct {
	byID map[string]*sigilv1.Generation
}

func (s *testWALReader) GetByID(_ context.Context, _ string, generationID string) (*sigilv1.Generation, error) {
	if s.byID == nil {
		return nil, nil
	}
	return s.byID[generationID], nil
}

func (s *testWALReader) GetByConversationID(_ context.Context, _ string, _ string) ([]*sigilv1.Generation, error) {
	return []*sigilv1.Generation{}, nil
}

type testScoreStore struct {
	scores []evalpkg.GenerationScore
	latest map[string]evalpkg.LatestScore
}

func (s *testScoreStore) GetScoresByGeneration(_ context.Context, _ string, _ string, limit int, cursor uint64) ([]evalpkg.GenerationScore, uint64, error) {
	if limit <= 0 {
		return []evalpkg.GenerationScore{}, 0, nil
	}
	start := int(cursor)
	if start >= len(s.scores) {
		return []evalpkg.GenerationScore{}, 0, nil
	}
	end := start + limit
	if end > len(s.scores) {
		end = len(s.scores)
	}
	nextCursor := uint64(0)
	if end < len(s.scores) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.GenerationScore(nil), s.scores[start:end]...), nextCursor, nil
}

func (s *testScoreStore) GetLatestScoresByGeneration(_ context.Context, _ string, _ string) (map[string]evalpkg.LatestScore, error) {
	if s.latest == nil {
		return map[string]evalpkg.LatestScore{}, nil
	}
	out := make(map[string]evalpkg.LatestScore, len(s.latest))
	for key, value := range s.latest {
		out[key] = value
	}
	return out, nil
}

func (s *testScoreStore) GetLatestScoresByConversation(_ context.Context, _ string, _ string) (map[string]map[string]evalpkg.LatestScore, error) {
	return map[string]map[string]evalpkg.LatestScore{}, nil
}

type testAgentCatalogStore struct {
	heads         []storage.AgentHead
	nextCursor    *storage.AgentHeadCursor
	version       *storage.AgentVersion
	latestVersion *storage.AgentVersion
	models        []storage.AgentVersionModel
	versions      []storage.AgentVersionSummary

	nextVersionCursor *storage.AgentVersionCursor
}

func (s *testAgentCatalogStore) ListAgentHeads(_ context.Context, _ string, _ int, _ *storage.AgentHeadCursor, _ string) ([]storage.AgentHead, *storage.AgentHeadCursor, error) {
	return s.heads, s.nextCursor, nil
}

func (s *testAgentCatalogStore) GetAgentVersion(_ context.Context, _ string, _ string, _ string) (*storage.AgentVersion, error) {
	return s.version, nil
}

func (s *testAgentCatalogStore) GetLatestAgentVersion(_ context.Context, _ string, _ string) (*storage.AgentVersion, error) {
	return s.latestVersion, nil
}

func (s *testAgentCatalogStore) ListAgentVersionModels(_ context.Context, _ string, _ string, _ string) ([]storage.AgentVersionModel, error) {
	return s.models, nil
}

func (s *testAgentCatalogStore) ListAgentVersions(_ context.Context, _ string, _ string, _ int, _ *storage.AgentVersionCursor) ([]storage.AgentVersionSummary, *storage.AgentVersionCursor, error) {
	return s.versions, s.nextVersionCursor, nil
}

func stringPtr(value string) *string {
	v := value
	return &v
}
