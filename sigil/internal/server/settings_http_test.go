package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"github.com/grafana/sigil/sigil/internal/tenantsettings"
)

func TestTenantSettingsRoutesGetAndPut(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	store := &tenantSettingsMemoryStore{}
	svc := tenantsettings.NewService(store)
	RegisterSettingsRoutes(mux, svc, protected)

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	getResp := httptest.NewRecorder()
	mux.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected GET settings 200, got %d", getResp.Code)
	}

	putReq := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/settings/datasources",
		bytes.NewBufferString(`{"datasources":{"prometheusDatasourceUID":"prom","tempoDatasourceUID":"tempo"}}`),
	)
	putResp := httptest.NewRecorder()
	mux.ServeHTTP(putResp, putReq)
	if putResp.Code != http.StatusOK {
		t.Fatalf("expected PUT datasources 200, got %d body=%s", putResp.Code, putResp.Body.String())
	}

	var payload struct {
		Datasources tenantsettings.DatasourceSettings `json:"datasources"`
	}
	if err := json.Unmarshal(putResp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Datasources.PrometheusDatasourceUID != "prom" {
		t.Fatalf("unexpected prometheus datasource uid: %q", payload.Datasources.PrometheusDatasourceUID)
	}
	if payload.Datasources.TempoDatasourceUID != "tempo" {
		t.Fatalf("unexpected tempo datasource uid: %q", payload.Datasources.TempoDatasourceUID)
	}
}

func TestTenantSettingsRoutesRejectInvalidDatasourcePayload(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "unknown field",
			body: `{"datasources":{"prometheusDatasourceUID":"prom"},"unexpected":true}`,
		},
		{
			name: "multiple json values",
			body: `{"datasources":{"prometheusDatasourceUID":"prom"}}{"datasources":{"tempoDatasourceUID":"tempo"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mux := http.NewServeMux()
			protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
			store := &tenantSettingsMemoryStore{}
			svc := tenantsettings.NewService(store)
			RegisterSettingsRoutes(mux, svc, protected)

			req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/datasources", bytes.NewBufferString(tt.body))
			resp := httptest.NewRecorder()
			mux.ServeHTTP(resp, req)

			if resp.Code != http.StatusBadRequest {
				t.Fatalf("expected PUT datasources 400, got %d body=%s", resp.Code, resp.Body.String())
			}
		})
	}
}

type tenantSettingsMemoryStore struct {
	settings map[string]tenantsettings.DatasourceSettings
}

func (s *tenantSettingsMemoryStore) GetTenantDatasourceSettings(_ context.Context, tenantID string) (tenantsettings.DatasourceSettings, error) {
	if s.settings == nil {
		return tenantsettings.DatasourceSettings{}, nil
	}
	return s.settings[tenantID], nil
}

func (s *tenantSettingsMemoryStore) UpsertTenantDatasourceSettings(_ context.Context, tenantID string, settings tenantsettings.DatasourceSettings) error {
	if s.settings == nil {
		s.settings = make(map[string]tenantsettings.DatasourceSettings)
	}
	s.settings[tenantID] = settings
	return nil
}
