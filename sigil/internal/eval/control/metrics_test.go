package control

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestControlMethod_bounds_to_known_set(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "GET", input: "GET", want: "GET"},
		{name: "POST", input: "POST", want: "POST"},
		{name: "PUT", input: "PUT", want: "PUT"},
		{name: "PATCH", input: "PATCH", want: "PATCH"},
		{name: "DELETE", input: "DELETE", want: "DELETE"},
		{name: "HEAD", input: "HEAD", want: "HEAD"},
		{name: "OPTIONS", input: "OPTIONS", want: "OPTIONS"},
		{name: "lowercase get", input: "get", want: "GET"},
		{name: "mixed case Post", input: "Post", want: "POST"},
		{name: "empty string", input: "", want: "UNKNOWN"},
		{name: "whitespace only", input: "   ", want: "UNKNOWN"},
		{name: "arbitrary method", input: "FOOBAR", want: "OTHER"},
		{name: "TRACE", input: "TRACE", want: "OTHER"},
		{name: "CONNECT", input: "CONNECT", want: "OTHER"},
		{name: "attacker method", input: "AAAB", want: "OTHER"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := controlMethod(tt.input)
			if got != tt.want {
				t.Errorf("controlMethod(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

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
