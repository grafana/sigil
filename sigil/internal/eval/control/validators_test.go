package control

import (
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestValidateJSONSchemaConfig(t *testing.T) {
	t.Run("valid nested schema", func(t *testing.T) {
		config := map[string]any{
			"schema": map[string]any{
				"type":     "object",
				"required": []any{" score "},
				"properties": map[string]any{
					"score": map[string]any{"type": "number"},
					"items": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "string",
						},
					},
				},
			},
		}
		if err := validateJSONSchemaConfig(config); err != nil {
			t.Fatalf("expected valid schema, got %v", err)
		}

		required := config["schema"].(map[string]any)["required"].([]string)
		if len(required) != 1 || required[0] != "score" {
			t.Fatalf("expected normalized required list, got %#v", required)
		}
	})

	t.Run("schema must be object", func(t *testing.T) {
		err := validateJSONSchemaConfig(map[string]any{"schema": "not-an-object"})
		if err == nil || !strings.Contains(err.Error(), "schema must be an object") {
			t.Fatalf("expected object error, got %v", err)
		}
	})

	t.Run("invalid nested schema", func(t *testing.T) {
		err := validateJSONSchemaConfig(map[string]any{
			"schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"score": map[string]any{"type": "wat"},
				},
			},
		})
		if err == nil || !strings.Contains(err.Error(), `schema.properties.score.type "wat" is unsupported`) {
			t.Fatalf("expected nested type error, got %v", err)
		}
	})

	t.Run("items must be object", func(t *testing.T) {
		err := validateJSONSchemaConfig(map[string]any{
			"schema": map[string]any{
				"type":  "array",
				"items": "bad",
			},
		})
		if err == nil || !strings.Contains(err.Error(), "schema.items must be an object") {
			t.Fatalf("expected items object error, got %v", err)
		}
	})
}

