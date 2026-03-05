package control

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStatusCapturingResponseWriter_Unwrap(t *testing.T) {
	inner := httptest.NewRecorder()
	w := &statusCapturingResponseWriter{ResponseWriter: inner}

	got := w.Unwrap()
	if got != inner {
		t.Fatalf("Unwrap() = %v, want %v", got, inner)
	}
}

func TestStatusCapturingResponseWriter_Unwrap_nil(t *testing.T) {
	var w *statusCapturingResponseWriter
	if got := w.Unwrap(); got != nil {
		t.Fatalf("Unwrap() on nil receiver = %v, want nil", got)
	}
}

func TestStatusCapturingResponseWriter_Unwrap_preserves_optional_interfaces(t *testing.T) {
	inner := httptest.NewRecorder()
	w := &statusCapturingResponseWriter{ResponseWriter: inner}

	rc := http.NewResponseController(w)
	if err := rc.Flush(); err != nil {
		t.Fatalf("ResponseController.Flush() through Unwrap() failed: %v", err)
	}
}
