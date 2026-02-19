package rules

import (
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMatchesRule(t *testing.T) {
	generation := &sigilv1.Generation{
		AgentName:     "assistant-api",
		AgentVersion:  "v2.1.0",
		OperationName: "generateText",
		Mode:          sigilv1.GenerationMode_GENERATION_MODE_STREAM,
		Model:         &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o-mini"},
		Tags: map[string]string{
			"env":            "prod",
			"team":           "platform",
			"error.type":     "provider_call_error",
			"error.category": "rate_limit",
		},
		CallError: "rate limited",
		Metadata: &structpb.Struct{
			Fields: map[string]*structpb.Value{
				"span.error.type":     structpb.NewStringValue("provider_call_error"),
				"span.error.category": structpb.NewStringValue("rate_limit"),
			},
		},
	}

	tests := []struct {
		name  string
		match map[string]any
		want  bool
	}{
		{name: "glob_agent_name", match: map[string]any{"agent_name": []string{"assistant-*"}}, want: true},
		{name: "glob_model", match: map[string]any{"model.name": []string{"gpt-*"}}, want: true},
		{name: "mode_exact", match: map[string]any{"mode": []string{"STREAM"}}, want: true},
		{name: "tag_exact", match: map[string]any{"tags.env": []string{"prod"}}, want: true},
		{name: "error_presence", match: map[string]any{"error.type": []string{"present"}}, want: true},
		{name: "error_type_exact", match: map[string]any{"error.type": []string{"provider_call_error"}}, want: true},
		{name: "error_category_exact", match: map[string]any{"error.category": []string{"rate_limit"}}, want: true},
		{name: "error_type_mismatch", match: map[string]any{"error.type": []string{"timeout"}}, want: false},
		{name: "invalid_scalar_type_fails_closed", match: map[string]any{"mode": 1}, want: false},
		{name: "invalid_array_type_fails_closed", match: map[string]any{"tags.env": []any{1, 2}}, want: false},
		{name: "invalid_glob_pattern_fails_closed", match: map[string]any{"agent_name": []string{"assistant-*", "assistant-["}}, want: false},
		{name: "error_absent_fails", match: map[string]any{"error.type": []string{"absent"}}, want: false},
		{name: "unknown_field_fails", match: map[string]any{"unknown": []string{"x"}}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := MatchesRule(test.match, generation)
			if got != test.want {
				t.Fatalf("expected %v, got %v", test.want, got)
			}
		})
	}
}

func TestMatchesRuleErrorFieldFallsBackToCallError(t *testing.T) {
	generation := &sigilv1.Generation{
		CallError: "timeout",
	}
	if !MatchesRule(map[string]any{"error.type": []string{"timeout"}}, generation) {
		t.Fatalf("expected call_error fallback to satisfy exact error.type match")
	}
	if MatchesRule(map[string]any{"error.category": []string{"rate_limit"}}, generation) {
		t.Fatalf("expected mismatched error.category to fail")
	}
}
