package openai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	osdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"

	"github.com/grafana/sigil/sdks/go/sigil"
)

type capturedExportRequest struct {
	Generations []capturedGeneration `json:"generations"`
}

type capturedGeneration struct {
	ID              string            `json:"id"`
	OperationName   string            `json:"operation_name"`
	Mode            string            `json:"mode"`
	Model           capturedModel     `json:"model"`
	ResponseID      string            `json:"response_id"`
	ResponseModel   string            `json:"response_model"`
	SystemPrompt    string            `json:"system_prompt"`
	Input           []capturedMessage `json:"input"`
	Output          []capturedMessage `json:"output"`
	Tools           []capturedTool    `json:"tools"`
	Usage           capturedUsage     `json:"usage"`
	StopReason      string            `json:"stop_reason"`
	MaxTokens       int64             `json:"max_tokens,string"`
	ThinkingEnabled bool              `json:"thinking_enabled"`
	Metadata        map[string]any    `json:"metadata"`
	CallError       string            `json:"call_error"`
}

type capturedModel struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
}

type capturedMessage struct {
	Role  string         `json:"role"`
	Parts []capturedPart `json:"parts"`
}

type capturedPart struct {
	Text       string              `json:"text"`
	Thinking   string              `json:"thinking"`
	ToolCall   *capturedToolCall   `json:"tool_call"`
	ToolResult *capturedToolResult `json:"tool_result"`
}

type capturedToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	InputJSON string `json:"input_json"`
}

type capturedToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name"`
	Content    string `json:"content"`
	IsError    bool   `json:"is_error"`
}

type capturedTool struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type capturedUsage struct {
	InputTokens          int64 `json:"input_tokens,string"`
	OutputTokens         int64 `json:"output_tokens,string"`
	TotalTokens          int64 `json:"total_tokens,string"`
	CacheReadInputTokens int64 `json:"cache_read_input_tokens,string"`
	ReasoningTokens      int64 `json:"reasoning_tokens,string"`
}

type generationCapture struct {
	mu       sync.Mutex
	requests []capturedExportRequest
	server   *httptest.Server
}

func newGenerationCapture(t *testing.T) *generationCapture {
	t.Helper()

	capture := &generationCapture{}
	capture.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/generations:export" {
			http.NotFound(w, r)
			return
		}

		var request capturedExportRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		capture.mu.Lock()
		capture.requests = append(capture.requests, request)
		capture.mu.Unlock()

		results := make([]map[string]any, 0, len(request.Generations))
		for _, generation := range request.Generations {
			results = append(results, map[string]any{
				"generation_id": generation.ID,
				"accepted":      true,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
	}))
	t.Cleanup(capture.server.Close)

	return capture
}

func (c *generationCapture) endpoint() string {
	return c.server.URL + "/api/v1/generations:export"
}

func (c *generationCapture) singleGeneration(t *testing.T) capturedGeneration {
	t.Helper()

	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.requests) != 1 {
		t.Fatalf("expected exactly one export request, got %d", len(c.requests))
	}
	if len(c.requests[0].Generations) != 1 {
		t.Fatalf("expected exactly one generation, got %d", len(c.requests[0].Generations))
	}
	return c.requests[0].Generations[0]
}

func newConformanceClient(t *testing.T, endpoint string) *sigil.Client {
	t.Helper()

	cfg := sigil.DefaultConfig()
	cfg.GenerationExport.Protocol = sigil.GenerationExportProtocolHTTP
	cfg.GenerationExport.Endpoint = endpoint
	cfg.GenerationExport.BatchSize = 1
	cfg.GenerationExport.QueueSize = 8
	cfg.GenerationExport.FlushInterval = time.Hour
	cfg.GenerationExport.MaxRetries = 1
	cfg.GenerationExport.InitialBackoff = time.Millisecond
	cfg.GenerationExport.MaxBackoff = 5 * time.Millisecond
	cfg.GenerationExport.PayloadMaxBytes = 4 << 20

	client := sigil.NewClient(cfg)
	t.Cleanup(func() {
		if err := client.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown sigil client: %v", err)
		}
	})

	return client
}

