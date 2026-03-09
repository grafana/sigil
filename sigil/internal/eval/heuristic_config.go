package eval

import (
	"fmt"
	"math"
	"strings"
)

const (
	HeuristicConfigVersionV2 = "v2"
	HeuristicMaxDepth        = 3
	HeuristicMaxNodes        = 25
)

type HeuristicOperator string

const (
	HeuristicOperatorAnd HeuristicOperator = "and"
	HeuristicOperatorOr  HeuristicOperator = "or"
)

type HeuristicRuleType string

const (
	HeuristicRuleNotEmpty    HeuristicRuleType = "not_empty"
	HeuristicRuleContains    HeuristicRuleType = "contains"
	HeuristicRuleNotContains HeuristicRuleType = "not_contains"
	HeuristicRuleMinLength   HeuristicRuleType = "min_length"
	HeuristicRuleMaxLength   HeuristicRuleType = "max_length"
)

type HeuristicConfig struct {
	Version string
	Root    HeuristicNode
}

type HeuristicNode struct {
	Group *HeuristicGroupNode
	Rule  *HeuristicRuleNode
}

type HeuristicGroupNode struct {
	Operator HeuristicOperator
	Rules    []HeuristicNode
}

type HeuristicRuleNode struct {
	Type        HeuristicRuleType
	StringValue string
	IntValue    int
}

func NewHeuristicConfig(root HeuristicGroupNode) map[string]any {
	return HeuristicConfig{
		Version: HeuristicConfigVersionV2,
		Root: HeuristicNode{
			Group: &root,
		},
	}.ToMap()
}

func ParseHeuristicConfig(config map[string]any) (*HeuristicConfig, error) {
	if config == nil {
		return nil, fmt.Errorf("heuristic config version is required")
	}

	version, err := heuristicRequiredString(config, "version", "heuristic config version")
	if err != nil {
		return nil, err
	}
	if version != HeuristicConfigVersionV2 {
		return nil, fmt.Errorf("heuristic config version %q is unsupported", version)
	}

	rawRoot, ok := config["root"]
	if !ok {
		return nil, fmt.Errorf("heuristic config root is required")
	}
	rootMap, ok := rawRoot.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("heuristic config root must be an object")
	}

	nodeCount := 0
	root, err := parseHeuristicNode(rootMap, "heuristic config root", 1, &nodeCount)
	if err != nil {
		return nil, err
	}
	if root.Group == nil {
		return nil, fmt.Errorf("heuristic config root must be a group")
	}

	return &HeuristicConfig{
		Version: version,
		Root:    root,
	}, nil
}

func (c HeuristicConfig) ToMap() map[string]any {
	return map[string]any{
		"version": c.Version,
		"root":    c.Root.ToMap(),
	}
}

func (n HeuristicNode) ToMap() map[string]any {
	if n.Group != nil {
		return n.Group.toMap()
	}
	return n.Rule.toMap()
}

func (g HeuristicGroupNode) toMap() map[string]any {
	rules := make([]any, 0, len(g.Rules))
	for _, rule := range g.Rules {
		rules = append(rules, rule.ToMap())
	}
	return map[string]any{
		"kind":     "group",
		"operator": string(g.Operator),
		"rules":    rules,
	}
}

func (r HeuristicRuleNode) toMap() map[string]any {
	out := map[string]any{
		"kind": "rule",
		"type": string(r.Type),
	}
	switch r.Type {
	case HeuristicRuleContains, HeuristicRuleNotContains:
		out["value"] = r.StringValue
	case HeuristicRuleMinLength, HeuristicRuleMaxLength:
		out["value"] = r.IntValue
	}
	return out
}

