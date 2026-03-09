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

func TestEvalTestRequest_NormalizeAndValidateErrors(t *testing.T) {
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
			_, err := tt.req.normalizeAndValidate()
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

func float64Ptr(v float64) *float64 { return &v }

func TestTestService_RunTest_BoundsEnforcement(t *testing.T) {
	tests := []struct {
		name           string
		outputKeys     []evalpkg.OutputKey
		scores         []evaluators.ScoreOutput
		wantScoreCount int
		wantScoreKeys  []string
	}{
		{
			name: "score_within_bounds_is_returned",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(5),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_below_min_is_filtered",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-1),
			}},
			wantScoreCount: 0,
		},
		{
			name: "score_above_max_is_filtered",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(11),
			}},
			wantScoreCount: 0,
		},
		{
			name: "only_min_set_below_min_filtered",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-0.5),
			}},
			wantScoreCount: 0,
		},
		{
			name: "only_min_set_above_min_returned",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(100),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "only_max_set_above_max_filtered",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(10.5),
			}},
			wantScoreCount: 0,
		},
		{
			name: "only_max_set_below_max_returned",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-100),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_at_exact_min_is_returned",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(0),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_at_exact_max_is_returned",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(10),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "bool_score_not_affected_by_number_bounds",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "pass",
				Type: evalpkg.ScoreTypeBool,
			}},
			scores: []evaluators.ScoreOutput{{
				Key:   "pass",
				Type:  evalpkg.ScoreTypeBool,
				Value: evalpkg.BoolValue(true),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"pass"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := &stubGenerationReader{generation: testGeneration()}
			eval := &stubEvaluator{
				kind:   evalpkg.EvaluatorKindHeuristic,
				scores: tt.scores,
			}
			svc := newTestService(reader, eval)

			resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
				Kind:         "heuristic",
				Config:       map[string]any{"not_empty": true},
				OutputKeys:   tt.outputKeys,
				GenerationID: "gen-1",
			})

			require.NoError(t, err)
			require.NotNil(t, resp)
			assert.Len(t, resp.Scores, tt.wantScoreCount)

			for i, wantKey := range tt.wantScoreKeys {
				assert.Equal(t, wantKey, resp.Scores[i].Key)
			}
		})
	}
}
