package judges

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type Discovery struct {
	providers map[string]providerEntry
}

type providerEntry struct {
	info   ProviderInfo
	client JudgeClient
}

func NewDiscovery() *Discovery {
	return &Discovery{providers: map[string]providerEntry{}}
}

func DiscoverFromEnv() *Discovery {
	discovery := NewDiscovery()
	httpClient := &http.Client{Timeout: 30 * time.Second}

	openAIKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_API_KEY"))
	if openAIKey != "" {
		baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_BASE_URL"))
		discovery.addProvider(ProviderInfo{ID: "openai", Name: "OpenAI", Type: "direct"}, NewOpenAIClient(httpClient, baseURL, openAIKey))
	}

	azureEndpoint := strings.TrimSpace(os.Getenv("SIGIL_EVAL_AZURE_OPENAI_ENDPOINT"))
	azureKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_AZURE_OPENAI_API_KEY"))
	if azureEndpoint != "" && azureKey != "" {
		discovery.addProvider(ProviderInfo{ID: "azure", Name: "Azure OpenAI", Type: "csp"}, NewAzureOpenAIClient(httpClient, azureEndpoint, azureKey))
	}

	anthropicKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_API_KEY"))
	if anthropicKey != "" {
		discovery.addProvider(ProviderInfo{ID: "anthropic", Name: "Anthropic", Type: "direct"}, NewAnthropicClient(httpClient, "", anthropicKey))
	}

	googleKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_GOOGLE_API_KEY"))
	if googleKey != "" {
		discovery.addProvider(ProviderInfo{ID: "google", Name: "Google", Type: "direct"}, NewGoogleClient(httpClient, "", googleKey))
	}

	compatBaseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL"))
	compatAPIKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY"))
	compatName := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_NAME"))
	if compatBaseURL != "" {
		id := sanitizeProviderID(compatName)
		if id == "" {
			id = "openai-compat"
		}
		name := compatName
		if name == "" {
			name = "OpenAI Compatible"
		}
		discovery.addProvider(ProviderInfo{ID: id, Name: name, Type: "openai_compat"}, NewOpenAICompatClient(httpClient, compatBaseURL, compatAPIKey))
	}

	for i := 1; i <= 20; i++ {
		baseURL := strings.TrimSpace(os.Getenv(fmt.Sprintf("SIGIL_EVAL_OPENAI_COMPAT_%d_BASE_URL", i)))
		if baseURL == "" {
			continue
		}
		apiKey := strings.TrimSpace(os.Getenv(fmt.Sprintf("SIGIL_EVAL_OPENAI_COMPAT_%d_API_KEY", i)))
		name := strings.TrimSpace(os.Getenv(fmt.Sprintf("SIGIL_EVAL_OPENAI_COMPAT_%d_NAME", i)))
		id := sanitizeProviderID(name)
		if id == "" {
			id = fmt.Sprintf("openai-compat-%d", i)
		}
		if name == "" {
			name = fmt.Sprintf("OpenAI Compatible %d", i)
		}
		discovery.addProvider(ProviderInfo{ID: id, Name: name, Type: "openai_compat"}, NewOpenAICompatClient(httpClient, baseURL, apiKey))
	}

	return discovery
}

func (d *Discovery) addProvider(info ProviderInfo, client JudgeClient) {
	if d == nil || client == nil {
		return
	}
	if strings.TrimSpace(info.ID) == "" {
		return
	}
	if d.providers == nil {
		d.providers = map[string]providerEntry{}
	}
	d.providers[info.ID] = providerEntry{info: info, client: NewInstrumentedClient(info.ID, client)}
}

func (d *Discovery) Client(providerID string) (JudgeClient, bool) {
	if d == nil {
		return nil, false
	}
	entry, ok := d.providers[strings.TrimSpace(providerID)]
	if !ok {
		return nil, false
	}
	return entry.client, true
}

func (d *Discovery) ListProviders(_ context.Context) []ProviderInfo {
	if d == nil {
		return []ProviderInfo{}
	}
	out := make([]ProviderInfo, 0, len(d.providers))
	for _, entry := range d.providers {
		out = append(out, entry.info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (d *Discovery) ListModels(ctx context.Context, providerID string) ([]JudgeModel, error) {
	client, ok := d.Client(providerID)
	if !ok {
		return nil, ErrProviderNotFound
	}
	return client.ListModels(ctx)
}

func sanitizeProviderID(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return ""
	}
	builder := strings.Builder{}
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-', r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}
	result := strings.Trim(builder.String(), "-")
	for strings.Contains(result, "--") {
		result = strings.ReplaceAll(result, "--", "-")
	}
	return result
}
