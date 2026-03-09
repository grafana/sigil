package control

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

var savedConversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)

func validateTemplateScope(scope evalpkg.TemplateScope) error {
	switch scope {
	case evalpkg.TemplateScopeGlobal, evalpkg.TemplateScopeTenant:
		return nil
	default:
		return fmt.Errorf("scope %q is invalid", scope)
	}
}

func validateEvaluatorConfig(kind evalpkg.EvaluatorKind, config map[string]any, outputKeys []evalpkg.OutputKey) error {
	if config == nil {
		config = map[string]any{}
	}

	if kind == evalpkg.EvaluatorKindLLMJudge && len(outputKeys) == 1 && strings.EqualFold(strings.TrimSpace(outputKeys[0].Key), "explanation") {
		return errors.New(`output key "explanation" is reserved for llm_judge evaluators`)
	}

	switch kind {
	case evalpkg.EvaluatorKindRegex:
		return validateRegexConfig(config)
	case evalpkg.EvaluatorKindJSONSchema:
		return validateJSONSchemaConfig(config)
	case evalpkg.EvaluatorKindHeuristic:
		return validateHeuristicConfig(config)
	case evalpkg.EvaluatorKindLLMJudge:
		return validateLLMJudgeConfig(config)
	default:
		return errors.New("kind is invalid")
	}
}

func validateRegexConfig(config map[string]any) error {
	hasPattern := false
	if raw, ok := config["pattern"]; ok {
		pattern, ok := raw.(string)
		if !ok {
			return errors.New("regex config pattern must be a string")
		}
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			return errors.New("regex config pattern is required")
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("regex config pattern is invalid: %w", err)
		}
		config["pattern"] = pattern
		hasPattern = true
	}

	if raw, ok := config["patterns"]; ok {
		patterns, err := normalizeConfigStringList(raw, "regex config patterns")
		if err != nil {
			return err
		}
		for _, pattern := range patterns {
			if _, err := regexp.Compile(pattern); err != nil {
				return fmt.Errorf("regex config pattern %q is invalid: %w", pattern, err)
			}
		}
		config["patterns"] = patterns
		hasPattern = hasPattern || len(patterns) > 0
	}

	if raw, ok := config["reject"]; ok {
		if _, ok := raw.(bool); !ok {
			return errors.New("regex config reject must be a bool")
		}
	}

	if !hasPattern {
		return errors.New("regex config requires pattern or patterns")
	}
	return nil
}

func validateJSONSchemaConfig(config map[string]any) error {
	rawSchema, ok := config["schema"]
	if !ok {
		return nil
	}
	schema, ok := rawSchema.(map[string]any)
	if !ok {
		return errors.New("json_schema config schema must be an object")
	}
	return validateJSONSchemaObject(schema, "schema")
}

func validateJSONSchemaObject(schema map[string]any, path string) error {
	if rawType, ok := schema["type"]; ok {
		typeName, ok := rawType.(string)
		if !ok {
			return fmt.Errorf("%s.type must be a string", path)
		}
		switch strings.TrimSpace(typeName) {
		case "", "any", "object", "array", "string", "number", "integer", "boolean":
		default:
			return fmt.Errorf("%s.type %q is unsupported", path, typeName)
		}
	}

	if rawRequired, ok := schema["required"]; ok {
		required, err := normalizeConfigStringList(rawRequired, path+".required")
		if err != nil {
			return err
		}
		schema["required"] = required
	}

	if rawProperties, ok := schema["properties"]; ok {
		properties, ok := rawProperties.(map[string]any)
		if !ok {
			return fmt.Errorf("%s.properties must be an object", path)
		}
		for key, rawProperty := range properties {
			child, ok := rawProperty.(map[string]any)
			if !ok {
				return fmt.Errorf("%s.properties.%s must be an object", path, key)
			}
			if err := validateJSONSchemaObject(child, path+".properties."+key); err != nil {
				return err
			}
		}
	}

	if rawItems, ok := schema["items"]; ok {
		items, ok := rawItems.(map[string]any)
		if !ok {
			return fmt.Errorf("%s.items must be an object", path)
		}
		if err := validateJSONSchemaObject(items, path+".items"); err != nil {
			return err
		}
	}

	return nil
}

