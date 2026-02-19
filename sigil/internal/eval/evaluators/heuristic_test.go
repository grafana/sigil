package evaluators

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestHeuristicEvaluator(t *testing.T) {
	evaluator := NewHeuristicEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: "This is an answer"}, evalpkg.EvaluatorDefinition{
		Config: map[string]any{
			"not_empty":    true,
			"min_length":   5,
			"max_length":   100,
			"contains":     []any{"answer"},
			"not_contains": []any{"forbidden"},
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "heuristic_pass", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("evaluate heuristic: %v", err)
	}
	if outputs[0].Passed == nil || !*outputs[0].Passed {
		t.Fatalf("expected heuristic pass")
	}
}

func TestHeuristicEvaluatorFail(t *testing.T) {
	evaluator := NewHeuristicEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: ""}, evalpkg.EvaluatorDefinition{
		Config:     map[string]any{"not_empty": true},
		OutputKeys: []evalpkg.OutputKey{{Key: "heuristic_pass", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("evaluate heuristic fail: %v", err)
	}
	if outputs[0].Passed == nil || *outputs[0].Passed {
		t.Fatalf("expected heuristic failure")
	}
}
