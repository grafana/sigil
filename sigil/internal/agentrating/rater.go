package agentrating

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	"github.com/grafana/sigil/sigil/internal/jsonutil"
)

const defaultJudgeModel = "openai/gpt-4o-mini"

type providerResolver interface {
	Client(providerID string) (judges.JudgeClient, bool)
}

// Rater evaluates agent design quality with an LLM judge.
//
// A Rater is safe for concurrent use.
type Rater struct {
	resolver          providerResolver
	defaultProviderID string
	defaultModelName  string
	thinking          judges.ThinkingConfig
}

// NewRater returns a Rater that resolves judge clients from discovery.
//
// When defaultModel is empty, it falls back to "openai/gpt-4o-mini".
// The expected format is "provider/model". If only a model name is provided,
// the provider defaults to "openai".
func NewRater(discovery *judges.Discovery, defaultModel string) *Rater {
	defaultProviderID, defaultModelName := parseDefaultModel(defaultModel)
	return NewRaterWithTarget(discovery, defaultProviderID, defaultModelName)
}

// NewRaterWithTarget returns a Rater configured with explicit provider/model
// defaults.
//
// When provider or model is empty, it falls back to "openai/gpt-4o-mini".
func NewRaterWithTarget(discovery *judges.Discovery, defaultProviderID string, defaultModelName string) *Rater {
	providerID := strings.TrimSpace(defaultProviderID)
	modelName := strings.TrimSpace(defaultModelName)
	if providerID == "" || modelName == "" {
		providerID, modelName = parseDefaultModel(defaultJudgeModel)
	}
	return &Rater{
		resolver:          discovery,
		defaultProviderID: providerID,
		defaultModelName:  modelName,
		thinking:          defaultThinkingConfig(),
	}
}

// RateWithModel evaluates agent design quality with an optional model override.
//
// modelOverride can be either "provider/model" or just "model". When only
// "model" is provided, the configured default provider is used.
func (r *Rater) RateWithModel(ctx context.Context, agent Agent, modelOverride string) (*Rating, error) {
	if r == nil || r.resolver == nil {
		return nil, fmt.Errorf("judge discovery is not configured")
	}

	providerID, modelName, err := r.resolveJudgeTarget(modelOverride)
	if err != nil {
		return nil, err
	}

	client, ok := r.resolver.Client(providerID)
	if !ok {
		return nil, NewValidationError(fmt.Sprintf("judge provider %q is not configured", providerID))
	}

	judgeRequest := judges.JudgeRequest{
		SystemPrompt: evaluatorSystemPrompt,
		UserPrompt:   buildUserPrompt(agent),
		Model:        modelName,
		MaxTokens:    1400,
		Temperature:  0,
		OutputSchema: ratingOutputSchema(),
		Thinking:     r.thinkingConfig(),
	}
	judgeResponse, err := client.Judge(ctx, judgeRequest)
	if err != nil && judgeRequest.Thinking.ModeOrDefault() == judges.ThinkingModePrefer && judges.IsThinkingUnsupportedError(err) {
		judgeRequest.Thinking.Mode = judges.ThinkingModeOff
		judgeResponse, err = client.Judge(ctx, judgeRequest)
	}
	if err != nil {
		return nil, fmt.Errorf("run agent rating judge: %w", err)
	}

	rating, err := parseJudgeRatingOutput(judgeResponse.Text)
	if err != nil {
		return nil, fmt.Errorf("parse judge response: %w", err)
	}
	rating.JudgeLatencyMs = judgeResponse.LatencyMs
	rating.JudgeModel = providerID + "/" + modelName
	if returnedModel := strings.TrimSpace(judgeResponse.Model); returnedModel != "" {
		if strings.Contains(returnedModel, "/") {
			rating.JudgeModel = returnedModel
		} else {
			rating.JudgeModel = providerID + "/" + returnedModel
		}
	}

	applyTokenWarning(agent, &rating)
	rating.Status = RatingStatusCompleted
	return &rating, nil
}

func (r *Rater) resolveJudgeTarget(modelOverride string) (string, string, error) {
	providerID := r.defaultProviderID
	modelName := r.defaultModelName

	override := strings.TrimSpace(modelOverride)
	if override != "" {
		if strings.Contains(override, "/") {
			parts := strings.SplitN(override, "/", 2)
			providerID = strings.TrimSpace(parts[0])
			modelName = strings.TrimSpace(parts[1])
		} else {
			modelName = override
		}
	}

	if providerID == "" || modelName == "" {
		return "", "", NewValidationError("judge model must be provided as model or provider/model")
	}
	return providerID, modelName, nil
}

func parseDefaultModel(rawDefault string) (string, string) {
	trimmed := strings.TrimSpace(rawDefault)
	if trimmed == "" {
		trimmed = defaultJudgeModel
	}
	if strings.Contains(trimmed, "/") {
		parts := strings.SplitN(trimmed, "/", 2)
		providerID := strings.TrimSpace(parts[0])
		modelName := strings.TrimSpace(parts[1])
		if providerID != "" && modelName != "" {
			return providerID, modelName
		}
	}
	return "openai", trimmed
}

