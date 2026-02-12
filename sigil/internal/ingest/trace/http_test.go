package trace

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/grafana/sigil/sigil/internal/tempo"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestOTLPHTTPRequiresTenantHeaderWhenAuthEnabled(t *testing.T) {
	forwarder := &testTempoForwarder{
		httpResponse: &tempo.HTTPForwardResponse{
			StatusCode: http.StatusOK,
			Headers:    http.Header{"X-Tempo": []string{"ok"}},
			Body:       []byte("forwarded"),
		},
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, NewService(forwarder), protected)

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
	if authorizedResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", authorizedResp.Code)
	}

	if got := forwarder.lastHTTPHeaders().Get("X-Scope-OrgID"); got != "tenant-a" {
		t.Fatalf("expected forwarded tenant header tenant-a, got %q", got)
	}
}

func TestOTLPHTTPHealthIsExempt(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, NewService(&testTempoForwarder{}), protected)

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
	forwarder := &testTempoForwarder{
		httpResponse: &tempo.HTTPForwardResponse{
			StatusCode: http.StatusAccepted,
			Headers:    http.Header{"Content-Type": []string{"application/x-protobuf"}},
			Body:       []byte("ok"),
		},
	}
	RegisterHTTPRoutes(mux, NewService(forwarder), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", resp.Code)
	}
}

func TestOTLPHTTPProxiesTempoResponse(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake-local"})
	forwarder := &testTempoForwarder{
		httpResponse: &tempo.HTTPForwardResponse{
			StatusCode: http.StatusTooManyRequests,
			Headers: http.Header{
				"Content-Type": []string{"application/x-protobuf"},
				"Retry-After":  []string{"5"},
			},
			Body: []byte("tempo says slow down"),
		},
	}
	RegisterHTTPRoutes(mux, NewService(forwarder), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", resp.Code)
	}
	if got := resp.Header().Get("Retry-After"); got != "5" {
		t.Fatalf("expected Retry-After=5, got %q", got)
	}
	if got := strings.TrimSpace(resp.Body.String()); got != "tempo says slow down" {
		t.Fatalf("expected proxied response body, got %q", got)
	}
}

func TestOTLPHTTPReturnsBadGatewayOnForwardError(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake-local"})
	forwarder := &testTempoForwarder{httpErr: errors.New("tempo unavailable")}
	RegisterHTTPRoutes(mux, NewService(forwarder), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", resp.Code)
	}
}

func TestOTLPHTTPForwardsAuthHeadersToTempo(t *testing.T) {
	var (
		mu              sync.Mutex
		capturedHeaders http.Header
		capturedBody    []byte
		capturedPath    string
	)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		mu.Lock()
		capturedHeaders = req.Header.Clone()
		capturedBody = append([]byte(nil), body...)
		capturedPath = req.URL.Path
		mu.Unlock()

		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("upstream-ok"))
	}))
	defer upstream.Close()

	tempoClient := tempo.NewClient("tempo:4317", upstream.URL)
	defer func() {
		_ = tempoClient.Close()
	}()

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, NewService(tempoClient), protected)

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString("trace"))
	req.Header.Set("X-Scope-OrgID", "tenant-a")
	req.Header.Set("Authorization", "Bearer trace-secret")
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	mu.Lock()
	defer mu.Unlock()

	if capturedPath != "/v1/traces" {
		t.Fatalf("expected path /v1/traces, got %q", capturedPath)
	}
	if got := capturedHeaders.Get("X-Scope-OrgID"); got != "tenant-a" {
		t.Fatalf("expected upstream tenant header tenant-a, got %q", got)
	}
	if got := capturedHeaders.Get("Authorization"); got != "Bearer trace-secret" {
		t.Fatalf("expected upstream authorization header, got %q", got)
	}
	if string(capturedBody) != "trace" {
		t.Fatalf("expected upstream payload trace, got %q", string(capturedBody))
	}
}

type testTempoForwarder struct {
	mu sync.Mutex

	httpResponse *tempo.HTTPForwardResponse
	httpErr      error
	httpHeaders  http.Header

	grpcResponse *collecttracev1.ExportTraceServiceResponse
	grpcErr      error
}

func (f *testTempoForwarder) ForwardTraceHTTP(_ context.Context, _ []byte, headers http.Header) (*tempo.HTTPForwardResponse, error) {
	f.mu.Lock()
	f.httpHeaders = headers.Clone()
	f.mu.Unlock()

	if f.httpErr != nil {
		return nil, f.httpErr
	}
	if f.httpResponse == nil {
		return nil, nil
	}
	return &tempo.HTTPForwardResponse{
		StatusCode: f.httpResponse.StatusCode,
		Headers:    f.httpResponse.Headers.Clone(),
		Body:       append([]byte(nil), f.httpResponse.Body...),
	}, nil
}

func (f *testTempoForwarder) ForwardTraceGRPC(_ context.Context, _ *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	if f.grpcErr != nil {
		return nil, f.grpcErr
	}
	if f.grpcResponse == nil {
		return &collecttracev1.ExportTraceServiceResponse{}, nil
	}
	cloned := proto.Clone(f.grpcResponse)
	response, ok := cloned.(*collecttracev1.ExportTraceServiceResponse)
	if !ok {
		return &collecttracev1.ExportTraceServiceResponse{}, nil
	}
	return response, nil
}

func (f *testTempoForwarder) lastHTTPHeaders() http.Header {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.httpHeaders.Clone()
}
