package anthropic

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	asdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

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

func TestConformance_MessageExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())
	req := testRequest()

	const responseBody = `{
  "id": "msg_1",
  "model": "claude-sonnet-4-5",
  "stop_reason": "end_turn",
  "content": [
    {
      "type": "text",
      "text": "It's 18C and sunny."
    },
    {
      "type": "thinking",
      "thinking": "answer done"
    }
  ],
  "usage": {
    "input_tokens": 120,
    "output_tokens": 42,
    "cache_read_input_tokens": 30,
    "cache_creation_input_tokens": 10,
    "server_tool_use": {
      "web_search_requests": 2,
      "web_fetch_requests": 1
    }
  }
}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/messages" || r.URL.RawQuery != "beta=true" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, responseBody)
	}))
	defer server.Close()

	provider := asdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	gotResponse, err := Message(context.Background(), sigilClient, provider, req)
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	if gotResponse == nil || gotResponse.ID != "msg_1" {
		t.Fatalf("expected native response msg_1, got %#v", gotResponse)
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
	if generation.Model.Provider != "anthropic" || generation.Model.Name != "claude-sonnet-4-5" {
		t.Fatalf("expected anthropic claude-sonnet-4-5 model, got %#v", generation.Model)
	}
	if generation.ResponseID != "msg_1" || generation.ResponseModel != "claude-sonnet-4-5" {
		t.Fatalf("expected response identifiers, got id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.SystemPrompt != "Be precise." {
		t.Fatalf("expected system prompt Be precise., got %q", generation.SystemPrompt)
	}
	if generation.StopReason != "end_turn" {
		t.Fatalf("expected stop reason end_turn, got %q", generation.StopReason)
	}
	if generation.MaxTokens != 512 {
		t.Fatalf("expected max tokens 512, got %d", generation.MaxTokens)
	}
	if !generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true")
	}
	if generation.Usage.TotalTokens != 162 {
		t.Fatalf("expected total tokens 162, got %d", generation.Usage.TotalTokens)
	}
	if generation.Usage.CacheReadInputTokens != 30 {
		t.Fatalf("expected cache read input tokens 30, got %d", generation.Usage.CacheReadInputTokens)
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"]) != 1024 {
		t.Fatalf("expected thinking budget metadata 1024, got %#v", generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"])
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.usage.server_tool_use.total_requests"]) != 3 {
		t.Fatalf("expected total server tool requests 3, got %#v", generation.Metadata["sigil.gen_ai.usage.server_tool_use.total_requests"])
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 2 {
		t.Fatalf("expected one assistant message with text and thinking, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Text != "It's 18C and sunny." {
		t.Fatalf("expected assistant text output, got %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Thinking != "answer done" {
		t.Fatalf("expected thinking output, got %#v", generation.Output[0].Parts[1])
	}
}

func TestConformance_MessageStreamExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())
	req := testRequest()

	events := []string{
		`event: message_start
data: {"type":"message_start","message":{"id":"msg_stream_1","model":"claude-sonnet-4-5"}}

`,
		`event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"look up tool"}}

`,
		`event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"weather","input":{"city":"Paris"}}}

`,
		`event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":"It's 18C and sunny."}}

`,
		`event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":80,"output_tokens":25,"cache_read_input_tokens":8,"cache_creation_input_tokens":4,"server_tool_use":{"web_search_requests":1,"web_fetch_requests":2}}}

`,
		`event: message_stop
data: {"type":"message_stop"}

