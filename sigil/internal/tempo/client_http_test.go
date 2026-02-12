package tempo

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestForwardTraceHTTPForwardsPayloadAndHeadersAndProxiesResponse(t *testing.T) {
	var (
		mu              sync.Mutex
		capturedPath    string
		capturedPayload []byte
		capturedHeaders http.Header
	)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		payload, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		mu.Lock()
		capturedPath = req.URL.Path
		capturedPayload = append([]byte(nil), payload...)
		capturedHeaders = req.Header.Clone()
		mu.Unlock()

		w.Header().Set("Content-Type", "application/x-protobuf")
		w.Header().Set("X-Tempo", "ok")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("tempo-response"))
	}))
	defer upstream.Close()

	client := NewClient("tempo:4317", upstream.URL)
	defer func() {
		_ = client.Close()
	}()

	headers := http.Header{
		"Authorization": []string{"Bearer trace-secret"},
		"X-Scope-OrgID": []string{"tenant-a"},
		"Content-Type":  []string{"application/x-protobuf"},
	}
	response, err := client.ForwardTraceHTTP(context.Background(), []byte("trace-payload"), headers)
	if err != nil {
		t.Fatalf("forward trace over http: %v", err)
	}
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", response.StatusCode)
	}
	if got := response.Headers.Get("X-Tempo"); got != "ok" {
		t.Fatalf("expected X-Tempo header value ok, got %q", got)
	}
	if string(response.Body) != "tempo-response" {
		t.Fatalf("expected proxied body tempo-response, got %q", string(response.Body))
	}

	mu.Lock()
	defer mu.Unlock()

	if capturedPath != "/v1/traces" {
		t.Fatalf("expected normalized path /v1/traces, got %q", capturedPath)
	}
	if !bytes.Equal(capturedPayload, []byte("trace-payload")) {
		t.Fatalf("expected payload trace-payload, got %q", string(capturedPayload))
	}
	if got := capturedHeaders.Get("Authorization"); got != "Bearer trace-secret" {
		t.Fatalf("expected forwarded authorization header, got %q", got)
	}
	if got := capturedHeaders.Get("X-Scope-OrgID"); got != "tenant-a" {
		t.Fatalf("expected forwarded tenant header tenant-a, got %q", got)
	}
}

func TestForwardTraceHTTPReturnsTransportError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	address := listener.Addr().String()
	_ = listener.Close()

	client := NewClient("tempo:4317", "http://"+address)
	defer func() {
		_ = client.Close()
	}()

	_, err = client.ForwardTraceHTTP(context.Background(), []byte("trace"), http.Header{
		"Content-Type": []string{"application/x-protobuf"},
	})
	if err == nil {
		t.Fatalf("expected transport error")
	}
}
