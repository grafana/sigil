package evaluators

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestJSONSchemaEvaluator(t *testing.T) {
	evaluator := NewJSONSchemaEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: `{"answer":"ok"}`}, evalpkg.EvaluatorDefinition{
		Config: map[string]any{
			"schema": map[string]any{
				"type":     "object",
				"required": []any{"answer"},
				"properties": map[string]any{
					"answer": map[string]any{"type": "string"},
				},
			},
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "json_valid", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("evaluate json schema: %v", err)
	}
	if outputs[0].Value.Bool == nil || !*outputs[0].Value.Bool {
		t.Fatalf("expected valid json result")
	}
}

func TestJSONSchemaEvaluatorInvalidJSON(t *testing.T) {
	evaluator := NewJSONSchemaEvaluator()
	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{ResponseText: `{"answer":}`}, evalpkg.EvaluatorDefinition{
		Config:     map[string]any{"schema": map[string]any{"type": "object"}},
		OutputKeys: []evalpkg.OutputKey{{Key: "json_valid", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("evaluate invalid json: %v", err)
	}
	if outputs[0].Value.Bool == nil || *outputs[0].Value.Bool {
		t.Fatalf("expected invalid json result")
	}
}
