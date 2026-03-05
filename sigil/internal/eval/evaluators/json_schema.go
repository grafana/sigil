package evaluators

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type JSONSchemaEvaluator struct{}

func NewJSONSchemaEvaluator() *JSONSchemaEvaluator {
	return &JSONSchemaEvaluator{}
}

func (e *JSONSchemaEvaluator) Kind() evalpkg.EvaluatorKind {
	return evalpkg.EvaluatorKindJSONSchema
}

func (e *JSONSchemaEvaluator) Evaluate(_ context.Context, input EvalInput, definition evalpkg.EvaluatorDefinition) ([]ScoreOutput, error) {
	meta := firstOutputKey(definition, "json_valid", evalpkg.ScoreTypeBool)
	if meta.Type != evalpkg.ScoreTypeBool {
		return nil, evalpkg.Permanent(fmt.Errorf("json_schema evaluator output key %q must be bool", meta.Key))
	}

	var value any
	if err := json.Unmarshal([]byte(input.ResponseText), &value); err != nil {
		return []ScoreOutput{{
			Key:         meta.Key,
			Type:        evalpkg.ScoreTypeBool,
			Value:       evalpkg.BoolValue(false),
			Unit:        meta.Unit,
			Passed:      boolPointer(false),
			Explanation: "response is not valid JSON",
			Metadata:    map[string]any{"error": err.Error()},
		}}, nil
	}

	schema := map[string]any{}
	if rawSchema, ok := definition.Config["schema"]; ok {
		if typedSchema, ok := rawSchema.(map[string]any); ok {
			schema = typedSchema
		}
	}

	err := validateSchemaValue(schema, value)
	valid := err == nil
	explanation := ""
	metadata := map[string]any{}
	if err != nil {
		explanation = err.Error()
		metadata["error"] = err.Error()
	}

	return []ScoreOutput{{
		Key:         meta.Key,
		Type:        evalpkg.ScoreTypeBool,
		Value:       evalpkg.BoolValue(valid),
		Unit:        meta.Unit,
		Passed:      boolPointer(valid),
		Explanation: explanation,
		Metadata:    metadata,
	}}, nil
}

func validateSchemaValue(schema map[string]any, value any) error {
	if len(schema) == 0 {
		return nil
	}

	typeName, _ := schema["type"].(string)
	switch strings.TrimSpace(typeName) {
	case "", "any":
		// No type constraint.
	case "object":
		objectValue, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("expected object")
		}
		if requiredRaw, ok := schema["required"]; ok {
			required := toStringSlice(requiredRaw)
			for _, key := range required {
				if _, exists := objectValue[key]; !exists {
					return fmt.Errorf("missing required key %q", key)
				}
			}
		}
		if propertiesRaw, ok := schema["properties"]; ok {
			if properties, ok := propertiesRaw.(map[string]any); ok {
				for key, propertySchemaRaw := range properties {
					propertyValue, exists := objectValue[key]
					if !exists {
						continue
					}
					propertySchema, ok := propertySchemaRaw.(map[string]any)
					if !ok {
						continue
					}
					if err := validateSchemaValue(propertySchema, propertyValue); err != nil {
						return fmt.Errorf("property %q: %w", key, err)
					}
				}
			}
		}
	case "array":
		arrayValue, ok := value.([]any)
		if !ok {
			return fmt.Errorf("expected array")
		}
		if itemsRaw, ok := schema["items"]; ok {
			itemsSchema, ok := itemsRaw.(map[string]any)
			if ok {
				for index, itemValue := range arrayValue {
					if err := validateSchemaValue(itemsSchema, itemValue); err != nil {
						return fmt.Errorf("item %d: %w", index, err)
					}
				}
			}
		}
	case "string":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string")
		}
	case "number":
		if _, ok := value.(float64); !ok {
			return fmt.Errorf("expected number")
		}
	case "integer":
		number, ok := value.(float64)
		if !ok || number != float64(int64(number)) {
			return fmt.Errorf("expected integer")
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("expected boolean")
		}
	}
	return nil
}

func toStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if asString, ok := item.(string); ok {
				out = append(out, asString)
			}
		}
		return out
	default:
		return nil
	}
}
