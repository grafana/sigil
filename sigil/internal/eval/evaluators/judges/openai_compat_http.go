package judges

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type openAICompatHTTPClient struct {
	httpClient *http.Client
	providerID string
	baseURL    string
	apiKey     string
}

func newOpenAICompatHTTPClient(httpClient *http.Client, providerID, baseURL, apiKey string) *openAICompatHTTPClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	trimmedBaseURL := normalizeOpenAICompatBaseURL(baseURL)
	if trimmedBaseURL == "" {
		trimmedBaseURL = "https://api.openai.com"
	}
	trimmedProviderID := strings.TrimSpace(providerID)
	if trimmedProviderID == "" {
		trimmedProviderID = "openai-compat"
	}
	return &openAICompatHTTPClient{
		httpClient: httpClient,
		providerID: trimmedProviderID,
		baseURL:    trimmedBaseURL,
		apiKey:     strings.TrimSpace(apiKey),
	}
}

func normalizeOpenAICompatBaseURL(baseURL string) string {
	normalized := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(strings.ToLower(normalized), "/v1") {
		normalized = normalized[:len(normalized)-3]
		normalized = strings.TrimRight(normalized, "/")
	}
	return normalized
}

func (c *openAICompatHTTPClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		return JudgeResponse{}, fmt.Errorf("model is required")
	}

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": req.SystemPrompt},
			{"role": "user", "content": req.UserPrompt},
		},
		"temperature": req.Temperature,
	}
	if req.Thinking.IsEnabled() {
		payload["reasoning_effort"] = string(mapOpenAIReasoningEffort(req.Thinking.LevelOrDefault()))
	}
	if req.MaxTokens > 0 {
		payload["max_tokens"] = req.MaxTokens
	}
	if len(req.OutputSchema) > 0 {
		payload["response_format"] = map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "judge_output",
				"schema": req.OutputSchema,
				"strict": true,
			},
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return JudgeResponse{}, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return JudgeResponse{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	start := time.Now()
	httpResponse, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return JudgeResponse{}, err
	}
	defer func() { _ = httpResponse.Body.Close() }()

	responseBody, err := io.ReadAll(httpResponse.Body)
	if err != nil {
		return JudgeResponse{}, err
	}
	if httpResponse.StatusCode >= 300 {
		return JudgeResponse{}, fmt.Errorf("judge request failed: status=%d body=%s", httpResponse.StatusCode, string(responseBody))
	}

	var decoded struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return JudgeResponse{}, err
	}
	if len(decoded.Choices) == 0 {
		return JudgeResponse{}, fmt.Errorf("judge response did not include choices")
	}

	content := extractOpenAICompatibleContent(decoded.Choices[0].Message.Content)
	return JudgeResponse{
		Text:      strings.TrimSpace(content),
		Model:     strings.TrimSpace(decoded.Model),
		LatencyMs: time.Since(start).Milliseconds(),
		Usage: JudgeUsage{
			InputTokens:  decoded.Usage.PromptTokens,
			OutputTokens: decoded.Usage.CompletionTokens,
		},
	}, nil
}

func (c *openAICompatHTTPClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	if c.apiKey != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	httpResponse, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() { _ = httpResponse.Body.Close() }()

	responseBody, err := io.ReadAll(httpResponse.Body)
	if err != nil {
		return nil, err
	}
	if httpResponse.StatusCode >= 300 {
		return nil, fmt.Errorf("list models failed: status=%d", httpResponse.StatusCode)
	}

	var decoded struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, err
	}
	out := make([]JudgeModel, 0, len(decoded.Data))
	for _, item := range decoded.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		out = append(out, JudgeModel{ID: id, Name: id, Provider: c.providerID})
	}
	return out, nil
}

func extractOpenAICompatibleContent(raw any) string {
	switch typed := raw.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			object, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := object["text"].(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}
