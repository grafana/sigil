package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/grafana/dskit/tenant"
	"github.com/grafana/sigil/sigil/internal/tenantsettings"
)

func RegisterSettingsRoutes(
	mux *http.ServeMux,
	settingsSvc *tenantsettings.Service,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	if mux == nil || settingsSvc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/settings", protectedMiddleware(http.HandlerFunc(getTenantSettings(settingsSvc))))
	mux.Handle("/api/v1/settings/datasources", protectedMiddleware(http.HandlerFunc(upsertTenantDatasourceSettings(settingsSvc))))
}

func getTenantSettings(settingsSvc *tenantsettings.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		settings, err := settingsSvc.GetTenantDatasourceSettings(req.Context(), tenantID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"datasources": settings,
		})
	}
}

func upsertTenantDatasourceSettings(settingsSvc *tenantsettings.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPut {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		payload := struct {
			Datasources tenantsettings.DatasourceSettings `json:"datasources"`
		}{}
		if req.Body != nil {
			decoder := json.NewDecoder(req.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}
		settings, err := settingsSvc.UpsertTenantDatasourceSettings(req.Context(), tenantID, payload.Datasources)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"datasources": settings,
		})
	}
}
