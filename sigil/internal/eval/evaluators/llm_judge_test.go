package evaluators

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_ENABLED", "true")
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

func TestLLMJudgeEvaluatorUsesLegacyDefaultPrompts(t *testing.T) {
	tests := []struct {
		name   string
		config map[string]any
	}{
		{
			name: "missing_prompts_use_defaults",
			config: map[string]any{
				"provider": "openai-compat",
				"model":    "judge-model",
			},
		},
		{
			name: "empty_prompts_use_defaults",
			config: map[string]any{
				"provider":      "openai-compat",
				"model":         "judge-model",
				"system_prompt": "   ",
				"user_prompt":   "",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gotSystemPrompt string
			var gotUserPrompt string

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				body, err := io.ReadAll(req.Body)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				var payload struct {
					Messages []struct {
						Role    string `json:"role"`
						Content string `json:"content"`
					} `json:"messages"`
				}
				if err := json.Unmarshal(body, &payload); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if len(payload.Messages) > 0 {
					gotSystemPrompt = payload.Messages[0].Content
				}
				if len(payload.Messages) > 1 {
					gotUserPrompt = payload.Messages[1].Content
				}

				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"1"}}],"model":"judge-model","usage":{"prompt_tokens":12,"completion_tokens":8}}`))
			}))
			defer server.Close()

			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_ENABLED", "true")
			discovery := judges.DiscoverFromEnv()
			evaluator := NewLLMJudgeEvaluator(discovery, "openai-compat/judge-model")

			_, err := evaluator.Evaluate(context.Background(), EvalInput{
				InputText:    "What is two plus two?",
				ResponseText: "It is four.",
			}, evalpkg.EvaluatorDefinition{
				Kind:       evalpkg.EvaluatorKindLLMJudge,
				Config:     tc.config,
				OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
			})
			if err != nil {
				t.Fatalf("evaluate llm judge: %v", err)
			}

			if gotSystemPrompt != "You are an evaluator." {
				t.Fatalf("expected default system prompt, got %q", gotSystemPrompt)
			}
			wantUserPrompt := "User input:\nWhat is two plus two?\n\nAssistant output:\nIt is four."
			if gotUserPrompt != wantUserPrompt {
				t.Fatalf("expected default user prompt %q, got %q", wantUserPrompt, gotUserPrompt)
			}
		})
	}
}

func TestParseJudgeResponseBoolFallback(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantValue bool
		wantErr   string
	}{
		{name: "plain_true", raw: "true", wantValue: true},
		{name: "plain_false", raw: "false", wantValue: false},
		{name: "quoted_true", raw: `"true"`, wantValue: true},
		{name: "quoted_true_with_punctuation", raw: `"true".`, wantValue: true},
		{name: "punctuated_false", raw: "false.", wantValue: false},
		{name: "ambiguous_not_true", raw: "not true", wantErr: "bool score"},
		{name: "mixed_text", raw: "this is true but also false", wantErr: "bool score"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value, passed, _, err := parseJudgeResponse(tc.raw, evalpkg.ScoreTypeBool)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
			if value.Bool == nil || *value.Bool != tc.wantValue {
				t.Fatalf("expected bool value=%v, got %#v", tc.wantValue, value)
			}
			if passed == nil || *passed != tc.wantValue {
				t.Fatalf("expected passed=%v, got %#v", tc.wantValue, passed)
			}
		})
	}
}

func TestParseJudgeResponseRejectsMalformedJSONSchemaWithoutFallback(t *testing.T) {
	_, _, _, err := parseJudgeResponse(`{"explanation":"score looked like 0.7"}`, evalpkg.ScoreTypeNumber)
	if err == nil {
		t.Fatalf("expected malformed JSON schema response to fail")
	}
	if !strings.Contains(err.Error(), "did not include score") {
		t.Fatalf("expected missing score error, got %v", err)
	}
}

func TestResolveJudgeTargetNormalizesProviderPrefixedModel(t *testing.T) {
	tests := []struct {
		name          string
		config        map[string]any
		defaultModel  string
		wantProvider  string
		wantModel     string
		wantErrSubstr string
	}{
		{
			name:         "uses_default_when_both_missing",
			config:       map[string]any{},
			defaultModel: "openai/gpt-4o-mini",
			wantProvider: "openai",
			wantModel:    "gpt-4o-mini",
		},
		{
			name: "provider_and_prefixed_model_match",
			config: map[string]any{
				"provider": "openai",
				"model":    "openai/gpt-4o-mini",
			},
			defaultModel: "openai/gpt-4o-mini",
			wantProvider: "openai",
			wantModel:    "gpt-4o-mini",
		},
		{
			name: "provider_and_prefixed_model_match_case_insensitive",
			config: map[string]any{
				"provider": "openai",
				"model":    "OpenAI/gpt-4o-mini",
			},
			defaultModel: "openai/gpt-4o-mini",
			wantProvider: "openai",
			wantModel:    "gpt-4o-mini",
		},
		{
			name: "provider_mismatch_is_rejected",
			config: map[string]any{
				"provider": "openai-compat",
				"model":    "openai/gpt-4o-mini",
			},
			defaultModel:  "openai/gpt-4o-mini",
			wantErrSubstr: "does not match provider",
		},
		{
			name: "provider_without_model_is_rejected",
			config: map[string]any{
				"provider": "anthropic",
			},
			defaultModel:  "openai/gpt-4o-mini",
			wantErrSubstr: "requires both provider and model",
		},
		{
			name: "model_without_provider_is_rejected",
			config: map[string]any{
				"model": "gpt-4o-mini",
			},
			defaultModel:  "openai/gpt-4o-mini",
			wantErrSubstr: "requires both provider and model",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			provider, model, err := resolveJudgeTarget(tc.config, tc.defaultModel)
			if tc.wantErrSubstr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErrSubstr) {
					t.Fatalf("expected error containing %q, got %v", tc.wantErrSubstr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolve judge target: %v", err)
			}
			if provider != tc.wantProvider {
				t.Fatalf("expected provider=%q, got %q", tc.wantProvider, provider)
			}
			if model != tc.wantModel {
				t.Fatalf("expected model=%q, got %q", tc.wantModel, model)
			}
		})
	}
}
