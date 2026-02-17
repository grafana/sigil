package evaluators

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
)

var numberExtractor = regexp.MustCompile(`[-+]?[0-9]*\.?[0-9]+`)

type LLMJudgeEvaluator struct {
	discovery    *judges.Discovery
	defaultModel string
}

func NewLLMJudgeEvaluator(discovery *judges.Discovery, defaultModel string) *LLMJudgeEvaluator {
	if strings.TrimSpace(defaultModel) == "" {
		defaultModel = "openai/gpt-4o-mini"
	}
	return &LLMJudgeEvaluator{discovery: discovery, defaultModel: defaultModel}
}

func (e *LLMJudgeEvaluator) Kind() evalpkg.EvaluatorKind {
	return evalpkg.EvaluatorKindLLMJudge
}

func (e *LLMJudgeEvaluator) Evaluate(ctx context.Context, input EvalInput, definition evalpkg.EvaluatorDefinition) ([]ScoreOutput, error) {
	if e.discovery == nil {
		return nil, evalpkg.Permanent(fmt.Errorf("judge discovery is not configured"))
	}

	providerID, modelName, err := resolveJudgeTarget(definition.Config, e.defaultModel)
	if err != nil {
		return nil, evalpkg.Permanent(err)
	}
	client, ok := e.discovery.Client(providerID)
	if !ok {
		return nil, evalpkg.Permanent(fmt.Errorf("judge provider %q is not configured", providerID))
	}

	systemPrompt := renderTemplate(configString(definition.Config, "system_prompt", "You are an evaluator."), input)
	userPrompt := renderTemplate(configString(definition.Config, "user_prompt", "User input:\n{{input}}\n\nAssistant output:\n{{output}}"), input)
	maxTokens, _ := configInt(definition.Config, "max_tokens")
	if maxTokens <= 0 {
		maxTokens = 256
	}
	temperature := configFloat(definition.Config, "temperature", 0)
	timeoutMs, _ := configInt(definition.Config, "timeout_ms")
	if timeoutMs <= 0 {
		timeoutMs = 20000
	}

	judgeCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	response, err := client.Judge(judgeCtx, judges.JudgeRequest{
		SystemPrompt: systemPrompt,
		UserPrompt:   userPrompt,
		Model:        modelName,
		MaxTokens:    maxTokens,
		Temperature:  temperature,
	})
	if err != nil {
		if judgeCtx.Err() != nil {
			return nil, fmt.Errorf("judge call timed out: %w", err)
		}
		return nil, err
	}

	key, scoreType, unit, passThreshold := firstOutputKey(definition, "judge_score", evalpkg.ScoreTypeNumber)
	value, parsedPassed, explanation, err := parseJudgeResponse(response.Text, scoreType)
	if err != nil {
		return nil, evalpkg.Permanent(err)
	}

	passed := parsedPassed
	if passed == nil {
		switch {
		case scoreType == evalpkg.ScoreTypeNumber && value.Number != nil && passThreshold != nil:
			passed = boolPointer(*value.Number >= *passThreshold)
		case scoreType == evalpkg.ScoreTypeBool && value.Bool != nil:
			passed = boolPointer(*value.Bool)
		}
	}

	metadata := map[string]any{
		"judge_provider":          providerID,
		"judge_model":             modelName,
		"judge_latency_ms":        response.LatencyMs,
		"judge_input_tokens":      response.Usage.InputTokens,
		"judge_output_tokens":     response.Usage.OutputTokens,
		"judge_cache_read_tokens": response.Usage.CacheReadTokens,
	}

	return []ScoreOutput{{
		Key:         key,
		Type:        scoreType,
		Value:       value,
		Unit:        unit,
		Passed:      passed,
		Explanation: explanation,
		Metadata:    metadata,
	}}, nil
}

func resolveJudgeTarget(config map[string]any, defaultModel string) (string, string, error) {
	providerID := strings.TrimSpace(configString(config, "provider", ""))
	modelName := strings.TrimSpace(configString(config, "model", ""))
	if providerID != "" && modelName != "" {
		return providerID, modelName, nil
	}

	if modelName != "" && strings.Contains(modelName, "/") {
		parts := strings.SplitN(modelName, "/", 2)
		if providerID == "" {
			providerID = strings.TrimSpace(parts[0])
		}
		modelName = strings.TrimSpace(parts[1])
	}

	if providerID == "" || modelName == "" {
		defaultValue := strings.TrimSpace(defaultModel)
		parts := strings.SplitN(defaultValue, "/", 2)
		if len(parts) == 2 {
			if providerID == "" {
				providerID = strings.TrimSpace(parts[0])
			}
			if modelName == "" {
				modelName = strings.TrimSpace(parts[1])
			}
		}
	}

	if providerID == "" || modelName == "" {
		return "", "", fmt.Errorf("llm_judge evaluator requires provider and model")
	}
	return providerID, modelName, nil
}

