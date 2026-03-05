package judges

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

func TestAnthropicClientJudgeAndListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v1/messages":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"claude-3-5-sonnet","content":[{"type":"text","text":"judge output"}],"usage":{"input_tokens":9,"output_tokens":4}}`))
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"claude-3-5-sonnet"}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	client := NewAnthropicClient(server.Client(), server.URL, "key", "")
	response, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "claude-3-5-sonnet",
		MaxTokens:    32,
		Temperature:  0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if response.Usage.InputTokens != 9 || response.Usage.OutputTokens != 4 {
		t.Fatalf("unexpected usage %+v", response.Usage)
	}

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 1 || models[0].ID != "claude-3-5-sonnet" {
		t.Fatalf("unexpected models %+v", models)
	}
}

func TestAnthropicClientJudgeWithAdaptiveThinking(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer func() { _ = req.Body.Close() }()
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"claude-3-5-sonnet","content":[{"type":"text","text":"judge output"}],"usage":{"input_tokens":9,"output_tokens":4}}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(server.Client(), server.URL, "key", "")
	_, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "claude-3-5-sonnet",
		MaxTokens:    1400,
		Temperature:  0,
		Thinking: ThinkingConfig{
			Mode:          ThinkingModePrefer,
			AnthropicMode: AnthropicThinkingModeAdaptive,
		},
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	thinkingPayload, ok := payload["thinking"].(map[string]any)
	if !ok {
		t.Fatalf("expected thinking payload, got %#v", payload["thinking"])
	}
	if gotType, ok := thinkingPayload["type"].(string); !ok || gotType != "adaptive" {
		t.Fatalf("expected adaptive thinking type, got %#v", thinkingPayload["type"])
	}
	if gotTemp, ok := payload["temperature"].(float64); !ok || gotTemp != 1.0 {
		t.Fatalf("expected temperature=1.0 when thinking is enabled, got %v", payload["temperature"])
	}
}

func TestAnthropicClientJudgeThinkingOverridesTemperature(t *testing.T) {
	tests := []struct {
		name     string
		thinking ThinkingConfig
	}{
		{
			name: "adaptive thinking",
			thinking: ThinkingConfig{
				Mode:          ThinkingModePrefer,
				AnthropicMode: AnthropicThinkingModeAdaptive,
			},
		},
		{
			name: "budgeted thinking",
			thinking: ThinkingConfig{
				Mode:          ThinkingModeRequire,
				AnthropicMode: AnthropicThinkingModeBudgeted,
				BudgetTokens:  2048,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var payload map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				defer func() { _ = req.Body.Close() }()
				if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
					t.Fatalf("decode payload: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"model":"claude-3-5-sonnet","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
			}))
			defer server.Close()

			client := NewAnthropicClient(server.Client(), server.URL, "key", "")
			_, err := client.Judge(context.Background(), JudgeRequest{
				UserPrompt:  "answer",
				Model:       "claude-3-5-sonnet",
				MaxTokens:   4096,
				Temperature: 0,
				Thinking:    tt.thinking,
			})
			if err != nil {
				t.Fatalf("judge: %v", err)
			}
			gotTemp, ok := payload["temperature"].(float64)
			if !ok || gotTemp != 1.0 {
				t.Errorf("expected temperature=1.0 when thinking enabled, got %v", payload["temperature"])
			}
		})
	}
}