type judgeRatingOutput struct {
	Score        json.Number  `json:"score"`
	Summary      string       `json:"summary"`
	Suggestions  []Suggestion `json:"suggestions"`
	TokenWarning string       `json:"token_warning,omitempty"`
}

func parseJudgeRatingOutput(raw string) (Rating, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Rating{}, fmt.Errorf("judge response is empty")
	}

	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()

	var output judgeRatingOutput
	if err := decoder.Decode(&output); err != nil {
		return Rating{}, err
	}
	if err := jsonutil.EnsureEOF(decoder); err != nil {
		return Rating{}, err
	}

	score, err := parseScore(output.Score)
	if err != nil {
		return Rating{}, err
	}
	summary := strings.TrimSpace(output.Summary)
	if summary == "" {
		return Rating{}, fmt.Errorf("judge response summary is required")
	}

	suggestions := normalizeSuggestions(output.Suggestions)
	return Rating{
		Score:        score,
		Summary:      summary,
		Suggestions:  suggestions,
		TokenWarning: strings.TrimSpace(output.TokenWarning),
	}, nil
}

func parseScore(rawScore json.Number) (int, error) {
	if strings.TrimSpace(rawScore.String()) == "" {
		return 0, fmt.Errorf("judge response score is required")
	}
	if integerScore, err := rawScore.Int64(); err == nil {
		if integerScore < 0 || integerScore > 10 {
			return 0, fmt.Errorf("judge response score must be between 0 and 10")
		}
		return int(integerScore), nil
	}

	floatScore, err := rawScore.Float64()
	if err != nil {
		return 0, fmt.Errorf("judge response score must be numeric")
	}
	rounded := int(math.Round(floatScore))
	if rounded < 0 || rounded > 10 {
		return 0, fmt.Errorf("judge response score must be between 0 and 10")
	}
	return rounded, nil
}

func normalizeSuggestions(rawSuggestions []Suggestion) []Suggestion {
	if len(rawSuggestions) == 0 {
		return []Suggestion{}
	}

	out := make([]Suggestion, 0, len(rawSuggestions))
	for _, suggestion := range rawSuggestions {
		category := normalizeCategory(suggestion.Category)
		severity := normalizeSeverity(suggestion.Severity)
		title := strings.TrimSpace(suggestion.Title)
		description := strings.TrimSpace(suggestion.Description)
		if title == "" && description == "" {
			continue
		}
		out = append(out, Suggestion{
			Category:    category,
			Severity:    severity,
			Title:       title,
			Description: description,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		leftRank := severityRank(out[i].Severity)
		rightRank := severityRank(out[j].Severity)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].Title < out[j].Title
	})
	return out
}

func normalizeCategory(rawCategory string) string {
	normalized := strings.TrimSpace(strings.ToLower(rawCategory))
	if normalized == "" {
		return "system_prompt"
	}
	normalized = strings.ReplaceAll(normalized, " ", "_")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	return normalized
}

func normalizeSeverity(rawSeverity string) string {
	switch strings.ToLower(strings.TrimSpace(rawSeverity)) {
	case "high":
		return "high"
	case "medium":
		return "medium"
	default:
		return "low"
	}
}

func severityRank(severity string) int {
	switch severity {
	case "high":
		return 0
	case "medium":
		return 1
	default:
		return 2
	}
}

func applyTokenWarning(agent Agent, rating *Rating) {
	if rating == nil {
		return
	}
	if strings.TrimSpace(rating.TokenWarning) != "" {
		return
	}
	if agent.TokenEstimate.Total <= tokenWarningThreshold {
		return
	}

	rating.TokenWarning = fmt.Sprintf(
		"Estimated baseline context is %d tokens; costs and instruction-following reliability can degrade above %d tokens.",
		agent.TokenEstimate.Total,
		tokenWarningThreshold,
	)
}

func ratingOutputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"score": map[string]any{
				"type": "integer",
			},
			"summary": map[string]any{
				"type": "string",
			},
			"suggestions": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"category": map[string]any{
							"type": "string",
						},
						"severity": map[string]any{
							"type": "string",
							"enum": []string{"high", "medium", "low"},
						},
						"title": map[string]any{
							"type": "string",
						},
						"description": map[string]any{
							"type": "string",
						},
					},
					"required":             []string{"category", "severity", "title", "description"},
					"additionalProperties": false,
				},
			},
			"token_warning": map[string]any{
				"type": "string",
			},
		},
		"required":             []string{"score", "summary", "suggestions"},
		"additionalProperties": false,
	}
}

func defaultThinkingConfig() judges.ThinkingConfig {
	return judges.ThinkingConfig{
		Mode:          judges.ThinkingModeOff,
		AnthropicMode: judges.AnthropicThinkingModeAdaptive,
	}
}

func (r *Rater) thinkingConfig() judges.ThinkingConfig {
	thinking := r.thinking
	if thinking.Mode == "" && thinking.Level == "" && thinking.BudgetTokens == 0 && thinking.AnthropicMode == "" {
		return defaultThinkingConfig()
	}
	return thinking
}
