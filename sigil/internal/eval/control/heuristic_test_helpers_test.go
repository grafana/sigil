package control

import (
	"encoding/json"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func heuristicConfigForTest(rules ...evalpkg.HeuristicNode) map[string]any {
	return evalpkg.NewHeuristicConfig(evalpkg.HeuristicGroupNode{
		Operator: evalpkg.HeuristicOperatorAnd,
		Rules:    rules,
	})
}

func heuristicNotEmptyConfigForTest() map[string]any {
	return heuristicConfigForTest(
		evalpkg.HeuristicNode{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleNotEmpty}},
	)
}

func heuristicContainsConfigForTest(value string) map[string]any {
	return heuristicConfigForTest(
		evalpkg.HeuristicNode{Rule: &evalpkg.HeuristicRuleNode{Type: evalpkg.HeuristicRuleContains, StringValue: value}},
	)
}

func heuristicNotEmptyJSONForTest() string {
	data, _ := json.Marshal(heuristicNotEmptyConfigForTest())
	return string(data)
}

func heuristicContainsJSONForTest(value string) string {
	data, _ := json.Marshal(heuristicContainsConfigForTest(value))
	return string(data)
}