func TestAnthropicClientJudgeWithAuthToken(t *testing.T) {
	var gotAuthorizationHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotAuthorizationHeader = req.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"claude-3-5-sonnet","content":[{"type":"text","text":"judge output"}],"usage":{"input_tokens":9,"output_tokens":4}}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(server.Client(), server.URL, "", "token-123")
	response, err := client.Judge(context.Background(), JudgeRequest{
		UserPrompt:  "answer",
		Model:       "claude-3-5-sonnet",
		MaxTokens:   32,
		Temperature: 0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if !strings.HasPrefix(strings.ToLower(gotAuthorizationHeader), "bearer ") {
		t.Fatalf("expected bearer authorization header, got %q", gotAuthorizationHeader)
	}
}

func TestResolveGoogleCredentialsValidation(t *testing.T) {
	if _, err := resolveGoogleCredentials("/tmp/creds.json", "{}"); err == nil {
		t.Fatalf("expected credentials file/json mutual exclusivity error")
	}
	if _, err := resolveGoogleCredentials("", "{invalid-json}"); err == nil {
		t.Fatalf("expected invalid credentials json error")
	}
	if _, err := resolveGoogleCredentials("", `{"type":"unsupported"}`); err == nil || !strings.Contains(err.Error(), "unsupported oauth credential type") {
		t.Fatalf("expected unsupported credentials type error, got %v", err)
	}
}

func TestBedrockAnthropicClientJudgeUsesBedrockAdapter(t *testing.T) {
	var gotPath string
	var gotAuthorizationHeader string
	var gotPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		gotAuthorizationHeader = req.Header.Get("Authorization")
		defer func() { _ = req.Body.Close() }()
		_ = json.NewDecoder(req.Body).Decode(&gotPayload)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"judge output"}],"model":"anthropic.claude-3-5-sonnet-v1:0","stop_reason":"end_turn","stop_sequence":"","usage":{"input_tokens":9,"output_tokens":4}}`))
	}))
	defer server.Close()

	client := NewBedrockAnthropicClient(server.Client(), server.URL, "us-east-1", "token-123")
	response, err := client.Judge(context.Background(), JudgeRequest{
		UserPrompt:  "answer",
		Model:       "anthropic.claude-3-5-sonnet-v1:0",
		MaxTokens:   32,
		Temperature: 0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if gotPath != "/model/anthropic.claude-3-5-sonnet-v1:0/invoke" {
		t.Fatalf("unexpected bedrock path %q", gotPath)
	}
	if !strings.HasPrefix(strings.ToLower(gotAuthorizationHeader), "bearer ") {
		t.Fatalf("expected bearer authorization header, got %q", gotAuthorizationHeader)
	}
	if version, ok := gotPayload["anthropic_version"].(string); !ok || version == "" {
		t.Fatalf("expected bedrock anthropic_version in payload, got %#v", gotPayload["anthropic_version"])
	}
	if _, exists := gotPayload["model"]; exists {
		t.Fatalf("expected model field to be moved to bedrock path")
	}

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("expected empty model list for bedrock, got %+v", models)
	}
}

func TestAnthropicVertexClientJudgeUsesVertexAdapter(t *testing.T) {
	var gotPath string
	var gotAuthorizationHeader string
	var gotPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		gotAuthorizationHeader = req.Header.Get("Authorization")
		defer func() { _ = req.Body.Close() }()
		_ = json.NewDecoder(req.Body).Decode(&gotPayload)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"judge output"}],"model":"claude-sonnet-4-5@20250929","stop_reason":"end_turn","stop_sequence":"","usage":{"input_tokens":9,"output_tokens":4}}`))
	}))
	defer server.Close()

	client := newAnthropicVertexClientWithCredentials(
		server.Client(),
		server.URL,
		"vertex-project",
		"global",
		&google.Credentials{TokenSource: oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "vertex-token"})},
	)
	response, err := client.Judge(context.Background(), JudgeRequest{
		UserPrompt:  "answer",
		Model:       "claude-sonnet-4-5@20250929",
		MaxTokens:   32,
		Temperature: 0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if gotPath != "/v1/projects/vertex-project/locations/global/publishers/anthropic/models/claude-sonnet-4-5@20250929:rawPredict" {
		t.Fatalf("unexpected vertex path %q", gotPath)
	}
	if !strings.HasPrefix(strings.ToLower(gotAuthorizationHeader), "bearer ") {
		t.Fatalf("expected bearer authorization header, got %q", gotAuthorizationHeader)
	}
	if version, ok := gotPayload["anthropic_version"].(string); !ok || version == "" {
		t.Fatalf("expected vertex anthropic_version in payload, got %#v", gotPayload["anthropic_version"])
	}
	if _, exists := gotPayload["model"]; exists {
		t.Fatalf("expected model field to be moved to vertex path")
	}

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("expected empty model list for anthropic-vertex, got %+v", models)
	}
}
