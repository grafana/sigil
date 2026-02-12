package trace

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/grafana/sigil/sigil/internal/tempo"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
)

type Service struct {
	tempoForwarder TempoForwarder
}

type TempoForwarder interface {
	ForwardTraceHTTP(ctx context.Context, payload []byte, headers http.Header) (*tempo.HTTPForwardResponse, error)
	ForwardTraceGRPC(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error)
}

func NewService(tempoForwarder TempoForwarder) *Service {
	return &Service{
		tempoForwarder: tempoForwarder,
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

	response, err := s.tempoForwarder.ForwardTraceHTTP(req.Context(), payload, req.Header)
	if err != nil {
		http.Error(w, "forward to tempo", http.StatusBadGateway)
		return
	}
	if response == nil {
		http.Error(w, "forward to tempo", http.StatusBadGateway)
		return
	}

	for key, values := range response.Headers {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(response.Body)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Service) ForwardToTempoGRPC(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	return s.tempoForwarder.ForwardTraceGRPC(ctx, request)
}
