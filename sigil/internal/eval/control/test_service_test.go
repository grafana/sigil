package control

import (
	"context"
	"errors"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- stubs ---

type stubGenerationReader struct {
	generation *sigilv1.Generation
	err        error
}

func (s *stubGenerationReader) GetByID(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
	return s.generation, s.err
}

type stubEvaluator struct {
	kind   evalpkg.EvaluatorKind
	scores []evaluators.ScoreOutput
	err    error
}

func (s *stubEvaluator) Kind() evalpkg.EvaluatorKind { return s.kind }

func (s *stubEvaluator) Evaluate(_ context.Context, _ evaluators.EvalInput, _ evalpkg.EvaluatorDefinition) ([]evaluators.ScoreOutput, error) {
	return s.scores, s.err
}

// --- helpers ---

func testGeneration() *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Input: []*sigilv1.Message{
			{Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "What is Go?"}}}},
		},
		Output: []*sigilv1.Message{
			{Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "Go is a programming language."}}}},
		},
	}
}

func newTestService(reader *stubGenerationReader, evals ...evaluators.Evaluator) *TestService {
	m := make(map[evalpkg.EvaluatorKind]evaluators.Evaluator, len(evals))
	for _, e := range evals {
		m[e.Kind()] = e
	}
	return NewTestService(reader, m)
}

// --- tests ---

func TestTestService_RunTest(t *testing.T) {
	passed := true
	reader := &stubGenerationReader{generation: testGeneration()}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{
			{
				Key:         "regex_match",
				Type:        evalpkg.ScoreTypeBool,
				Value:       evalpkg.BoolValue(true),
				Passed:      &passed,
				Explanation: "pattern matched",
				Metadata:    map[string]any{"pattern": "Go"},
			},
		},
	}

	svc := newTestService(reader, eval)
	resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": "Go"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-1",
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "gen-1", resp.GenerationID)
	assert.Equal(t, "conv-1", resp.ConversationID)
	assert.Greater(t, resp.ExecutionTimeMs, int64(-1))

	require.Len(t, resp.Scores, 1)
	score := resp.Scores[0]
	assert.Equal(t, "regex_match", score.Key)
	assert.Equal(t, "bool", score.Type)
	assert.Equal(t, true, score.Value)
	require.NotNil(t, score.Passed)
	assert.True(t, *score.Passed)
	assert.Equal(t, "pattern matched", score.Explanation)
	assert.Equal(t, map[string]any{"pattern": "Go"}, score.Metadata)
}

func TestTestService_RunTest_ValidationErrors(t *testing.T) {
	reader := &stubGenerationReader{generation: testGeneration()}
	eval := &stubEvaluator{kind: evalpkg.EvaluatorKindRegex}
	svc := newTestService(reader, eval)

	tests := []struct {
		name string
		req  EvalTestRequest
	}{
		{
			name: "empty kind",
			req: EvalTestRequest{
				Kind:         "",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "gen-1",
			},
		},
		{
			name: "invalid kind",
			req: EvalTestRequest{
				Kind:         "unknown_kind",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "gen-1",
			},
		},
		{
			name: "empty config",
			req: EvalTestRequest{
				Kind:         "regex",
				Config:       nil,
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "gen-1",
			},
		},
		{
			name: "empty output_keys",
			req: EvalTestRequest{
				Kind:         "regex",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   nil,
				GenerationID: "gen-1",
			},
		},
		{
			name: "empty generation_id",
			req: EvalTestRequest{
				Kind:         "regex",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.RunTest(context.Background(), "tenant-1", tt.req)
			require.Error(t, err)
			assert.True(t, isValidationError(err), "expected validation error, got: %v", err)
		})
	}
}

func TestTestService_RunTest_GenerationNotFound(t *testing.T) {
	reader := &stubGenerationReader{generation: nil, err: nil}
	eval := &stubEvaluator{kind: evalpkg.EvaluatorKindRegex}
	svc := newTestService(reader, eval)

	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": "x"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-missing",
	})

	require.Error(t, err)
	assert.True(t, isNotFoundError(err), "expected not-found error, got: %v", err)
}

func TestTestService_RunTest_EvaluatorNotRegistered(t *testing.T) {
	reader := &stubGenerationReader{generation: testGeneration()}
	// No evaluators registered.
	svc := NewTestService(reader, map[evalpkg.EvaluatorKind]evaluators.Evaluator{})

	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": "x"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-1",
	})

	require.Error(t, err)
	assert.True(t, isValidationError(err), "expected validation error for unregistered evaluator, got: %v", err)
}

func TestTestService_RunTest_EvaluatorError(t *testing.T) {
	reader := &stubGenerationReader{generation: testGeneration()}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		err:  errors.New("evaluator exploded"),
	}
	svc := newTestService(reader, eval)

	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": "x"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-1",
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "evaluator exploded")
}