func TestConformance_ResponsesNewExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	req := oresponses.ResponseNewParams{
		Model:           shared.ResponsesModel("gpt-5"),
		Instructions:    param.NewOpt("Be concise."),
		Input:           oresponses.ResponseNewParamsInputUnion{OfString: param.NewOpt("hello")},
		MaxOutputTokens: param.NewOpt(int64(320)),
		Temperature:     param.NewOpt(0.2),
		TopP:            param.NewOpt(0.85),
		Reasoning: shared.ReasoningParam{
			Effort: shared.ReasoningEffortMedium,
		},
	}

	const responseBody = `{
  "id": "resp_1",
  "model": "gpt-5",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "content": [
        {
          "type": "output_text",
          "text": "world"
        }
      ]
    },
    {
      "type": "function_call",
      "call_id": "call_weather",
      "name": "weather",
      "arguments": "{\"city\":\"Paris\"}"
    }
  ],
  "usage": {
    "input_tokens": 80,
    "output_tokens": 20,
    "total_tokens": 100,
    "input_tokens_details": {
      "cached_tokens": 2
    },
    "output_tokens_details": {
      "reasoning_tokens": 3
    }
  }
}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/responses" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, responseBody)
	}))
	defer server.Close()

	provider := osdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	gotResponse, err := ResponsesNew(context.Background(), sigilClient, provider, req)
	if err != nil {
		t.Fatalf("ResponsesNew: %v", err)
	}
	if gotResponse == nil || gotResponse.ID != "resp_1" {
		t.Fatalf("expected native response resp_1, got %#v", gotResponse)
	}
	if err := sigilClient.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown sigil client: %v", err)
	}

	generation := capture.singleGeneration(t)
	if generation.OperationName != "generateText" {
		t.Fatalf("expected generateText operation, got %q", generation.OperationName)
	}
	if generation.Mode != "GENERATION_MODE_SYNC" {
		t.Fatalf("expected sync mode, got %q", generation.Mode)
	}
	if generation.Model.Provider != "openai" {
		t.Fatalf("expected provider openai, got %q", generation.Model.Provider)
	}
	if generation.Model.Name != "gpt-5" {
		t.Fatalf("expected request model gpt-5, got %q", generation.Model.Name)
	}
	if generation.ResponseID != "resp_1" {
		t.Fatalf("expected response id resp_1, got %q", generation.ResponseID)
	}
	if generation.ResponseModel != "gpt-5" {
		t.Fatalf("expected response model gpt-5, got %q", generation.ResponseModel)
	}
	if generation.SystemPrompt != "Be concise." {
		t.Fatalf("expected system prompt, got %q", generation.SystemPrompt)
	}
	if generation.StopReason != "stop" {
		t.Fatalf("expected stop reason stop, got %q", generation.StopReason)
	}
	if generation.MaxTokens != 320 {
		t.Fatalf("expected max tokens 320, got %d", generation.MaxTokens)
	}
	if !generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true")
	}
	if generation.Usage.TotalTokens != 100 {
		t.Fatalf("expected total tokens 100, got %d", generation.Usage.TotalTokens)
	}
	if generation.Usage.CacheReadInputTokens != 2 {
		t.Fatalf("expected cache read input tokens 2, got %d", generation.Usage.CacheReadInputTokens)
	}
	if generation.Usage.ReasoningTokens != 3 {
		t.Fatalf("expected reasoning tokens 3, got %d", generation.Usage.ReasoningTokens)
	}
	if len(generation.Output) != 2 {
		t.Fatalf("expected two output messages, got %d", len(generation.Output))
	}
	if len(generation.Output[0].Parts) != 1 || generation.Output[0].Parts[0].Text != "world" {
		t.Fatalf("expected assistant text output, got %#v", generation.Output[0].Parts)
	}
	if len(generation.Output[1].Parts) != 1 || generation.Output[1].Parts[0].ToolCall == nil {
		t.Fatalf("expected assistant tool call output, got %#v", generation.Output[1].Parts)
	}
	if generation.Output[1].Parts[0].ToolCall.Name != "weather" {
		t.Fatalf("expected tool call weather, got %#v", generation.Output[1].Parts[0].ToolCall)
	}
	if decodeBase64JSON(t, generation.Output[1].Parts[0].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("expected tool call args {\"city\":\"Paris\"}, got %s", decodeBase64JSON(t, generation.Output[1].Parts[0].ToolCall.InputJSON))
	}
}

func TestConformance_ChatCompletionsNewStreamingExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	req := osdk.ChatCompletionNewParams{
		Model: shared.ChatModel("gpt-4o-mini"),
		Messages: []osdk.ChatCompletionMessageParamUnion{
			osdk.SystemMessage("You are concise."),
			osdk.UserMessage("What is the weather in Paris?"),
		},
		Tools: []osdk.ChatCompletionToolUnionParam{
			osdk.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
				Name: "weather",
				Parameters: shared.FunctionParameters{
					"type": "object",
				},
			}),
		},
		MaxCompletionTokens: param.NewOpt(int64(42)),
		ReasoningEffort:     shared.ReasoningEffortMedium,
	}

	chunks := []osdk.ChatCompletionChunk{
		{
			ID:    "chatcmpl_stream_1",
			Model: "gpt-4o-mini",
			Choices: []osdk.ChatCompletionChunkChoice{
				{
					Delta: osdk.ChatCompletionChunkChoiceDelta{
						Content: "Calling tool",
						ToolCalls: []osdk.ChatCompletionChunkChoiceDeltaToolCall{
							{
								Index: 0,
								ID:    "call_weather",
								Function: osdk.ChatCompletionChunkChoiceDeltaToolCallFunction{
									Name:      "weather",
									Arguments: `{"city":"Pa`,
								},
							},
						},
					},
				},
			},
		},
		{
			ID:    "chatcmpl_stream_1",
			Model: "gpt-4o-mini",
			Choices: []osdk.ChatCompletionChunkChoice{
				{
					Delta: osdk.ChatCompletionChunkChoiceDelta{
						Content: " now.",
						ToolCalls: []osdk.ChatCompletionChunkChoiceDeltaToolCall{
							{
								Index: 0,
								Function: osdk.ChatCompletionChunkChoiceDeltaToolCallFunction{
									Arguments: `ris"}`,
								},
							},
						},
					},
					FinishReason: "tool_calls",
				},
			},
			Usage: osdk.CompletionUsage{
				PromptTokens:     19,
				CompletionTokens: 6,
				TotalTokens:      25,
				CompletionTokensDetails: osdk.CompletionUsageCompletionTokensDetails{
					ReasoningTokens: 4,
				},
			},
		},
	}

	encodedChunks := make([][]byte, 0, len(chunks))
	for _, chunk := range chunks {
		encoded, err := json.Marshal(chunk)
		if err != nil {
			t.Fatalf("marshal chunk: %v", err)
		}
		encodedChunks = append(encodedChunks, encoded)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, encoded := range encodedChunks {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", encoded)
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	provider := osdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	_, summary, err := ChatCompletionsNewStreaming(context.Background(), sigilClient, provider, req)
	if err != nil {
		t.Fatalf("ChatCompletionsNewStreaming: %v", err)
	}
	if len(summary.Chunks) != 2 {
		t.Fatalf("expected two streamed chunks, got %d", len(summary.Chunks))
	}
	if err := sigilClient.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown sigil client: %v", err)
	}

	generation := capture.singleGeneration(t)
	if generation.OperationName != "streamText" {
		t.Fatalf("expected streamText operation, got %q", generation.OperationName)
	}
	if generation.Mode != "GENERATION_MODE_STREAM" {
		t.Fatalf("expected stream mode, got %q", generation.Mode)
	}
	if generation.StopReason != "tool_calls" {
		t.Fatalf("expected stop reason tool_calls, got %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 25 {
		t.Fatalf("expected total tokens 25, got %d", generation.Usage.TotalTokens)
	}
	if generation.Usage.ReasoningTokens != 4 {
		t.Fatalf("expected reasoning tokens 4, got %d", generation.Usage.ReasoningTokens)
	}
	if len(generation.Output) != 1 {
		t.Fatalf("expected one output message, got %d", len(generation.Output))
	}
	if len(generation.Output[0].Parts) != 2 {
		t.Fatalf("expected text and tool call parts, got %#v", generation.Output[0].Parts)
	}
	if generation.Output[0].Parts[0].Text != "Calling tool now." {
		t.Fatalf("expected merged stream text, got %q", generation.Output[0].Parts[0].Text)
	}
	if generation.Output[0].Parts[1].ToolCall == nil {
		t.Fatalf("expected reconstructed tool call, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[1].ToolCall.ID != "call_weather" {
		t.Fatalf("expected tool call id call_weather, got %#v", generation.Output[0].Parts[1].ToolCall)
	}
	if generation.Output[0].Parts[1].ToolCall.Name != "weather" {
		t.Fatalf("expected tool call weather, got %#v", generation.Output[0].Parts[1].ToolCall)
	}
	if decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("expected reconstructed tool args {\"city\":\"Paris\"}, got %s", decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON))
	}
}