func renderTemplate(template string, input EvalInput) string {
	output := strings.ReplaceAll(template, "{{input}}", input.InputText)
	output = strings.ReplaceAll(output, "{{output}}", input.ResponseText)
	output = strings.ReplaceAll(output, "{{generation_id}}", input.GenerationID)
	output = strings.ReplaceAll(output, "{{conversation_id}}", input.ConversationID)
	return output
}

func parseJudgeResponse(raw string, scoreType evalpkg.ScoreType) (evalpkg.ScoreValue, *bool, string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return evalpkg.ScoreValue{}, nil, "", fmt.Errorf("judge response was empty")
	}

	parsed := map[string]any{}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
		value, passed, explanation, err := parseJudgeJSON(parsed, scoreType)
		if err == nil {
			return value, passed, explanation, nil
		}
	}

	switch scoreType {
	case evalpkg.ScoreTypeBool:
		lower := strings.ToLower(trimmed)
		if strings.Contains(lower, "true") {
			value := evalpkg.BoolValue(true)
			return value, boolPointer(true), "", nil
		}
		if strings.Contains(lower, "false") {
			value := evalpkg.BoolValue(false)
			return value, boolPointer(false), "", nil
		}
		return evalpkg.ScoreValue{}, nil, "", fmt.Errorf("judge response did not include a bool score")
	case evalpkg.ScoreTypeString:
		value := evalpkg.StringValue(trimmed)
		return value, nil, "", nil
	case evalpkg.ScoreTypeNumber:
		match := numberExtractor.FindString(trimmed)
		if match == "" {
			return evalpkg.ScoreValue{}, nil, "", fmt.Errorf("judge response did not include a numeric score")
		}
		number, err := strconv.ParseFloat(match, 64)
		if err != nil {
			return evalpkg.ScoreValue{}, nil, "", err
		}
		value := evalpkg.NumberValue(number)
		return value, nil, "", nil
	default:
		return evalpkg.ScoreValue{}, nil, "", fmt.Errorf("unsupported score type %q", scoreType)
	}
}

func parseJudgeJSON(parsed map[string]any, scoreType evalpkg.ScoreType) (evalpkg.ScoreValue, *bool, string, error) {
	explanation := ""
	if value, ok := parsed["explanation"].(string); ok {
		explanation = strings.TrimSpace(value)
	}
	var passed *bool
	if value, ok := parsed["passed"].(bool); ok {
		passed = boolPointer(value)
	}

	scoreRaw, ok := parsed["score"]
	if !ok {
		if scoreType == evalpkg.ScoreTypeBool {
			if boolScore, ok := parsed["value"].(bool); ok {
				value := evalpkg.BoolValue(boolScore)
				return value, passed, explanation, nil
			}
		}
		return evalpkg.ScoreValue{}, nil, explanation, fmt.Errorf("judge response JSON did not include score")
	}

	switch scoreType {
	case evalpkg.ScoreTypeBool:
		boolScore, ok := scoreRaw.(bool)
		if !ok {
			return evalpkg.ScoreValue{}, nil, explanation, fmt.Errorf("judge response score must be bool")
		}
		value := evalpkg.BoolValue(boolScore)
		if passed == nil {
			passed = boolPointer(boolScore)
		}
		return value, passed, explanation, nil
	case evalpkg.ScoreTypeString:
		stringScore, ok := scoreRaw.(string)
		if !ok {
			return evalpkg.ScoreValue{}, nil, explanation, fmt.Errorf("judge response score must be string")
		}
		value := evalpkg.StringValue(stringScore)
		return value, passed, explanation, nil
	case evalpkg.ScoreTypeNumber:
		number, ok := scoreRaw.(float64)
		if !ok {
			return evalpkg.ScoreValue{}, nil, explanation, fmt.Errorf("judge response score must be number")
		}
		value := evalpkg.NumberValue(number)
		return value, passed, explanation, nil
	default:
		return evalpkg.ScoreValue{}, nil, explanation, fmt.Errorf("unsupported score type %q", scoreType)
	}
}

func configString(config map[string]any, key, defaultValue string) string {
	if config == nil {
		return defaultValue
	}
	raw, ok := config[key]
	if !ok {
		return defaultValue
	}
	asString, ok := raw.(string)
	if !ok {
		return defaultValue
	}
	trimmed := strings.TrimSpace(asString)
	if trimmed == "" {
		return defaultValue
	}
	return trimmed
}

func configFloat(config map[string]any, key string, defaultValue float64) float64 {
	if config == nil {
		return defaultValue
	}
	raw, ok := config[key]
	if !ok {
		return defaultValue
	}
	switch typed := raw.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return defaultValue
	}
}
