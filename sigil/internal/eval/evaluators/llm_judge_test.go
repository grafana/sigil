package evaluators

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
)

func TestLLMJudgeEvaluatorParsesNumericJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"score\":0.82,\"passed\":true,\"explanation\":\"good\"}"}}],"model":"judge-model","usage":{"prompt_tokens":12,"completion_tokens":8}}`))
	}))
	defer server.Close()

	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
	discovery := judges.DiscoverFromEnv()
	evaluator := NewLLMJudgeEvaluator(discovery, "openai-compat/judge-model")

	outputs, err := evaluator.Evaluate(context.Background(), EvalInput{
		InputText:    "What is two plus two?",
		ResponseText: "It is four.",
	}, evalpkg.EvaluatorDefinition{
		Kind: evalpkg.EvaluatorKindLLMJudge,
		Config: map[string]any{
			"provider":      "openai-compat",
			"model":         "judge-model",
			"system_prompt": "Judge this answer",
			"user_prompt":   "Question: {{input}}\nAnswer: {{output}}",
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("evaluate llm judge: %v", err)
	}
	if len(outputs) != 1 {
		t.Fatalf("expected one output, got %d", len(outputs))
	}
	if outputs[0].Value.Number == nil || *outputs[0].Value.Number != 0.82 {
		t.Fatalf("expected score 0.82, got %#v", outputs[0].Value)
	}
	if outputs[0].Passed == nil || !*outputs[0].Passed {
		t.Fatalf("expected passed=true")
	}
}
