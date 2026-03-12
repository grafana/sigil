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
var llmJudgeTemplateVarPattern = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_]+)\s*\}\}`)

const (
	defaultLLMJudgeSystemPrompt = "You evaluate one assistant response. Use only the user input and assistant output. Follow the score field description exactly. Be strict. If uncertain, choose the lower score."
	defaultLLMJudgeUserPrompt   = "Latest user message:\n{{latest_user_message}}\n\nAssistant response:\n{{assistant_response}}"
	defaultLLMJudgeMaxTokens    = 128
)

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

	systemPrompt := renderTemplate(configString(definition.Config, "system_prompt", defaultLLMJudgeSystemPrompt), input)
	userPrompt := renderTemplate(configString(definition.Config, "user_prompt", defaultLLMJudgeUserPrompt), input)
	maxTokens, _ := configInt(definition.Config, "max_tokens")
	if maxTokens <= 0 {
		maxTokens = defaultLLMJudgeMaxTokens
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
		OutputSchema: BuildJudgeSchema(definition.OutputKeys),
	})
	if err != nil {
		if judgeCtx.Err() != nil {
			return nil, fmt.Errorf("judge call timed out: %w", err)
		}
		return nil, err
	}

	meta := firstOutputKey(definition, "judge_score", evalpkg.ScoreTypeNumber)
	value, parsedPassed, explanation, err := parseJudgeResponse(response.Text, meta.Key, meta.Type)
	if err != nil {
		return nil, evalpkg.Permanent(err)
	}

	passed := parsedPassed
	if passed == nil {
		switch {
		case meta.Type == evalpkg.ScoreTypeNumber && value.Number != nil && meta.PassThreshold != nil:
			passed = boolPointer(*value.Number >= *meta.PassThreshold)
		case meta.Type == evalpkg.ScoreTypeBool && value.Bool != nil:
			if meta.PassValue != nil {
				passed = boolPointer(*value.Bool == *meta.PassValue)
			} else {
				passed = boolPointer(*value.Bool)
			}
		case meta.Type == evalpkg.ScoreTypeString && value.String != nil && len(meta.PassMatch) > 0:
			passed = boolPointer(stringSliceContains(meta.PassMatch, *value.String))
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
		Key:         meta.Key,
		Type:        meta.Type,
		Value:       value,
		Unit:        meta.Unit,
		Passed:      passed,
		Explanation: explanation,
		Metadata:    metadata,
	}}, nil
}

func resolveJudgeTarget(config map[string]any, defaultModel string) (string, string, error) {
	providerID := strings.TrimSpace(configString(config, "provider", ""))
	modelName := strings.TrimSpace(configString(config, "model", ""))

	if modelName != "" && strings.Contains(modelName, "/") {
		parts := strings.SplitN(modelName, "/", 2)
		modelProvider := strings.TrimSpace(parts[0])
		if providerID == "" {
			providerID = modelProvider
		} else if modelProvider != "" && !strings.EqualFold(providerID, modelProvider) {
			return "", "", fmt.Errorf("llm_judge evaluator model provider %q does not match provider %q", modelProvider, providerID)
		}
		modelName = strings.TrimSpace(parts[1])
	}
	if providerID != "" && modelName != "" {
		return providerID, modelName, nil
	}

	if providerID == "" && modelName == "" {
		defaultValue := strings.TrimSpace(defaultModel)
		parts := strings.SplitN(defaultValue, "/", 2)
		if len(parts) == 2 {
			providerID = strings.TrimSpace(parts[0])
			modelName = strings.TrimSpace(parts[1])
		}
	}

	if providerID == "" || modelName == "" {
		if providerID != "" || modelName != "" {
			return "", "", fmt.Errorf("llm_judge evaluator requires both provider and model when overriding defaults")
		}
		return "", "", fmt.Errorf("llm_judge evaluator requires provider and model")
	}
	return providerID, modelName, nil
}

func renderTemplate(template string, input EvalInput) string {
	vars := buildLLMJudgeTemplateVars(input)
	return llmJudgeTemplateVarPattern.ReplaceAllStringFunc(template, func(match string) string {
		parts := llmJudgeTemplateVarPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		name := strings.TrimSpace(parts[1])
		value, ok := vars[name]
		if !ok {
			return match
		}
		return value
	})
}

func parseJudgeResponse(raw string, scoreKey string, scoreType evalpkg.ScoreType) (evalpkg.ScoreValue, *bool, string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return evalpkg.ScoreValue{}, nil, "", fmt.Errorf("judge response was empty")
	}

	parsed := map[string]any{}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
		return parseJudgeJSON(parsed, scoreKey, scoreType)
	}

	switch scoreType {
	case evalpkg.ScoreTypeBool:
		if boolValue, ok := parseJudgeBoolFallback(trimmed); ok {
			value := evalpkg.BoolValue(boolValue)
			// Don't infer passed here; let the caller apply PassValue logic.
			return value, nil, "", nil
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

func parseJudgeBoolFallback(raw string) (bool, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false, false
	}
	if value, ok := parseJudgeWrappedBoolLiteral(trimmed); ok {
		return value, true
	}

	trimmed = strings.TrimSpace(strings.TrimRight(trimmed, ".!?"))
	if value, ok := parseJudgeWrappedBoolLiteral(trimmed); ok {
		return value, true
	}
	return false, false
}

func parseJudgeWrappedBoolLiteral(raw string) (bool, bool) {
	if value, ok := parseJudgeBoolLiteral(raw); ok {
		return value, true
	}
	if len(raw) < 2 {
		return false, false
	}
	start := raw[0]
	end := raw[len(raw)-1]
	if (start == '"' && end == '"') || (start == '\'' && end == '\'') || (start == '`' && end == '`') {
		return parseJudgeBoolLiteral(raw[1 : len(raw)-1])
	}
	return false, false
}

func parseJudgeBoolLiteral(raw string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true":
		return true, true
	case "false":
		return false, true
	default:
		return false, false
	}
}

func parseJudgeJSON(parsed map[string]any, scoreKey string, scoreType evalpkg.ScoreType) (evalpkg.ScoreValue, *bool, string, error) {
	explanation := ""
	if value, ok := parsed["explanation"].(string); ok {
		explanation = strings.TrimSpace(value)
	}
	var passed *bool
	if value, ok := parsed["passed"].(bool); ok {
		passed = boolPointer(value)
	}

	// Look for the score value: try "score" first (legacy format), then the
	// output key name (structured output format), then "value" for bools.
	scoreRaw, ok := parsed["score"]
	if !ok && scoreKey != "" && scoreKey != "score" {
		scoreRaw, ok = parsed[scoreKey]
	}
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
		// Only return passed from an explicit "passed" field in the JSON;
		// let the caller apply PassValue logic for inferred pass/fail.
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

// BuildJudgeSchema dynamically constructs a JSON Schema from OutputKeys.
// The schema always includes an "explanation" string field alongside the
// score fields derived from the output key definitions.
func BuildJudgeSchema(keys []evalpkg.OutputKey) map[string]any {
	if len(keys) == 0 {
		return nil
	}

	// Collect valid keys first; return nil if none survive trimming.
	type validKey struct {
		name string
		def  evalpkg.OutputKey
	}
	valid := make([]validKey, 0, len(keys))
	for _, k := range keys {
		name := strings.TrimSpace(k.Key)
		// "explanation" is reserved for the judge's reasoning text.
		if name != "" && name != "explanation" {
			valid = append(valid, validKey{name: name, def: k})
		}
	}
	if len(valid) == 0 {
		return nil
	}

	props := map[string]any{
		"explanation": map[string]any{"type": "string", "description": "Concise justification for the score"},
	}
	required := []string{"explanation"}

	for _, vk := range valid {
		k := vk.def
		key := vk.name
		prop := map[string]any{}
		switch k.Type {
		case evalpkg.ScoreTypeNumber:
			prop["type"] = "number"
		case evalpkg.ScoreTypeBool:
			prop["type"] = "boolean"
		case evalpkg.ScoreTypeString:
			prop["type"] = "string"
			if len(k.Enum) > 0 {
				prop["enum"] = k.Enum
			}
		default:
			prop["type"] = "string"
		}
		if k.Description != "" {
			prop["description"] = k.Description
		}
		props[key] = prop
		required = append(required, key)
	}

	return map[string]any{
		"type":                 "object",
		"properties":           props,
		"required":             required,
		"additionalProperties": false,
	}
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
