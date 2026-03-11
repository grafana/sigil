package control

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/encoding/protojson"
)

// EvalTestRequest describes a one-shot evaluator test against a stored generation.
// When GenerationData is provided the backend uses it directly, avoiding a
// storage round-trip. The frontend already fetches the generation for preview,
// so echoing it back here eliminates a redundant cold-storage scan.
type EvalTestRequest struct {
	Kind           string              `json:"kind"`
	Config         map[string]any      `json:"config"`
	OutputKeys     []evalpkg.OutputKey `json:"output_keys"`
	GenerationID   string              `json:"generation_id,omitempty"`
	GenerationData json.RawMessage     `json:"generation_data,omitempty"`
	ConversationID string              `json:"conversation_id,omitempty"`
	From           time.Time           `json:"from,omitempty"`
	To             time.Time           `json:"to,omitempty"`
	At             time.Time           `json:"at,omitempty"`
}

// EvalTestScore is a single score produced during a test run.
type EvalTestScore struct {
	Key         string         `json:"key"`
	Type        string         `json:"type"`
	Value       any            `json:"value"`
	Passed      *bool          `json:"passed,omitempty"`
	Explanation string         `json:"explanation,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// EvalTestResponse contains the results of a synchronous evaluator test.
type EvalTestResponse struct {
	GenerationID    string          `json:"generation_id"`
	ConversationID  string          `json:"conversation_id"`
	Scores          []EvalTestScore `json:"scores"`
	ExecutionTimeMs int64           `json:"execution_time_ms"`
}

type generationLookup interface {
	GetGenerationByIDWithPlan(
		ctx context.Context,
		tenantID, generationID string,
		plan storage.GenerationReadPlan,
	) (*sigilv1.Generation, error)
}

// TestService runs synchronous one-shot evaluator tests against stored generations.
type TestService struct {
	reader     generationLookup
	evaluators map[evalpkg.EvaluatorKind]evaluators.Evaluator
}

// NewTestService creates a TestService with the given generation reader and evaluator registry.
func NewTestService(reader generationLookup, evals map[evalpkg.EvaluatorKind]evaluators.Evaluator) *TestService {
	return &TestService{
		reader:     reader,
		evaluators: evals,
	}
}

// RunTest validates the request, fetches the generation, runs the evaluator, and returns scores.
func (s *TestService) RunTest(ctx context.Context, tenantID string, req EvalTestRequest) (*EvalTestResponse, error) {
	kind := evalpkg.EvaluatorKind(req.Kind)

	eval, ok := s.evaluators[kind]
	if !ok {
		return nil, ValidationWrap(fmt.Errorf("no evaluator registered for kind %q", kind))
	}

	generation, err := s.resolveGeneration(ctx, tenantID, req)
	if err != nil {
		return nil, err
	}
	if generation == nil {
		return nil, NotFoundError(fmt.Sprintf("generation %q not found", req.GenerationID))
	}

	input := evaluators.InputFromGeneration(tenantID, generation)

	definition := evalpkg.EvaluatorDefinition{
		Kind:       kind,
		Config:     req.Config,
		OutputKeys: req.OutputKeys,
	}

	start := time.Now()
	scores, err := eval.Evaluate(ctx, input, definition)
	elapsed := time.Since(start)
	if err != nil {
		return nil, fmt.Errorf("evaluate: %w", err)
	}

	keyConstraints := make(map[string]evalpkg.OutputKey, len(req.OutputKeys))
	for _, ok := range req.OutputKeys {
		keyConstraints[ok.Key] = ok
	}

	result := &EvalTestResponse{
		GenerationID:    generation.GetId(),
		ConversationID:  generation.GetConversationId(),
		Scores:          make([]EvalTestScore, 0, len(scores)),
		ExecutionTimeMs: elapsed.Milliseconds(),
	}

	for _, s := range scores {
		if constraint, found := keyConstraints[s.Key]; found && s.Type == evalpkg.ScoreTypeNumber && s.Value.Number != nil {
			if constraint.Min != nil && *s.Value.Number < *constraint.Min {
				continue
			}
			if constraint.Max != nil && *s.Value.Number > *constraint.Max {
				continue
			}
		}

		result.Scores = append(result.Scores, EvalTestScore{
			Key:         s.Key,
			Type:        string(s.Type),
			Value:       scoreValueToAny(s.Value),
			Passed:      s.Passed,
			Explanation: s.Explanation,
			Metadata:    s.Metadata,
		})
	}

	return result, nil
}

// resolveGeneration returns a generation from inline data when available,
// falling back to a storage lookup.
func (s *TestService) resolveGeneration(ctx context.Context, tenantID string, req EvalTestRequest) (*sigilv1.Generation, error) {
	if len(req.GenerationData) > 0 {
		return decodeInlineGeneration(req.GenerationData)
	}
	lookupPlan := storage.GenerationReadPlan{
		ConversationID: req.ConversationID,
		From:           req.From,
		To:             req.To,
		At:             req.At,
	}
	generation, err := s.reader.GetGenerationByIDWithPlan(ctx, tenantID, req.GenerationID, lookupPlan)
	if err != nil {
		return nil, fmt.Errorf("fetch generation: %w", err)
	}
	return generation, nil
}

// decodeInlineGeneration unmarshals client-provided generation JSON back into
// the proto representation. The query API reshapes several proto fields before
// returning them (e.g. renames "id" → "generation_id"), so we normalize the
// JSON before handing it to protojson. Non-proto fields like latest_scores are
// silently discarded via DiscardUnknown.
func decodeInlineGeneration(data json.RawMessage) (*sigilv1.Generation, error) {
	data = normalizeQueryAPIGeneration(data)
	var gen sigilv1.Generation
	opts := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err := opts.Unmarshal(data, &gen); err != nil {
		return nil, ValidationWrap(fmt.Errorf("invalid generation_data: %w", err))
	}
	return &gen, nil
}

// normalizeQueryAPIGeneration remaps query-API field names back to proto field
// names so protojson can unmarshal correctly. The query API's
// generationToResponsePayload renames proto "id" → "generation_id"; this
// reverses that transform. When both fields are present, the explicit proto
// "id" wins.
func normalizeQueryAPIGeneration(data json.RawMessage) json.RawMessage {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return data
	}
	if gid, ok := raw["generation_id"]; ok {
		if _, hasID := raw["id"]; !hasID {
			raw["id"] = gid
		}
		delete(raw, "generation_id")
	}
	out, err := json.Marshal(raw)
	if err != nil {
		return data
	}
	return out
}

// scoreValueToAny extracts the concrete value from a ScoreValue union.
func scoreValueToAny(v evalpkg.ScoreValue) any {
	switch {
	case v.Number != nil:
		return *v.Number
	case v.Bool != nil:
		return *v.Bool
	case v.String != nil:
		return *v.String
	default:
		return nil
	}
}