func parseHeuristicNode(raw map[string]any, path string, depth int, nodeCount *int) (HeuristicNode, error) {
	if depth > HeuristicMaxDepth {
		return HeuristicNode{}, fmt.Errorf("%s exceeds max depth %d", path, HeuristicMaxDepth)
	}
	*nodeCount = *nodeCount + 1
	if *nodeCount > HeuristicMaxNodes {
		return HeuristicNode{}, fmt.Errorf("heuristic config exceeds max node count %d", HeuristicMaxNodes)
	}

	kind, err := heuristicRequiredString(raw, "kind", path+" kind")
	if err != nil {
		return HeuristicNode{}, err
	}
	switch kind {
	case "group":
		group, err := parseHeuristicGroup(raw, path, depth, nodeCount)
		if err != nil {
			return HeuristicNode{}, err
		}
		return HeuristicNode{Group: group}, nil
	case "rule":
		rule, err := parseHeuristicRule(raw, path)
		if err != nil {
			return HeuristicNode{}, err
		}
		return HeuristicNode{Rule: rule}, nil
	default:
		return HeuristicNode{}, fmt.Errorf("%s kind %q is invalid", path, kind)
	}
}

func parseHeuristicGroup(raw map[string]any, path string, depth int, nodeCount *int) (*HeuristicGroupNode, error) {
	operator, err := heuristicRequiredString(raw, "operator", path+" operator")
	if err != nil {
		return nil, err
	}

	var normalizedOperator HeuristicOperator
	switch HeuristicOperator(operator) {
	case HeuristicOperatorAnd:
		normalizedOperator = HeuristicOperatorAnd
	case HeuristicOperatorOr:
		normalizedOperator = HeuristicOperatorOr
	default:
		return nil, fmt.Errorf("%s operator %q is invalid", path, operator)
	}

	rawRules, ok := raw["rules"]
	if !ok {
		return nil, fmt.Errorf("%s rules are required", path)
	}
	ruleList, ok := rawRules.([]any)
	if !ok {
		return nil, fmt.Errorf("%s rules must be an array", path)
	}
	if len(ruleList) == 0 {
		return nil, fmt.Errorf("%s rules must contain at least one node", path)
	}

	rules := make([]HeuristicNode, 0, len(ruleList))
	for idx, child := range ruleList {
		childMap, ok := child.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s rules[%d] must be an object", path, idx)
		}
		parsed, err := parseHeuristicNode(childMap, fmt.Sprintf("%s rules[%d]", path, idx), depth+1, nodeCount)
		if err != nil {
			return nil, err
		}
		rules = append(rules, parsed)
	}

	return &HeuristicGroupNode{
		Operator: normalizedOperator,
		Rules:    rules,
	}, nil
}

func parseHeuristicRule(raw map[string]any, path string) (*HeuristicRuleNode, error) {
	ruleType, err := heuristicRequiredString(raw, "type", path+" type")
	if err != nil {
		return nil, err
	}

	out := &HeuristicRuleNode{Type: HeuristicRuleType(ruleType)}
	switch out.Type {
	case HeuristicRuleNotEmpty:
		if rawValue, ok := raw["value"]; ok && rawValue != nil {
			return nil, fmt.Errorf("%s value is not supported for rule type %q", path, ruleType)
		}
	case HeuristicRuleContains, HeuristicRuleNotContains:
		value, err := heuristicRequiredString(raw, "value", path+" value")
		if err != nil {
			return nil, err
		}
		out.StringValue = value
	case HeuristicRuleMinLength, HeuristicRuleMaxLength:
		value, err := heuristicRequiredInt(raw, "value", path+" value")
		if err != nil {
			return nil, err
		}
		if value < 0 {
			return nil, fmt.Errorf("%s must be >= 0", path+" value")
		}
		out.IntValue = value
	default:
		return nil, fmt.Errorf("%s type %q is invalid", path, ruleType)
	}
	return out, nil
}

func heuristicRequiredString(raw map[string]any, key, field string) (string, error) {
	value, ok := raw[key]
	if !ok {
		return "", fmt.Errorf("%s is required", field)
	}
	asString, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("%s must be a string", field)
	}
	trimmed := strings.TrimSpace(asString)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	return trimmed, nil
}

func heuristicRequiredInt(raw map[string]any, key, field string) (int, error) {
	value, ok := raw[key]
	if !ok {
		return 0, fmt.Errorf("%s is required", field)
	}
	switch typed := value.(type) {
	case int:
		return typed, nil
	case int64:
		return int(typed), nil
	case float64:
		if math.Trunc(typed) != typed {
			return 0, fmt.Errorf("%s must be an integer", field)
		}
		return int(typed), nil
	default:
		return 0, fmt.Errorf("%s must be an integer", field)
	}
}
