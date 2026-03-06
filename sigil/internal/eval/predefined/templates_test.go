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

func TestTemplatesIncludeGroundednessAndNoHallucination(t *testing.T) {
	foundGroundedness := false
	for _, template := range Templates() {
		if template.EvaluatorID == "sigil.hallucination" {
			t.Fatalf("deprecated template %q should not be present", template.EvaluatorID)
		}
		if template.EvaluatorID == "sigil.groundedness" {
			foundGroundedness = true
		}
	}
	if !foundGroundedness {
		t.Fatal("expected sigil.groundedness predefined template")
	}
}

func TestBoolSafetyTemplatesSetPassValueFalse(t *testing.T) {
	for _, templateID := range []string{"sigil.toxicity", "sigil.pii"} {
		found := false
		for _, template := range Templates() {
			if template.EvaluatorID != templateID {
				continue
			}
			found = true
			if len(template.OutputKeys) != 1 || template.OutputKeys[0].PassValue == nil || *template.OutputKeys[0].PassValue {
				t.Fatalf("template %q should set pass_value=false", templateID)
			}
		}
		if !found {
			t.Fatalf("expected template %q", templateID)
		}
	}
}

func TestNumericJudgeTemplatesDeclareBounds(t *testing.T) {
	for _, templateID := range []string{"sigil.helpfulness", "sigil.groundedness", "sigil.relevance", "sigil.conciseness"} {
		found := false
		for _, template := range Templates() {
			if template.EvaluatorID != templateID {
				continue
			}
			found = true
			if len(template.OutputKeys) != 1 {
				t.Fatalf("template %q should have one output key", templateID)
			}
			ok := template.OutputKeys[0]
			if ok.Min == nil || *ok.Min != 1 {
				t.Fatalf("template %q should set min=1", templateID)
			}
			if ok.Max == nil || *ok.Max != 10 {
				t.Fatalf("template %q should set max=10", templateID)
			}
		}
		if !found {
			t.Fatalf("expected template %q", templateID)
		}
	}
}
