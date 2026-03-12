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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, chunk := range chunks {
			encoded, err := json.Marshal(chunk)
			if err != nil {
				t.Fatalf("marshal chunk: %v", err)
			}
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
