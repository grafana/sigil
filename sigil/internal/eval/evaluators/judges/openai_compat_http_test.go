package judges

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAICompatHTTPClientNormalizesBaseURLWithV1Suffix(t *testing.T) {
	paths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		paths = append(paths, req.URL.Path)
		switch req.URL.Path {
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"judge-model","choices":[{"message":{"content":"judge output"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"judge-model"}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	client := newOpenAICompatHTTPClient(server.Client(), "ollama", server.URL+"/v1", "test-key")
	if _, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "judge-model",
		MaxTokens:    16,
	}); err != nil {
		t.Fatalf("judge request failed: %v", err)
	}
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models failed: %v", err)
	}
	if len(models) != 1 || models[0].ID != "judge-model" {
		t.Fatalf("unexpected model response %+v", models)
	}
	if models[0].Provider != "ollama" {
		t.Fatalf("expected provider=ollama, got %q", models[0].Provider)
	}

	for _, path := range paths {
		if strings.Contains(path, "/v1/v1/") {
			t.Fatalf("expected normalized /v1 path, got %q", path)
		}
	}
}

func TestNormalizeOpenAICompatBaseURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "root_no_suffix", input: "https://example.com", want: "https://example.com"},
		{name: "root_with_suffix", input: "https://example.com/v1", want: "https://example.com"},
		{name: "path_with_suffix", input: "https://example.com/openai/v1/", want: "https://example.com/openai"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeOpenAICompatBaseURL(tc.input)
			if got != tc.want {
				t.Fatalf("normalizeOpenAICompatBaseURL(%q)=%q want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestOpenAICompatHTTPClientJudgeWithThinkingSetsReasoningEffort(t *testing.T) {
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
		_, _ = w.Write([]byte(`{"model":"judge-model","choices":[{"message":{"content":"judge output"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer server.Close()

	client := newOpenAICompatHTTPClient(server.Client(), "ollama", server.URL, "test-key")
	_, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "judge-model",
		MaxTokens:    16,
		Thinking: ThinkingConfig{
			Mode:  ThinkingModePrefer,
			Level: ThinkingLevelLow,
		},
	})
	if err != nil {
		t.Fatalf("judge request failed: %v", err)
	}
	if got, ok := payload["reasoning_effort"].(string); !ok || got != "low" {
		t.Fatalf("expected reasoning_effort=low, got %#v", payload["reasoning_effort"])
	}
}
