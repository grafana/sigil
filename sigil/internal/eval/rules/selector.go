package rules

import (
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func MatchesSelector(selector evalpkg.Selector, generation *sigilv1.Generation) bool {
	if generation == nil {
		return false
	}

	switch selector {
	case evalpkg.SelectorAllAssistantGenerations:
		return hasAssistantOutput(generation)
	case evalpkg.SelectorToolCallSteps:
		return hasToolCalls(generation)
	case evalpkg.SelectorErroredGenerations:
		return strings.TrimSpace(generation.GetCallError()) != ""
	case evalpkg.SelectorUserVisibleTurn, "":
		if visibilityOverride, ok := userVisibilityOverride(generation); ok {
			return visibilityOverride
		}
		return hasAssistantTextOutput(generation) && !hasToolCalls(generation)
	default:
		return false
	}
}

func userVisibilityOverride(generation *sigilv1.Generation) (bool, bool) {
	if generation == nil {
		return false, false
	}
	value := strings.ToLower(strings.TrimSpace(generation.GetTags()["sigil.visibility"]))
	switch value {
	case "user":
		return true, true
	case "internal":
		return false, true
	default:
		return false, false
	}
}

func hasAssistantOutput(generation *sigilv1.Generation) bool {
	for _, message := range generation.GetOutput() {
		if message.GetRole() == sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			return true
		}
	}
	return false
}

func hasAssistantTextOutput(generation *sigilv1.Generation) bool {
	for _, message := range generation.GetOutput() {
		if message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			continue
		}
		for _, part := range message.GetParts() {
			if strings.TrimSpace(part.GetText()) != "" {
				return true
			}
		}
	}
	return false
}

func hasToolCalls(generation *sigilv1.Generation) bool {
	for _, message := range generation.GetOutput() {
		for _, part := range message.GetParts() {
			if part.GetToolCall() != nil {
				return true
			}
		}
	}
	return false
}
