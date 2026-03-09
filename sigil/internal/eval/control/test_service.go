package control

import (
	"context"
	"fmt"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
)

// EvalTestRequest describes a one-shot evaluator test against a stored generation.
type EvalTestRequest struct {
	Kind         string              `json:"kind"`
	Config       map[string]any      `json:"config"`
	OutputKeys   []evalpkg.OutputKey `json:"output_keys"`
	GenerationID string              `json:"generation_id"`
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

// TestService runs synchronous one-shot evaluator tests against stored generations.
type TestService struct {
	reader     worker.GenerationReader
	evaluators map[evalpkg.EvaluatorKind]evaluators.Evaluator
}

// NewTestService creates a TestService with the given generation reader and evaluator registry.
func NewTestService(reader worker.GenerationReader, evals map[evalpkg.EvaluatorKind]evaluators.Evaluator) *TestService {
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

	generation, err := s.reader.GetByID(ctx, tenantID, req.GenerationID)
	if err != nil {
		return nil, fmt.Errorf("fetch generation: %w", err)
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