func validateHeuristicConfig(config map[string]any) error {
	notEmpty := false
	if raw, ok := config["not_empty"]; ok {
		asBool, ok := raw.(bool)
		if !ok {
			return errors.New("heuristic config not_empty must be a bool")
		}
		notEmpty = asBool
	}

	contains := []string(nil)
	if raw, ok := config["contains"]; ok {
		values, err := normalizeConfigStringList(raw, "heuristic config contains")
		if err != nil {
			return err
		}
		contains = values
		config["contains"] = values
	}

	notContains := []string(nil)
	if raw, ok := config["not_contains"]; ok {
		values, err := normalizeConfigStringList(raw, "heuristic config not_contains")
		if err != nil {
			return err
		}
		notContains = values
		config["not_contains"] = values
	}

	minLength, hasMinLength, err := normalizeOptionalInt(config, "min_length")
	if err != nil {
		return err
	}
	maxLength, hasMaxLength, err := normalizeOptionalInt(config, "max_length")
	if err != nil {
		return err
	}
	if hasMinLength && minLength < 0 {
		return errors.New("heuristic config min_length must be >= 0")
	}
	if hasMaxLength && maxLength < 0 {
		return errors.New("heuristic config max_length must be >= 0")
	}
	if hasMinLength && hasMaxLength && maxLength <= minLength {
		return errors.New("heuristic config max_length must be greater than min_length")
	}
	if !notEmpty && len(contains) == 0 && len(notContains) == 0 && !hasMinLength && !hasMaxLength {
		return errors.New("heuristic config requires at least one rule")
	}
	return nil
}

func validateLLMJudgeConfig(config map[string]any) error {
	provider, hasProvider, err := normalizeOptionalString(config, "provider")
	if err != nil {
		return err
	}
	model, hasModel, err := normalizeOptionalString(config, "model")
	if err != nil {
		return err
	}
	if hasProvider {
		config["provider"] = provider
	}
	if hasModel {
		config["model"] = model
	}
	switch {
	case hasProvider && !hasModel:
		return errors.New("llm_judge config requires both provider and model when overriding defaults")
	case !hasProvider && hasModel:
		if strings.Contains(model, "/") {
			parts := strings.SplitN(model, "/", 2)
			if strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
				return errors.New("llm_judge config model must be provider/model when provider is omitted")
			}
		} else {
			return errors.New("llm_judge config requires both provider and model when overriding defaults")
		}
	case hasProvider && hasModel && strings.Contains(model, "/"):
		parts := strings.SplitN(model, "/", 2)
		if !strings.EqualFold(strings.TrimSpace(parts[0]), provider) {
			return fmt.Errorf("llm_judge config model provider %q does not match provider %q", strings.TrimSpace(parts[0]), provider)
		}
	}

	if _, _, err := normalizeOptionalString(config, "system_prompt"); err != nil {
		return err
	}
	if _, _, err := normalizeOptionalString(config, "user_prompt"); err != nil {
		return err
	}

	maxTokens, hasMaxTokens, err := normalizeOptionalInt(config, "max_tokens")
	if err != nil {
		return err
	}
	if hasMaxTokens && maxTokens <= 0 {
		return errors.New("llm_judge config max_tokens must be an integer greater than 0")
	}

	timeoutMs, hasTimeoutMs, err := normalizeOptionalInt(config, "timeout_ms")
	if err != nil {
		return err
	}
	if hasTimeoutMs && timeoutMs <= 0 {
		return errors.New("llm_judge config timeout_ms must be an integer greater than 0")
	}

	temperature, hasTemperature, err := normalizeOptionalFloat(config, "temperature")
	if err != nil {
		return err
	}
	if hasTemperature && (math.IsNaN(temperature) || math.IsInf(temperature, 0) || temperature < 0 || temperature > 2) {
		return errors.New("llm_judge config temperature must be between 0 and 2")
	}
	return nil
}

