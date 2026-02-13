package server

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestExportGenerationsHTTPParity(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), newTestModelCardService(t), protected)

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
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), newTestModelCardService(t), protected)

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

func TestRecordsEndpointsAreRemoved(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), newTestModelCardService(t), nil)

	for _, path := range []string{"/api/v1/records", "/api/v1/records/rec-1"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)

		if resp.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for %s, got %d", path, resp.Code)
		}
	}
}

func TestProtectedRoutesRequireTenantHeaderWhenAuthEnabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), newTestModelCardService(t), protected)

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
}

func TestHealthRouteIsExemptFromTenantHeader(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestModelCardsListAndLookup(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), svc, protected)

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

func TestModelCardsRefreshEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), svc, protected)

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