func TestValidateRegexConfig(t *testing.T) {
	tests := []struct {
		name    string
		config  map[string]any
		wantErr string
	}{
		{
			name:    "pattern wrong type",
			config:  map[string]any{"pattern": 123},
			wantErr: "pattern must be a string",
		},
		{
			name:    "patterns wrong type",
			config:  map[string]any{"patterns": "abc"},
			wantErr: "patterns must be an array of strings",
		},
		{
			name:    "invalid pattern in list",
			config:  map[string]any{"patterns": []any{"("}},
			wantErr: "pattern \"(\" is invalid",
		},
		{
			name:    "reject wrong type",
			config:  map[string]any{"pattern": "ok", "reject": "true"},
			wantErr: "reject must be a bool",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateRegexConfig(tc.config)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestValidateLLMJudgeConfig(t *testing.T) {
	tests := []struct {
		name    string
		config  map[string]any
		wantErr string
	}{
		{
			name:    "provider without model",
			config:  map[string]any{"provider": "openai"},
			wantErr: "requires both provider and model",
		},
		{
			name:    "prefixed model missing provider name",
			config:  map[string]any{"model": "/gpt-4o-mini"},
			wantErr: "model must be provider/model",
		},
		{
			name:    "provider mismatch",
			config:  map[string]any{"provider": "google", "model": "openai/gpt-4o-mini"},
			wantErr: "does not match provider",
		},
		{
			name:    "invalid max_tokens type",
			config:  map[string]any{"provider": "openai", "model": "gpt-4o-mini", "max_tokens": 1.5},
			wantErr: "max_tokens must be an integer",
		},
		{
			name:    "invalid timeout_ms value",
			config:  map[string]any{"provider": "openai", "model": "gpt-4o-mini", "timeout_ms": 0},
			wantErr: "timeout_ms must be an integer greater than 0",
		},
		{
			name:    "invalid temperature type",
			config:  map[string]any{"provider": "openai", "model": "gpt-4o-mini", "temperature": "hot"},
			wantErr: "temperature must be a number",
		},
		{
			name:    "invalid temperature range",
			config:  map[string]any{"provider": "openai", "model": "gpt-4o-mini", "temperature": 3},
			wantErr: "temperature must be between 0 and 2",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateLLMJudgeConfig(tc.config)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}

	t.Run("valid config normalizes numeric fields", func(t *testing.T) {
		config := map[string]any{
			"provider":      " openai ",
			"model":         " gpt-4o-mini ",
			"system_prompt": " hi ",
			"user_prompt":   " there ",
			"max_tokens":    int64(128),
			"timeout_ms":    int(5000),
			"temperature":   float32(0.5),
		}
		if err := validateLLMJudgeConfig(config); err != nil {
			t.Fatalf("expected valid config, got %v", err)
		}
		if config["provider"] != "openai" || config["model"] != "gpt-4o-mini" {
			t.Fatalf("expected trimmed provider/model, got %#v", config)
		}
		if _, ok := config["max_tokens"].(int); !ok {
			t.Fatalf("expected normalized int max_tokens, got %#v", config["max_tokens"])
		}
		if _, ok := config["temperature"].(float64); !ok {
			t.Fatalf("expected normalized float64 temperature, got %#v", config["temperature"])
		}
	})
}

func TestValidateEvaluatorConfig(t *testing.T) {
	err := validateEvaluatorConfig(evalpkg.EvaluatorKindLLMJudge, map[string]any{"provider": "openai", "model": "gpt-4o-mini"}, []evalpkg.OutputKey{{
		Key:  " explanation ",
		Type: evalpkg.ScoreTypeNumber,
	}})
	if err == nil || !strings.Contains(err.Error(), `output key "explanation" is reserved`) {
		t.Fatalf("expected reserved-key error, got %v", err)
	}

	err = validateEvaluatorConfig(evalpkg.EvaluatorKind("bogus"), map[string]any{}, nil)
	if err == nil || !strings.Contains(err.Error(), "kind is invalid") {
		t.Fatalf("expected invalid kind error, got %v", err)
	}

	t.Run("json schema requires bool outputs", func(t *testing.T) {
		err := validateEvaluatorConfig(evalpkg.EvaluatorKindJSONSchema, map[string]any{
			"schema": map[string]any{"type": "object"},
		}, []evalpkg.OutputKey{{
			Key:  "json_valid",
			Type: evalpkg.ScoreTypeString,
		}})
		if err == nil || !strings.Contains(err.Error(), "json_schema evaluators require bool output keys") {
			t.Fatalf("expected bool output error, got %v", err)
		}
	})

	t.Run("regex rejects pass_value overrides", func(t *testing.T) {
		passValue := false
		err := validateEvaluatorConfig(evalpkg.EvaluatorKindRegex, map[string]any{
			"pattern": "^ok$",
		}, []evalpkg.OutputKey{{
			Key:       "regex_match",
			Type:      evalpkg.ScoreTypeBool,
			PassValue: &passValue,
		}})
		if err == nil || !strings.Contains(err.Error(), "regex evaluators do not support output key pass_value=false") {
			t.Fatalf("expected pass_value error, got %v", err)
		}
	})

	t.Run("json schema normalizes legacy pass_value true", func(t *testing.T) {
		passValue := true
		outputKeys := []evalpkg.OutputKey{{
			Key:       "json_valid",
			Type:      evalpkg.ScoreTypeBool,
			PassValue: &passValue,
		}}
		err := validateEvaluatorConfig(evalpkg.EvaluatorKindJSONSchema, map[string]any{
			"schema": map[string]any{"type": "object"},
		}, outputKeys)
		if err != nil {
			t.Fatalf("expected legacy pass_value=true to be accepted, got %v", err)
		}
		if outputKeys[0].PassValue != nil {
			t.Fatalf("expected legacy pass_value=true to be normalized away, got %#v", outputKeys[0].PassValue)
		}
	})
}

func TestNumericNormalizationHelpers(t *testing.T) {
	t.Run("normalizeOptionalInt", func(t *testing.T) {
		config := map[string]any{"value": int64(12)}
		got, ok, err := normalizeOptionalInt(config, "value")
		if err != nil || !ok || got != 12 {
			t.Fatalf("unexpected int normalization result: got=%d ok=%v err=%v", got, ok, err)
		}

		_, _, err = normalizeOptionalInt(map[string]any{"value": 1.5}, "value")
		if err == nil || !strings.Contains(err.Error(), "must be an integer") {
			t.Fatalf("expected integer error, got %v", err)
		}
	})

	t.Run("normalizeOptionalFloat", func(t *testing.T) {
		config := map[string]any{"value": int64(3)}
		got, ok, err := normalizeOptionalFloat(config, "value")
		if err != nil || !ok || got != 3 {
			t.Fatalf("unexpected float normalization result: got=%v ok=%v err=%v", got, ok, err)
		}

		_, _, err = normalizeOptionalFloat(map[string]any{"value": true}, "value")
		if err == nil || !strings.Contains(err.Error(), "must be a number") {
			t.Fatalf("expected number error, got %v", err)
		}
	})
}

func TestNormalizeTimePointer(t *testing.T) {
	if normalizeTimePointer(nil) != nil {
		t.Fatal("expected nil input to remain nil")
	}

	loc := time.FixedZone("custom", -5*60*60)
	value := time.Date(2026, 3, 9, 12, 0, 0, 0, loc)
	got := normalizeTimePointer(&value)
	if got == nil {
		t.Fatal("expected normalized time")
	}
	if got.Location() != time.UTC {
		t.Fatalf("expected UTC location, got %v", got.Location())
	}
	if got.Hour() != 17 {
		t.Fatalf("expected UTC conversion, got %v", got)
	}
}

func TestValidateManualGenerations_NormalizesTimesToUTC(t *testing.T) {
	loc := time.FixedZone("custom", -5*60*60)
	startedAt := time.Date(2026, 3, 9, 12, 0, 0, 0, loc)
	completedAt := time.Date(2026, 3, 9, 12, 1, 0, 0, loc)
	generations := []ManualGeneration{{
		GenerationID: "gen-1",
		Mode:         "sync",
		Model: ManualModelRef{
			Provider: "openai",
			Name:     "gpt-4o-mini",
		},
		Input:       []ManualMessage{{Role: "user", Content: "hello"}},
		Output:      []ManualMessage{{Role: "assistant", Content: "world"}},
		StartedAt:   &startedAt,
		CompletedAt: &completedAt,
	}}

	if err := validateManualGenerations(generations); err != nil {
		t.Fatalf("validate manual generations: %v", err)
	}
	if generations[0].StartedAt == nil || generations[0].CompletedAt == nil {
		t.Fatal("expected timestamps to remain populated")
	}
	if generations[0].StartedAt.Location() != time.UTC {
		t.Fatalf("expected started_at to be normalized to UTC, got %v", generations[0].StartedAt.Location())
	}
	if generations[0].CompletedAt.Location() != time.UTC {
		t.Fatalf("expected completed_at to be normalized to UTC, got %v", generations[0].CompletedAt.Location())
	}
}
