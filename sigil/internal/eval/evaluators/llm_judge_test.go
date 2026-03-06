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

			wantSystemPrompt := defaultLLMJudgeSystemPrompt
			if gotSystemPrompt != wantSystemPrompt {
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
			value, passed, _, err := parseJudgeResponse(tc.raw, "score", evalpkg.ScoreTypeBool)
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
			// parseJudgeResponse no longer infers passed from the bool value;
			// the caller applies PassValue logic instead.
			if passed != nil {
				t.Fatalf("expected passed=nil (caller infers), got %v", *passed)
			}
		})
	}
}

func TestParseJudgeResponseRejectsMalformedJSONSchemaWithoutFallback(t *testing.T) {
	_, _, _, err := parseJudgeResponse(`{"explanation":"score looked like 0.7"}`, "score", evalpkg.ScoreTypeNumber)
	if err == nil {
		t.Fatalf("expected malformed JSON schema response to fail")
	}
	if !strings.Contains(err.Error(), "did not include score") {
		t.Fatalf("expected missing score error, got %v", err)
	}
}

func TestBuildJudgeSchema(t *testing.T) {
	tests := []struct {
		name string
		keys []evalpkg.OutputKey
		want map[string]any
	}{
		{
			name: "nil_keys_returns_nil",
			keys: nil,
			want: nil,
		},
		{
			name: "empty_keys_returns_nil",
			keys: []evalpkg.OutputKey{},
			want: nil,
		},
		{
			name: "number_score",
			keys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
			want: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"explanation": map[string]any{"type": "string"},
					"helpfulness": map[string]any{"type": "number"},
				},
				"required":             []string{"explanation", "helpfulness"},
				"additionalProperties": false,
			},
		},
		{
			name: "bool_score",
			keys: []evalpkg.OutputKey{{Key: "toxic", Type: evalpkg.ScoreTypeBool}},
			want: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"explanation": map[string]any{"type": "string"},
					"toxic":       map[string]any{"type": "boolean"},
				},
				"required":             []string{"explanation", "toxic"},
				"additionalProperties": false,
			},
		},
		{
			name: "string_with_enum",
			keys: []evalpkg.OutputKey{{Key: "severity", Type: evalpkg.ScoreTypeString, Enum: []string{"none", "mild", "severe"}}},
			want: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"explanation": map[string]any{"type": "string"},
					"severity":    map[string]any{"type": "string", "enum": []string{"none", "mild", "severe"}},
				},
				"required":             []string{"explanation", "severity"},
				"additionalProperties": false,
			},
		},
		{
			name: "explanation_key_is_reserved",
			keys: []evalpkg.OutputKey{{Key: "explanation", Type: evalpkg.ScoreTypeNumber}},
			want: nil,
		},
		{
			name: "with_description",
			keys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber, Description: "Helpfulness score from 0 to 1"}},
			want: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"explanation": map[string]any{"type": "string"},
					"score":       map[string]any{"type": "number", "description": "Helpfulness score from 0 to 1"},
				},
				"required":             []string{"explanation", "score"},
				"additionalProperties": false,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := BuildJudgeSchema(tc.keys)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("expected nil schema, got %v", got)
				}
				return
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(tc.want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("schema mismatch:\ngot:  %s\nwant: %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestLLMJudgeEvaluatorSendsResponseFormat(t *testing.T) {
	var gotResponseFormat map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if rf, ok := payload["response_format"]; ok {
			if rfMap, ok := rf.(map[string]any); ok {
				gotResponseFormat = rfMap
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"helpfulness\":0.9,\"explanation\":\"great\"}"}}],"model":"judge-model","usage":{"prompt_tokens":12,"completion_tokens":8}}`))
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
		Kind: evalpkg.EvaluatorKindLLMJudge,
		Config: map[string]any{
			"provider": "openai-compat",
			"model":    "judge-model",
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("evaluate llm judge: %v", err)
	}
	if gotResponseFormat == nil {
		t.Fatal("expected response_format to be sent in request")
	}
	if gotResponseFormat["type"] != "json_schema" {
		t.Fatalf("expected response_format.type=json_schema, got %v", gotResponseFormat["type"])
	}
	jsonSchema, ok := gotResponseFormat["json_schema"].(map[string]any)
	if !ok {
		t.Fatal("expected response_format.json_schema to be an object")
	}
	if jsonSchema["strict"] != true {
		t.Fatalf("expected strict=true, got %v", jsonSchema["strict"])
	}
}

func TestParseJudgeResponseStructuredOutputKeyLookup(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		scoreKey  string
		scoreType evalpkg.ScoreType
		wantScore float64
		wantExpl  string
	}{
		{
			name:      "key_name_instead_of_score",
			raw:       `{"helpfulness": 0.85, "explanation": "very clear"}`,
			scoreKey:  "helpfulness",
			scoreType: evalpkg.ScoreTypeNumber,
			wantScore: 0.85,
			wantExpl:  "very clear",
		},
		{
			name:      "legacy_score_field_still_works",
			raw:       `{"score": 0.72, "explanation": "ok"}`,
			scoreKey:  "helpfulness",
			scoreType: evalpkg.ScoreTypeNumber,
			wantScore: 0.72,
			wantExpl:  "ok",
		},
		{
			name:      "score_field_takes_precedence",
			raw:       `{"score": 0.5, "helpfulness": 0.9, "explanation": "both present"}`,
			scoreKey:  "helpfulness",
			scoreType: evalpkg.ScoreTypeNumber,
			wantScore: 0.5,
			wantExpl:  "both present",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value, _, explanation, err := parseJudgeResponse(tc.raw, tc.scoreKey, tc.scoreType)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if value.Number == nil || *value.Number != tc.wantScore {
				t.Fatalf("expected score %v, got %v", tc.wantScore, value)
			}
			if explanation != tc.wantExpl {
				t.Fatalf("expected explanation %q, got %q", tc.wantExpl, explanation)
			}
		})
	}
}

func TestLLMJudgeEvaluatorStringPassMatchDerived(t *testing.T) {
	tests := []struct {
		name       string
		judgeReply string
		passMatch  []string
		wantPassed *bool
		wantValue  string
	}{
		{
			name:       "matching_value_passes",
			judgeReply: `{"severity":"none","explanation":"no issues"}`,
			passMatch:  []string{"none", "mild"},
			wantPassed: boolPointer(true),
			wantValue:  "none",
		},
		{
			name:       "non_matching_value_fails",
			judgeReply: `{"severity":"severe","explanation":"very bad"}`,
			passMatch:  []string{"none", "mild"},
			wantPassed: boolPointer(false),
			wantValue:  "severe",
		},
		{
			name:       "no_pass_match_leaves_passed_nil",
			judgeReply: `{"severity":"moderate","explanation":"some issues"}`,
			passMatch:  nil,
			wantPassed: nil,
			wantValue:  "moderate",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				reply := map[string]any{
					"choices": []map[string]any{{
						"message": map[string]any{"content": tc.judgeReply},
					}},
					"model": "judge-model",
					"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 8},
				}
				replyBytes, _ := json.Marshal(reply)
				_, _ = w.Write(replyBytes)
			}))
			defer server.Close()

			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_ENABLED", "true")
			discovery := judges.DiscoverFromEnv()
			evaluator := NewLLMJudgeEvaluator(discovery, "openai-compat/judge-model")

			outputs, err := evaluator.Evaluate(context.Background(), EvalInput{
				InputText:    "Evaluate this.",
				ResponseText: "Some response.",
			}, evalpkg.EvaluatorDefinition{
				Kind: evalpkg.EvaluatorKindLLMJudge,
				Config: map[string]any{
					"provider":      "openai-compat",
					"model":         "judge-model",
					"system_prompt": "Judge the severity",
					"user_prompt":   "Input: {{input}}\nOutput: {{output}}",
				},
				OutputKeys: []evalpkg.OutputKey{{
					Key:       "severity",
					Type:      evalpkg.ScoreTypeString,
					PassMatch: tc.passMatch,
				}},
			})
			if err != nil {
				t.Fatalf("evaluate: %v", err)
			}
			if len(outputs) != 1 {
				t.Fatalf("expected 1 output, got %d", len(outputs))
			}
			out := outputs[0]
			if out.Value.String == nil || *out.Value.String != tc.wantValue {
				t.Fatalf("expected value %q, got %v", tc.wantValue, out.Value)
			}
			if tc.wantPassed == nil {
				if out.Passed != nil {
					t.Fatalf("expected passed=nil, got %v", *out.Passed)
				}
			} else {
				if out.Passed == nil {
					t.Fatalf("expected passed=%v, got nil", *tc.wantPassed)
				}
				if *out.Passed != *tc.wantPassed {
					t.Fatalf("expected passed=%v, got %v", *tc.wantPassed, *out.Passed)
				}
			}
		})
	}
}

func TestLLMJudgeEvaluatorBoolPassValue(t *testing.T) {
	tests := []struct {
		name       string
		judgeReply string
		passValue  *bool
		wantPassed *bool
	}{
		{
			name:       "default_true_passes",
			judgeReply: `{"toxicity":true,"explanation":"toxic"}`,
			passValue:  nil,
			wantPassed: boolPointer(true),
		},
		{
			name:       "default_false_fails",
			judgeReply: `{"toxicity":false,"explanation":"clean"}`,
			passValue:  nil,
			wantPassed: boolPointer(false),
		},
		{
			name:       "pass_value_false_inverts_false_passes",
			judgeReply: `{"toxicity":false,"explanation":"clean"}`,
			passValue:  boolPointer(false),
			wantPassed: boolPointer(true),
		},
		{
			name:       "pass_value_false_inverts_true_fails",
			judgeReply: `{"toxicity":true,"explanation":"toxic"}`,
			passValue:  boolPointer(false),
			wantPassed: boolPointer(false),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				reply := map[string]any{
					"choices": []map[string]any{{
						"message": map[string]any{"content": tc.judgeReply},
					}},
					"model": "judge-model",
					"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 8},
				}
				replyBytes, _ := json.Marshal(reply)
				_, _ = w.Write(replyBytes)
			}))
			defer server.Close()

			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
			t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_ENABLED", "true")
			discovery := judges.DiscoverFromEnv()
			evaluator := NewLLMJudgeEvaluator(discovery, "openai-compat/judge-model")

			outputs, err := evaluator.Evaluate(context.Background(), EvalInput{
				InputText:    "Evaluate this.",
				ResponseText: "Some response.",
			}, evalpkg.EvaluatorDefinition{
				Kind: evalpkg.EvaluatorKindLLMJudge,
				Config: map[string]any{
					"provider": "openai-compat",
					"model":    "judge-model",
				},
				OutputKeys: []evalpkg.OutputKey{{
					Key:       "toxicity",
					Type:      evalpkg.ScoreTypeBool,
					PassValue: tc.passValue,
				}},
			})
			if err != nil {
				t.Fatalf("evaluate: %v", err)
			}
			if len(outputs) != 1 {
				t.Fatalf("expected 1 output, got %d", len(outputs))
			}
			out := outputs[0]
			if tc.wantPassed == nil {
				if out.Passed != nil {
					t.Fatalf("expected passed=nil, got %v", *out.Passed)
				}
			} else {
				if out.Passed == nil {
					t.Fatalf("expected passed=%v, got nil", *tc.wantPassed)
				}
				if *out.Passed != *tc.wantPassed {
					t.Fatalf("expected passed=%v, got %v", *tc.wantPassed, *out.Passed)
				}
			}
		})
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
