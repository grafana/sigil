package followup

import (
	"strings"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
	"time"
)

func TestBuildConversationLog(t *testing.T) {
	base := time.Date(2026, 3, 9, 10, 0, 0, 0, time.UTC)

	gen1 := &sigilv1.Generation{
		Id:           "gen-1",
		SystemPrompt: "You are a helpful assistant.",
		AgentName:    "test-agent",
		Model:        &sigilv1.ModelRef{Provider: "anthropic", Name: "claude-sonnet-4-6"},
		StartedAt:    timestamppb.New(base),
		Input: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_USER,
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_Text{Text: "List all errors"}},
				},
			},
		},
		Output: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{
						Id:        "tc-1",
						Name:      "jq",
						InputJson: []byte(`{"operation": "list_artifacts"}`),
					}}},
				},
			},
		},
	}

	gen2 := &sigilv1.Generation{
		Id:        "gen-2",
		AgentName: "test-agent",
		Model:     &sigilv1.ModelRef{Provider: "anthropic", Name: "claude-sonnet-4-6"},
		StartedAt: timestamppb.New(base.Add(time.Second)),
		Input: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_TOOL,
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_ToolResult{ToolResult: &sigilv1.ToolResult{
						ToolCallId: "tc-1",
						Name:       "jq",
						Content:    `["artifact-1", "artifact-2"]`,
					}}},
				},
			},
		},
		Output: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_Text{Text: "Found 2 artifacts."}},
				},
			},
		},
	}

	log := buildConversationLog([]*sigilv1.Generation{gen1, gen2})

	logChecks := []string{
		"[User]",
		"List all errors",
		"[Tool Call: jq (id: tc-1)]",
		`"list_artifacts"`,
		"[Tool Result: jq]",
		"artifact-1",
		"Found 2 artifacts.",
	}
	for _, check := range logChecks {
		if !strings.Contains(log, check) {
			t.Errorf("expected conversation log to contain %q, got:\n%s", check, log)
		}
	}

	if strings.Contains(log, "[System Prompt]") {
		t.Error("system prompt should not appear in conversation log")
	}
}

func TestBuildConversationLogEmpty(t *testing.T) {
	log := buildConversationLog(nil)
	if log != "" {
		t.Errorf("expected empty conversation log, got %q", log)
	}
}

func TestBuildFollowupUserPrompt(t *testing.T) {
	prompt := buildFollowupUserPrompt("conversation content here", "why did you do that?")

	if !strings.Contains(prompt, "<conversation>") {
		t.Error("expected prompt to contain <conversation> tag")
	}
	if !strings.Contains(prompt, "conversation content here") {
		t.Error("expected prompt to contain conversation content")
	}
	if !strings.Contains(prompt, "why did you do that?") {
		t.Error("expected prompt to contain user question")
	}
}

func TestBuildFollowupUserPromptTruncatesLargeConversation(t *testing.T) {
	large := strings.Repeat("x", maxMessageCharLen+1000)
	prompt := buildFollowupUserPrompt(large, "question")
	if !strings.Contains(prompt, "[... conversation truncated ...]") {
		t.Error("expected truncation marker for large conversation")
	}
}
