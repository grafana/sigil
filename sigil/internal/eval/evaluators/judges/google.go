package judges

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	cloudauth "cloud.google.com/go/auth"
	cloudcredentials "cloud.google.com/go/auth/credentials"
	"google.golang.org/genai"
)

type GoogleClient struct {
	providerID string
	client     *genai.Client
	initErr    error
}

// NewGoogleClient constructs a direct Gemini API-key backed judge client.
func NewGoogleClient(httpClient *http.Client, baseURL, apiKey string) *GoogleClient {
	cfg := &genai.ClientConfig{
		APIKey:  strings.TrimSpace(apiKey),
		Backend: genai.BackendGeminiAPI,
	}
	if httpClient != nil {
		cfg.HTTPClient = httpClient
	}
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		cfg.HTTPOptions.BaseURL = trimmedBaseURL
	}

	return newGoogleClient("google", cfg)
}

// NewVertexAIClient constructs a Vertex AI backed judge client.
// Vertex mode uses OAuth2 credentials (ADC or explicit credential sources) and
// requires a project ID.
func NewVertexAIClient(baseURL, projectID, location, apiKey, credentialsFile, credentialsJSON string) *GoogleClient {
	trimmedAPIKey := strings.TrimSpace(apiKey)
	if trimmedAPIKey != "" {
		return &GoogleClient{
			providerID: "vertexai",
			initErr:    fmt.Errorf("vertex ai provider does not support API keys; use google provider for Gemini API key auth"),
		}
	}

	credentials, err := resolveVertexCredentials(strings.TrimSpace(credentialsFile), strings.TrimSpace(credentialsJSON))
	if err != nil {
		return &GoogleClient{
			providerID: "vertexai",
			initErr:    err,
		}
	}

	return newVertexAIClientWithCredentials(baseURL, projectID, location, credentials)
}

func newVertexAIClientWithCredentials(baseURL, projectID, location string, credentials *cloudauth.Credentials) *GoogleClient {
	trimmedProjectID := strings.TrimSpace(projectID)
	if trimmedProjectID == "" {
		return &GoogleClient{
			providerID: "vertexai",
			initErr:    fmt.Errorf("vertex project id is required"),
		}
	}
	trimmedLocation := strings.TrimSpace(location)
	if trimmedLocation == "" {
		trimmedLocation = defaultVertexLocation
	}

	cfg := &genai.ClientConfig{
		Backend:  genai.BackendVertexAI,
		Project:  trimmedProjectID,
		Location: trimmedLocation,
	}
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		cfg.HTTPOptions.BaseURL = trimmedBaseURL
	}
	if credentials != nil {
		cfg.Credentials = credentials
	}
	return newGoogleClient("vertexai", cfg)
}

func newGoogleClient(providerID string, cfg *genai.ClientConfig) *GoogleClient {
	client, err := genai.NewClient(context.Background(), cfg)
	if err != nil {
		return &GoogleClient{
			providerID: providerID,
			initErr:    err,
		}
	}
	return &GoogleClient{
		providerID: providerID,
		client:     client,
	}
}

func (c *GoogleClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	if c.initErr != nil {
		return JudgeResponse{}, c.initErr
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return JudgeResponse{}, fmt.Errorf("model is required")
	}

	cfg := &genai.GenerateContentConfig{}
	if req.MaxTokens > 0 {
		cfg.MaxOutputTokens = int32(req.MaxTokens)
	}
	temperature := float32(req.Temperature)
	cfg.Temperature = &temperature
	if system := strings.TrimSpace(req.SystemPrompt); system != "" {
		cfg.SystemInstruction = genai.NewContentFromText(system, genai.RoleUser)
	}
	if len(req.OutputSchema) > 0 {
		cfg.ResponseMIMEType = "application/json"
		cfg.ResponseJsonSchema = req.OutputSchema
	}
	if req.Thinking.IsEnabled() {
		thinkingConfig := &genai.ThinkingConfig{
			ThinkingLevel: mapGoogleThinkingLevel(req.Thinking.LevelOrDefault()),
		}
		if req.Thinking.BudgetTokens > 0 {
			budgetTokens := req.Thinking.BudgetTokens
			if budgetTokens > 2147483647 {
				budgetTokens = 2147483647
			}
			budget := int32(budgetTokens)
			thinkingConfig.ThinkingBudget = &budget
		}
		cfg.ThinkingConfig = thinkingConfig
	}

	start := time.Now()
	response, err := c.client.Models.GenerateContent(ctx, model, genai.Text(req.UserPrompt), cfg)
	if err != nil {
		return JudgeResponse{}, err
	}
	if response == nil || len(response.Candidates) == 0 {
		return JudgeResponse{}, fmt.Errorf("judge response did not include candidates")
	}

	usage := JudgeUsage{}
	if response.UsageMetadata != nil {
		usage.InputTokens = int64(response.UsageMetadata.PromptTokenCount)
		usage.OutputTokens = int64(response.UsageMetadata.CandidatesTokenCount)
		usage.CacheReadTokens = int64(response.UsageMetadata.CachedContentTokenCount)
	}

	resolvedModel := strings.TrimSpace(response.ModelVersion)
	if resolvedModel == "" {
		resolvedModel = model
	}

	return JudgeResponse{
		Text:      strings.TrimSpace(response.Text()),
		Model:     resolvedModel,
		LatencyMs: time.Since(start).Milliseconds(),
		Usage:     usage,
	}, nil
}

