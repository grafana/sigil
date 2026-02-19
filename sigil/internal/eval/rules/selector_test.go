package rules

import (
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func TestMatchesSelector(t *testing.T) {
	assistantText := &sigilv1.Generation{
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
	}
	assistantToolCall := &sigilv1.Generation{
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{Id: "call-1"}}}},
		}},
	}
	errored := &sigilv1.Generation{CallError: "timeout"}

	tests := []struct {
		name       string
		selector   evalpkg.Selector
		generation *sigilv1.Generation
		want       bool
	}{
		{name: "user_visible_turn_true", selector: evalpkg.SelectorUserVisibleTurn, generation: assistantText, want: true},
		{name: "user_visible_turn_false_on_tool_call", selector: evalpkg.SelectorUserVisibleTurn, generation: assistantToolCall, want: false},
		{name: "all_assistant_generations_true", selector: evalpkg.SelectorAllAssistantGenerations, generation: assistantText, want: true},
		{name: "tool_call_steps_true", selector: evalpkg.SelectorToolCallSteps, generation: assistantToolCall, want: true},
		{name: "errored_generations_true", selector: evalpkg.SelectorErroredGenerations, generation: errored, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := MatchesSelector(test.selector, test.generation)
			if got != test.want {
				t.Fatalf("expected %v, got %v", test.want, got)
			}
		})
	}
}

func TestMatchesSelectorHonorsVisibilityOverride(t *testing.T) {
	generation := &sigilv1.Generation{
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{Id: "call-1"}}}},
		}},
		Tags: map[string]string{"sigil.visibility": "user"},
	}
	if !MatchesSelector(evalpkg.SelectorUserVisibleTurn, generation) {
		t.Fatalf("expected user visibility override to force selection")
	}

	generation.Tags["sigil.visibility"] = "internal"
	if MatchesSelector(evalpkg.SelectorUserVisibleTurn, generation) {
		t.Fatalf("expected internal visibility override to disable selection")
	}
}
