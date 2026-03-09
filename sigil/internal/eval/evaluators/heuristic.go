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

	config, err := evalpkg.ParseHeuristicConfig(definition.Config)
	if err != nil {
		return nil, evalpkg.Permanent(fmt.Errorf("heuristic evaluator config is invalid: %w", err))
	}
	passed := evaluateHeuristicNode(config.Root, text, length)

	meta := firstOutputKey(definition, "heuristic_pass", evalpkg.ScoreTypeBool)
	if meta.Type != evalpkg.ScoreTypeBool {
		return nil, evalpkg.Permanent(fmt.Errorf("heuristic evaluator output key %q must be bool", meta.Key))
	}

	metadata := map[string]any{
		"response_length": length,
		"version":         config.Version,
		"root":            config.Root.ToMap(),
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

func evaluateHeuristicNode(node evalpkg.HeuristicNode, text string, length int) bool {
	if node.Group != nil {
		switch node.Group.Operator {
		case evalpkg.HeuristicOperatorAnd:
			for _, child := range node.Group.Rules {
				if !evaluateHeuristicNode(child, text, length) {
					return false
				}
			}
			return true
		case evalpkg.HeuristicOperatorOr:
			for _, child := range node.Group.Rules {
				if evaluateHeuristicNode(child, text, length) {
					return true
				}
			}
			return false
		default:
			return false
		}
	}

	switch node.Rule.Type {
	case evalpkg.HeuristicRuleNotEmpty:
		return text != ""
	case evalpkg.HeuristicRuleContains:
		return strings.Contains(strings.ToLower(text), strings.ToLower(node.Rule.StringValue))
	case evalpkg.HeuristicRuleNotContains:
		return !strings.Contains(strings.ToLower(text), strings.ToLower(node.Rule.StringValue))
	case evalpkg.HeuristicRuleMinLength:
		return length >= node.Rule.IntValue
	case evalpkg.HeuristicRuleMaxLength:
		return length <= node.Rule.IntValue
	default:
		return false
	}
}
