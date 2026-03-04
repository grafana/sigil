package agentmeta

import (
	"strings"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func TestBuildDescriptorNormalizesWhitespaceAndToolOrder(t *testing.T) {
	base := &sigilv1.Generation{
		AgentName:    " assistant ",
		AgentVersion: " v1 ",
		SystemPrompt: "You are\n  concise.",
		Model:        &sigilv1.ModelRef{Provider: " openai ", Name: " gpt-5 "},
		Tools: []*sigilv1.ToolDefinition{
			{
				Name:            " weather ",
				Description:     "  Fetch weather ",
				Type:            " function ",
				InputSchemaJson: []byte(`{"b":2,"a":1}`),
			},
			{
				Name:            "search",
				Description:     "web",
				Type:            "function",
				InputSchemaJson: []byte(`{"q":{"type":"string"}}`),
			},
		},
	}

	sameSemantics := &sigilv1.Generation{
		AgentName:    "assistant",
		AgentVersion: "v2",
		SystemPrompt: "  You are  \n  concise.  ",
		Model:        &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		Tools: []*sigilv1.ToolDefinition{
			{
				Name:            "search",
				Description:     "web",
				Type:            "function",
				InputSchemaJson: []byte("{\"q\":{\"type\":\"string\"}}"),
			},
			{
				Name:            "weather",
				Description:     "Fetch weather",
				Type:            "function",
				InputSchemaJson: []byte(`{"a":1,"b":2}`),
			},
		},
	}

	left, err := BuildDescriptor(base)
	if err != nil {
		t.Fatalf("build descriptor left: %v", err)
	}
	right, err := BuildDescriptor(sameSemantics)
	if err != nil {
		t.Fatalf("build descriptor right: %v", err)
	}

	if left.AgentName != "assistant" {
		t.Fatalf("expected trimmed agent name, got %q", left.AgentName)
	}
	if left.DeclaredVersion != "v1" {
		t.Fatalf("expected trimmed declared version, got %q", left.DeclaredVersion)
	}
	if left.EffectiveVersion != right.EffectiveVersion {
		t.Fatalf("expected same effective version for semantically-equal inputs: left=%s right=%s", left.EffectiveVersion, right.EffectiveVersion)
	}
	if left.SystemPrompt != "You are\nconcise." {
		t.Fatalf("unexpected normalized prompt: %q", left.SystemPrompt)
	}
	if left.ToolCount != 2 {
		t.Fatalf("expected tool_count=2, got %d", left.ToolCount)
	}
	if left.TokenEstimateTotal <= 0 {
		t.Fatalf("expected non-zero token estimate total")
	}
	if left.ModelProvider != "openai" || left.ModelName != "gpt-5" {
		t.Fatalf("unexpected model normalization: provider=%q model=%q", left.ModelProvider, left.ModelName)
	}
}

func TestBuildDescriptorHandlesNonJSONSchemaDeterministically(t *testing.T) {
	first, err := BuildDescriptor(&sigilv1.Generation{
		SystemPrompt: "prompt",
		Tools: []*sigilv1.ToolDefinition{
			{Name: "x", Type: "function", InputSchemaJson: []byte{0x01, 0x02, 0x03}},
		},
	})
	if err != nil {
		t.Fatalf("build descriptor first: %v", err)
	}
	second, err := BuildDescriptor(&sigilv1.Generation{
		SystemPrompt: "prompt",
		Tools: []*sigilv1.ToolDefinition{
			{Name: "x", Type: "function", InputSchemaJson: []byte{0x01, 0x02, 0x03}},
		},
	})
	if err != nil {
		t.Fatalf("build descriptor second: %v", err)
	}

	if first.EffectiveVersion != second.EffectiveVersion {
		t.Fatalf("expected deterministic effective version for identical non-json schema")
	}
	if len(first.Tools) != 1 {
		t.Fatalf("expected one tool")
	}
	if !strings.HasPrefix(first.Tools[0].InputSchemaJSON, "__base64__:") {
		t.Fatalf("expected base64 schema fallback, got %q", first.Tools[0].InputSchemaJSON)
	}
}

func TestNormalizeSystemPrompt(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "whitespace_only", input: "   \n  \t  ", want: ""},
		{name: "single_line", input: "  hello world  ", want: "hello world"},
		{name: "collapses_spaces_within_line", input: "You   are   helpful.", want: "You are helpful."},
		{name: "preserves_newline", input: "You are\nconcise.", want: "You are\nconcise."},
		{name: "trims_and_preserves_newline", input: "  You are  \n  concise.  ", want: "You are\nconcise."},
		{name: "preserves_multiple_newlines", input: "Line one.\nLine two.\nLine three.", want: "Line one.\nLine two.\nLine three."},
		{name: "collapses_spaces_each_line", input: "  hello   world  \n  foo   bar  ", want: "hello world\nfoo bar"},
		{name: "leading_trailing_newlines_trimmed", input: "\n\nHello.\n\n", want: "Hello."},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeSystemPrompt(tc.input)
			if got != tc.want {
				t.Fatalf("normalizeSystemPrompt(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestClampRunes(t *testing.T) {
	tests := []struct {
		name  string
		value string
		limit int
		want  string
	}{
		{name: "empty", value: "", limit: 3, want: ""},
		{name: "zero_limit", value: "abc", limit: 0, want: ""},
		{name: "short_ascii", value: "abc", limit: 5, want: "abc"},
		{name: "truncate_ascii", value: "abcdef", limit: 3, want: "abc"},
		{name: "truncate_unicode", value: "åß∂ƒ", limit: 2, want: "åß"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := ClampRunes(tc.value, tc.limit)
			if got != tc.want {
				t.Fatalf("ClampRunes(%q, %d) = %q, want %q", tc.value, tc.limit, got, tc.want)
			}
		})
	}
}
