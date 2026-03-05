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
	providerID        string
	messages          anthropic.MessageService
	models            anthropic.ModelService
	supportsModelList bool
	initErr           error
}

// NewAnthropicClient constructs a direct Anthropic judge client.
// Either apiKey or authToken can be used depending on deployment auth mode.
func NewAnthropicClient(httpClient *http.Client, baseURL, apiKey, authToken string) *AnthropicClient {
	opts := make([]anthropicoption.RequestOption, 0, 4)
	if trimmedAPIKey := strings.TrimSpace(apiKey); trimmedAPIKey != "" {
		opts = append(opts, anthropicoption.WithAPIKey(trimmedAPIKey))
	}
	if trimmedAuthToken := strings.TrimSpace(authToken); trimmedAuthToken != "" {
		opts = append(opts, anthropicoption.WithAuthToken(trimmedAuthToken))
	}
	if httpClient != nil {
		opts = append(opts, anthropicoption.WithHTTPClient(httpClient))
	}
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		opts = append(opts, anthropicoption.WithBaseURL(trimmedBaseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicClient{
		providerID:        "anthropic",
		messages:          client.Messages,
		models:            client.Models,
		supportsModelList: true,
	}
}

func (c *AnthropicClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	if c.initErr != nil {
		return JudgeResponse{}, c.initErr
	}
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
	if req.Thinking.IsEnabled() {
		params.Temperature = anthropic.Float(1)
		switch req.Thinking.AnthropicModeOrDefault() {
		case AnthropicThinkingModeBudgeted:
			budgetTokens := req.Thinking.BudgetTokens
			if budgetTokens < 1024 {
				budgetTokens = 1024
			}
			if maxTokens <= budgetTokens {
				maxTokens = budgetTokens + 1
				params.MaxTokens = int64(maxTokens)
			}
			params.Thinking = anthropic.ThinkingConfigParamOfEnabled(int64(budgetTokens))
		default:
			adaptive := anthropic.NewThinkingConfigAdaptiveParam()
			params.Thinking = anthropic.ThinkingConfigParamUnion{
				OfAdaptive: &adaptive,
			}
		}
	}
	if system := strings.TrimSpace(req.SystemPrompt); system != "" {
		params.System = []anthropic.TextBlockParam{{Text: system}}
	}
	if len(req.OutputSchema) > 0 {
		params.OutputConfig = anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: req.OutputSchema,
			},
		}
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
	if c.initErr != nil {
		return nil, c.initErr
	}
	if !c.supportsModelList {
		return []JudgeModel{}, nil
	}

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
		out = append(out, JudgeModel{ID: id, Name: name, Provider: c.providerID})
	}
	if err := pager.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
