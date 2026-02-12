package ingest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/grafana/sigil/api/internal/tempo"
)

type Service struct {
	tempoClient *tempo.Client
}

type ingestResponse struct {
	Status string `json:"status"`
}

func NewService(tempoClient *tempo.Client) *Service {
	return &Service{
		tempoClient: tempoClient,
	}
}

func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, protectedMiddleware func(http.Handler) http.Handler) {
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/v1/traces", protectedMiddleware(http.HandlerFunc(service.HandleOTLPHTTP)))
	mux.HandleFunc("/healthz", service.HandleHealth)
}

func (s *Service) HandleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Service) HandleOTLPHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload, err := io.ReadAll(req.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	_ = s.tempoClient.ForwardTrace(req.Context(), payload)
	writeJSON(w, http.StatusAccepted, ingestResponse{Status: "accepted"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Service) ForwardToTempo(ctx context.Context, payload []byte) error {
	return s.tempoClient.ForwardTrace(ctx, payload)
}