func TestConformance_ResponsesNewProviderErrorExportsCallError(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	req := oresponses.ResponseNewParams{
		Model: shared.ResponsesModel("gpt-5"),
		Input: oresponses.ResponseNewParamsInputUnion{OfString: param.NewOpt("hello")},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/responses" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"error":{"message":"provider unavailable"}}`)
	}))
	defer server.Close()

	provider := osdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	_, err := ResponsesNew(context.Background(), sigilClient, provider, req)
	if err == nil {
		t.Fatalf("expected provider error")
	}
	if !strings.Contains(err.Error(), "provider unavailable") {
		t.Fatalf("expected provider error to mention availability, got %v", err)
	}
	if err := sigilClient.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown sigil client: %v", err)
	}

	generation := capture.singleGeneration(t)
	if generation.OperationName != "generateText" {
		t.Fatalf("expected generateText operation, got %q", generation.OperationName)
	}
	if generation.Mode != "GENERATION_MODE_SYNC" {
		t.Fatalf("expected sync mode, got %q", generation.Mode)
	}
	if generation.Model.Provider != "openai" || generation.Model.Name != "gpt-5" {
		t.Fatalf("expected openai gpt-5 model, got %#v", generation.Model)
	}
	if !strings.Contains(generation.CallError, "provider unavailable") {
		t.Fatalf("expected call_error to mention provider failure, got %q", generation.CallError)
	}
	if len(generation.Output) != 0 {
		t.Fatalf("expected no output on provider error, got %#v", generation.Output)
	}
}

