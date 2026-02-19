package evaluators

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestRegexEvaluator(t *testing.T) {
	evaluator := NewRegexEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: "hello world"}, evalpkg.EvaluatorDefinition{
		Config: map[string]any{"pattern": "hello"},
		OutputKeys: []evalpkg.OutputKey{
			{Key: "regex_match", Type: evalpkg.ScoreTypeBool},
		},
	})
	if err != nil {
		t.Fatalf("evaluate regex: %v", err)
	}
	if len(outputs) != 1 {
		t.Fatalf("expected one output")
	}
	if outputs[0].Value.Bool == nil || !*outputs[0].Value.Bool {
		t.Fatalf("expected regex match true, got %#v", outputs[0].Value)
	}
	if outputs[0].Passed == nil || !*outputs[0].Passed {
		t.Fatalf("expected pass=true")
	}
}

func TestRegexEvaluatorRejectMode(t *testing.T) {
	evaluator := NewRegexEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: "hello world"}, evalpkg.EvaluatorDefinition{
		Config: map[string]any{"pattern": "forbidden", "reject": true},
		OutputKeys: []evalpkg.OutputKey{
			{Key: "regex_match", Type: evalpkg.ScoreTypeBool},
		},
	})
	if err != nil {
		t.Fatalf("evaluate regex reject mode: %v", err)
	}
	if outputs[0].Passed == nil || !*outputs[0].Passed {
		t.Fatalf("expected pass=true when reject mode pattern did not match")
	}
	if outputs[0].Value.Bool == nil || !*outputs[0].Value.Bool {
		t.Fatalf("expected score value=true when reject mode passes, got %#v", outputs[0].Value)
	}

	outputs, err = evaluator.Evaluate(context.Background(), EvalInput{ResponseText: "contains forbidden text"}, evalpkg.EvaluatorDefinition{
		Config: map[string]any{"pattern": "forbidden", "reject": true},
		OutputKeys: []evalpkg.OutputKey{
			{Key: "regex_match", Type: evalpkg.ScoreTypeBool},
		},
	})
	if err != nil {
		t.Fatalf("evaluate regex reject mode (matched): %v", err)
	}
	if outputs[0].Passed == nil || *outputs[0].Passed {
		t.Fatalf("expected pass=false when reject mode pattern matched")
	}
	if outputs[0].Value.Bool == nil || *outputs[0].Value.Bool {
		t.Fatalf("expected score value=false when reject mode fails, got %#v", outputs[0].Value)
	}
}
