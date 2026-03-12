package gemini

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/genai"

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
	Temperature     float64           `json:"temperature"`
	TopP            float64           `json:"top_p"`
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

func TestConformance_GenerateContentExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	temperature := float32(0.4)
	topP := float32(0.75)
	thinkingBudget := int32(2048)
	model := "gemini-2.5-pro"
	contents := []*genai.Content{
		genai.NewContentFromText("What is the weather in Paris?", genai.RoleUser),
		genai.NewContentFromParts([]*genai.Part{
			genai.NewPartFromFunctionResponse("weather", map[string]any{"temp_c": 18}),
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

	resp := &genai.GenerateContentResponse{
		ResponseID:   "resp_1",
		ModelVersion: "gemini-2.5-pro-001",
		Candidates: []*genai.Candidate{
			{
				FinishReason: genai.FinishReasonStop,
				Content: genai.NewContentFromParts([]*genai.Part{
					{Text: "Need to check the weather.", Thought: true},
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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, ":generateContent") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	provider, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:  "test-key",
		Backend: genai.BackendGeminiAPI,
		HTTPOptions: genai.HTTPOptions{
			BaseURL: server.URL,
		},
	})
	if err != nil {
		t.Fatalf("new genai client: %v", err)
	}

	gotResponse, err := GenerateContent(context.Background(), sigilClient, provider, model, contents, config)
	if err != nil {
		t.Fatalf("GenerateContent: %v", err)
	}
	if gotResponse == nil || gotResponse.ResponseID != "resp_1" {
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
	if generation.Model.Provider != "gemini" || generation.Model.Name != "gemini-2.5-pro" {
		t.Fatalf("expected gemini gemini-2.5-pro model, got %#v", generation.Model)
	}
	if generation.ResponseID != "resp_1" || generation.ResponseModel != "gemini-2.5-pro-001" {
		t.Fatalf("expected response identifiers, got id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.SystemPrompt != "Be concise." {
		t.Fatalf("expected system prompt Be concise., got %q", generation.SystemPrompt)
	}
	if generation.StopReason != "STOP" {
		t.Fatalf("expected stop reason STOP, got %q", generation.StopReason)
	}
	if generation.MaxTokens != 300 {
		t.Fatalf("expected max tokens 300, got %d", generation.MaxTokens)
	}
	if math.Abs(generation.Temperature-0.4) > 1e-6 {
		t.Fatalf("expected temperature 0.4, got %v", generation.Temperature)
	}
	if math.Abs(generation.TopP-0.75) > 1e-6 {
		t.Fatalf("expected top_p 0.75, got %v", generation.TopP)
	}
	if !generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true")
	}
	if generation.Usage.TotalTokens != 170 {
		t.Fatalf("expected total tokens 170, got %d", generation.Usage.TotalTokens)
	}
	if generation.Usage.CacheReadInputTokens != 12 {
		t.Fatalf("expected cache read input tokens 12, got %d", generation.Usage.CacheReadInputTokens)
	}
	if generation.Usage.ReasoningTokens != 10 {
		t.Fatalf("expected reasoning tokens 10, got %d", generation.Usage.ReasoningTokens)
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"]) != 2048 {
		t.Fatalf("expected thinking budget metadata 2048, got %#v", generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"])
	}
	if generation.Metadata["sigil.gen_ai.request.thinking.level"] != "high" {
		t.Fatalf("expected thinking level metadata high, got %#v", generation.Metadata["sigil.gen_ai.request.thinking.level"])
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.usage.tool_use_prompt_tokens"]) != 9 {
		t.Fatalf("expected tool use prompt tokens 9, got %#v", generation.Metadata["sigil.gen_ai.usage.tool_use_prompt_tokens"])
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 3 {
		t.Fatalf("expected thinking, tool call, and text output parts, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Thinking != "Need to check the weather." {
		t.Fatalf("expected thinking output, got %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].ToolCall == nil {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[1].ToolCall.Name != "weather" {
		t.Fatalf("expected weather tool call, got %#v", generation.Output[0].Parts[1].ToolCall)
	}
	if decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON) != `{"city":"Paris"}` {
		t.Fatalf("expected tool call args {\"city\":\"Paris\"}, got %s", decodeBase64JSON(t, generation.Output[0].Parts[1].ToolCall.InputJSON))
	}
	if generation.Output[0].Parts[2].Text != "It is 18C and sunny." {
		t.Fatalf("expected assistant text output, got %#v", generation.Output[0].Parts[2])
	}
}

func TestConformance_GenerateContentStreamExportsNormalizedGeneration(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	temperature := float32(0.2)
	topP := float32(0.6)
	thinkingBudget := int32(1536)
	model := "gemini-2.5-pro"
	contents := []*genai.Content{
		genai.NewContentFromText("What is the weather in Paris?", genai.RoleUser),
	}
	config := &genai.GenerateContentConfig{
		MaxOutputTokens: 90,
		Temperature:     &temperature,
		TopP:            &topP,
		ToolConfig: &genai.ToolConfig{
			FunctionCallingConfig: &genai.FunctionCallingConfig{
				Mode: genai.FunctionCallingConfigModeAuto,
			},
		},
		ThinkingConfig: &genai.ThinkingConfig{
			IncludeThoughts: false,
			ThinkingBudget:  &thinkingBudget,
			ThinkingLevel:   genai.ThinkingLevelMedium,
		},
		Tools: []*genai.Tool{
			{
				FunctionDeclarations: []*genai.FunctionDeclaration{
					{Name: "weather"},
				},
			},
		},
	}

	responses := []*genai.GenerateContentResponse{
		{
			ResponseID:   "resp_stream_1",
			ModelVersion: "gemini-2.5-pro-001",
			Candidates: []*genai.Candidate{
				{
					Content: genai.NewContentFromParts([]*genai.Part{
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
			ResponseID:   "resp_stream_2",
			ModelVersion: "gemini-2.5-pro-001",
			Candidates: []*genai.Candidate{
				{
					FinishReason: genai.FinishReasonStop,
					Content: genai.NewContentFromParts([]*genai.Part{
						{Text: "Reasoned answer.", Thought: true},
						genai.NewPartFromText("It is 18C and sunny."),
					}, genai.RoleModel),
				},
			},
			UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
				PromptTokenCount:        20,
				CandidatesTokenCount:    6,
				TotalTokenCount:         31,
				ToolUsePromptTokenCount: 5,
			},
		},
	}

	encodedResponses := make([][]byte, 0, len(responses))
	for _, response := range responses {
		encoded, err := json.Marshal(response)
		if err != nil {
			t.Fatalf("marshal stream response: %v", err)
		}
		encodedResponses = append(encodedResponses, encoded)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.Contains(r.URL.Path, ":streamGenerateContent") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, encoded := range encodedResponses {
			_, _ = fmt.Fprintf(w, "data:%s\n\n", encoded)
		}
	}))
	defer server.Close()

	provider, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:  "test-key",
		Backend: genai.BackendGeminiAPI,
		HTTPOptions: genai.HTTPOptions{
			BaseURL: server.URL,
		},
	})
	if err != nil {
		t.Fatalf("new genai client: %v", err)
	}

	summary, err := GenerateContentStream(context.Background(), sigilClient, provider, model, contents, config)
	if err != nil {
		t.Fatalf("GenerateContentStream: %v", err)
	}
	if len(summary.Responses) != 2 {
		t.Fatalf("expected two streamed responses, got %d", len(summary.Responses))
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
	if generation.StopReason != "STOP" {
		t.Fatalf("expected stop reason STOP, got %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 31 {
		t.Fatalf("expected total tokens 31, got %d", generation.Usage.TotalTokens)
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"]) != 1536 {
		t.Fatalf("expected thinking budget metadata 1536, got %#v", generation.Metadata["sigil.gen_ai.request.thinking.budget_tokens"])
	}
	if generation.Metadata["sigil.gen_ai.request.thinking.level"] != "medium" {
		t.Fatalf("expected thinking level metadata medium, got %#v", generation.Metadata["sigil.gen_ai.request.thinking.level"])
	}
	if metadataInt64(t, generation.Metadata["sigil.gen_ai.usage.tool_use_prompt_tokens"]) != 5 {
		t.Fatalf("expected tool use prompt tokens 5, got %#v", generation.Metadata["sigil.gen_ai.usage.tool_use_prompt_tokens"])
	}
	if len(generation.Output) != 2 {
		t.Fatalf("expected one tool-call message and one assistant message, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].ToolCall == nil {
		t.Fatalf("expected streamed tool call output, got %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[0].ToolCall.Name != "weather" {
		t.Fatalf("expected weather tool call, got %#v", generation.Output[0].Parts[0].ToolCall)
	}
	if generation.Output[1].Parts[0].Thinking != "Reasoned answer." {
		t.Fatalf("expected streamed thinking output, got %#v", generation.Output[1].Parts[0])
	}
	if generation.Output[1].Parts[1].Text != "It is 18C and sunny." {
		t.Fatalf("expected streamed assistant text output, got %#v", generation.Output[1].Parts[1])
	}
}

func TestConformance_GenerateContentProviderErrorExportsCallError(t *testing.T) {
	capture := newGenerationCapture(t)
	sigilClient := newConformanceClient(t, capture.endpoint())

	model := "gemini-2.5-pro"
	contents := []*genai.Content{genai.NewContentFromText("hello", genai.RoleUser)}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, ":generateContent") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"error":{"code":503,"message":"provider unavailable","status":"UNAVAILABLE"}}`)
	}))
	defer server.Close()

	provider, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:  "test-key",
		Backend: genai.BackendGeminiAPI,
		HTTPOptions: genai.HTTPOptions{
			BaseURL: server.URL,
		},
	})
	if err != nil {
		t.Fatalf("new genai client: %v", err)
	}

	_, err = GenerateContent(context.Background(), sigilClient, provider, model, contents, nil)
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
	if generation.Model.Provider != "gemini" || generation.Model.Name != "gemini-2.5-pro" {
		t.Fatalf("expected gemini gemini-2.5-pro model, got %#v", generation.Model)
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

func TestConformance_GenerateContentSyncNormalization(t *testing.T) {
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
						},
					},
				},
			},
		},
	}

	resp := &genai.GenerateContentResponse{
		ResponseID:   "resp_1",
		ModelVersion: "gemini-2.5-pro-001",
		Candidates: []*genai.Candidate{
			{
				FinishReason: genai.FinishReasonStop,
				Content: genai.NewContentFromParts([]*genai.Part{
					{
						Text:    "reasoning trace",
						Thought: true,
					},
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

	generation, err := FromRequestResponse(model, contents, config, resp,
		WithConversationID("conv-gemini-sync"),
		WithConversationTitle("Paris weather"),
		WithAgentName("agent-gemini"),
		WithAgentVersion("v-gemini"),
		WithTag("tenant", "t-123"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("gemini sync mapping: %v", err)
	}

	if generation.Model.Provider != "gemini" || generation.Model.Name != "gemini-2.5-pro" {
		t.Fatalf("unexpected model mapping: %#v", generation.Model)
	}
	if generation.ConversationID != "conv-gemini-sync" || generation.ConversationTitle != "Paris weather" {
		t.Fatalf("unexpected conversation mapping: %#v", generation)
	}
	if generation.AgentName != "agent-gemini" || generation.AgentVersion != "v-gemini" {
		t.Fatalf("unexpected agent mapping: name=%q version=%q", generation.AgentName, generation.AgentVersion)
	}
	if generation.ResponseID != "resp_1" || generation.ResponseModel != "gemini-2.5-pro-001" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "STOP" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 170 || generation.Usage.CacheReadInputTokens != 12 || generation.Usage.ReasoningTokens != 10 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if generation.ThinkingEnabled == nil || !*generation.ThinkingEnabled {
		t.Fatalf("expected thinking enabled true, got %v", generation.ThinkingEnabled)
	}
	if generation.Temperature == nil || math.Abs(*generation.Temperature-0.4) > 1e-6 {
		t.Fatalf("unexpected temperature: %v", generation.Temperature)
	}
	if generation.TopP == nil || math.Abs(*generation.TopP-0.75) > 1e-6 {
		t.Fatalf("unexpected top_p: %v", generation.TopP)
	}
	if len(generation.Output) != 1 || len(generation.Output[0].Parts) != 3 {
		t.Fatalf("expected thinking + tool call + text output, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Kind != sigil.PartKindThinking || generation.Output[0].Parts[0].Thinking != "reasoning trace" {
		t.Fatalf("unexpected thinking output: %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected tool call output, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[0].Parts[2].Kind != sigil.PartKindText || generation.Output[0].Parts[2].Text != "It is 18C and sunny." {
		t.Fatalf("unexpected text output: %#v", generation.Output[0].Parts[2])
	}
	if generation.Metadata["sigil.gen_ai.request.thinking.level"] != "high" {
		t.Fatalf("unexpected thinking level metadata: %#v", generation.Metadata)
	}
	if generation.Tags["tenant"] != "t-123" {
		t.Fatalf("expected tenant tag")
	}
	requireGeminiArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindResponse,
		sigil.ArtifactKindTools,
	)
}

func TestConformance_GenerateContentStreamNormalization(t *testing.T) {
	temperature := float32(0.2)
	topP := float32(0.6)
	thinkingBudget := int32(1536)
	model := "gemini-2.5-pro"
	contents := []*genai.Content{
		genai.NewContentFromText("What is the weather in Paris?", genai.RoleUser),
	}
	config := &genai.GenerateContentConfig{
		MaxOutputTokens: 90,
		Temperature:     &temperature,
		TopP:            &topP,
		ToolConfig: &genai.ToolConfig{
			FunctionCallingConfig: &genai.FunctionCallingConfig{
				Mode: genai.FunctionCallingConfigModeAuto,
			},
		},
		ThinkingConfig: &genai.ThinkingConfig{
			IncludeThoughts: true,
			ThinkingBudget:  &thinkingBudget,
			ThinkingLevel:   genai.ThinkingLevelMedium,
		},
		Tools: []*genai.Tool{
			{
				FunctionDeclarations: []*genai.FunctionDeclaration{
					{Name: "weather"},
				},
			},
		},
	}

	summary := StreamSummary{
		Responses: []*genai.GenerateContentResponse{
			{
				ResponseID:   "resp_stream_1",
				ModelVersion: "gemini-2.5-pro-001",
				Candidates: []*genai.Candidate{
					{
						Content: genai.NewContentFromParts([]*genai.Part{
							{
								Text:    "reasoning trace",
								Thought: true,
							},
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
				ResponseID:   "resp_stream_2",
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

	generation, err := FromStream(model, contents, config, summary,
		WithConversationID("conv-gemini-stream"),
		WithAgentName("agent-gemini-stream"),
		WithAgentVersion("v-gemini-stream"),
		WithRawArtifacts(),
	)
	if err != nil {
		t.Fatalf("gemini stream mapping: %v", err)
	}

	if generation.ConversationID != "conv-gemini-stream" || generation.AgentName != "agent-gemini-stream" || generation.AgentVersion != "v-gemini-stream" {
		t.Fatalf("unexpected identity mapping: %#v", generation)
	}
	if generation.ResponseID != "resp_stream_2" || generation.ResponseModel != "gemini-2.5-pro-001" {
		t.Fatalf("unexpected response mapping: id=%q model=%q", generation.ResponseID, generation.ResponseModel)
	}
	if generation.StopReason != "STOP" {
		t.Fatalf("unexpected stop reason: %q", generation.StopReason)
	}
	if generation.Usage.TotalTokens != 31 || generation.Usage.ReasoningTokens != 4 {
		t.Fatalf("unexpected usage mapping: %#v", generation.Usage)
	}
	if len(generation.Output) != 2 {
		t.Fatalf("expected streamed thinking/tool output plus final text, got %#v", generation.Output)
	}
	if generation.Output[0].Parts[0].Kind != sigil.PartKindThinking || generation.Output[0].Parts[0].Thinking != "reasoning trace" {
		t.Fatalf("unexpected streamed thinking output: %#v", generation.Output[0].Parts[0])
	}
	if generation.Output[0].Parts[1].Kind != sigil.PartKindToolCall {
		t.Fatalf("expected streamed tool call output, got %#v", generation.Output[0].Parts[1])
	}
	if generation.Output[1].Parts[0].Kind != sigil.PartKindText || generation.Output[1].Parts[0].Text != "It is 18C and sunny." {
		t.Fatalf("unexpected streamed text output: %#v", generation.Output[1].Parts[0])
	}
	requireGeminiArtifactKinds(t, generation.Artifacts,
		sigil.ArtifactKindRequest,
		sigil.ArtifactKindTools,
		sigil.ArtifactKindProviderEvent,
	)
}

func TestConformance_GeminiErrorMapping(t *testing.T) {
	if _, err := FromRequestResponse("", nil, nil, &genai.GenerateContentResponse{}); err == nil || err.Error() != "request model is required" {
		t.Fatalf("expected explicit request model error, got %v", err)
	}
	if _, err := FromRequestResponse("gemini-2.5-pro", nil, nil, nil); err == nil || err.Error() != "response is required" {
		t.Fatalf("expected explicit response error, got %v", err)
	}
	if _, err := FromStream("gemini-2.5-pro", nil, nil, StreamSummary{}); err == nil || err.Error() != "stream summary has no responses" {
		t.Fatalf("expected explicit stream error, got %v", err)
	}

	_, err := FromRequestResponse(
		"gemini-2.5-pro",
		nil,
		nil,
		&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{
				{
					Content: genai.NewContentFromText("ok", genai.RoleModel),
				},
			},
		},
		WithProviderName(""),
	)
	if err == nil || err.Error() != "generation.model.provider is required" {
		t.Fatalf("expected explicit validation error for invalid provider mapping, got %v", err)
	}
}

func requireGeminiArtifactKinds(t *testing.T, artifacts []sigil.Artifact, want ...sigil.ArtifactKind) {
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
