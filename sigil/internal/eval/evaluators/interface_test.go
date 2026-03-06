package evaluators

import (
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func TestInputFromGenerationIncludesToolCallPartsInOutput(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Input: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_USER,
			Parts: []*sigilv1.Part{
				{Payload: &sigilv1.Part_Text{Text: "What is the weather?"}},
			},
		}},
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{
				{Payload: &sigilv1.Part_Text{Text: "Let me check."}},
				{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{
					Id:        "call-1",
					Name:      "weather.lookup",
					InputJson: []byte(`{"city":"Boston"}`),
				}}},
			},
		}},
	}

	input := InputFromGeneration("tenant-a", generation)

	if input.InputText != "What is the weather?" {
		t.Fatalf("expected input text to remain text-only, got %q", input.InputText)
	}

	want := "Let me check.\n[tool_call] weather.lookup {\"city\":\"Boston\"}"
	if input.ResponseText != want {
		t.Fatalf("expected response text %q, got %q", want, input.ResponseText)
	}
}

func TestInputFromGenerationIncludesToolCallOnlyOutput(t *testing.T) {
	generation := &sigilv1.Generation{
		Id: "gen-1",
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{
				{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{
					Name:      "search",
					InputJson: []byte(`{"query":"status"}`),
				}}},
			},
		}},
	}

	input := InputFromGeneration("tenant-a", generation)

	want := "[tool_call] search {\"query\":\"status\"}"
	if input.ResponseText != want {
		t.Fatalf("expected response text %q, got %q", want, input.ResponseText)
	}
}
