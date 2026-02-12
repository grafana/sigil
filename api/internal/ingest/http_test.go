package ingest

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/sigil/api/internal/tempo"
	"github.com/grafana/sigil/api/internal/tenantauth"
)

func TestOTLPHTTPRequiresTenantHeaderWhenAuthEnabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, NewService(tempo.NewClient("tempo:4317")), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}

	authorizedReq := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	authorizedReq.Header.Set("X-Scope-OrgID", "tenant-a")
	authorizedResp := httptest.NewRecorder()
	mux.ServeHTTP(authorizedResp, authorizedReq)
	if authorizedResp.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", authorizedResp.Code)
	}
}

func TestOTLPHTTPHealthIsExempt(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, NewService(tempo.NewClient("tempo:4317")), protected)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestOTLPHTTPUsesFakeTenantWhenAuthDisabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake-local"})
	RegisterHTTPRoutes(mux, NewService(tempo.NewClient("tempo:4317")), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", resp.Code)
	}
}
