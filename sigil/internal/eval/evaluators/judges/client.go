package judges

import (
	"context"
	"errors"
)

type JudgeClient interface {
	Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error)
	ListModels(ctx context.Context) ([]JudgeModel, error)
}

type JudgeRequest struct {
	SystemPrompt string
	UserPrompt   string
	Model        string
	MaxTokens    int
	Temperature  float64
}

type JudgeUsage struct {
	InputTokens     int64
	OutputTokens    int64
	CacheReadTokens int64
}

type JudgeResponse struct {
	Text      string
	Model     string
	LatencyMs int64
	Usage     JudgeUsage
}

type JudgeModel struct {
	ID            string
	Name          string
	Provider      string
	ContextWindow int
}

type ProviderInfo struct {
	ID   string
	Name string
	Type string
}

var ErrProviderNotFound = errors.New("judge provider was not found")
