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
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
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
			wantUserPrompt := "Latest user message:\nWhat is two plus two?\n\nAssistant response:\nIt is four."
			if gotUserPrompt != wantUserPrompt {
				t.Fatalf("expected default user prompt %q, got %q", wantUserPrompt, gotUserPrompt)
			}
		})
	}
}

func TestRenderTemplateUsesDeveloperFacingAliases(t *testing.T) {
	input := EvalInput{
		GenerationID:   "gen-1",
		ConversationID: "conv-1",
		Generation: &sigilv1.Generation{
			Id:             "gen-1",
			ConversationId: "conv-1",
			SystemPrompt:   "Be concise.",
			StopReason:     "end_turn",
			Tools: []*sigilv1.ToolDefinition{{
				Name:            "search",
				Type:            "function",
				Description:     "Search docs",
				InputSchemaJson: []byte(`{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}`),
			}},
			Input: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("First question")}},
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_TOOL, Parts: []*sigilv1.Part{toolResultPart("call-1", "search", `{"hits":2}`, false, "tool_result")}},
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("Final question")}},
			},
			Output: []*sigilv1.Message{{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
				Parts: []*sigilv1.Part{
					thinkingPart("Need to search first", "thinking"),
					toolCallPart("call-1", "search", `{"query":"sigil"}`, "tool_call"),
					textPart("Here is the answer."),
				},
			}},
		},
	}

	rendered := renderTemplate(strings.Join([]string{
		"Input={{input}}",
		"Output={{output}}",
		"Latest={{latest_user_message}}",
		"Response={{assistant_response}}",
		"System={{system_prompt}}",
		"Calls={{tool_calls}}",
		"Results={{tool_results}}",
		"Thinking={{assistant_thinking}}",
		"Sequence={{assistant_sequence}}",
		"CallError={{call_error}}",
		"Tools={{tools}}",
		"Stop={{stop_reason}}",
		"IDs={{generation_id}}/{{conversation_id}}",
	}, "\n"), input)

	checks := []string{
		"Input=Final question",
		"Output=Here is the answer.",
		"Latest=Final question",
		"Response=Here is the answer.",
		"System=Be concise.",
		"<tool_call name=\"search\" id=\"call-1\" provider_type=\"tool_call\">",
		"<tool_result name=\"search\" id=\"call-1\" provider_type=\"tool_result\">",
		"<thinking provider_type=\"thinking\">Need to search first</thinking>",
		"<text>Here is the answer.</text>",
		"<tool name=\"search\" type=\"function\">",
		"properties: limit, query; required: query",
		"Stop=end_turn",
		"IDs=gen-1/conv-1",
	}
	for _, check := range checks {
		if !strings.Contains(rendered, check) {
			t.Fatalf("expected rendered template to contain %q, got:\n%s", check, rendered)
		}
	}
}

func TestRenderTemplateKeepsSimpleVariablesComposableAndOmitsEmptyCompoundValues(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			Input: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("Hello")}},
			},
			Output: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT, Parts: []*sigilv1.Part{textPart("Hi there")}},
			},
		},
	}

	rendered := renderTemplate("The user said: {{latest_user_message}}\nTool calls:\n{{tool_calls}}\n\nTool results:\n{{tool_results}}", input)
	if strings.Contains(rendered, "<latest_user_message>") {
		t.Fatalf("expected simple variable to render as plain text, got %q", rendered)
	}
	if strings.Contains(rendered, "<tool_call") || strings.Contains(rendered, "<tool_result") {
		t.Fatalf("expected empty compound variables to omit tags, got %q", rendered)
	}
	if !strings.Contains(rendered, "The user said: Hello") {
		t.Fatalf("expected latest_user_message content, got %q", rendered)
	}
}

func TestRenderTemplateEscapesUserHistoryContent(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			Input: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("if a < b && c > d")}},
			},
		},
	}

	rendered := renderTemplate("History:\n{{user_history}}", input)
	if !strings.Contains(rendered, "<message index=\"1\">") {
		t.Fatalf("expected user_history message wrapper, got:\n%s", rendered)
	}
	if !strings.Contains(rendered, "if a &lt; b &amp;&amp; c &gt; d") {
		t.Fatalf("expected escaped user_history content, got:\n%s", rendered)
	}
	if strings.Contains(rendered, "if a < b && c > d\n</message>") {
		t.Fatalf("expected raw user_history content to be escaped inside tags, got:\n%s", rendered)
	}
}

