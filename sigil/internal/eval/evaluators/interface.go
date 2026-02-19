package evaluators

import (
	"context"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

type EvalInput struct {
	TenantID       string
	GenerationID   string
	ConversationID string
	InputText      string
	ResponseText   string
	Generation     *sigilv1.Generation
}

type ScoreOutput struct {
	Key         string
	Type        evalpkg.ScoreType
	Value       evalpkg.ScoreValue
	Unit        string
	Passed      *bool
	Explanation string
	Metadata    map[string]any
}

type Evaluator interface {
	Kind() evalpkg.EvaluatorKind
	Evaluate(ctx context.Context, input EvalInput, definition evalpkg.EvaluatorDefinition) ([]ScoreOutput, error)
}

func InputFromGeneration(tenantID string, generation *sigilv1.Generation) EvalInput {
	if generation == nil {
		return EvalInput{TenantID: tenantID}
	}
	return EvalInput{
		TenantID:       tenantID,
		GenerationID:   generation.GetId(),
		ConversationID: generation.GetConversationId(),
		InputText:      flattenMessages(generation.GetInput()),
		ResponseText:   flattenMessages(generation.GetOutput()),
		Generation:     generation,
	}
}

func flattenMessages(messages []*sigilv1.Message) string {
	if len(messages) == 0 {
		return ""
	}
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		if message == nil {
			continue
		}
		for _, part := range message.GetParts() {
			if text := strings.TrimSpace(part.GetText()); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func firstOutputKey(definition evalpkg.EvaluatorDefinition, fallbackKey string, fallbackType evalpkg.ScoreType) (string, evalpkg.ScoreType, string, *float64) {
	if len(definition.OutputKeys) == 0 {
		return fallbackKey, fallbackType, "", nil
	}
	item := definition.OutputKeys[0]
	key := strings.TrimSpace(item.Key)
	if key == "" {
		key = fallbackKey
	}
	typeValue := item.Type
	if strings.TrimSpace(string(typeValue)) == "" {
		typeValue = fallbackType
	}
	return key, typeValue, item.Unit, item.PassThreshold
}

func boolPointer(value bool) *bool {
	copied := value
	return &copied
}
