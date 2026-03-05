package judges

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
)

func TestDiscoverFromEnvRequiresEnableFlags(t *testing.T) {
	isolateDiscoveryEnv(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"test-model"}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_NAME", "ollama")

	discovery := DiscoverFromEnv()
	providers := discovery.ListProviders(context.Background())
	if len(providers) != 0 {
		t.Fatalf("expected no discovered providers without enable flags, got %+v", providers)
	}
}

func TestDiscoverFromEnvRegistersEnabledProviders(t *testing.T) {
	isolateDiscoveryEnv(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"test-model"}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	t.Setenv("SIGIL_EVAL_OPENAI_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_OPENAI_API_KEY", "test-openai")

	t.Setenv("SIGIL_EVAL_GOOGLE_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_GOOGLE_API_KEY", "test-google")

	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL", server.URL)
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY", "test")
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_NAME", "ollama")

	t.Setenv("SIGIL_EVAL_BEDROCK_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_BEDROCK_BEARER_TOKEN", "token")

	discovery := DiscoverFromEnv()
	providers := discovery.ListProviders(context.Background())
	ids := providerIDs(providers)
	sort.Strings(ids)

	expected := []string{"bedrock", "google", "ollama", "openai"}
	if len(ids) != len(expected) {
		t.Fatalf("expected %d providers, got %d: %+v", len(expected), len(ids), ids)
	}
	for i := range expected {
		if ids[i] != expected[i] {
			t.Fatalf("unexpected provider ids: got=%+v want=%+v", ids, expected)
		}
	}
}

func TestDiscoverFromEnvSkipsAnthropicVertexOnInvalidCredentials(t *testing.T) {
	isolateDiscoveryEnv(t)

	t.Setenv("SIGIL_EVAL_ANTHROPIC_VERTEX_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT", "vertex-project")
	t.Setenv("SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_JSON", "{invalid-json}")

	discovery := DiscoverFromEnv()
	providers := discovery.ListProviders(context.Background())
	for _, provider := range providers {
		if provider.ID == "anthropic-vertex" {
			t.Fatalf("expected anthropic-vertex provider to be skipped on invalid credentials")
		}
	}
}

func TestDiscoverFromEnvSkipsVertexAIWithoutProject(t *testing.T) {
	isolateDiscoveryEnv(t)

	t.Setenv("SIGIL_EVAL_VERTEXAI_ENABLED", "true")

	discovery := DiscoverFromEnv()
	providers := discovery.ListProviders(context.Background())
	for _, provider := range providers {
		if provider.ID == "vertexai" {
			t.Fatalf("expected vertexai provider to be skipped when project is missing")
		}
	}
}

func TestDiscoverFromEnvOpenAICompatIndexed(t *testing.T) {
	isolateDiscoveryEnv(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"test-model"}]}`))
	}))
	defer server.Close()

	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_1_ENABLED", "true")
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_1_BASE_URL", server.URL)
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_1_API_KEY", "test")
	t.Setenv("SIGIL_EVAL_OPENAI_COMPAT_1_NAME", "local-vllm")

	discovery := DiscoverFromEnv()
	client, ok := discovery.Client("local-vllm")
	if !ok || client == nil {
		t.Fatalf("expected discovered local-vllm client")
	}

	models, err := discovery.ListModels(context.Background(), "local-vllm")
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 1 || models[0].ID != "test-model" {
		t.Fatalf("unexpected models %+v", models)
	}
	if models[0].Provider != "local-vllm" {
		t.Fatalf("expected model provider metadata to match provider id, got %+v", models[0])
	}
}

func TestDiscoveryListModelsUnknownProvider(t *testing.T) {
	isolateDiscoveryEnv(t)

	discovery := NewDiscovery()
	if _, err := discovery.ListModels(context.Background(), "missing"); err == nil {
		t.Fatalf("expected error for unknown provider")
	}
}

func isolateDiscoveryEnv(t *testing.T) {
	t.Helper()

	keys := []string{
		"SIGIL_EVAL_OPENAI_ENABLED",
		"SIGIL_EVAL_OPENAI_API_KEY",
		"SIGIL_EVAL_OPENAI_BASE_URL",
		"SIGIL_EVAL_AZURE_OPENAI_ENABLED",
		"SIGIL_EVAL_AZURE_OPENAI_ENDPOINT",
		"SIGIL_EVAL_AZURE_OPENAI_API_KEY",
		"SIGIL_EVAL_ANTHROPIC_ENABLED",
		"SIGIL_EVAL_ANTHROPIC_API_KEY",
		"SIGIL_EVAL_ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"SIGIL_EVAL_BEDROCK_ENABLED",
		"SIGIL_EVAL_BEDROCK_REGION",
		"AWS_REGION",
		"SIGIL_EVAL_BEDROCK_BASE_URL",
		"SIGIL_EVAL_BEDROCK_BEARER_TOKEN",
		"SIGIL_EVAL_GOOGLE_ENABLED",
		"SIGIL_EVAL_GOOGLE_API_KEY",
		"GOOGLE_API_KEY",
		"GEMINI_API_KEY",
		"SIGIL_EVAL_GOOGLE_BASE_URL",
		"SIGIL_EVAL_VERTEXAI_ENABLED",
		"SIGIL_EVAL_VERTEXAI_PROJECT",
		"SIGIL_EVAL_VERTEXAI_LOCATION",
		"SIGIL_EVAL_VERTEXAI_CREDENTIALS_FILE",
		"SIGIL_EVAL_VERTEXAI_CREDENTIALS_JSON",
		"SIGIL_EVAL_VERTEXAI_BASE_URL",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_ENABLED",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_LOCATION",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_FILE",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_JSON",
		"SIGIL_EVAL_ANTHROPIC_VERTEX_BASE_URL",
		"SIGIL_EVAL_OPENAI_COMPAT_ENABLED",
		"SIGIL_EVAL_OPENAI_COMPAT_BASE_URL",
		"SIGIL_EVAL_OPENAI_COMPAT_API_KEY",
		"SIGIL_EVAL_OPENAI_COMPAT_NAME",
	}

	for i := 1; i <= 20; i++ {
		prefix := fmt.Sprintf("SIGIL_EVAL_OPENAI_COMPAT_%d", i)
		keys = append(keys,
			prefix+"_ENABLED",
			prefix+"_BASE_URL",
			prefix+"_API_KEY",
			prefix+"_NAME",
		)
	}

	for _, key := range keys {
		t.Setenv(key, "")
	}
}

func providerIDs(providers []ProviderInfo) []string {
	ids := make([]string, 0, len(providers))
	for _, provider := range providers {
		ids = append(ids, provider.ID)
	}
	return ids
}
