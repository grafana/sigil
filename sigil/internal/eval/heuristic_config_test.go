package eval

import (
	"strings"
	"testing"
)

func TestParseHeuristicConfig(t *testing.T) {
	t.Run("parses nested tree and normalizes values", func(t *testing.T) {
		config := map[string]any{
			"version": " v2 ",
			"root": map[string]any{
				"kind":     " group ",
				"operator": " and ",
				"rules": []any{
					map[string]any{"kind": "rule", "type": "not_empty"},
					map[string]any{
						"kind":     "group",
						"operator": "or",
						"rules": []any{
							map[string]any{"kind": "rule", "type": "contains", "value": " refund "},
							map[string]any{"kind": "rule", "type": "min_length", "value": float64(5)},
						},
					},
				},
			},
		}

		parsed, err := ParseHeuristicConfig(config)
		if err != nil {
			t.Fatalf("parse heuristic config: %v", err)
		}

		if parsed.Version != HeuristicConfigVersionV2 {
			t.Fatalf("expected version %q, got %q", HeuristicConfigVersionV2, parsed.Version)
		}
		if parsed.Root.Group == nil {
			t.Fatalf("expected root group, got %#v", parsed.Root)
		}
		if parsed.Root.Group.Operator != HeuristicOperatorAnd {
			t.Fatalf("expected root operator %q, got %q", HeuristicOperatorAnd, parsed.Root.Group.Operator)
		}

		nested := parsed.Root.Group.Rules[1]
		if nested.Group == nil || nested.Group.Operator != HeuristicOperatorOr {
			t.Fatalf("expected nested or group, got %#v", nested)
		}
		if nested.Group.Rules[0].Rule == nil || nested.Group.Rules[0].Rule.StringValue != "refund" {
			t.Fatalf("expected trimmed string value, got %#v", nested.Group.Rules[0].Rule)
		}
		if nested.Group.Rules[1].Rule == nil || nested.Group.Rules[1].Rule.IntValue != 5 {
			t.Fatalf("expected normalized integer value, got %#v", nested.Group.Rules[1].Rule)
		}
	})

	tests := []struct {
		name    string
		config  map[string]any
		wantErr string
	}{
		{
			name:    "nil config",
			config:  nil,
			wantErr: "heuristic config version is required",
		},
		{
			name:    "unsupported version",
			config:  map[string]any{"version": "v1", "root": map[string]any{}},
			wantErr: `heuristic config version "v1" is unsupported`,
		},
		{
			name:    "missing root",
			config:  map[string]any{"version": "v2"},
			wantErr: "heuristic config root is required",
		},
		{
			name:    "root must be group",
			config:  map[string]any{"version": "v2", "root": map[string]any{"kind": "rule", "type": "not_empty"}},
			wantErr: "heuristic config root must be a group",
		},
		{
			name: "depth limit",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules": []any{
						map[string]any{
							"kind":     "group",
							"operator": "and",
							"rules": []any{
								map[string]any{
									"kind":     "group",
									"operator": "and",
									"rules": []any{
										map[string]any{"kind": "rule", "type": "not_empty"},
									},
								},
							},
						},
					},
				},
			},
			wantErr: "exceeds max depth 3",
		},
		{
			name: "node count limit",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules":    repeatedRuleMaps(HeuristicMaxNodes),
				},
			},
			wantErr: "heuristic config exceeds max node count 25",
		},
		{
			name: "not empty rejects value",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules": []any{
						map[string]any{"kind": "rule", "type": "not_empty", "value": true},
					},
				},
			},
			wantErr: `value is not supported for rule type "not_empty"`,
		},
		{
			name: "string rule requires non blank value",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules": []any{
						map[string]any{"kind": "rule", "type": "contains", "value": "   "},
					},
				},
			},
			wantErr: "is required",
		},
		{
			name: "int rule requires integer",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules": []any{
						map[string]any{"kind": "rule", "type": "min_length", "value": 1.5},
					},
				},
			},
			wantErr: "must be an integer",
		},
		{
			name: "int rule rejects negative",
			config: map[string]any{
				"version": "v2",
				"root": map[string]any{
					"kind":     "group",
					"operator": "and",
					"rules": []any{
						map[string]any{"kind": "rule", "type": "max_length", "value": -1},
					},
				},
			},
			wantErr: "must be >= 0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseHeuristicConfig(tt.config)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestHeuristicConfigToMap(t *testing.T) {
	config := HeuristicConfig{
		Version: HeuristicConfigVersionV2,
		Root: HeuristicNode{
			Group: &HeuristicGroupNode{
				Operator: HeuristicOperatorAnd,
				Rules: []HeuristicNode{
					{Rule: &HeuristicRuleNode{Type: HeuristicRuleNotEmpty}},
					{Rule: &HeuristicRuleNode{Type: HeuristicRuleContains, StringValue: "refund"}},
					{Rule: &HeuristicRuleNode{Type: HeuristicRuleMaxLength, IntValue: 200}},
				},
			},
		},
	}

	got := config.ToMap()
	want := map[string]any{
		"version": "v2",
		"root": map[string]any{
			"kind":     "group",
			"operator": "and",
			"rules": []any{
				map[string]any{"kind": "rule", "type": "not_empty"},
				map[string]any{"kind": "rule", "type": "contains", "value": "refund"},
				map[string]any{"kind": "rule", "type": "max_length", "value": 200},
			},
		},
	}
	if !mapsEqual(got, want) {
		t.Fatalf("unexpected map output: got %#v want %#v", got, want)
	}

	if !mapsEqual(NewHeuristicConfig(*config.Root.Group), want) {
		t.Fatalf("NewHeuristicConfig did not produce expected map")
	}
}

func repeatedRuleMaps(count int) []any {
	rules := make([]any, 0, count)
	for range count {
		rules = append(rules, map[string]any{"kind": "rule", "type": "not_empty"})
	}
	return rules
}

func mapsEqual(left, right map[string]any) bool {
	if len(left) != len(right) {
		return false
	}
	for key, leftValue := range left {
		rightValue, ok := right[key]
		if !ok {
			return false
		}
		if !valuesEqual(leftValue, rightValue) {
			return false
		}
	}
	return true
}

func valuesEqual(left, right any) bool {
	switch leftTyped := left.(type) {
	case map[string]any:
		rightTyped, ok := right.(map[string]any)
		return ok && mapsEqual(leftTyped, rightTyped)
	case []any:
		rightTyped, ok := right.([]any)
		if !ok || len(leftTyped) != len(rightTyped) {
			return false
		}
		for idx := range leftTyped {
			if !valuesEqual(leftTyped[idx], rightTyped[idx]) {
				return false
			}
		}
		return true
	default:
		return left == right
	}
}
