// Package promptinsights evaluates agent system prompt effectiveness by
// analyzing actual conversation data with an LLM judge.
//
// Unlike agentrating (which evaluates prompt design in isolation), this package
// grounds its analysis in how the agent actually behaved in real conversations.
package promptinsights

import (
	"errors"
	"strings"
)

const (
	StatusPending   = "pending"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
)

// Insight identifies a specific section of the system prompt along with an
// explanation of why it is effective or problematic, grounded in observed
// conversation behavior.
type Insight struct {
	Quote       string `json:"quote"`
	Title       string `json:"title"`
	Explanation string `json:"explanation"`
}

// PromptInsights is the result of analyzing an agent's system prompt against
// its conversation history.
type PromptInsights struct {
	Status         string    `json:"status"`
	Strengths      []Insight `json:"strengths"`
	Weaknesses     []Insight `json:"weaknesses"`
	JudgeModel     string    `json:"judge_model"`
	JudgeLatencyMs int64     `json:"judge_latency_ms"`
}

// ConversationExcerpt is a truncated summary of a single conversation used as
// evidence for the LLM judge.
type ConversationExcerpt struct {
	ConversationID  string
	GenerationCount int
	HasErrors       bool
	ToolCallCount   int
	UserInput       string
	AssistantOutput string
}

// NormalizeStatus coerces status to a supported value.
func NormalizeStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case StatusPending:
		return StatusPending
	case StatusFailed:
		return StatusFailed
	default:
		return StatusCompleted
	}
}

// ValidationError marks invalid request data.
type ValidationError struct {
	msg string
}

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
