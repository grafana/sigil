// Package agentrating evaluates agent design quality with an LLM judge.
//
// The package accepts an agent's configuration (system prompt, tools, and token
// estimates) and returns a 0-10 rating with actionable suggestions.
package agentrating

import (
	"errors"
	"strings"
)

const tokenWarningThreshold = 30_000

const (
	RatingStatusPending   = "pending"
	RatingStatusCompleted = "completed"
	RatingStatusFailed    = "failed"
)

// Agent describes the agent configuration that will be evaluated.
type Agent struct {
	Name          string
	SystemPrompt  string
	Tools         []Tool
	Models        []string
	TokenEstimate TokenEstimate
}

// Tool is a single tool definition attached to an agent.
type Tool struct {
	Name            string
	Description     string
	Type            string
	InputSchemaJSON string
	TokenEstimate   int
}

// TokenEstimate summarizes the baseline context cost for an agent.
type TokenEstimate struct {
	SystemPrompt int
	ToolsTotal   int
	Total        int
}

// Rating is the result of evaluating an agent.
type Rating struct {
	Status         string       `json:"status"`
	Score          int          `json:"score"`
	Summary        string       `json:"summary"`
	Suggestions    []Suggestion `json:"suggestions"`
	TokenWarning   string       `json:"token_warning,omitempty"`
	JudgeModel     string       `json:"judge_model"`
	JudgeLatencyMs int64        `json:"judge_latency_ms"`
}

// NormalizeRatingStatus coerces status to a supported value.
func NormalizeRatingStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case RatingStatusPending:
		return RatingStatusPending
	case RatingStatusFailed:
		return RatingStatusFailed
	default:
		return RatingStatusCompleted
	}
}

// Suggestion is a single actionable improvement item.
type Suggestion struct {
	Category    string `json:"category"`
	Severity    string `json:"severity"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// ValidationError marks invalid request data passed to the rater.
type ValidationError struct {
	msg string
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	return e.msg
}

// NewValidationError constructs a validation error.
func NewValidationError(msg string) error {
	return &ValidationError{msg: msg}
}

// IsValidationError reports whether err wraps a ValidationError.
func IsValidationError(err error) bool {
	var validationErr *ValidationError
	return errors.As(err, &validationErr)
}
