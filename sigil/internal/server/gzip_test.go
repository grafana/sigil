package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithGzipCompressionCompressesWhenAccepted(t *testing.T) {
	handler := WithGzipCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if got := resp.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected gzip content encoding, got %q", got)
	}

	reader, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatalf("new gzip reader: %v", err)
	}
	defer func() {
		_ = reader.Close()
	}()

	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read gzipped body: %v", err)
	}
	if string(body) != `{"status":"ok"}` {
		t.Fatalf("unexpected decompressed body: %q", body)
	}
}

func TestWithGzipCompressionRespectsExistingContentEncoding(t *testing.T) {
	handler := WithGzipCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Encoding", "br")
		_, _ = w.Write([]byte("already-encoded"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/proxy", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if got := resp.Header().Get("Content-Encoding"); got != "br" {
		t.Fatalf("expected existing content encoding to win, got %q", got)
	}
	if body := resp.Body.String(); body != "already-encoded" {
		t.Fatalf("expected unmodified body, got %q", body)
	}
}

func TestWithGzipCompressionDoesNotWriteBodyForNoContent(t *testing.T) {
	handler := WithGzipCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/resource", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.Code)
	}
	if got := resp.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no content encoding for 204, got %q", got)
	}
	if resp.Body.Len() != 0 {
		t.Fatalf("expected empty body for 204, got %d bytes", resp.Body.Len())
	}
}

func TestAcceptsGzip(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   bool
	}{
		{name: "plain gzip", header: "gzip", want: true},
		{name: "gzip with q=1", header: "gzip;q=1", want: true},
		{name: "gzip with q=0.5", header: "gzip;q=0.5", want: true},
		{name: "gzip with q=0.1", header: "gzip;q=0.1", want: true},
		{name: "gzip with q=0.9", header: "gzip;q=0.9", want: true},
		{name: "gzip with q=0.001", header: "gzip;q=0.001", want: true},
		{name: "gzip with q=0 rejected", header: "gzip;q=0", want: false},
		{name: "gzip with q=0.0 rejected", header: "gzip;q=0.0", want: false},
		{name: "gzip with q=0.000 rejected", header: "gzip;q=0.000", want: false},
		{name: "gzip with space before q", header: "gzip; q=0.5", want: true},
		{name: "gzip among multiple", header: "deflate, gzip;q=0.8, br", want: true},
		{name: "gzip q=0 among multiple", header: "deflate, gzip;q=0, br", want: false},
		{name: "no gzip", header: "deflate, br", want: false},
		{name: "empty header", header: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := acceptsGzip(tt.header); got != tt.want {
				t.Errorf("acceptsGzip(%q) = %v, want %v", tt.header, got, tt.want)
			}
		})
	}
}

func TestWithGzipCompressionSkipsHeadRequests(t *testing.T) {
	handler := WithGzipCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodHead, "/healthz", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if got := resp.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no content encoding for HEAD, got %q", got)
	}
	if resp.Body.Len() != 0 {
		t.Fatalf("expected empty body for HEAD, got %d bytes", resp.Body.Len())
	}
}
