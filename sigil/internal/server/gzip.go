package server

import (
	"compress/gzip"
	"net/http"
	"strings"
)

func WithGzipCompression(next http.Handler) http.Handler {
	if next == nil {
		return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method == http.MethodHead || !acceptsGzip(req.Header.Get("Accept-Encoding")) || strings.TrimSpace(req.Header.Get("Upgrade")) != "" {
			next.ServeHTTP(w, req)
			return
		}

		gzipWriter := &lazyGzipResponseWriter{ResponseWriter: w}
		defer func() {
			_ = gzipWriter.Close()
		}()
		next.ServeHTTP(gzipWriter, req)
	})
}

type lazyGzipResponseWriter struct {
	http.ResponseWriter
	gzipWriter      *gzip.Writer
	headerWritten   bool
	compressAllowed bool
}

func (w *lazyGzipResponseWriter) WriteHeader(statusCode int) {
	w.compressAllowed = responseMayHaveBody(statusCode)
	if w.compressAllowed {
		w.ensureEncodingHeader()
	}
	w.headerWritten = true
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *lazyGzipResponseWriter) Write(p []byte) (int, error) {
	if !w.headerWritten {
		w.WriteHeader(http.StatusOK)
	}
	if w.gzipWriter == nil {
		return w.ResponseWriter.Write(p)
	}
	return w.gzipWriter.Write(p)
}

func (w *lazyGzipResponseWriter) Flush() {
	if w.gzipWriter != nil {
		_ = w.gzipWriter.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *lazyGzipResponseWriter) Close() error {
	if w.gzipWriter != nil {
		return w.gzipWriter.Close()
	}
	return nil
}

func (w *lazyGzipResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *lazyGzipResponseWriter) ensureEncodingHeader() {
	if w.gzipWriter != nil || w.Header().Get("Content-Encoding") != "" {
		return
	}
	w.Header().Add("Vary", "Accept-Encoding")
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	w.gzipWriter = gzip.NewWriter(w.ResponseWriter)
}

func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		token := strings.TrimSpace(part)
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "gzip") {
			return !strings.Contains(token, "q=0")
		}
	}
	return false
}

func responseMayHaveBody(statusCode int) bool {
	if statusCode >= 100 && statusCode < 200 {
		return false
	}
	switch statusCode {
	case http.StatusNoContent, http.StatusNotModified:
		return false
	default:
		return true
	}
}
