package evaluators

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestHeuristicEvaluator(t *testing.T) {
	evaluator := NewHeuristicEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: "This is an answer"}, evalpkg.EvaluatorDefinition{
		Config: evalpkg.NewHeuristicConfig(evalpkg.HeuristicGroupNode{
			Operator: evalpkg.HeuristicOperatorAnd,
			Rules: []evalpkg.HeuristicNode{
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleNotEmpty}},
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleMinLength, IntValue: 5}},
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleMaxLength, IntValue: 100}},
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleContains, StringValue: "answer"}},
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleNotContains, StringValue: "forbidden"}},
			},
		}),
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
		Config: evalpkg.NewHeuristicConfig(evalpkg.HeuristicGroupNode{
			Operator: evalpkg.HeuristicOperatorAnd,
			Rules: []evalpkg.HeuristicNode{
				{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleNotEmpty}},
			},
		}),
		OutputKeys: []evalpkg.OutputKey{{Key: "heuristic_pass", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("evaluate heuristic fail: %v", err)
	}
	if outputs[0].Passed == nil || *outputs[0].Passed {
		t.Fatalf("expected heuristic failure")
	}
}
