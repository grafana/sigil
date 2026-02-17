package judges

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGoogleClientJudgeAndListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/v1beta/models") && req.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-2.0-flash","displayName":"Gemini 2.0 Flash","inputTokenLimit":1048576}]}`))
			return
		}
		if strings.Contains(req.URL.Path, ":generateContent") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"judge output"}]}}],"usageMetadata":{"promptTokenCount":13,"candidatesTokenCount":6}}`))
			return
		}
		http.NotFound(w, req)
	}))
	defer server.Close()

	client := NewGoogleClient(server.Client(), server.URL, "key")
	response, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "gemini-2.0-flash",
		MaxTokens:    64,
		Temperature:  0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if response.Usage.InputTokens != 13 || response.Usage.OutputTokens != 6 {
		t.Fatalf("unexpected usage %+v", response.Usage)
	}

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 1 || models[0].ID != "gemini-2.0-flash" {
		t.Fatalf("unexpected models %+v", models)
	}
}
