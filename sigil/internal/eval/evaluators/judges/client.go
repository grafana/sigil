package judges

import (
	"context"
	"errors"
	"strings"
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
	// OutputSchema is a JSON Schema object for structured output.
	// When set, providers that support it will use constrained decoding
	// to guarantee the response matches this schema.
	OutputSchema map[string]any
	// Thinking controls provider-specific reasoning behavior.
	Thinking ThinkingConfig
}

// ThinkingMode controls whether a client should request model reasoning.
type ThinkingMode string

const (
	ThinkingModeOff     ThinkingMode = "off"
	ThinkingModePrefer  ThinkingMode = "prefer"
	ThinkingModeRequire ThinkingMode = "require"
)

// ThinkingLevel expresses preferred reasoning intensity.
type ThinkingLevel string

const (
	ThinkingLevelMinimal ThinkingLevel = "minimal"
	ThinkingLevelLow     ThinkingLevel = "low"
	ThinkingLevelMedium  ThinkingLevel = "medium"
	ThinkingLevelHigh    ThinkingLevel = "high"
)

// AnthropicThinkingMode controls how Claude thinking is requested.
type AnthropicThinkingMode string

const (
	AnthropicThinkingModeAdaptive AnthropicThinkingMode = "adaptive"
	AnthropicThinkingModeBudgeted AnthropicThinkingMode = "budgeted"
)

// ThinkingConfig stores provider-agnostic reasoning preferences.
type ThinkingConfig struct {
	Mode          ThinkingMode
	Level         ThinkingLevel
	BudgetTokens  int
	AnthropicMode AnthropicThinkingMode
}

func (c ThinkingConfig) ModeOrDefault() ThinkingMode {
	switch c.Mode {
	case ThinkingModeOff, ThinkingModePrefer, ThinkingModeRequire:
		return c.Mode
	default:
		return ThinkingModeOff
	}
}

func (c ThinkingConfig) IsEnabled() bool {
	mode := c.ModeOrDefault()
	return mode == ThinkingModePrefer || mode == ThinkingModeRequire
}

func (c ThinkingConfig) LevelOrDefault() ThinkingLevel {
	switch c.Level {
	case ThinkingLevelMinimal, ThinkingLevelLow, ThinkingLevelMedium, ThinkingLevelHigh:
		return c.Level
	default:
		return ThinkingLevelMedium
	}
}

func (c ThinkingConfig) AnthropicModeOrDefault() AnthropicThinkingMode {
	if c.AnthropicMode == AnthropicThinkingModeBudgeted {
		return AnthropicThinkingModeBudgeted
	}
	return AnthropicThinkingModeAdaptive
}

// IsThinkingUnsupportedError returns true when an error likely indicates that
// the target model/provider does not support a requested reasoning feature.
func IsThinkingUnsupportedError(err error) bool {
	if err == nil {
		return false
	}

	message := strings.ToLower(err.Error())
	mentionsThinking := strings.Contains(message, "thinking") ||
		strings.Contains(message, "reasoning") ||
		strings.Contains(message, "reasoning_effort")
	if !mentionsThinking {
		return false
	}

	unsupportedMarkers := []string{
		"unsupported",
		"does not support",
		"not support",
		"unrecognized",
		"unknown field",
		"invalid parameter",
		"invalid value",
		"extra inputs are not permitted",
	}
	for _, marker := range unsupportedMarkers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
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