func validateEvaluatorConfigOverrides(kind evalpkg.EvaluatorKind, config map[string]any) error {
	switch kind {
	case evalpkg.EvaluatorKindLLMJudge:
		return validateLLMJudgeConfig(config)
	default:
		return nil
	}
}

func validateSavedConversationID(id string) error {
	if !savedConversationIDPattern.MatchString(id) {
		return fmt.Errorf("saved_id %q is invalid: only letters, digits, _, ., -, and : are allowed", id)
	}
	return nil
}

func validateSavedConversationTags(tags map[string]string) (map[string]string, error) {
	if len(tags) == 0 {
		return map[string]string{}, nil
	}
	normalized := make(map[string]string, len(tags))
	for rawKey, rawValue := range tags {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" {
			return nil, errors.New("tags keys cannot be empty")
		}
		if value == "" {
			return nil, fmt.Errorf("tag %q value cannot be empty", key)
		}
		normalized[key] = value
	}
	return normalized, nil
}

func validateManualGenerations(generations []ManualGeneration) error {
	if len(generations) == 0 {
		return errors.New("at least one generation is required")
	}
	seenGenerationIDs := make(map[string]struct{}, len(generations))
	for idx := range generations {
		gen := &generations[idx]
		gen.GenerationID = strings.TrimSpace(gen.GenerationID)
		gen.OperationName = strings.TrimSpace(gen.OperationName)
		if gen.GenerationID == "" {
			return fmt.Errorf("generation[%d]: generation_id is required", idx)
		}
		if _, exists := seenGenerationIDs[gen.GenerationID]; exists {
			return fmt.Errorf("generation[%d]: generation_id %q is duplicated", idx, gen.GenerationID)
		}
		seenGenerationIDs[gen.GenerationID] = struct{}{}

		switch strings.ToUpper(strings.TrimSpace(gen.Mode)) {
		case "":
			gen.Mode = ""
		case "SYNC", "STREAM":
			gen.Mode = strings.ToUpper(strings.TrimSpace(gen.Mode))
		default:
			return fmt.Errorf("generation[%d]: mode must be SYNC or STREAM", idx)
		}

		gen.Model.Provider = strings.TrimSpace(gen.Model.Provider)
		gen.Model.Name = strings.TrimSpace(gen.Model.Name)
		if gen.Model.Provider == "" {
			return fmt.Errorf("generation[%d]: model.provider is required", idx)
		}
		if gen.Model.Name == "" {
			return fmt.Errorf("generation[%d]: model.name is required", idx)
		}
		if len(gen.Input) == 0 {
			return fmt.Errorf("generation[%d]: at least one input message is required", idx)
		}
		if len(gen.Output) == 0 {
			return fmt.Errorf("generation[%d]: at least one output message is required", idx)
		}
		if err := validateManualMessages(fmt.Sprintf("generation[%d].input", idx), gen.Input); err != nil {
			return err
		}
		if err := validateManualMessages(fmt.Sprintf("generation[%d].output", idx), gen.Output); err != nil {
			return err
		}
		gen.StartedAt = normalizeTimePointer(gen.StartedAt)
		gen.CompletedAt = normalizeTimePointer(gen.CompletedAt)
		if gen.StartedAt != nil && gen.CompletedAt != nil && gen.CompletedAt.Before(*gen.StartedAt) {
			return fmt.Errorf("generation[%d]: completed_at must be >= started_at", idx)
		}
	}
	return nil
}

