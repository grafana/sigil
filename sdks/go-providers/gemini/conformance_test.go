package gemini

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/genai"

	sigil "github.com/grafana/sigil/sdks/go/sigil"
	"github.com/grafana/sigil/sdks/go/sigil/sigiltest"
)

const (
	geminiSpanErrorCategory = "error.category"
	geminiSpanInputCount    = "gen_ai.embeddings.input_count"
	geminiSpanDimCount      = "gen_ai.embeddings.dimension.count"
)

func TestConformance_GeminiSyncMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	model, contents, config := geminiConformanceRequest()
	resp := &genai.GenerateContentResponse{
		ResponseID:   "resp_gemini_sync",
		ModelVersion: "gemini-2.5-pro-001",
		Candidates: []*genai.Candidate{
			{
				FinishReason: genai.FinishReasonStop,
				Content: genai.NewContentFromParts([]*genai.Part{
					{Text: "need weather tool", Thought: true},
					{
						FunctionCall: &genai.FunctionCall{
							ID:   "call_weather",
							Name: "weather",
							Args: map[string]any{"city": "Paris"},
						},
					},
					genai.NewPartFromText("It is 18C and sunny."),
				}, genai.RoleModel),
			},
		},
		UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
			PromptTokenCount:        120,
			CandidatesTokenCount:    40,
			TotalTokenCount:         170,
			CachedContentTokenCount: 12,
			ThoughtsTokenCount:      10,
			ToolUsePromptTokenCount: 9,
		},
	}
	start := sigil.GenerationStart{
		ConversationID:    "conv-gemini-sync",
		ConversationTitle: "Gemini sync",
		AgentName:         "agent-gemini",
		AgentVersion:      "v-gemini",
		Model:             sigil.ModelRef{Provider: "gemini", Name: model},
	}

	generation, err := FromRequestResponse(
		model,
		contents,
		config,
		resp,
		WithConversationID(start.ConversationID),
		WithConversationTitle(start.ConversationTitle),
		WithAgentName(start.AgentName),
		WithAgentVersion(start.AgentVersion),
		WithTag("tenant", "t-gemini"),
	)
	sigiltest.RecordGeneration(t, env, start, generation, err)
	env.Shutdown(t)

	exported := env.SingleGenerationJSON(t)

	if got := sigiltest.StringValue(t, exported, "mode"); got != "GENERATION_MODE_SYNC" {
		t.Fatalf("unexpected mode: got %q want %q\n%s", got, "GENERATION_MODE_SYNC", sigiltest.DebugJSON(exported))
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "STOP" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "STOP")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 0, "thinking"); got != "need weather tool" {
		t.Fatalf("unexpected thinking part: got %q want %q", got, "need weather tool")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 1, "tool_call", "name"); got != "weather" {
		t.Fatalf("unexpected tool_call.name: got %q want %q", got, "weather")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 2, "text"); got != "It is 18C and sunny." {
		t.Fatalf("unexpected output text: got %q want %q", got, "It is 18C and sunny.")
	}
	if got := sigiltest.StringValue(t, exported, "input", 1, "role"); got != "MESSAGE_ROLE_TOOL" {
		t.Fatalf("unexpected tool input role: got %q want %q", got, "MESSAGE_ROLE_TOOL")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "reasoning_tokens"); got != "10" {
		t.Fatalf("unexpected usage.reasoning_tokens: got %q want %q", got, "10")
	}
	if got := sigiltest.FloatValue(t, exported, "metadata", "sigil.gen_ai.usage.tool_use_prompt_tokens"); got != 9 {
		t.Fatalf("unexpected tool_use_prompt_tokens: got %v want %v", got, float64(9))
	}
}

func TestConformance_GeminiStreamMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	model, contents, config := geminiConformanceRequest()
	summary := StreamSummary{
		FirstChunkAt: time.Unix(1_741_780_200, 0).UTC(),
		Responses: []*genai.GenerateContentResponse{
			{
				ResponseID:   "resp_gemini_stream_1",
				ModelVersion: "gemini-2.5-pro-001",
				Candidates: []*genai.Candidate{
					{
						Content: genai.NewContentFromParts([]*genai.Part{
							{Text: "need weather tool", Thought: true},
							{
								FunctionCall: &genai.FunctionCall{
									ID:   "call_weather",
									Name: "weather",
									Args: map[string]any{"city": "Paris"},
								},
							},
						}, genai.RoleModel),
					},
				},
			},
			{
				ResponseID:   "resp_gemini_stream_2",
				ModelVersion: "gemini-2.5-pro-001",
				Candidates: []*genai.Candidate{
					{
						FinishReason: genai.FinishReasonStop,
						Content:      genai.NewContentFromText("It is 18C and sunny.", genai.RoleModel),
					},
				},
				UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
					PromptTokenCount:        20,
					CandidatesTokenCount:    6,
					TotalTokenCount:         31,
					ThoughtsTokenCount:      4,
					ToolUsePromptTokenCount: 5,
				},
			},
		},
	}
	start := sigil.GenerationStart{
		ConversationID: "conv-gemini-stream",
		AgentName:      "agent-gemini-stream",
		AgentVersion:   "v-gemini-stream",
		Model:          sigil.ModelRef{Provider: "gemini", Name: model},
	}

	generation, err := FromStream(
		model,
		contents,
		config,
		summary,
		WithConversationID(start.ConversationID),
		WithAgentName(start.AgentName),
		WithAgentVersion(start.AgentVersion),
	)
	sigiltest.RecordStreamingGeneration(t, env, start, summary.FirstChunkAt, generation, err)
	env.Shutdown(t)

	exported := env.SingleGenerationJSON(t)

	if got := sigiltest.StringValue(t, exported, "mode"); got != "GENERATION_MODE_STREAM" {
		t.Fatalf("unexpected mode: got %q want %q\n%s", got, "GENERATION_MODE_STREAM", sigiltest.DebugJSON(exported))
	}
	if got := sigiltest.StringValue(t, exported, "response_id"); got != "resp_gemini_stream_2" {
		t.Fatalf("unexpected response_id: got %q want %q", got, "resp_gemini_stream_2")
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "STOP" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "STOP")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 0, "thinking"); got != "need weather tool" {
		t.Fatalf("unexpected streamed thinking part: got %q want %q", got, "need weather tool")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 1, "tool_call", "name"); got != "weather" {
		t.Fatalf("unexpected streamed tool_call.name: got %q want %q", got, "weather")
	}
	if got := sigiltest.StringValue(t, exported, "output", 1, "parts", 0, "text"); got != "It is 18C and sunny." {
		t.Fatalf("unexpected streamed output text: got %q want %q", got, "It is 18C and sunny.")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "total_tokens"); got != "31" {
		t.Fatalf("unexpected usage.total_tokens: got %q want %q", got, "31")
	}
}

