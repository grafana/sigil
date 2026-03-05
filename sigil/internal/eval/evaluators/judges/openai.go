package judges

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
)

type OpenAIClient struct {
	providerID string
	chat       openai.ChatCompletionService
	models     openai.ModelService
}

func NewOpenAIClient(httpClient *http.Client, baseURL, apiKey string) *OpenAIClient {
	opts := []option.RequestOption{
		option.WithAPIKey(strings.TrimSpace(apiKey)),
	}
	if httpClient != nil {
		opts = append(opts, option.WithHTTPClient(httpClient))
	}
	if normalizedBaseURL := normalizeOpenAIBaseURL(baseURL); normalizedBaseURL != "" {
		opts = append(opts, option.WithBaseURL(normalizedBaseURL))
	}

	client := openai.NewClient(opts...)
	return &OpenAIClient{
		providerID: "openai",
		chat:       client.Chat.Completions,
		models:     client.Models,
	}
}

func NewAzureOpenAIClient(httpClient *http.Client, endpoint, apiKey string) *OpenAIClient {
	opts := []option.RequestOption{
		azure.WithEndpoint(strings.TrimSpace(endpoint), "2024-06-01"),
		azure.WithAPIKey(strings.TrimSpace(apiKey)),
	}
	if httpClient != nil {
		opts = append(opts, option.WithHTTPClient(httpClient))
	}

	client := openai.NewClient(opts...)
	return &OpenAIClient{
		providerID: "azure",
		chat:       client.Chat.Completions,
		models:     client.Models,
	}
}

func (c *OpenAIClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return JudgeResponse{}, fmt.Errorf("model is required")
	}

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModel(model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(req.SystemPrompt),
			openai.UserMessage(req.UserPrompt),
		},
		Temperature: openai.Float(req.Temperature),
	}
	if req.Thinking.IsEnabled() {
		params.ReasoningEffort = mapOpenAIReasoningEffort(req.Thinking.LevelOrDefault())
	}
	if req.MaxTokens > 0 {
		params.MaxCompletionTokens = openai.Int(int64(req.MaxTokens))
	}
	if len(req.OutputSchema) > 0 {
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "judge_output",
					Schema: req.OutputSchema,
					Strict: openai.Bool(true),
				},
			},
		}
	}

	start := time.Now()
	response, err := c.chat.New(ctx, params)
	if err != nil {
		return JudgeResponse{}, err
	}
	if len(response.Choices) == 0 {
		return JudgeResponse{}, fmt.Errorf("judge response did not include choices")
	}

	content := strings.TrimSpace(response.Choices[0].Message.Content)
	if content == "" {
		content = strings.TrimSpace(response.Choices[0].Message.Refusal)
	}
	modelName := strings.TrimSpace(response.Model)
	if modelName == "" {
		modelName = model
	}

	return JudgeResponse{
		Text:      content,
		Model:     modelName,
		LatencyMs: time.Since(start).Milliseconds(),
		Usage: JudgeUsage{
			InputTokens:     response.Usage.PromptTokens,
			OutputTokens:    response.Usage.CompletionTokens,
			CacheReadTokens: response.Usage.PromptTokensDetails.CachedTokens,
		},
	}, nil
}

func (c *OpenAIClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	if c.providerID == "azure" {
		return []JudgeModel{}, nil
	}

	pager := c.models.ListAutoPaging(ctx)
	out := make([]JudgeModel, 0, 16)
	for pager.Next() {
		model := pager.Current()
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		out = append(out, JudgeModel{ID: id, Name: id, Provider: c.providerID})
	}
	if err := pager.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func mapOpenAIReasoningEffort(level ThinkingLevel) shared.ReasoningEffort {
	switch level {
	case ThinkingLevelMinimal:
		return shared.ReasoningEffortMinimal
	case ThinkingLevelLow:
		return shared.ReasoningEffortLow
	case ThinkingLevelHigh:
		return shared.ReasoningEffortHigh
	default:
		return shared.ReasoningEffortMedium
	}
}

func normalizeOpenAIBaseURL(baseURL string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return ""
	}
	if strings.HasSuffix(strings.ToLower(trimmed), "/v1") {
		return trimmed + "/"
	}
	return trimmed + "/v1/"
}
