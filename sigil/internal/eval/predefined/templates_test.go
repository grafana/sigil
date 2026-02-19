package predefined

import (
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestLLMJudgeTemplatesDoNotHardcodeProviderOrModel(t *testing.T) {
	for _, template := range Templates() {
		if template.Kind != evalpkg.EvaluatorKindLLMJudge {
			continue
		}

		if _, exists := template.Config["provider"]; exists {
			t.Fatalf("template %q should not hardcode provider", template.EvaluatorID)
		}
		if _, exists := template.Config["model"]; exists {
			t.Fatalf("template %q should not hardcode model", template.EvaluatorID)
		}
	}
}
