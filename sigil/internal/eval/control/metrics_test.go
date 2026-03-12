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

func TestControlEndpoint(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "trimmed endpoint", input: "  evaluators  ", want: "evaluators"},
		{name: "empty endpoint", input: "", want: controlUnknownLabel},
		{name: "whitespace endpoint", input: "  \t", want: controlUnknownLabel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := controlEndpoint(tt.input)
			if got != tt.want {
				t.Fatalf("controlEndpoint(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestControlStatusClass(t *testing.T) {
	tests := []struct {
		name   string
		status int
		want   string
	}{
		{name: "1xx lower bound", status: 100, want: "1xx"},
		{name: "199", status: 199, want: "1xx"},
		{name: "200", status: 200, want: "2xx"},
		{name: "299", status: 299, want: "2xx"},
		{name: "300", status: 300, want: "3xx"},
		{name: "399", status: 399, want: "3xx"},
		{name: "400", status: 400, want: "4xx"},
		{name: "499", status: 499, want: "4xx"},
		{name: "500", status: 500, want: "5xx"},
		{name: "599", status: 599, want: "5xx"},
		{name: "0 defaults to 1xx", status: 0, want: "1xx"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := controlStatusClass(tt.status)
			if got != tt.want {
				t.Fatalf("controlStatusClass(%d) = %q, want %q", tt.status, got, tt.want)
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