func (c *GoogleClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	if c.initErr != nil {
		return nil, c.initErr
	}

	page, err := c.client.Models.List(ctx, nil)
	if err != nil {
		return nil, err
	}

	out := make([]JudgeModel, 0, len(page.Items))
	for {
		for _, item := range page.Items {
			if item == nil {
				continue
			}
			id := normalizeGoogleModelID(item.Name)
			if id == "" {
				continue
			}
			name := strings.TrimSpace(item.DisplayName)
			if name == "" {
				name = id
			}
			contextWindow := int(item.InputTokenLimit)
			if int(item.OutputTokenLimit) > contextWindow {
				contextWindow = int(item.OutputTokenLimit)
			}
			out = append(out, JudgeModel{ID: id, Name: name, Provider: c.providerID, ContextWindow: contextWindow})
		}

		if strings.TrimSpace(page.NextPageToken) == "" {
			break
		}
		nextPage, err := page.Next(ctx)
		if errors.Is(err, genai.ErrPageDone) {
			break
		}
		if err != nil {
			return nil, err
		}
		page = nextPage
	}
	return out, nil
}

func normalizeGoogleModelID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	if strings.Contains(trimmed, "/models/") {
		parts := strings.Split(trimmed, "/models/")
		if len(parts) > 0 {
			last := strings.TrimSpace(parts[len(parts)-1])
			if last != "" {
				return last
			}
		}
	}

	trimmed = strings.TrimPrefix(trimmed, "models/")
	return strings.TrimSpace(trimmed)
}

func mapGoogleThinkingLevel(level ThinkingLevel) genai.ThinkingLevel {
	switch level {
	case ThinkingLevelMinimal:
		return genai.ThinkingLevelMinimal
	case ThinkingLevelLow:
		return genai.ThinkingLevelLow
	case ThinkingLevelHigh:
		return genai.ThinkingLevelHigh
	default:
		return genai.ThinkingLevelMedium
	}
}

func resolveVertexCredentials(credentialsFile, credentialsJSON string) (*cloudauth.Credentials, error) {
	if credentialsFile != "" && credentialsJSON != "" {
		return nil, fmt.Errorf("vertex credentials file and credentials json are mutually exclusive")
	}
	if credentialsFile == "" && credentialsJSON == "" {
		return nil, nil
	}

	opts := &cloudcredentials.DetectOptions{
		Scopes: []string{vertexCloudPlatformScope},
	}
	if credentialsFile != "" {
		payload, err := os.ReadFile(credentialsFile)
		if err != nil {
			return nil, err
		}
		credentialType, err := cloudCredentialsTypeFromJSON(payload)
		if err != nil {
			return nil, fmt.Errorf("vertex credentials file is invalid: %w", err)
		}
		return cloudcredentials.NewCredentialsFromJSON(credentialType, payload, opts)
	}
	if credentialsJSON != "" {
		payload := []byte(credentialsJSON)
		credentialType, err := cloudCredentialsTypeFromJSON(payload)
		if err != nil {
			return nil, fmt.Errorf("vertex credentials json is invalid: %w", err)
		}
		return cloudcredentials.NewCredentialsFromJSON(credentialType, payload, opts)
	}
	return cloudcredentials.DetectDefault(opts)
}
