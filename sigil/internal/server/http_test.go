package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestExportGenerationsHTTPParity(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), protected)

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
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), protected)

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
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), nil)

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
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), protected)

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
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), protected)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}
