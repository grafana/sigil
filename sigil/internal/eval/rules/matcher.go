package rules

import (
	"path"
	"strings"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func MatchesRule(match map[string]any, generation *sigilv1.Generation) bool {
	if generation == nil {
		return false
	}
	if len(match) == 0 {
		return true
	}

	for key, rawExpected := range match {
		expectedValues := normalizeExpectedValues(rawExpected)
		if len(expectedValues) == 0 {
			return false
		}

		switch {
		case key == "agent_name":
			if !matchesGlobAny(generation.GetAgentName(), expectedValues) {
				return false
			}
		case key == "agent_version":
			if !matchesGlobAny(generation.GetAgentVersion(), expectedValues) {
				return false
			}
		case key == "operation_name":
			if !matchesGlobAny(generation.GetOperationName(), expectedValues) {
				return false
			}
		case key == "model.provider":
			if !matchesGlobAny(generation.GetModel().GetProvider(), expectedValues) {
				return false
			}
		case key == "model.name":
			if !matchesGlobAny(generation.GetModel().GetName(), expectedValues) {
				return false
			}
		case key == "mode":
			if !matchesExactAny(normalizeMode(generation.GetMode().String()), expectedValues) {
				return false
			}
		case strings.HasPrefix(key, "tags."):
			tagKey := strings.TrimPrefix(key, "tags.")
			if tagKey == "" {
				return false
			}
			if !matchesExactAny(generation.GetTags()[tagKey], expectedValues) {
				return false
			}
		case key == "error.type", key == "error.category":
			errorValue := resolveErrorMatchValue(generation, key)
			if !matchesErrorExpectation(errorValue, expectedValues) {
				return false
			}
		default:
			return false
		}
	}

	return true
}

func matchesErrorExpectation(actualError string, expectedValues []string) bool {
	trimmedActual := strings.TrimSpace(actualError)
	hasError := trimmedActual != ""

	for _, expected := range expectedValues {
		switch strings.ToLower(strings.TrimSpace(expected)) {
		case "present", "true", "1", "*":
			if hasError {
				return true
			}
		case "absent", "false", "0":
			if !hasError {
				return true
			}
		default:
			if hasError && strings.EqualFold(expected, "error") {
				return true
			}
			if strings.EqualFold(trimmedActual, strings.TrimSpace(expected)) {
				return true
			}
		}
	}
	return false
}

func resolveErrorMatchValue(generation *sigilv1.Generation, key string) string {
	if generation == nil {
		return ""
	}

	candidates := []string{
		generation.GetTags()[key],
		metadataFieldString(generation, key),
	}
	switch key {
	case "error.type":
		candidates = append(candidates, generation.GetTags()["span.error.type"], metadataFieldString(generation, "span.error.type"))
	case "error.category":
		candidates = append(candidates, generation.GetTags()["span.error.category"], metadataFieldString(generation, "span.error.category"))
	}
	candidates = append(candidates, generation.GetCallError())

	for _, candidate := range candidates {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func metadataFieldString(generation *sigilv1.Generation, key string) string {
	if generation == nil || strings.TrimSpace(key) == "" {
		return ""
	}
	metadata := generation.GetMetadata()
	if metadata == nil {
		return ""
	}
	fields := metadata.GetFields()
	value, ok := fields[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(value.GetStringValue())
}

func normalizeExpectedValues(raw any) []string {
	switch typed := raw.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		return []string{trimmed}
	case []string:
		out := make([]string, 0, len(typed))
		for _, value := range typed {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(typed))
		for _, value := range typed {
			if asString, ok := value.(string); ok {
				if trimmed := strings.TrimSpace(asString); trimmed != "" {
					out = append(out, trimmed)
				}
			}
		}
		return out
	default:
		return nil
	}
}

func matchesGlobAny(actual string, patterns []string) bool {
	trimmedActual := strings.TrimSpace(strings.ToLower(actual))
	for _, pattern := range patterns {
		trimmedPattern := strings.TrimSpace(strings.ToLower(pattern))
		if trimmedPattern == "" || !strings.ContainsAny(trimmedPattern, "*?[") {
			continue
		}
		if _, err := path.Match(trimmedPattern, ""); err != nil {
			return false
		}
	}

	for _, pattern := range patterns {
		trimmedPattern := strings.TrimSpace(strings.ToLower(pattern))
		if trimmedPattern == "" {
			continue
		}
		if !strings.ContainsAny(trimmedPattern, "*?[") {
			if trimmedActual == trimmedPattern {
				return true
			}
			continue
		}
		matched, err := path.Match(trimmedPattern, trimmedActual)
		if err != nil {
			return false
		}
		if matched {
			return true
		}
	}
	return false
}

func matchesExactAny(actual string, expected []string) bool {
	trimmedActual := strings.TrimSpace(strings.ToLower(actual))
	for _, value := range expected {
		if trimmedActual == strings.TrimSpace(strings.ToLower(value)) {
			return true
		}
	}
	return false
}

func normalizeMode(mode string) string {
	value := strings.ToUpper(strings.TrimSpace(mode))
	value = strings.TrimPrefix(value, "GENERATION_MODE_")
	return value
}
