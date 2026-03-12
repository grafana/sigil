package openai

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	osdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"

	sigil "github.com/grafana/sigil/sdks/go/sigil"
	"github.com/grafana/sigil/sdks/go/sigil/sigiltest"
)

const (
	openAISpanErrorCategory = "error.category"
	openAISpanInputCount    = "gen_ai.embeddings.input_count"
	openAISpanDimCount      = "gen_ai.embeddings.dimension.count"
)

func TestConformance_OpenAIResponsesSyncMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	req := openAIResponsesRequest()
	resp := openAIResponsesResponse()
	start := sigil.GenerationStart{
		ConversationID:    "conv-openai-sync",
		ConversationTitle: "OpenAI responses sync",
		AgentName:         "agent-openai",
		AgentVersion:      "v-openai",
		Model:             sigil.ModelRef{Provider: "openai", Name: string(req.Model)},
	}

	generation, err := ResponsesFromRequestResponse(
		req,
		resp,
		WithConversationID(start.ConversationID),
		WithConversationTitle(start.ConversationTitle),
		WithAgentName(start.AgentName),
		WithAgentVersion(start.AgentVersion),
		WithTag("tenant", "t-openai"),
	)
	sigiltest.RecordGeneration(t, env, start, generation, err)
	env.Shutdown(t)

	exported := env.SingleGenerationJSON(t)

	if got := sigiltest.StringValue(t, exported, "mode"); got != "GENERATION_MODE_SYNC" {
		t.Fatalf("unexpected mode: got %q want %q\n%s", got, "GENERATION_MODE_SYNC", sigiltest.DebugJSON(exported))
	}
	if got := sigiltest.StringValue(t, exported, "response_id"); got != "resp_openai_sync" {
		t.Fatalf("unexpected response_id: got %q want %q", got, "resp_openai_sync")
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "stop" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "stop")
	}
	if got := sigiltest.StringValue(t, exported, "system_prompt"); got != "Be concise." {
		t.Fatalf("unexpected system_prompt: got %q want %q", got, "Be concise.")
	}
	if got := sigiltest.StringValue(t, exported, "conversation_id"); got != start.ConversationID {
		t.Fatalf("unexpected conversation_id: got %q want %q", got, start.ConversationID)
	}
	if got := sigiltest.StringValue(t, exported, "agent_name"); got != start.AgentName {
		t.Fatalf("unexpected agent_name: got %q want %q", got, start.AgentName)
	}
	if got := sigiltest.StringValue(t, exported, "model", "provider"); got != "openai" {
		t.Fatalf("unexpected model.provider: got %q want %q", got, "openai")
	}
	if got := sigiltest.StringValue(t, exported, "model", "name"); got != "gpt-5" {
		t.Fatalf("unexpected model.name: got %q want %q", got, "gpt-5")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "reasoning_tokens"); got != "3" {
		t.Fatalf("unexpected usage.reasoning_tokens: got %q want %q", got, "3")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "cache_read_input_tokens"); got != "2" {
		t.Fatalf("unexpected usage.cache_read_input_tokens: got %q want %q", got, "2")
	}
	if got := sigiltest.StringValue(t, exported, "input", 1, "role"); got != "MESSAGE_ROLE_TOOL" {
		t.Fatalf("unexpected tool input role: got %q want %q", got, "MESSAGE_ROLE_TOOL")
	}
	if got := sigiltest.StringValue(t, exported, "input", 1, "parts", 0, "metadata", "provider_type"); got != "tool_result" {
		t.Fatalf("unexpected tool result provider_type: got %q want %q", got, "tool_result")
	}
	if got := sigiltest.StringValue(t, exported, "input", 1, "parts", 0, "tool_result", "tool_call_id"); got != "call_weather" {
		t.Fatalf("unexpected tool_result.tool_call_id: got %q want %q", got, "call_weather")
	}
	if got := sigiltest.StringValue(t, exported, "output", 1, "parts", 0, "metadata", "provider_type"); got != "tool_call" {
		t.Fatalf("unexpected tool call provider_type: got %q want %q", got, "tool_call")
	}
	if got := sigiltest.StringValue(t, exported, "output", 1, "parts", 0, "tool_call", "name"); got != "weather" {
		t.Fatalf("unexpected tool_call.name: got %q want %q", got, "weather")
	}
}

func TestConformance_OpenAIResponsesStreamMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	req := openAIResponsesRequest()
	summary := openAIResponsesStreamSummary()
	start := sigil.GenerationStart{
		ConversationID: "conv-openai-stream",
		AgentName:      "agent-openai-stream",
		AgentVersion:   "v-openai-stream",
		Model:          sigil.ModelRef{Provider: "openai", Name: string(req.Model)},
	}

	generation, err := ResponsesFromStream(
		req,
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
	if got := sigiltest.StringValue(t, exported, "response_id"); got != "resp_openai_stream" {
		t.Fatalf("unexpected response_id: got %q want %q", got, "resp_openai_stream")
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "stop" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "stop")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 0, "text"); got != "checking weather" {
		t.Fatalf("unexpected streamed output text: got %q want %q", got, "checking weather")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "total_tokens"); got != "26" {
		t.Fatalf("unexpected usage.total_tokens: got %q want %q", got, "26")
	}
	if got := sigiltest.StringValue(t, exported, "input", 1, "parts", 0, "tool_result", "tool_call_id"); got != "call_weather" {
		t.Fatalf("unexpected streamed tool_result.tool_call_id: got %q want %q", got, "call_weather")
	}
}

func TestConformance_OpenAIErrorMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	callErr := &osdk.Error{
		StatusCode: http.StatusTooManyRequests,
		Request:    &http.Request{Method: http.MethodPost, URL: mustURL(t, "https://api.openai.com/v1/responses")},
		Response:   &http.Response{StatusCode: http.StatusTooManyRequests, Status: "429 Too Many Requests"},
	}
	sigiltest.RecordCallError(t, env, sigil.GenerationStart{
		Model: sigil.ModelRef{Provider: "openai", Name: "gpt-5"},
	}, callErr)

	span := sigiltest.FindSpan(t, env.Spans.Ended(), "generateText gpt-5")
	attrs := sigiltest.SpanAttributes(span)
	if got := attrs[openAISpanErrorCategory].AsString(); got != "rate_limit" {
		t.Fatalf("unexpected error.category: got %q want %q", got, "rate_limit")
	}

	env.Shutdown(t)
	exported := env.SingleGenerationJSON(t)
	callError := sigiltest.StringValue(t, exported, "call_error")
	if !strings.Contains(callError, "429") {
		t.Fatalf("expected call_error to include status code, got %q", callError)
	}
}

func TestConformance_OpenAIEmbeddingMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	req := osdk.EmbeddingNewParams{
		Model: osdk.EmbeddingModel("text-embedding-3-small"),
		Input: osdk.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: []string{"hello", "world"},
		},
	}
	resp := &osdk.CreateEmbeddingResponse{
		Model: "text-embedding-3-small",
		Data: []osdk.Embedding{
			{Embedding: []float64{0.1, 0.2, 0.3}},
			{Embedding: []float64{0.4, 0.5, 0.6}},
		},
		Usage: osdk.CreateEmbeddingResponseUsage{
			PromptTokens: 42,
			TotalTokens:  42,
		},
	}
	dimensions := int64(3)
	sigiltest.RecordEmbedding(t, env, sigil.EmbeddingStart{
		Model:        sigil.ModelRef{Provider: "openai", Name: string(req.Model)},
		AgentName:    "agent-openai-embed",
		AgentVersion: "v-openai-embed",
		Dimensions:   &dimensions,
	}, EmbeddingsFromResponse(req, resp))

	span := sigiltest.FindSpan(t, env.Spans.Ended(), "embeddings text-embedding-3-small")
	attrs := sigiltest.SpanAttributes(span)
	if got := attrs[openAISpanInputCount].AsInt64(); got != 2 {
		t.Fatalf("unexpected gen_ai.embeddings.input_count: got %d want %d", got, 2)
	}
	if got := attrs[openAISpanDimCount].AsInt64(); got != 3 {
		t.Fatalf("unexpected gen_ai.embeddings.dimension.count: got %d want %d", got, 3)
	}

	env.Shutdown(t)
	sigiltest.RequireRequestCount(t, env, 0)
}

