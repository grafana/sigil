package promptinsights

import (
	"strings"
	"testing"
)

func TestBuildUserPrompt(t *testing.T) {
	tests := []struct {
		name             string
		systemPrompt     string
		excerpts         []ConversationExcerpt
		wantContains     []string
		wantNotContains  []string
	}{
		{
			name:         "includes system prompt in XML",
			systemPrompt: "You are a helpful assistant.",
			wantContains: []string{
				"<agent_system_prompt>",
				"You are a helpful assistant.",
				"</agent_system_prompt>",
				"<no_conversations>",
			},
		},
		{
			name:         "escapes XML special chars",
			systemPrompt: "Use <tool> & 'quote' \"double\"",
			wantContains: []string{
				"&lt;tool&gt;",
				"&amp;",
				"&apos;quote&apos;",
				"&quot;double&quot;",
			},
		},
		{
			name:         "includes conversation excerpts",
			systemPrompt: "You are a helper.",
			excerpts: []ConversationExcerpt{
				{
					ConversationID:  "conv-1",
					GenerationCount: 5,
					HasErrors:       true,
					ToolCallCount:   2,
					UserInput:       "How do I fix this bug?",
					AssistantOutput: "Let me debug it step by step.",
				},
			},
			wantContains: []string{
				"conv-1",
				"generations=\"5\"",
				"has_errors=\"true\"",
				"tool_calls=\"2\"",
				"How do I fix this bug?",
				"Let me debug it step by step.",
			},
			wantNotContains: []string{"<no_conversations>"},
		},
		{
			name:         "truncates long input",
			systemPrompt: "Short prompt.",
			excerpts: []ConversationExcerpt{
				{
					ConversationID: "conv-long",
					UserInput:      strings.Repeat("a", 1000),
					AssistantOutput: strings.Repeat("b", 1000),
				},
			},
			wantContains: []string{"..."},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := buildUserPrompt(tt.systemPrompt, tt.excerpts)
			for _, want := range tt.wantContains {
				if !strings.Contains(result, want) {
					t.Errorf("expected prompt to contain %q", want)
				}
			}
			for _, notWant := range tt.wantNotContains {
				if strings.Contains(result, notWant) {
					t.Errorf("expected prompt NOT to contain %q", notWant)
				}
			}
		})
	}
}

func TestInsightsOutputSchema(t *testing.T) {
	schema := insightsOutputSchema()
	if schema == nil {
		t.Fatal("expected non-nil schema")
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties map")
	}
	if _, ok := props["strengths"]; !ok {
		t.Error("missing 'strengths' in schema")
	}
	if _, ok := props["weaknesses"]; !ok {
		t.Error("missing 'weaknesses' in schema")
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{name: "short string unchanged", input: "hello", maxLen: 10, want: "hello"},
		{name: "exact length unchanged", input: "hello", maxLen: 5, want: "hello"},
		{name: "long string truncated", input: "hello world", maxLen: 5, want: "hello..."},
		{name: "empty string", input: "", maxLen: 5, want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncate(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeStatus(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"pending", StatusPending},
		{"PENDING", StatusPending},
		{" Pending ", StatusPending},
		{"failed", StatusFailed},
		{"FAILED", StatusFailed},
		{"completed", StatusCompleted},
		{"anything", StatusCompleted},
		{"", StatusCompleted},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := NormalizeStatus(tt.input)
			if got != tt.want {
				t.Errorf("NormalizeStatus(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
