package judges

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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

	client := NewAnthropicClient(server.Client(), server.URL, "key")
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
