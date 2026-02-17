package judges

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverFromEnv(t *testing.T) {
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
	if len(providers) != 1 {
		t.Fatalf("expected one discovered provider, got %d", len(providers))
	}
	if providers[0].ID != "ollama" {
		t.Fatalf("expected provider id ollama, got %q", providers[0].ID)
	}

	client, ok := discovery.Client("ollama")
	if !ok || client == nil {
		t.Fatalf("expected discovered ollama client")
	}

	models, err := discovery.ListModels(context.Background(), "ollama")
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 1 || models[0].ID != "test-model" {
		t.Fatalf("unexpected models %+v", models)
	}
}

func TestDiscoveryListModelsUnknownProvider(t *testing.T) {
	discovery := NewDiscovery()
	if _, err := discovery.ListModels(context.Background(), "missing"); err == nil {
		t.Fatalf("expected error for unknown provider")
	}
}