`,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/messages" || r.URL.RawQuery != "beta=true" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range events {
			_, _ = io.WriteString(w, event)
		}
	}))
	defer server.Close()

	provider := asdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	_, summary, err := MessageStream(context.Background(), sigilClient, provider, req)
	if err != nil {
		t.Fatalf("MessageStream: %v", err)
	}
	if len(summary.Events) != 6 {
		t.Fatalf("expected six streamed events, got %d", len(summary.Events))
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
	if generation.StopReason != "end_turn" {
		t.Fatalf("expected stop reason end_turn, got %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 105 {
		t.Fatalf("expected total tokens 105, got %d", generation.Usage.TotalTokens)
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.usage.server_tool_use.total_requests"]) != 3 {
		t.Fatalf("expected total server tool requests 3, got %#v", generation.Metadata["sigil.gen_ai.usage.server_tool_use.total_requests"])
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 3 {
		t.Fatalf("expected thinking, tool call, and text output parts, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Thinking != "look up tool" {
		t.Fatalf("expected thinking output, got %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].ToolCall == nil {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[1].ToolCall.ID != "toolu_2" || generation.Output[0].Parts[1].ToolCall.Name != "weather" {
		t.Fatalf("expected weather tool call, got %#v", generation.Output[0].Parts[1].ToolCall)
	}
	if decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("expected tool call args {\"city\":\"Paris\"}, got %s", decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON))
	}
	if generation.Output[0].Parts[2].Text != "It's 18C and sunny." {
		t.Fatalf("expected assistant text output, got %#v", generation.Output[0].Parts[2])
	}
}

func TestConformance_MessageProviderErrorExportsCallError(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())
	req := testRequest()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/messages" || r.URL.RawQuery != "beta=true" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"overloaded_error","message":"provider unavailable"}}`)
	}))
	defer server.Close()

	provider := asdk.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
		option.WithMaxRetries(0),
	)

	_, err := Message(context.Background(), sigilClient, provider, req)
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
	if generation.Model.Provider != "anthropic" || generation.Model.Name != "claude-sonnet-4-5" {
		t.Fatalf("expected anthropic claude-sonnet-4-5 model, got %#v", generation.Model)
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

func metadataInt64(t *testing.T, value any) int64 {
	t.Helper()

	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			t.Fatalf("parse json number %q: %v", typed, err)
		}
		return parsed
	case string:
		parsed, err := strconv.ParseInt(typed, 10, 64)
		if err != nil {
			t.Fatalf("parse string int %q: %v", typed, err)
		}
		return parsed
	default:
		t.Fatalf("unsupported metadata int type %T (%#v)", value, value)
		return 0
	}
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