func decodeBase64JSON(t *testing.T, value string) string {
	t.Helper()

	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("decode base64 %q: %v", value, err)
	}
	return string(decoded)
}

func (g *capturedGeneration) UnmarshalJSON(data []byte) error {
	type generationAlias capturedGeneration
	aux := struct {
		MaxTokens json.RawMessage `json:"max_tokens"`
		*generationAlias
	}{
		generationAlias: (*generationAlias)(g),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if len(aux.MaxTokens) == 0 || string(aux.MaxTokens) == "null" {
		return nil
	}
	var text string
	if err := json.Unmarshal(aux.MaxTokens, &text); err == nil {
		value, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return err
		}
		g.MaxTokens = value
		return nil
	}
	return json.Unmarshal(aux.MaxTokens, &g.MaxTokens)
}

func TestConformance_ChatCompletionsSyncNormalization(t *testing.T) {
	req := osdk.ChatCompletionNewParams{
		Model: shared.ChatModel("gpt-4o-mini"),
		Messages: []osdk.ChatCompletionMessageParamUnion{
			osdk.SystemMessage("You are concise."),
			osdk.UserMessage("What is the weather in Paris?"),
			osdk.ToolMessage(`{"temp_c":18}`, "call_weather"),
		},
		Tools: []osdk.ChatCompletionToolUnionParam{
			osdk.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
				Name:        "weather",
				Description: osdk.String("Get weather"),
				Parameters: shared.FunctionParameters{
					"type": "object",
					"properties": map[string]any{
						"city": map[string]any{"type": "string"},
					},
				},
			}),
		},
		MaxCompletionTokens: param.NewOpt(int64(128)),
		Temperature:         param.NewOpt(0.7),
		TopP:                param.NewOpt(0.9),
		ToolChoice:          osdk.ToolChoiceOptionFunctionToolChoice(osdk.ChatCompletionNamedToolChoiceFunctionParam{Name: "weather"}),
		ReasoningEffort:     shared.ReasoningEffortLow,
	}

	resp := &osdk.ChatCompletion{
		ID:    "chatcmpl_1",
		Model: "gpt-4o-mini",
		Choices: []osdk.ChatCompletionChoice{
			{
				FinishReason: "tool_calls",
				Message: osdk.ChatCompletionMessage{
					Content: "Calling tool",
					ToolCalls: []osdk.ChatCompletionMessageToolCallUnion{
						{
							ID:   "call_weather",
							Type: "function",
							Function: osdk.ChatCompletionMessageFunctionToolCallFunction{
								Name:      "weather",
								Arguments: `{"city":"Paris"}`,
							},
						},
					},
				},
			},
		},
		Usage: osdk.CompletionUsage{
			PromptTokens:     120,
			CompletionTokens: 42,
			TotalTokens:      162,
			PromptTokensDetails: osdk.CompletionUsagePromptTokensDetails{
				CachedTokens: 8,
			},
			CompletionTokensDetails: osdk.CompletionUsageCompletionTokensDetails{
				ReasoningTokens: 5,
			},
		},
	}

	generation, err := ChatCompletionsFromRequestResponse(req, resp,
		WithConversationID("conv-openai-sync"),
		WithConversationTitle("Paris weather"),
		WithAgentName("agent-openai"),
		WithAgentVersion("v-openai"),
		WithTag("tenant", "t-123"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("chat completions sync mapping: %v", err)
	}

	if generation.Model.Provider != "openai" || generation.Model.Name != "gpt-4o-mini" {
		t.Fatalf("unexpected model mapping: %#v", generation.Model)
	}
	if generation.ConversationID != "conv-openai-sync" || generation.ConversationTitle != "Paris weather" {
		t.Fatalf("unexpected conversation mapping: id=%q title=%q", generation.ConversationID, generation.ConversationTitle)
	}
	if generation.AgentName != "agent-openai" || generation.AgentVersion != "v-openai" {
		t.Fatalf("unexpected agent mapping: name=%q version=%q", generation.AgentName, generation.AgentVersion)
	}
	if generation.ResponseID != "chatcmpl_1" || generation.ResponseModel != "gpt-4o-mini" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.SystemPrompt != "You are concise." {
		t.Fatalf("unexpected system prompt: %q", generation.SystemPrompt)
	}
	if generation.StopReason != "tool_calls" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 162 || generation.Usage.CacheReadInputTokens != 8 || generation.Usage.ReasoningTokens != 5 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if generation.ThinkingEnabled == nil || !*generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true, got %v", generation.ThinkingEnabled)
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 2 {
		t.Fatalf("expected one assistant message with text + tool call, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Kind != sigil.PartKindText || generation.Output[0].Parts[0].Text != "Calling tool" {
		t.Fatalf("unexpected assistant text part: %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected tool_call part, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[1].ToolCall.ID != "call_weather" || generation.Output[0].Parts[1].ToolCall.Name != "weather" {
		t.Fatalf("unexpected tool call mapping: %#v", generation.Output[0].Parts[1].ToolCall)
	}
	if string(generation.Output[0].Parts[1].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("unexpected tool call input: %q", string(generation.Output[0].Parts[1].ToolCall.InputJSON))
	}
	if generation.Tags["tenant"] != "t-123" {
		t.Fatalf("expected tenant tag")
	}
	requireOpenAIArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindResponse,
		sigil.ArtifactKindTools,
	)
}

func TestConformance_ChatCompletionsStreamNormalization(t *testing.T) {
	req := osdk.ChatCompletionNewParams{
		Model: shared.ChatModel("gpt-4o-mini"),
		Messages: []osdk.ChatCompletionMessageParamUnion{
			osdk.SystemMessage("You are concise."),
			osdk.UserMessage("What is the weather in Paris?"),
		},
		Tools: []osdk.ChatCompletionToolUnionParam{
			osdk.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
				Name: "weather",
			}),
		},
		MaxCompletionTokens: param.NewOpt(int64(42)),
		Temperature:         param.NewOpt(0.15),
		TopP:                param.NewOpt(0.4),
		ToolChoice:          osdk.ToolChoiceOptionFunctionToolChoice(osdk.ChatCompletionNamedToolChoiceFunctionParam{Name: "weather"}),
		ReasoningEffort:     shared.ReasoningEffortMedium,
	}

	summary := ChatCompletionsStreamSummary{
		Chunks: []osdk.ChatCompletionChunk{
			{
				ID:    "chatcmpl_stream_1",
				Model: "gpt-4o-mini",
				Choices: []osdk.ChatCompletionChunkChoice{
					{
						Delta: osdk.ChatCompletionChunkChoiceDelta{
							Content: "Calling tool",
							ToolCalls: []osdk.ChatCompletionChunkChoiceDeltaToolCall{
								{
									Index: 0,
									ID:    "call_weather",
									Function: osdk.ChatCompletionChunkChoiceDeltaToolCallFunction{
										Name:      "weather",
										Arguments: `{"city":"Pa`,
									},
								},
							},
						},
					},
				},
			},
			{
				Choices: []osdk.ChatCompletionChunkChoice{
					{
						Delta: osdk.ChatCompletionChunkChoiceDelta{
							Content: " now.",
							ToolCalls: []osdk.ChatCompletionChunkChoiceDeltaToolCall{
								{
									Index: 0,
									Function: osdk.ChatCompletionChunkChoiceDeltaToolCallFunction{
										Arguments: `ris"}`,
									},
								},
							},
						},
						FinishReason: "tool_calls",
					},
				},
				Usage: osdk.CompletionUsage{
					PromptTokens:     20,
					CompletionTokens: 5,
					TotalTokens:      25,
				},
			},
		},
	}

	generation, err := ChatCompletionsFromStream(req, summary,
		WithConversationID("conv-openai-stream"),
		WithAgentName("agent-openai-stream"),
		WithAgentVersion("v-openai-stream"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("chat completions stream mapping: %v", err)
	}

	if generation.ConversationID != "conv-openai-stream" || generation.AgentName != "agent-openai-stream" || generation.AgentVersion != "v-openai-stream" {
		t.Fatalf("unexpected identity mapping: %#v", generation)
	}
	if generation.ResponseID != "chatcmpl_stream_1" || generation.ResponseModel != "gpt-4o-mini" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "tool_calls" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 25 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if generation.ThinkingEnabled == nil || !*generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true, got %v", generation.ThinkingEnabled)
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 2 {
		t.Fatalf("expected merged assistant output, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Text != "Calling tool now." {
		t.Fatalf("unexpected streamed text: %q", generation.Output[0].Parts[0].Text)
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[1])
	}
	if string(generation.Output[0].Parts[1].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("unexpected streamed tool input: %q", string(generation.Output[0].Parts[1].ToolCall.InputJSON))
	}
	requireOpenAIArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindTools,
		sigil.ArtifactKindProviderEvent,
	)
}

