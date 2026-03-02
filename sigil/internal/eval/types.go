package eval

import (
	"context"
	"time"
)

type EvaluatorKind string

const (
	EvaluatorKindLLMJudge   EvaluatorKind = "llm_judge"
	EvaluatorKindJSONSchema EvaluatorKind = "json_schema"
	EvaluatorKindRegex      EvaluatorKind = "regex"
	EvaluatorKindHeuristic  EvaluatorKind = "heuristic"
)

type ScoreType string

const (
	ScoreTypeNumber ScoreType = "number"
	ScoreTypeBool   ScoreType = "bool"
	ScoreTypeString ScoreType = "string"
)

type Selector string

const (
	SelectorUserVisibleTurn         Selector = "user_visible_turn"
	SelectorAllAssistantGenerations Selector = "all_assistant_generations"
	SelectorToolCallSteps           Selector = "tool_call_steps"
	SelectorErroredGenerations      Selector = "errored_generations"
)

type WorkItemStatus string

const (
	WorkItemStatusQueued  WorkItemStatus = "queued"
	WorkItemStatusClaimed WorkItemStatus = "claimed"
	WorkItemStatusSuccess WorkItemStatus = "success"
	WorkItemStatusFailed  WorkItemStatus = "failed"
)

type ScoreValue struct {
	Number *float64 `json:"number,omitempty"`
	Bool   *bool    `json:"bool,omitempty"`
	String *string  `json:"string,omitempty"`
}

func NumberValue(v float64) ScoreValue {
	return ScoreValue{Number: &v}
}

func BoolValue(v bool) ScoreValue {
	return ScoreValue{Bool: &v}
}

func StringValue(v string) ScoreValue {
	return ScoreValue{String: &v}
}

func (v ScoreValue) Type() ScoreType {
	switch {
	case v.Number != nil:
		return ScoreTypeNumber
	case v.Bool != nil:
		return ScoreTypeBool
	default:
		return ScoreTypeString
	}
}

type OutputKey struct {
	Key           string    `json:"key"`
	Type          ScoreType `json:"type"`
	Unit          string    `json:"unit,omitempty"`
	PassThreshold *float64  `json:"pass_threshold,omitempty"`
}

