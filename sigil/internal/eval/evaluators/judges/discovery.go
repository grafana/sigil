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
	httpClient := &http.Client{Timeout: 2 * time.Minute}

	registerOpenAIFromEnv(discovery, httpClient)
	registerAzureFromEnv(discovery, httpClient)
	registerAnthropicFromEnv(discovery, httpClient)
	registerBedrockFromEnv(discovery, httpClient)
	registerGoogleFromEnv(discovery, httpClient)
	registerVertexAIFromEnv(discovery, httpClient)
	registerAnthropicVertexFromEnv(discovery, httpClient)
	registerOpenAICompatFromEnv(discovery, httpClient)

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

func registerOpenAIFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_OPENAI_ENABLED") {
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_API_KEY"))
	if apiKey == "" {
		return
	}
	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_BASE_URL"))
	addProviderIfReady(discovery, ProviderInfo{ID: "openai", Name: "OpenAI", Type: "direct"}, NewOpenAIClient(httpClient, baseURL, apiKey))
}

func registerAzureFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_AZURE_OPENAI_ENABLED") {
		return
	}

	endpoint := strings.TrimSpace(os.Getenv("SIGIL_EVAL_AZURE_OPENAI_ENDPOINT"))
	apiKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_AZURE_OPENAI_API_KEY"))
	if endpoint == "" || apiKey == "" {
		return
	}
	addProviderIfReady(discovery, ProviderInfo{ID: "azure", Name: "Azure OpenAI", Type: "csp"}, NewAzureOpenAIClient(httpClient, endpoint, apiKey))
}

func registerAnthropicFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_ANTHROPIC_ENABLED") {
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_API_KEY"))
	authToken := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_AUTH_TOKEN"))
	if apiKey == "" && authToken == "" && strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) == "" && strings.TrimSpace(os.Getenv("ANTHROPIC_AUTH_TOKEN")) == "" {
		return
	}

	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_BASE_URL"))
	addProviderIfReady(discovery, ProviderInfo{ID: "anthropic", Name: "Anthropic", Type: "direct"}, NewAnthropicClient(httpClient, baseURL, apiKey, authToken))
}

func registerBedrockFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_BEDROCK_ENABLED") {
		return
	}

	region := strings.TrimSpace(os.Getenv("SIGIL_EVAL_BEDROCK_REGION"))
	if region == "" {
		region = strings.TrimSpace(os.Getenv("AWS_REGION"))
	}
	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_BEDROCK_BASE_URL"))
	bearerToken := strings.TrimSpace(os.Getenv("SIGIL_EVAL_BEDROCK_BEARER_TOKEN"))
	addProviderIfReady(discovery, ProviderInfo{ID: "bedrock", Name: "AWS Bedrock", Type: "csp"}, NewBedrockAnthropicClient(httpClient, baseURL, region, bearerToken))
}

func registerGoogleFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_GOOGLE_ENABLED") {
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_GOOGLE_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	}
	if apiKey == "" {
		return
	}

	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_GOOGLE_BASE_URL"))
	addProviderIfReady(discovery, ProviderInfo{ID: "google", Name: "Google", Type: "direct"}, NewGoogleClient(httpClient, baseURL, apiKey))
}

func registerVertexAIFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_VERTEXAI_ENABLED") {
		return
	}

	projectID := strings.TrimSpace(os.Getenv("SIGIL_EVAL_VERTEXAI_PROJECT"))
	location := strings.TrimSpace(os.Getenv("SIGIL_EVAL_VERTEXAI_LOCATION"))
	credentialsFile := strings.TrimSpace(os.Getenv("SIGIL_EVAL_VERTEXAI_CREDENTIALS_FILE"))
	credentialsJSON := strings.TrimSpace(os.Getenv("SIGIL_EVAL_VERTEXAI_CREDENTIALS_JSON"))
	if projectID == "" {
		return
	}

	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_VERTEXAI_BASE_URL"))
	client := NewVertexAIClient(baseURL, projectID, location, "", credentialsFile, credentialsJSON)
	addProviderIfReady(discovery, ProviderInfo{ID: "vertexai", Name: "Vertex AI", Type: "csp"}, client)
}

func registerAnthropicVertexFromEnv(discovery *Discovery, httpClient *http.Client) {
	if !isEnabled("SIGIL_EVAL_ANTHROPIC_VERTEX_ENABLED") {
		return
	}

	projectID := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT"))
	if projectID == "" {
		return
	}
	location := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_VERTEX_LOCATION"))
	credentialsFile := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_FILE"))
	credentialsJSON := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_VERTEX_CREDENTIALS_JSON"))
	baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_ANTHROPIC_VERTEX_BASE_URL"))
	client := NewAnthropicVertexClient(httpClient, baseURL, projectID, location, credentialsFile, credentialsJSON)
	addProviderIfReady(discovery, ProviderInfo{ID: "anthropic-vertex", Name: "Anthropic Vertex", Type: "csp"}, client)
}

func registerOpenAICompatFromEnv(discovery *Discovery, httpClient *http.Client) {
	if isEnabled("SIGIL_EVAL_OPENAI_COMPAT_ENABLED") {
		baseURL := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_BASE_URL"))
		if baseURL != "" {
			apiKey := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_API_KEY"))
			name := strings.TrimSpace(os.Getenv("SIGIL_EVAL_OPENAI_COMPAT_NAME"))
			id := sanitizeProviderID(name)
			if id == "" {
				id = "openai-compat"
			}
			if name == "" {
				name = "OpenAI Compatible"
			}
			addProviderIfReady(discovery, ProviderInfo{ID: id, Name: name, Type: "openai_compat"}, NewOpenAICompatClient(httpClient, id, baseURL, apiKey))
		}
	}

	for i := 1; i <= 20; i++ {
		if !isEnabled(fmt.Sprintf("SIGIL_EVAL_OPENAI_COMPAT_%d_ENABLED", i)) {
			continue
		}

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
		addProviderIfReady(discovery, ProviderInfo{ID: id, Name: name, Type: "openai_compat"}, NewOpenAICompatClient(httpClient, id, baseURL, apiKey))
	}
}

func addProviderIfReady(discovery *Discovery, info ProviderInfo, client JudgeClient) {
	switch typed := client.(type) {
	case *AnthropicClient:
		if typed == nil || typed.initErr != nil {
			return
		}
	case *GoogleClient:
		if typed == nil || typed.initErr != nil {
			return
		}
	}
	discovery.addProvider(info, client)
}

func isEnabled(envKey string) bool {
	rawValue, ok := os.LookupEnv(envKey)
	if !ok {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(rawValue)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
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