func TestConformance_ResponsesSyncNormalization(t *testing.T) {
	req := oresponses.ResponseNewParams{
		Model:           shared.ResponsesModel("gpt-5"),
		Instructions:    param.NewOpt("Be concise."),
		Input:           oresponses.ResponseNewParamsInputUnion{OfString: param.NewOpt("hello")},
		MaxOutputTokens: param.NewOpt(int64(320)),
		Temperature:     param.NewOpt(0.2),
		TopP:            param.NewOpt(0.85),
		Reasoning: shared.ReasoningParam{
			Effort: shared.ReasoningEffortMedium,
		},
	}

	resp := &oresponses.Response{
		ID:     "resp_1",
		Model:  shared.ResponsesModel("gpt-5"),
		Status: oresponses.ResponseStatusCompleted,
		Output: []oresponses.ResponseOutputItemUnion{
			{
				Type: "message",
				Content: []oresponses.ResponseOutputMessageContentUnion{
					{Type: "output_text", Text: "world"},
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

	generation, err := ResponsesFromRequestResponse(req, resp, WithRawArtifacts())
	if err != nil {
		t.Fatalf("responses sync mapping: %v", err)
	}

	if generation.Model.Provider != "openai" || generation.Model.Name != "gpt-5" {
		t.Fatalf("unexpected model mapping: %#v", generation.Model)
	}
	if generation.ResponseID != "resp_1" || generation.ResponseModel != "gpt-5" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.SystemPrompt != "Be concise." {
		t.Fatalf("unexpected system prompt: %q", generation.SystemPrompt)
	}
	if generation.StopReason != "stop" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.ThinkingEnabled == nil || !*generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true, got %v", generation.ThinkingEnabled)
	}
	if generation.Usage.TotalTokens != 100 || generation.Usage.CacheReadInputTokens != 2 || generation.Usage.ReasoningTokens != 3 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if len(generation.Output) != 2 {
		t.Fatalf("expected text + tool call outputs, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Text != "world" {
		t.Fatalf("unexpected response text: %q", generation.Output[0].Parts[0].Text)
	}
	if generation.Output[1].Parts[0].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected response tool call, got %#v", generation.Output[1].Parts[0])
	}
	requireOpenAIArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindResponse,
	)
}

func TestConformance_ResponsesStreamNormalization(t *testing.T) {
	req := oresponses.ResponseNewParams{
		Model:           shared.ResponsesModel("gpt-5"),
		Input:           oresponses.ResponseNewParamsInputUnion{OfString: param.NewOpt("hello")},
		MaxOutputTokens: param.NewOpt(int64(128)),
	}

	summary := ResponsesStreamSummary{
		Events: []oresponses.ResponseStreamEventUnion{
			{
				Type:  "response.output_text.delta",
				Delta: "hello",
			},
			{
				Type:  "response.output_text.delta",
				Delta: " world",
			},
			{
				Type: "response.completed",
				Response: oresponses.Response{
					ID:    "resp_stream_1",
					Model: shared.ResponsesModel("gpt-5"),
				},
			},
		},
	}

	generation, err := ResponsesFromStream(req, summary, WithRawArtifacts())
	if err != nil {
		t.Fatalf("responses stream mapping: %v", err)
	}

	if generation.Model.Provider != "openai" || generation.Model.Name != "gpt-5" {
		t.Fatalf("unexpected model mapping: %#v", generation.Model)
	}
	if generation.ResponseID != "resp_stream_1" || generation.ResponseModel != "gpt-5" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "stop" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if len(generation.Output) != 1 || generation.Output[0].Parts[0].Text != "hello world" {
		t.Fatalf("unexpected streamed output: %#v", generation.Output)
	}
	requireOpenAIArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindProviderEvent,
	)
}

func TestConformance_OpenAIErrorMapping(t *testing.T) {
	if _, err := ChatCompletionsFromRequestResponse(osdk.ChatCompletionNewParams{}, nil); err == nil || err.Error() != "response is required" {
		t.Fatalf("expected explicit chat response error, got %v", err)
	}
	if _, err := ChatCompletionsFromStream(osdk.ChatCompletionNewParams{}, ChatCompletionsStreamSummary{}); err == nil || err.Error() != "stream summary has no chunks and no final response" {
		t.Fatalf("expected explicit chat stream error, got %v", err)
	}
	if _, err := ResponsesFromRequestResponse(oresponses.ResponseNewParams{}, nil); err == nil || err.Error() != "response is required" {
		t.Fatalf("expected explicit responses response error, got %v", err)
	}
	if _, err := ResponsesFromStream(oresponses.ResponseNewParams{}, ResponsesStreamSummary{}); err == nil || err.Error() != "stream summary has no events and no final response" {
		t.Fatalf("expected explicit responses stream error, got %v", err)
	}

	_, err := ChatCompletionsFromRequestResponse(
		osdk.ChatCompletionNewParams{Model: shared.ChatModel("gpt-4o-mini")},
		&osdk.ChatCompletion{Model: "gpt-4o-mini"},
		WithProviderName(""),
	)
	if err == nil || err.Error() != "generation.model.provider is required" {
		t.Fatalf("expected explicit validation error for invalid provider mapping, got %v", err)
	}
}

func requireOpenAIArtifactKinds(t *testing.T, artifacts []sigil.Artifact, want ...sigil.ArtifactKind) {
	t.Helper()

	if len(artifacts) != len(want) {
		t.Fatalf("expected %d artifacts, got %d", len(want), len(artifacts))
	}
	for i, kind := range want {
		if artifacts[i].Kind != kind {
			t.Fatalf("artifact %d kind mismatch: got %q want %q", i, artifacts[i].Kind, kind)
		}
	}
}