func openAIResponsesRequest() oresponses.ResponseNewParams {
	return oresponses.ResponseNewParams{
		Model:        shared.ResponsesModel("gpt-5"),
		Instructions: param.NewOpt("Be concise."),
		Input: oresponses.ResponseNewParamsInputUnion{
			OfInputItemList: oresponses.ResponseInputParam{
				{
					OfMessage: &oresponses.EasyInputMessageParam{
						Role:    oresponses.EasyInputMessageRoleUser,
						Content: oresponses.EasyInputMessageContentUnionParam{OfString: param.NewOpt("what is the weather in Paris?")},
					},
				},
				{
					OfFunctionCallOutput: &oresponses.ResponseInputItemFunctionCallOutputParam{
						CallID: "call_weather",
						Output: oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam{OfString: param.NewOpt(`{"temp_c":18}`)},
					},
				},
			},
		},
		MaxOutputTokens: param.NewOpt(int64(320)),
		Temperature:     param.NewOpt(0.2),
		TopP:            param.NewOpt(0.85),
		Reasoning: shared.ReasoningParam{
			Effort: shared.ReasoningEffortMedium,
		},
	}
}

func openAIResponsesResponse() *oresponses.Response {
	return &oresponses.Response{
		ID:     "resp_openai_sync",
		Model:  shared.ResponsesModel("gpt-5"),
		Status: oresponses.ResponseStatusCompleted,
		Output: []oresponses.ResponseOutputItemUnion{
			{
				Type: "message",
				Content: []oresponses.ResponseOutputMessageContentUnion{
					{Type: "output_text", Text: "It is 18C and sunny."},
				},
			},
			{
				Type:      "function_call",
				CallID:    "call_weather",
				Name:      "weather",
				Arguments: oresponses.ResponseOutputItemUnionArguments{OfString: `{"city":"Paris"}`},
			},
		},
		Usage: oresponses.ResponseUsage{
			InputTokens:  80,
			OutputTokens: 20,
			TotalTokens:  100,
			InputTokensDetails: oresponses.ResponseUsageInputTokensDetails{
				CachedTokens: 2,
			},
			OutputTokensDetails: oresponses.ResponseUsageOutputTokensDetails{
				ReasoningTokens: 3,
			},
		},
	}
}

func openAIResponsesStreamSummary() ResponsesStreamSummary {
	return ResponsesStreamSummary{
		FirstChunkAt: time.Unix(1_741_780_000, 0).UTC(),
		Events: []oresponses.ResponseStreamEventUnion{
			{
				Type:  "response.output_text.delta",
				Delta: "checking ",
				Response: oresponses.Response{
					ID:    "resp_openai_stream",
					Model: shared.ResponsesModel("gpt-5"),
				},
			},
			{
				Type:  "response.output_text.delta",
				Delta: "weather",
			},
			{
				Type: "response.completed",
				Response: oresponses.Response{
					ID:     "resp_openai_stream",
					Model:  shared.ResponsesModel("gpt-5"),
					Status: oresponses.ResponseStatusCompleted,
					Usage: oresponses.ResponseUsage{
						InputTokens:  20,
						OutputTokens: 6,
						TotalTokens:  26,
					},
				},
			},
		},
	}
}

func mustURL(t testing.TB, raw string) *url.URL {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse url %q: %v", raw, err)
	}
	return parsed
}
