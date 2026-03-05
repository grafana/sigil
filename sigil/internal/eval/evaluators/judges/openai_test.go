package judges

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIClientJudgeAndListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"gpt-4o-mini","choices":[{"message":{"content":"judge output"}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}`))
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4.1-mini"}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	client := NewOpenAIClient(server.Client(), server.URL, "key")
	response, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "gpt-4o-mini",
		MaxTokens:    32,
		Temperature:  0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge response text %q", response.Text)
	}
	if response.Usage.InputTokens != 11 || response.Usage.OutputTokens != 7 {
		t.Fatalf("unexpected usage %+v", response.Usage)
	}

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
}

func TestOpenAIClientJudgeWithThinkingSetsReasoningEffort(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, req)
			return
		}
		defer func() { _ = req.Body.Close() }()
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-4o-mini","choices":[{"message":{"content":"judge output"}}]}`))
	}))
	defer server.Close()

	client := NewOpenAIClient(server.Client(), server.URL, "key")
	_, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "gpt-4o-mini",
		MaxTokens:    32,
		Temperature:  0,
		Thinking: ThinkingConfig{
			Mode:  ThinkingModePrefer,
			Level: ThinkingLevelHigh,
		},
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if got, ok := payload["reasoning_effort"].(string); !ok || got != "high" {
		t.Fatalf("expected reasoning_effort=high, got %#v", payload["reasoning_effort"])
	}
}
