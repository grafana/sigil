package judges

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"google.golang.org/genai"
)

type GoogleClient struct {
	client  *genai.Client
	initErr error
}

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

	client, err := genai.NewClient(context.Background(), cfg)
	if err != nil {
		return &GoogleClient{initErr: err}
	}
	return &GoogleClient{client: client}
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
			id := strings.TrimPrefix(strings.TrimSpace(item.Name), "models/")
			if id == "" {
				id = strings.TrimSpace(item.Name)
			}
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
			out = append(out, JudgeModel{ID: id, Name: name, Provider: "google", ContextWindow: contextWindow})
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