type EvaluatorDefinition struct {
	TenantID     string         `json:"tenant_id"`
	EvaluatorID  string         `json:"evaluator_id"`
	Version      string         `json:"version"`
	Kind         EvaluatorKind  `json:"kind"`
	Config       map[string]any `json:"config"`
	OutputKeys   []OutputKey    `json:"output_keys"`
	IsPredefined bool           `json:"is_predefined"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

type RuleDefinition struct {
	TenantID     string         `json:"tenant_id"`
	RuleID       string         `json:"rule_id"`
	Enabled      bool           `json:"enabled"`
	Selector     Selector       `json:"selector"`
	Match        map[string]any `json:"match"`
	SampleRate   float64        `json:"sample_rate"`
	EvaluatorIDs []string       `json:"evaluator_ids"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

type GenerationScore struct {
	TenantID         string         `json:"tenant_id"`
	ScoreID          string         `json:"score_id"`
	GenerationID     string         `json:"generation_id"`
	ConversationID   string         `json:"conversation_id,omitempty"`
	TraceID          string         `json:"trace_id,omitempty"`
	SpanID           string         `json:"span_id,omitempty"`
	EvaluatorID      string         `json:"evaluator_id"`
	EvaluatorVersion string         `json:"evaluator_version"`
	RuleID           string         `json:"rule_id,omitempty"`
	RunID            string         `json:"run_id,omitempty"`
	ScoreKey         string         `json:"score_key"`
	ScoreType        ScoreType      `json:"score_type"`
	Value            ScoreValue     `json:"value"`
	Unit             string         `json:"unit,omitempty"`
	Passed           *bool          `json:"passed,omitempty"`
	Explanation      string         `json:"explanation,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	IngestedAt       time.Time      `json:"ingested_at"`
	SourceKind       string         `json:"source_kind,omitempty"`
	SourceID         string         `json:"source_id,omitempty"`
}

type LatestScore struct {
	ScoreKey         string     `json:"score_key"`
	ScoreType        ScoreType  `json:"score_type"`
	Value            ScoreValue `json:"value"`
	Passed           *bool      `json:"passed,omitempty"`
	EvaluatorID      string     `json:"evaluator_id"`
	EvaluatorVersion string     `json:"evaluator_version"`
	CreatedAt        time.Time  `json:"created_at"`
}

type WorkItem struct {
	TenantID         string         `json:"tenant_id"`
	WorkID           string         `json:"work_id"`
	GenerationID     string         `json:"generation_id"`
	EvaluatorID      string         `json:"evaluator_id"`
	EvaluatorVersion string         `json:"evaluator_version"`
	RuleID           string         `json:"rule_id"`
	ScheduledAt      time.Time      `json:"scheduled_at"`
	Attempts         int            `json:"attempts"`
	Status           WorkItemStatus `json:"status"`
	LastError        string         `json:"last_error,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

type RulePreviewRequest struct {
	RuleID     string         `json:"rule_id,omitempty"`
	Selector   Selector       `json:"selector"`
	Match      map[string]any `json:"match"`
	SampleRate float64        `json:"sample_rate"`
}

type RulePreviewResponse struct {
	WindowHours         int                       `json:"window_hours"`
	TotalGenerations    int                       `json:"total_generations"`
	MatchingGenerations int                       `json:"matching_generations"`
	SampledGenerations  int                       `json:"sampled_generations"`
	Samples             []PreviewGenerationSample `json:"samples"`
}

type PreviewGenerationSample struct {
	GenerationID   string `json:"generation_id"`
	ConversationID string `json:"conversation_id"`
	AgentName      string `json:"agent_name,omitempty"`
	Model          string `json:"model,omitempty"`
	CreatedAt      string `json:"created_at"`
	InputPreview   string `json:"input_preview,omitempty"`
}

type EvalStore interface {
	CreateEvaluator(ctx context.Context, evaluator EvaluatorDefinition) error
	GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*EvaluatorDefinition, error)
	GetEvaluatorVersion(ctx context.Context, tenantID, evaluatorID, version string) (*EvaluatorDefinition, error)
	ListEvaluators(ctx context.Context, tenantID string, limit int, cursor uint64) ([]EvaluatorDefinition, uint64, error)
	DeleteEvaluator(ctx context.Context, tenantID, evaluatorID string) error
	CountActiveEvaluators(ctx context.Context, tenantID string) (int64, error)

	CreateRule(ctx context.Context, rule RuleDefinition) error
	GetRule(ctx context.Context, tenantID, ruleID string) (*RuleDefinition, error)
	ListRules(ctx context.Context, tenantID string, limit int, cursor uint64) ([]RuleDefinition, uint64, error)
	ListEnabledRules(ctx context.Context, tenantID string) ([]RuleDefinition, error)
	UpdateRule(ctx context.Context, rule RuleDefinition) error
	DeleteRule(ctx context.Context, tenantID, ruleID string) error
	CountActiveRules(ctx context.Context, tenantID string) (int64, error)

	InsertScore(ctx context.Context, score GenerationScore) (bool, error)
	InsertScoreBatch(ctx context.Context, scores []GenerationScore) (int, error)
	GetScoresByGeneration(ctx context.Context, tenantID, generationID string, limit int, cursor uint64) ([]GenerationScore, uint64, error)
	GetScoresByRule(ctx context.Context, tenantID, ruleID string, limit int, cursor uint64) ([]GenerationScore, uint64, error)
	GetLatestScoresByGeneration(ctx context.Context, tenantID, generationID string) (map[string]LatestScore, error)

	EnqueueWorkItem(ctx context.Context, item WorkItem) error
	ClaimWorkItems(ctx context.Context, now time.Time, limit int) ([]WorkItem, error)
	CompleteWorkItem(ctx context.Context, tenantID, workID string) error
	FailWorkItem(ctx context.Context, tenantID, workID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error)
	CountWorkItemsByStatus(ctx context.Context, status WorkItemStatus) (map[string]int64, error)
}
