package judges

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	cloudauth "cloud.google.com/go/auth"
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

func TestVertexAIClientJudgeWithStaticCredentials(t *testing.T) {
	var gotPath string
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotPath = req.URL.Path
		gotAuth = req.Header.Get("Authorization")
		if strings.Contains(req.URL.Path, ":generateContent") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"judge output"}]}}],"usageMetadata":{"promptTokenCount":13,"candidatesTokenCount":6}}`))
			return
		}
		http.NotFound(w, req)
	}))
	defer server.Close()

	credentials := cloudauth.NewCredentials(&cloudauth.CredentialsOptions{
		TokenProvider: staticTokenProvider{token: "vertex-access-token"},
	})
	client := newVertexAIClientWithCredentials(server.Client(), server.URL, "vertex-project", "global", credentials)
	response, err := client.Judge(context.Background(), JudgeRequest{
		SystemPrompt: "judge",
		UserPrompt:   "answer",
		Model:        "publishers/google/models/gemini-2.0-flash",
		MaxTokens:    64,
		Temperature:  0,
	})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}
	if response.Text != "judge output" {
		t.Fatalf("unexpected judge output %q", response.Text)
	}
	if gotAuth != "Bearer vertex-access-token" {
		t.Fatalf("expected bearer auth header, got %q", gotAuth)
	}
	if !strings.Contains(gotPath, "/projects/vertex-project/locations/global/") {
		t.Fatalf("expected vertex project/location path, got %q", gotPath)
	}
	if !strings.Contains(gotPath, "/publishers/google/models/gemini-2.0-flash:generateContent") {
		t.Fatalf("expected model path in vertex request, got %q", gotPath)
	}
}

func TestVertexAIClientRejectsAPIKey(t *testing.T) {
	client := NewVertexAIClient(nil, "", "vertex-project", "global", "vertex-key", "", "")
	if client.initErr == nil {
		t.Fatalf("expected vertex init error when api key is configured")
	}
	if !strings.Contains(client.initErr.Error(), "does not support API keys") {
		t.Fatalf("unexpected vertex api key error: %v", client.initErr)
	}
}

func TestResolveVertexCredentialsValidation(t *testing.T) {
	if _, err := resolveVertexCredentials("/tmp/creds.json", "{}"); err == nil {
		t.Fatalf("expected credentials file/json mutual exclusivity error")
	}
	if _, err := resolveVertexCredentials("", "{invalid-json}"); err == nil {
		t.Fatalf("expected invalid credentials json error")
	}
	if _, err := resolveVertexCredentials("", `{"type":"unsupported"}`); err == nil || !strings.Contains(err.Error(), "unsupported cloud credential type") {
		t.Fatalf("expected unsupported credentials type error, got %v", err)
	}
}

func TestNormalizeGoogleModelID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "gemini_models_prefix", input: "models/gemini-2.0-flash", want: "gemini-2.0-flash"},
		{name: "vertex_publishers_path", input: "publishers/google/models/gemini-2.5-pro", want: "gemini-2.5-pro"},
		{name: "vertex_full_resource", input: "projects/p/locations/global/publishers/google/models/gemini-1.5-pro", want: "gemini-1.5-pro"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeGoogleModelID(tc.input)
			if got != tc.want {
				t.Fatalf("normalizeGoogleModelID(%q)=%q want %q", tc.input, got, tc.want)
			}
		})
	}
}

type staticTokenProvider struct {
	token string
}

func (s staticTokenProvider) Token(context.Context) (*cloudauth.Token, error) {
	return &cloudauth.Token{
		Value:  s.token,
		Expiry: time.Now().Add(time.Hour),
	}, nil
}
