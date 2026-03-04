package agentmeta

import (
	"bytes"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func TestBuildDescriptorPreservesPromptTokensAndToolOrder(t *testing.T) {
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
	if left.EffectiveVersion == right.EffectiveVersion {
		t.Fatalf("expected different effective versions when prompt whitespace differs: left=%s right=%s", left.EffectiveVersion, right.EffectiveVersion)
	}
	if left.SystemPrompt != "You are\n  concise." {
		t.Fatalf("expected raw system prompt to be preserved, got %q", left.SystemPrompt)
	}
	if left.ToolCount != 2 {
		t.Fatalf("expected tool_count=2, got %d", left.ToolCount)
	}
	if left.Tools[0].Name != " weather " {
		t.Fatalf("expected tool name spacing to be preserved, got %q", left.Tools[0].Name)
	}
	if left.Tools[0].Description != "  Fetch weather " {
		t.Fatalf("expected tool description spacing to be preserved, got %q", left.Tools[0].Description)
	}
	if left.Tools[0].Type != " function " {
		t.Fatalf("expected tool type spacing to be preserved, got %q", left.Tools[0].Type)
	}
	if left.Tools[0].InputSchemaJSON != `{"b":2,"a":1}` {
		t.Fatalf("expected tool schema to be preserved as-is, got %q", left.Tools[0].InputSchemaJSON)
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
	if !bytes.Equal([]byte(first.Tools[0].InputSchemaJSON), []byte{0x01, 0x02, 0x03}) {
		t.Fatalf("expected raw schema bytes to be preserved, got %#v", []byte(first.Tools[0].InputSchemaJSON))
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

func TestBuildDescriptorDeferredChangesEffectiveVersion(t *testing.T) {
	base := &sigilv1.Generation{
		SystemPrompt: "You are concise.",
		Tools: []*sigilv1.ToolDefinition{
			{
				Name:            "weather",
				Description:     "fetch weather",
				Type:            "function",
				InputSchemaJson: []byte(`{"city":{"type":"string"}}`),
				Deferred:        false,
			},
		},
	}
	deferred := &sigilv1.Generation{
		SystemPrompt: "You are concise.",
		Tools: []*sigilv1.ToolDefinition{
			{
				Name:            "weather",
				Description:     "fetch weather",
				Type:            "function",
				InputSchemaJson: []byte(`{"city":{"type":"string"}}`),
				Deferred:        true,
			},
		},
	}

	baseDescriptor, err := BuildDescriptor(base)
	if err != nil {
		t.Fatalf("build descriptor base: %v", err)
	}
	deferredDescriptor, err := BuildDescriptor(deferred)
	if err != nil {
		t.Fatalf("build descriptor deferred: %v", err)
	}

	if baseDescriptor.EffectiveVersion == deferredDescriptor.EffectiveVersion {
		t.Fatalf("expected deferred tool config to change effective version")
	}
	if len(deferredDescriptor.Tools) != 1 || !deferredDescriptor.Tools[0].Deferred {
		t.Fatalf("expected deferred tool to be reflected in descriptor tools")
	}
	if !strings.Contains(deferredDescriptor.ToolsJSON, `"deferred":true`) {
		t.Fatalf("expected tools_json to include deferred=true, got %q", deferredDescriptor.ToolsJSON)
	}
}
