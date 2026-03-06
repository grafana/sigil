package promptinsights

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
)

const defaultJudgeModel = "openai/gpt-4o-mini"

type providerResolver interface {
	Client(providerID string) (judges.JudgeClient, bool)
}

// Analyzer evaluates an agent's system prompt against conversation evidence.
type Analyzer struct {
	resolver          providerResolver
	defaultProviderID string
	defaultModelName  string
	thinking          judges.ThinkingConfig
}

// NewAnalyzer returns an Analyzer that resolves judge clients from discovery.
//
// When defaultModel is empty, it falls back to "openai/gpt-4o-mini".
// The expected format is "provider/model".
func NewAnalyzer(discovery *judges.Discovery, defaultModel string) *Analyzer {
	defaultProviderID, defaultModelName := parseDefaultModel(defaultModel)
	return &Analyzer{
		resolver:          discovery,
		defaultProviderID: defaultProviderID,
		defaultModelName:  defaultModelName,
		thinking:          defaultThinkingConfig(),
	}
}

// Analyze evaluates the system prompt using conversation excerpts as evidence.
func (a *Analyzer) Analyze(ctx context.Context, systemPrompt string, excerpts []ConversationExcerpt, modelOverride string) (*PromptInsights, error) {
	if a == nil || a.resolver == nil {
		return nil, fmt.Errorf("judge discovery is not configured")
	}

	providerID, modelName, err := a.resolveJudgeTarget(modelOverride)
	if err != nil {
		return nil, err
	}

	client, ok := a.resolver.Client(providerID)
	if !ok {
		return nil, NewValidationError(fmt.Sprintf("judge provider %q is not configured", providerID))
	}

	judgeReq := judges.JudgeRequest{
		SystemPrompt: analyzerSystemPrompt,
		UserPrompt:   buildUserPrompt(systemPrompt, excerpts),
		Model:        modelName,
		MaxTokens:    2000,
		Temperature:  0,
		OutputSchema: insightsOutputSchema(),
		Thinking:     a.thinkingConfig(),
	}
	resp, err := client.Judge(ctx, judgeReq)
	if err != nil && judgeReq.Thinking.ModeOrDefault() == judges.ThinkingModePrefer && judges.IsThinkingUnsupportedError(err) {
		judgeReq.Thinking.Mode = judges.ThinkingModeOff
		resp, err = client.Judge(ctx, judgeReq)
	}
	if err != nil {
		return nil, fmt.Errorf("run prompt insights judge: %w", err)
	}

	insights, err := parseJudgeOutput(resp.Text)
	if err != nil {
		return nil, fmt.Errorf("parse judge response: %w", err)
	}
	insights.JudgeLatencyMs = resp.LatencyMs
	insights.JudgeModel = providerID + "/" + modelName
	if returnedModel := strings.TrimSpace(resp.Model); returnedModel != "" {
		if strings.Contains(returnedModel, "/") {
			insights.JudgeModel = returnedModel
		} else {
			insights.JudgeModel = providerID + "/" + returnedModel
		}
	}
	insights.Status = StatusCompleted
	return insights, nil
}

func (a *Analyzer) resolveJudgeTarget(modelOverride string) (string, string, error) {
	providerID := a.defaultProviderID
	modelName := a.defaultModelName

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

type judgeInsightsOutput struct {
	Strengths  []Insight `json:"strengths"`
	Weaknesses []Insight `json:"weaknesses"`
}

func parseJudgeOutput(raw string) (*PromptInsights, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("judge response is empty")
	}

	var output judgeInsightsOutput
	if err := json.Unmarshal([]byte(trimmed), &output); err != nil {
		return nil, fmt.Errorf("decode judge response: %w", err)
	}

	strengths := normalizeInsights(output.Strengths)
	weaknesses := normalizeInsights(output.Weaknesses)

	return &PromptInsights{
		Strengths:  strengths,
		Weaknesses: weaknesses,
	}, nil
}

func normalizeInsights(raw []Insight) []Insight {
	if len(raw) == 0 {
		return []Insight{}
	}
	out := make([]Insight, 0, len(raw))
	for _, insight := range raw {
		quote := strings.TrimSpace(insight.Quote)
		title := strings.TrimSpace(insight.Title)
		explanation := strings.TrimSpace(insight.Explanation)
		if quote == "" || title == "" {
			continue
		}
		out = append(out, Insight{
			Quote:       quote,
			Title:       title,
			Explanation: explanation,
		})
	}
	return out
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

func defaultThinkingConfig() judges.ThinkingConfig {
	return judges.ThinkingConfig{
		Mode:          judges.ThinkingModeOff,
		AnthropicMode: judges.AnthropicThinkingModeAdaptive,
	}
}

func (a *Analyzer) thinkingConfig() judges.ThinkingConfig {
	thinking := a.thinking
	if thinking.Mode == "" && thinking.Level == "" && thinking.BudgetTokens == 0 && thinking.AnthropicMode == "" {
		return defaultThinkingConfig()
	}
	return thinking
}
