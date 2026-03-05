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

// OutputKeyMeta holds the resolved fields from the first output key definition.
type OutputKeyMeta struct {
	Key           string
	Type          evalpkg.ScoreType
	Unit          string
	PassThreshold *float64
	Min           *float64
	Max           *float64
	PassMatch     []string
	PassValue     *bool
}

func firstOutputKey(definition evalpkg.EvaluatorDefinition, fallbackKey string, fallbackType evalpkg.ScoreType) OutputKeyMeta {
	if len(definition.OutputKeys) == 0 {
		return OutputKeyMeta{Key: fallbackKey, Type: fallbackType}
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
	return OutputKeyMeta{
		Key:           key,
		Type:          typeValue,
		Unit:          item.Unit,
		PassThreshold: item.PassThreshold,
		Min:           item.Min,
		Max:           item.Max,
		PassMatch:     item.PassMatch,
		PassValue:     item.PassValue,
	}
}

func boolPointer(value bool) *bool {
	copied := value
	return &copied
}

func stringSliceContains(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
