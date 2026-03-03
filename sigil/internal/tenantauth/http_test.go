package tenantauth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/dskit/tenant"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestHTTPMiddlewareEnabledRequiresTenantHeader(t *testing.T) {
	protected := HTTPMiddleware(Config{Enabled: true, FakeTenantID: "fake"})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			t.Fatalf("extract tenant from context: %v", err)
		}
		_, _ = w.Write([]byte(tenantID))
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	resp := httptest.NewRecorder()
	protected.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}

	before := testutil.ToFloat64(authFailuresTotal.WithLabelValues("http", "tenant_id"))
	invalidTenantReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	invalidTenantReq.Header.Set("X-Scope-OrgID", "tenant with spaces")
	invalidTenantResp := httptest.NewRecorder()
	protected.ServeHTTP(invalidTenantResp, invalidTenantReq)
	if invalidTenantResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid tenant id, got %d", invalidTenantResp.Code)
	}
	after := testutil.ToFloat64(authFailuresTotal.WithLabelValues("http", "tenant_id"))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected auth failure metric increment of 1, got %v", delta)
	}

	authorizedReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	authorizedReq.Header.Set("X-Scope-OrgID", "tenant-a")
	authorizedResp := httptest.NewRecorder()
	protected.ServeHTTP(authorizedResp, authorizedReq)
	if authorizedResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", authorizedResp.Code)
	}
	if authorizedResp.Body.String() != "tenant-a" {
		t.Fatalf("expected tenant-a, got %q", authorizedResp.Body.String())
	}
}

func TestHTTPMiddlewareDisabledInjectsFakeTenant(t *testing.T) {
	protected := HTTPMiddleware(Config{Enabled: false, FakeTenantID: "local-fake"})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			t.Fatalf("extract tenant from context: %v", err)
		}
		_, _ = w.Write([]byte(tenantID))
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	resp := httptest.NewRecorder()
	protected.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	if resp.Body.String() != "local-fake" {
		t.Fatalf("expected local-fake, got %q", resp.Body.String())
	}
}
