package judges

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
)

type AnthropicClient struct {
	messages anthropic.MessageService
	models   anthropic.ModelService
}

func NewAnthropicClient(httpClient *http.Client, baseURL, apiKey string) *AnthropicClient {
	opts := []anthropicoption.RequestOption{
		anthropicoption.WithAPIKey(strings.TrimSpace(apiKey)),
	}
	if httpClient != nil {
		opts = append(opts, anthropicoption.WithHTTPClient(httpClient))
	}
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		opts = append(opts, anthropicoption.WithBaseURL(trimmedBaseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicClient{
		messages: client.Messages,
		models:   client.Models,
	}
}

func (c *AnthropicClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return JudgeResponse{}, fmt.Errorf("model is required")
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 256
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: int64(maxTokens),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(req.UserPrompt)),
		},
		Temperature: anthropic.Float(req.Temperature),
	}
	if system := strings.TrimSpace(req.SystemPrompt); system != "" {
		params.System = []anthropic.TextBlockParam{{Text: system}}
	}

	start := time.Now()
	response, err := c.messages.New(ctx, params)
	if err != nil {
		return JudgeResponse{}, err
	}

	parts := make([]string, 0, len(response.Content))
	for _, part := range response.Content {
		if text := strings.TrimSpace(part.Text); text != "" {
			parts = append(parts, text)
		}
	}

	modelName := strings.TrimSpace(string(response.Model))
	if modelName == "" {
		modelName = model
	}

	return JudgeResponse{
		Text:      strings.Join(parts, "\n"),
		Model:     modelName,
		LatencyMs: time.Since(start).Milliseconds(),
		Usage: JudgeUsage{
			InputTokens:     response.Usage.InputTokens,
			OutputTokens:    response.Usage.OutputTokens,
			CacheReadTokens: response.Usage.CacheReadInputTokens,
		},
	}, nil
}

func (c *AnthropicClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	pager := c.models.ListAutoPaging(ctx, anthropic.ModelListParams{})
	out := make([]JudgeModel, 0, 16)
	for pager.Next() {
		model := pager.Current()
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		name := strings.TrimSpace(model.DisplayName)
		if name == "" {
			name = id
		}
		out = append(out, JudgeModel{ID: id, Name: name, Provider: "anthropic"})
	}
	if err := pager.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