func validateManualMessages(field string, messages []ManualMessage) error {
	for idx := range messages {
		msg := &messages[idx]
		msg.Role = strings.ToLower(strings.TrimSpace(msg.Role))
		msg.Content = strings.TrimSpace(msg.Content)
		switch msg.Role {
		case "user", "assistant", "tool":
		default:
			return fmt.Errorf("%s[%d]: role must be user, assistant, or tool", field, idx)
		}
		if msg.Content == "" {
			return fmt.Errorf("%s[%d]: content is required", field, idx)
		}
	}
	return nil
}

func normalizeOutputKeyStrings(values []string, field string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	for idx, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, fmt.Errorf("%s[%d] cannot be empty", field, idx)
		}
		if slices.Contains(normalized, trimmed) {
			return nil, fmt.Errorf("%s contains duplicate value %q", field, trimmed)
		}
		normalized = append(normalized, trimmed)
	}
	return normalized, nil
}

func normalizeConfigStringList(raw any, field string) ([]string, error) {
	switch typed := raw.(type) {
	case []string:
		return normalizeOutputKeyStrings(typed, field)
	case []any:
		values := make([]string, 0, len(typed))
		for idx, value := range typed {
			asString, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("%s[%d] must be a string", field, idx)
			}
			values = append(values, asString)
		}
		return normalizeOutputKeyStrings(values, field)
	default:
		return nil, fmt.Errorf("%s must be an array of strings", field)
	}
}

func normalizeOptionalString(config map[string]any, key string) (string, bool, error) {
	raw, ok := config[key]
	if !ok {
		return "", false, nil
	}
	asString, ok := raw.(string)
	if !ok {
		return "", false, fmt.Errorf("%s must be a string", key)
	}
	trimmed := strings.TrimSpace(asString)
	if trimmed == "" {
		delete(config, key)
		return "", false, nil
	}
	config[key] = trimmed
	return trimmed, true, nil
}

func normalizeOptionalInt(config map[string]any, key string) (int, bool, error) {
	raw, ok := config[key]
	if !ok {
		return 0, false, nil
	}
	switch typed := raw.(type) {
	case int:
		config[key] = typed
		return typed, true, nil
	case int64:
		config[key] = int(typed)
		return int(typed), true, nil
	case float64:
		if math.Trunc(typed) != typed {
			return 0, false, fmt.Errorf("%s must be an integer", key)
		}
		config[key] = int(typed)
		return int(typed), true, nil
	default:
		return 0, false, fmt.Errorf("%s must be an integer", key)
	}
}

func normalizeOptionalFloat(config map[string]any, key string) (float64, bool, error) {
	raw, ok := config[key]
	if !ok {
		return 0, false, nil
	}
	switch typed := raw.(type) {
	case float64:
		return typed, true, nil
	case float32:
		config[key] = float64(typed)
		return float64(typed), true, nil
	case int:
		config[key] = float64(typed)
		return float64(typed), true, nil
	case int64:
		config[key] = float64(typed)
		return float64(typed), true, nil
	default:
		return 0, false, fmt.Errorf("%s must be a number", key)
	}
}

func mergeEvaluatorForkConfig(kind evalpkg.EvaluatorKind, baseConfig, overrideConfig map[string]any) map[string]any {
	merged := cloneMap(baseConfig)
	if kind == evalpkg.EvaluatorKindLLMJudge {
		if rawModel, ok := overrideConfig["model"]; ok {
			if model, ok := rawModel.(string); ok && strings.TrimSpace(model) != "" {
				if _, hasProvider := overrideConfig["provider"]; !hasProvider {
					delete(merged, "provider")
				}
			}
		}
	}
	for key, value := range overrideConfig {
		merged[key] = value
	}
	return merged
}

func validateRulePreviewRuleID(ruleID string) error {
	trimmed := strings.TrimSpace(ruleID)
	if trimmed == "" {
		return nil
	}
	return validateID("rule_id", trimmed)
}

func normalizeTimePointer(ts *time.Time) *time.Time {
	if ts == nil {
		return nil
	}
	normalized := ts.UTC()
	return &normalized
}
