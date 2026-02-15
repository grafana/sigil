package queryproxy

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/dskit/user"
)

func TestIsAllowed(t *testing.T) {
	tests := []struct {
		name          string
		backend       Backend
		method        string
		path          string
		pathMatched   bool
		methodAllowed bool
	}{
		{
			name:          "prometheus query allows get",
			backend:       BackendPrometheus,
			method:        http.MethodGet,
			path:          "/api/v1/query",
			pathMatched:   true,
			methodAllowed: true,
		},
		{
			name:          "prometheus label values rejects post",
			backend:       BackendPrometheus,
			method:        http.MethodPost,
			path:          "/api/v1/label/job/values",
			pathMatched:   true,
			methodAllowed: false,
		},
		{
			name:          "tempo traces allows get",
			backend:       BackendTempo,
			method:        http.MethodGet,
			path:          "/api/traces/abcd1234",
			pathMatched:   true,
			methodAllowed: true,
		},
		{
			name:          "tempo traces rejects additional segment",
			backend:       BackendTempo,
			method:        http.MethodGet,
			path:          "/api/traces/abcd1234/extra",
			pathMatched:   false,
			methodAllowed: false,
		},
		{
			name:          "unknown path is rejected",
			backend:       BackendPrometheus,
			method:        http.MethodGet,
			path:          "/api/v1/alerts",
			pathMatched:   false,
			methodAllowed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pathMatched, methodAllowed := isAllowed(tt.backend, tt.method, tt.path)
			if pathMatched != tt.pathMatched {
				t.Fatalf("expected pathMatched=%v, got %v", tt.pathMatched, pathMatched)
			}
			if methodAllowed != tt.methodAllowed {
				t.Fatalf("expected methodAllowed=%v, got %v", tt.methodAllowed, methodAllowed)
			}
		})
	}
}

func TestForwardPassesTenantAndSafeHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/prom-prefix/api/v1/query_range" {
			http.Error(w, "unexpected path: "+req.URL.Path, http.StatusBadRequest)
			return
		}
		if req.URL.RawQuery != "query=up&step=15" {
			http.Error(w, "unexpected query: "+req.URL.RawQuery, http.StatusBadRequest)
			return
		}
		if got := req.Header.Get("X-Scope-OrgID"); got != "tenant-a" {
			http.Error(w, "missing tenant header", http.StatusUnauthorized)
			return
		}
		if got := req.Header.Get("Authorization"); got != "" {
			http.Error(w, "authorization header should not be forwarded", http.StatusBadRequest)
			return
		}
		if got := req.Header.Get("X-Request-Id"); got != "req-1" {
			http.Error(w, "missing request id", http.StatusBadRequest)
			return
		}
		if got := req.Header.Get("Accept"); got != "application/json" {
			http.Error(w, "missing accept header", http.StatusBadRequest)
			return
		}
		if got := req.Header.Get("Connection"); got != "" {
			http.Error(w, "connection header should not be forwarded", http.StatusBadRequest)
			return
		}
		payload, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if string(payload) != `{"query":"up"}` {
			http.Error(w, "unexpected body", http.StatusBadRequest)
			return
		}
		w.Header().Set("Connection", "close")
		w.Header().Set("Keep-Alive", "timeout=5")
		w.Header().Set("X-Proxy-Test", "ok")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer upstream.Close()

	proxy, err := New(Config{
		PrometheusBaseURL: upstream.URL + "/prom-prefix",
		TempoBaseURL:      upstream.URL + "/tempo-prefix",
		Timeout:           time.Second,
	})
	if err != nil {
		t.Fatalf("new proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/proxy/prometheus/api/v1/query_range?query=up&step=15", strings.NewReader(`{"query":"up"}`))
	req = req.WithContext(user.InjectOrgID(req.Context(), "tenant-a"))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Request-Id", "req-1")
	req.Header.Set("Connection", "keep-alive")

	resp := httptest.NewRecorder()
	if err := proxy.Forward(resp, req, BackendPrometheus, "/api/v1/query_range"); err != nil {
		t.Fatalf("forward: %v", err)
	}

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected %d, got %d", http.StatusAccepted, resp.Code)
	}
	if body := resp.Body.String(); body != `{"status":"success"}` {
		t.Fatalf("unexpected response body: %s", body)
	}
	if got := resp.Header().Get("X-Proxy-Test"); got != "ok" {
		t.Fatalf("expected X-Proxy-Test header, got %q", got)
	}
	if got := resp.Header().Get("Connection"); got != "" {
		t.Fatalf("expected Connection header to be stripped, got %q", got)
	}
	if got := resp.Header().Get("Keep-Alive"); got != "" {
		t.Fatalf("expected Keep-Alive header to be stripped, got %q", got)
	}
}

func TestForwardValidationAndErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	proxy, err := New(Config{
		PrometheusBaseURL: upstream.URL,
		TempoBaseURL:      upstream.URL,
		Timeout:           time.Second,
	})
	if err != nil {
		t.Fatalf("new proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/proxy", nil)
	req = req.WithContext(user.InjectOrgID(req.Context(), "tenant-a"))
	resp := httptest.NewRecorder()

	if err := proxy.Forward(resp, req, BackendPrometheus, "/api/v1/alerts"); !errors.Is(err, ErrPathNotAllowed) {
		t.Fatalf("expected ErrPathNotAllowed, got %v", err)
	}
	if err := proxy.Forward(resp, req, BackendTempo, "/api/search"); !errors.Is(err, ErrMethodNotAllowed) {
		t.Fatalf("expected ErrMethodNotAllowed, got %v", err)
	}

	noTenantReq := httptest.NewRequest(http.MethodGet, "/proxy", nil)
	if err := proxy.Forward(resp, noTenantReq, BackendPrometheus, "/api/v1/query"); !errors.Is(err, ErrTenantRequired) {
		t.Fatalf("expected ErrTenantRequired, got %v", err)
	}
}

func TestForwardUpstreamUnavailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	_ = listener.Close()

	proxy, err := New(Config{
		PrometheusBaseURL: "http://" + addr,
		TempoBaseURL:      "http://" + addr,
		Timeout:           200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("new proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/proxy", nil)
	req = req.WithContext(user.InjectOrgID(req.Context(), "tenant-a"))
	resp := httptest.NewRecorder()

	err = proxy.Forward(resp, req, BackendPrometheus, "/api/v1/query")
	if !errors.Is(err, ErrUpstreamUnavailable) {
		t.Fatalf("expected ErrUpstreamUnavailable, got %v", err)
	}
}