func TestConformance_MessageSyncNormalization(t *testing.T) {
	req := testRequest()
	resp := &asdk.BetaMessage{
		ID:         "msg_1",
		Model:      asdk.Model("claude-sonnet-4-5"),
		StopReason: asdk.BetaStopReasonEndTurn,
		Content: []asdk.BetaContentBlockUnion{
			{Type: "text", Text: "It's 18C and sunny."},
			{Type: "thinking", Thinking: "answer done"},
			mustUnmarshalBetaContentBlockUnion(t, `{"type":"tool_use","id":"toolu_2","name":"weather","input":{"city":"Paris"}}`),
		},
		Usage: asdk.BetaUsage{
			InputTokens:              120,
			OutputTokens:             42,
			CacheReadInputTokens:     30,
			CacheCreationInputTokens: 10,
		},
	}

	generation, err := FromRequestResponse(req, resp,
		WithConversationID("conv-anthropic-sync"),
		WithConversationTitle("Paris weather"),
		WithAgentName("agent-anthropic"),
		WithAgentVersion("v-anthropic"),
		WithTag("tenant", "t-123"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("anthropic sync mapping: %v", err)
	}

	if generation.Model.Provider != "anthropic" || generation.Model.Name != "claude-sonnet-4-5" {
		t.Fatalf("unexpected model mapping: %#v", generation.Model)
	}
	if generation.ConversationID != "conv-anthropic-sync" || generation.ConversationTitle != "Paris weather" {
		t.Fatalf("unexpected conversation mapping: %#v", generation)
	}
	if generation.AgentName != "agent-anthropic" || generation.AgentVersion != "v-anthropic" {
		t.Fatalf("unexpected agent mapping: name=%q version=%q", generation.AgentName, generation.AgentVersion)
	}
	if generation.ResponseID != "msg_1" || generation.ResponseModel != "claude-sonnet-4-5" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "end_turn" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 162 || generation.Usage.CacheReadInputTokens != 30 || generation.Usage.CacheCreationInputTokens != 10 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if generation.ThinkingEnabled == nil || !*generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true, got %v", generation.ThinkingEnabled)
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 3 {
		t.Fatalf("expected text + thinking + tool call output, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Kind != sigil.PartKindText || generation.Output[0].Parts[0].Text != "It's 18C and sunny." {
		t.Fatalf("unexpected text output: %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindThinking || generation.Output[0].Parts[1].Thinking != "answer done" {
		t.Fatalf("unexpected thinking output: %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[2].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[2])
	}
	if generation.Output[0].Parts[2].ToolCall.ID != "toolu_2" || generation.Output[0].Parts[2].ToolCall.Name != "weather" {
		t.Fatalf("unexpected tool call mapping: %#v", generation.Output[0].Parts[2].ToolCall)
	}
	if generation.Tags["tenant"] != "t-123" {
		t.Fatalf("expected tenant tag")
	}
	requireAnthropicArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindResponse,
		sigil.ArtifactKindTools,
	)
}

func TestConformance_MessageStreamNormalization(t *testing.T) {
	req := testRequest()
	summary := StreamSummary{
		Events: []asdk.BetaRawMessageStreamEventUnion{
			{
				Type: "message_start",
				Message: asdk.BetaMessage{
					ID:    "msg_delta_1",
					Model: asdk.Model("claude-sonnet-4-5"),
				},
			},
			{
				Type:  "content_block_start",
				Index: 0,
				ContentBlock: asdk.BetaRawContentBlockStartEventContentBlockUnion{
					Type: "thinking",
				},
			},
			{
				Type:  "content_block_delta",
				Index: 0,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Thinking: "let me "},
			},
			{
				Type:  "content_block_delta",
				Index: 0,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Thinking: "think about this"},
			},
			{
				Type:  "content_block_start",
				Index: 1,
				ContentBlock: asdk.BetaRawContentBlockStartEventContentBlockUnion{
					Type: "text",
				},
			},
			{
				Type:  "content_block_delta",
				Index: 1,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Text: "Hello, "},
			},
			{
				Type:  "content_block_delta",
				Index: 1,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Text: "world!"},
			},
			{
				Type:  "content_block_start",
				Index: 2,
				ContentBlock: asdk.BetaRawContentBlockStartEventContentBlockUnion{
					Type:  "tool_use",
					ID:    "toolu_1",
					Name:  "weather",
					Input: map[string]any{},
				},
			},
			{
				Type:  "content_block_delta",
				Index: 2,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{PartialJSON: `{"city"`},
			},
			{
				Type:  "content_block_delta",
				Index: 2,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{PartialJSON: `:"Berlin"}`},
			},
			{
				Type: "message_delta",
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{
					StopReason: asdk.BetaStopReasonToolUse,
				},
				Usage: asdk.BetaMessageDeltaUsage{
					InputTokens:  100,
					OutputTokens: 50,
				},
			},
		},
	}

	generation, err := FromStream(req, summary,
		WithConversationID("conv-anthropic-stream"),
		WithAgentName("agent-anthropic-stream"),
		WithAgentVersion("v-anthropic-stream"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("anthropic stream mapping: %v", err)
	}

	if generation.ConversationID != "conv-anthropic-stream" || generation.AgentName != "agent-anthropic-stream" || generation.AgentVersion != "v-anthropic-stream" {
		t.Fatalf("unexpected identity mapping: %#v", generation)
	}
	if generation.ResponseID != "msg_delta_1" || generation.ResponseModel != "claude-sonnet-4-5" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "tool_use" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 150 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 3 {
		t.Fatalf("expected thinking + text + tool call output, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Kind != sigil.PartKindThinking || generation.Output[0].Parts[0].Thinking != "let me think about this" {
		t.Fatalf("unexpected thinking output: %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindText || generation.Output[0].Parts[1].Text != "Hello, world!" {
		t.Fatalf("unexpected text output: %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[2].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[2])
	}
	if string(generation.Output[0].Parts[2].ToolCall.InputJSON) != `{"city":"Berlin"}` {
		t.Fatalf("unexpected streamed tool input: %q", string(generation.Output[0].Parts[2].ToolCall.InputJSON))
	}
	requireAnthropicArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindTools,
		sigil.ArtifactKindProviderEvent,
	)
}

func TestConformance_AnthropicErrorMapping(t *testing.T) {
	if _, err := FromRequestResponse(testRequest(), nil); err == nil || err.Error() != "response is required" {
		t.Fatalf("expected explicit response error, got %v", err)
	}
	if _, err := FromStream(testRequest(), StreamSummary{}); err == nil || err.Error() != "stream summary has no events and no final message" {
		t.Fatalf("expected explicit stream error, got %v", err)
	}

	_, err := FromRequestResponse(
		testRequest(),
		&asdk.BetaMessage{Model: asdk.Model("claude-sonnet-4-5")},
		WithProviderName(""),
	)
	if err == nil || err.Error() != "generation.model.provider is required" {
		t.Fatalf("expected explicit validation error for invalid provider mapping, got %v", err)
	}
}

func requireAnthropicArtifactKinds(t *testing.T, artifacts []sigil.Artifact, want ...sigil.ArtifactKind) {
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