func TestConformance_GeminiErrorMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	sigiltest.RecordCallError(t, env, sigil.GenerationStart{
		Model: sigil.ModelRef{Provider: "gemini", Name: "gemini-2.5-pro"},
	}, genai.APIError{Code: 429, Message: "rate limited", Status: "RESOURCE_EXHAUSTED"})

	span := sigiltest.FindSpan(t, env.Spans.Ended(), "generateText gemini-2.5-pro")
	attrs := sigiltest.SpanAttributes(span)
	if got := attrs[geminiSpanErrorCategory].AsString(); got != "rate_limit" {
		t.Fatalf("unexpected error.category: got %q want %q", got, "rate_limit")
	}

	env.Shutdown(t)
	exported := env.SingleGenerationJSON(t)
	callError := sigiltest.StringValue(t, exported, "call_error")
	if !strings.Contains(callError, "429") {
		t.Fatalf("expected call_error to include status code, got %q", callError)
	}
}

func TestConformance_GeminiEmbeddingMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	model := "gemini-embedding-001"
	contents := []*genai.Content{
		genai.NewContentFromText("hello", genai.RoleUser),
		genai.NewContentFromText("world", genai.RoleUser),
	}
	dimensions := int32(3)
	config := &genai.EmbedContentConfig{
		OutputDimensionality: &dimensions,
	}
	resp := &genai.EmbedContentResponse{
		Embeddings: []*genai.ContentEmbedding{
			{
				Values: []float32{0.1, 0.2, 0.3},
				Statistics: &genai.ContentEmbeddingStatistics{
					TokenCount: 2,
				},
			},
			{
				Values: []float32{0.4, 0.5, 0.6},
				Statistics: &genai.ContentEmbeddingStatistics{
					TokenCount: 2,
				},
			},
		},
	}
	startDimensions := int64(dimensions)
	sigiltest.RecordEmbedding(t, env, sigil.EmbeddingStart{
		Model:        sigil.ModelRef{Provider: "gemini", Name: model},
		AgentName:    "agent-gemini-embed",
		AgentVersion: "v-gemini-embed",
		Dimensions:   &startDimensions,
	}, EmbeddingFromResponse(model, contents, config, resp))

	span := sigiltest.FindSpan(t, env.Spans.Ended(), "embeddings gemini-embedding-001")
	attrs := sigiltest.SpanAttributes(span)
	if got := attrs[geminiSpanInputCount].AsInt64(); got != 2 {
		t.Fatalf("unexpected gen_ai.embeddings.input_count: got %d want %d", got, 2)
	}
	if got := attrs[geminiSpanDimCount].AsInt64(); got != 3 {
		t.Fatalf("unexpected gen_ai.embeddings.dimension.count: got %d want %d", got, 3)
	}

	env.Shutdown(t)
	sigiltest.RequireRequestCount(t, env, 0)
}

func geminiConformanceRequest() (string, []*genai.Content, *genai.GenerateContentConfig) {
	temperature := float32(0.4)
	topP := float32(0.75)
	thinkingBudget := int32(2048)
	model := "gemini-2.5-pro"
	contents := []*genai.Content{
		genai.NewContentFromText("What is the weather in Paris?", genai.RoleUser),
		genai.NewContentFromParts([]*genai.Part{
			genai.NewPartFromFunctionResponse("weather", map[string]any{
				"temp_c": 18,
			}),
		}, genai.RoleUser),
	}
	config := &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText("Be concise.", genai.RoleUser),
		MaxOutputTokens:   300,
		Temperature:       &temperature,
		TopP:              &topP,
		ToolConfig: &genai.ToolConfig{
			FunctionCallingConfig: &genai.FunctionCallingConfig{
				Mode: genai.FunctionCallingConfigModeAny,
			},
		},
		ThinkingConfig: &genai.ThinkingConfig{
			IncludeThoughts: true,
			ThinkingBudget:  &thinkingBudget,
			ThinkingLevel:   genai.ThinkingLevelHigh,
		},
		Tools: []*genai.Tool{
			{
				FunctionDeclarations: []*genai.FunctionDeclaration{
					{
						Name:        "weather",
						Description: "Get weather",
						ParametersJsonSchema: map[string]any{
							"type": "object",
							"properties": map[string]any{
								"city": map[string]any{"type": "string"},
							},
							"required": []string{"city"},
						},
					},
				},
			},
		},
	}
	return model, contents, config
}
