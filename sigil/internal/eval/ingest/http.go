package ingest

import (
	"encoding/json"
	"net/http"

	"github.com/grafana/dskit/tenant"
)

func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || service == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}
	mux.Handle("/api/v1/scores:export", protectedMiddleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		var request ExportScoresRequest
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		response := service.Export(withTransport(req.Context(), "http"), tenantID, request)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(response)
	})))
}
