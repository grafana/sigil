package predefined

import (
	"strings"
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

func TestLLMJudgeTemplatesDefineSpecificSystemPrompt(t *testing.T) {
	for _, template := range Templates() {
		if template.Kind != evalpkg.EvaluatorKindLLMJudge {
			continue
		}

		rawPrompt, ok := template.Config["system_prompt"]
		if !ok {
			t.Fatalf("template %q should define system_prompt", template.EvaluatorID)
		}
		prompt, ok := rawPrompt.(string)
		if !ok {
			t.Fatalf("template %q system_prompt should be a string", template.EvaluatorID)
		}
		if strings.TrimSpace(prompt) == "" {
			t.Fatalf("template %q system_prompt should not be empty", template.EvaluatorID)
		}
	}
}

func TestLLMJudgeTemplatesDefineSpecificUserPrompt(t *testing.T) {
	for _, template := range Templates() {
		if template.Kind != evalpkg.EvaluatorKindLLMJudge {
			continue
		}

		rawPrompt, ok := template.Config["user_prompt"]
		if !ok {
			t.Fatalf("template %q should define user_prompt", template.EvaluatorID)
		}
		prompt, ok := rawPrompt.(string)
		if !ok {
			t.Fatalf("template %q user_prompt should be a string", template.EvaluatorID)
		}
		if strings.TrimSpace(prompt) == "" {
			t.Fatalf("template %q user_prompt should not be empty", template.EvaluatorID)
		}
	}
}

func TestGroundednessAndFormatAdherencePromptsIncludeRicherContext(t *testing.T) {
	expected := map[string][]string{
		"sigil.groundedness":     {"{{system_prompt}}", "{{user_history}}", "{{tool_results}}", "{{assistant_response}}"},
		"sigil.format_adherence": {"{{system_prompt}}", "{{user_history}}", "{{assistant_response}}"},
	}

	for _, template := range Templates() {
		required, ok := expected[template.EvaluatorID]
		if !ok {
			continue
		}
		prompt, _ := template.Config["user_prompt"].(string)
		for _, variable := range required {
			if !strings.Contains(prompt, variable) {
				t.Fatalf("template %q user_prompt should contain %q, got %q", template.EvaluatorID, variable, prompt)
			}
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

func TestTemplatesHaveUniqueEvaluatorIDs(t *testing.T) {
	seen := make(map[string]struct{}, len(Templates()))
	for _, template := range Templates() {
		if _, exists := seen[template.EvaluatorID]; exists {
			t.Fatalf("duplicate evaluator id %q", template.EvaluatorID)
		}
		seen[template.EvaluatorID] = struct{}{}
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
