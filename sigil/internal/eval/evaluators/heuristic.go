package evaluators

import (
	"context"
	"fmt"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type HeuristicEvaluator struct{}

func NewHeuristicEvaluator() *HeuristicEvaluator {
	return &HeuristicEvaluator{}
}

func (e *HeuristicEvaluator) Kind() evalpkg.EvaluatorKind {
	return evalpkg.EvaluatorKindHeuristic
}

func (e *HeuristicEvaluator) Evaluate(_ context.Context, input EvalInput, definition evalpkg.EvaluatorDefinition) ([]ScoreOutput, error) {
	text := strings.TrimSpace(input.ResponseText)
	length := len(text)

	notEmptyRequired := configBool(definition.Config, "not_empty", false)
	containsValues := configStringSlice(definition.Config, "contains")
	notContainsValues := configStringSlice(definition.Config, "not_contains")
	minLength, hasMinLength := configInt(definition.Config, "min_length")
	maxLength, hasMaxLength := configInt(definition.Config, "max_length")

	passed := true
	if notEmptyRequired {
		passed = text != ""
	}
	if hasMinLength && length < minLength {
		passed = false
	}
	if hasMaxLength && length > maxLength {
		passed = false
	}
	for _, needle := range containsValues {
		if !strings.Contains(strings.ToLower(text), strings.ToLower(needle)) {
			passed = false
			break
		}
	}
	for _, needle := range notContainsValues {
		if strings.Contains(strings.ToLower(text), strings.ToLower(needle)) {
			passed = false
			break
		}
	}

	meta := firstOutputKey(definition, "heuristic_pass", evalpkg.ScoreTypeBool)
	if meta.Type != evalpkg.ScoreTypeBool {
		return nil, evalpkg.Permanent(fmt.Errorf("heuristic evaluator output key %q must be bool", meta.Key))
	}

	metadata := map[string]any{"response_length": length}
	if hasMinLength {
		metadata["min_length"] = minLength
	}
	if hasMaxLength {
		metadata["max_length"] = maxLength
	}
	if len(containsValues) > 0 {
		metadata["contains"] = containsValues
	}
	if len(notContainsValues) > 0 {
		metadata["not_contains"] = notContainsValues
	}
	if notEmptyRequired {
		metadata["not_empty"] = true
	}

	return []ScoreOutput{{
		Key:      meta.Key,
		Type:     evalpkg.ScoreTypeBool,
		Value:    evalpkg.BoolValue(passed),
		Unit:     meta.Unit,
		Passed:   boolPointer(passed),
		Metadata: metadata,
	}}, nil
}

func configStringSlice(config map[string]any, key string) []string {
	if config == nil {
		return nil
	}
	raw, ok := config[key]
	if !ok {
		return nil
	}
	switch typed := raw.(type) {
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
			asString, ok := value.(string)
			if !ok {
				continue
			}
			if trimmed := strings.TrimSpace(asString); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	default:
		return nil
	}
}

func configInt(config map[string]any, key string) (int, bool) {
	if config == nil {
		return 0, false
	}
	raw, ok := config[key]
	if !ok {
		return 0, false
	}
	switch typed := raw.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}