func TestRenderTemplateLeavesUnsupportedAdvancedVariablesUntouched(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			Input:  []*sigilv1.Message{{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("Need a summary")}}},
			Output: []*sigilv1.Message{{Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT, Parts: []*sigilv1.Part{textPart("Here is the summary.")}}},
		},
	}

	rendered := renderTemplate("{{input_messages}} {{output_messages}} {{tools}} {{metadata}} {{response_model}}", input)
	for _, unresolved := range []string{
		"{{input_messages}}",
		"{{output_messages}}",
		"{{metadata}}",
		"{{response_model}}",
	} {
		if !strings.Contains(rendered, unresolved) {
			t.Fatalf("expected unsupported variable %q to remain untouched, got:\n%s", unresolved, rendered)
		}
	}
}

func TestRenderTemplateRendersStopReason(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			StopReason: "max_tokens",
		},
	}

	rendered := renderTemplate("Stop={{stop_reason}}", input)
	if !strings.Contains(rendered, "Stop=max_tokens") {
		t.Fatalf("expected stop_reason to resolve, got:\n%s", rendered)
	}
}

func TestRenderTemplateRendersErrorAlias(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			CallError: "provider timeout",
		},
	}

	rendered := renderTemplate("Error={{error}}", input)
	if !strings.Contains(rendered, "Error=provider timeout") {
		t.Fatalf("expected error alias to resolve, got:\n%s", rendered)
	}
}

func TestRenderTemplateRendersCompactTools(t *testing.T) {
	input := EvalInput{
		Generation: &sigilv1.Generation{
			Tools: []*sigilv1.ToolDefinition{
				{
					Name:            "search",
					Type:            "function",
					Description:     "Search docs",
					InputSchemaJson: []byte(`{"type":"object","properties":{"query":{"type":"string"},"filters":{"type":"object","properties":{"lang":{"type":"string"}}}},"required":["query"]}`),
				},
				{
					Name:            "opaque",
					InputSchemaJson: []byte(`not-json`),
				},
			},
		},
	}

	rendered := renderTemplate("Tools:\n{{tools}}", input)
	if !strings.Contains(rendered, "properties: filters, query; required: query") {
		t.Fatalf("expected compact schema summary, got:\n%s", rendered)
	}
	if strings.Contains(rendered, `"filters":{"type":"object"`) {
		t.Fatalf("expected full tool schema JSON to be omitted, got:\n%s", rendered)
	}
	if !strings.Contains(rendered, "<tool name=\"opaque\">") || !strings.Contains(rendered, "<input_schema_summary>schema_present=true</input_schema_summary>") {
		t.Fatalf("expected invalid schema fallback summary, got:\n%s", rendered)
	}
}

func TestLLMJudgeEvaluatorDefaultPromptUsesLatestUserMessageAlias(t *testing.T) {
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
		GenerationID:   "gen-1",
		ConversationID: "conv-1",
		Generation: &sigilv1.Generation{
			Id:             "gen-1",
			ConversationId: "conv-1",
			Input: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("Earlier question")}},
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{textPart("Latest question")}},
			},
			Output: []*sigilv1.Message{
				{Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT, Parts: []*sigilv1.Part{textPart("Latest answer")}},
			},
		},
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

	want := "Latest user message:\nLatest question\n\nAssistant response:\nLatest answer"
	if gotUserPrompt != want {
		t.Fatalf("expected default user prompt %q, got %q", want, gotUserPrompt)
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

func textPart(value string) *sigilv1.Part {
	return &sigilv1.Part{Payload: &sigilv1.Part_Text{Text: value}}
}

func thinkingPart(value, providerType string) *sigilv1.Part {
	return &sigilv1.Part{
		Metadata: &sigilv1.PartMetadata{ProviderType: providerType},
		Payload:  &sigilv1.Part_Thinking{Thinking: value},
	}
}

func toolCallPart(id, name, inputJSON, providerType string) *sigilv1.Part {
	return &sigilv1.Part{
		Metadata: &sigilv1.PartMetadata{ProviderType: providerType},
		Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{
			Id:        id,
			Name:      name,
			InputJson: []byte(inputJSON),
		}},
	}
}

func toolResultPart(id, name, content string, isError bool, providerType string) *sigilv1.Part {
	return &sigilv1.Part{
		Metadata: &sigilv1.PartMetadata{ProviderType: providerType},
		Payload: &sigilv1.Part_ToolResult{ToolResult: &sigilv1.ToolResult{
			ToolCallId: id,
			Name:       name,
			Content:    content,
			IsError:    isError,
		}},
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
