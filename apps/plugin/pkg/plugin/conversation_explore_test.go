package plugin

import (
	"testing"
	"time"
)

func TestNormalizeSpanKind(t *testing.T) {
	tests := []struct {
		name  string
		input any
		want  string
	}{
		{name: "numeric int 1", input: float64(1), want: "INTERNAL"},
		{name: "numeric int 2", input: float64(2), want: "SERVER"},
		{name: "numeric int 3", input: float64(3), want: "CLIENT"},
		{name: "numeric int 4", input: float64(4), want: "PRODUCER"},
		{name: "numeric int 5", input: float64(5), want: "CONSUMER"},
		{name: "numeric string 1", input: "1", want: "INTERNAL"},
		{name: "numeric string 2", input: "2", want: "SERVER"},
		{name: "numeric string 3", input: "3", want: "CLIENT"},
		{name: "numeric string 4", input: "4", want: "PRODUCER"},
		{name: "numeric string 5", input: "5", want: "CONSUMER"},
		{name: "string INTERNAL", input: "INTERNAL", want: "INTERNAL"},
		{name: "string SERVER", input: "SERVER", want: "SERVER"},
		{name: "string CLIENT", input: "CLIENT", want: "CLIENT"},
		{name: "string PRODUCER", input: "PRODUCER", want: "PRODUCER"},
		{name: "string CONSUMER", input: "CONSUMER", want: "CONSUMER"},
		{name: "lowercase internal", input: "internal", want: "INTERNAL"},
		{name: "mixed case Server", input: "Server", want: "SERVER"},
		{name: "numeric 0", input: float64(0), want: "UNSPECIFIED"},
		{name: "empty string", input: "", want: "UNSPECIFIED"},
		{name: "nil", input: nil, want: "UNSPECIFIED"},
		{name: "unknown string", input: "UNKNOWN", want: "UNSPECIFIED"},
		{name: "whitespace padded", input: " SERVER ", want: "SERVER"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSpanKind(tt.input)
			if got != tt.want {
				t.Errorf("normalizeSpanKind(%v) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestExtractExploreGenerations_ReturnsThreeValues(t *testing.T) {
	raw := []any{
		map[string]any{
			"trace_id":   "abc123def456abc123def456abc12345",
			"span_id":    "1234567890abcdef",
			"created_at": "2025-01-01T00:00:00Z",
		},
	}
	window := conversationExploreTraceWindow{
		Start: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		End:   time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
	}

	traceIDs, generationSpanKeys, traceWindows := extractExploreGenerations(raw, window)

	if len(traceIDs) != 1 {
		t.Fatalf("expected 1 traceID, got %d", len(traceIDs))
	}
	if traceIDs[0] != "abc123def456abc123def456abc12345" {
		t.Errorf("unexpected traceID: %s", traceIDs[0])
	}
	if len(generationSpanKeys) != 1 {
		t.Errorf("expected 1 generation span key, got %d", len(generationSpanKeys))
	}
	if len(traceWindows) != 1 {
		t.Errorf("expected 1 trace window, got %d", len(traceWindows))
	}
}
