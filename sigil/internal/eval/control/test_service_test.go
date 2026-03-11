package control

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
)

// --- stubs ---

type stubGenerationReader struct {
	generation *sigilv1.Generation
	err        error
	lastPlan   storage.GenerationReadPlan
	called     bool
}

func (s *stubGenerationReader) GetGenerationByIDWithPlan(
	_ context.Context,
	_,
	_ string,
	plan storage.GenerationReadPlan,
) (*sigilv1.Generation, error) {
	s.called = true
	s.lastPlan = plan
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

func TestTestService_RunTestPassesLookupHints(t *testing.T) {
	createdAt := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC)
	from := createdAt.Add(-5 * time.Minute)
	to := createdAt.Add(5 * time.Minute)

	reader := &stubGenerationReader{generation: testGeneration()}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{{
			Key:   "regex_match",
			Type:  evalpkg.ScoreTypeBool,
			Value: evalpkg.BoolValue(true),
		}},
	}

	svc := newTestService(reader, eval)
	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "Go"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationID:   "gen-1",
		ConversationID: "conv-1",
		From:           from,
		To:             to,
		At:             createdAt,
	})

	require.NoError(t, err)
	assert.Equal(t, storage.GenerationReadPlan{
		ConversationID: "conv-1",
		From:           from,
		To:             to,
		At:             createdAt,
	}, reader.lastPlan)
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
		{
			name: "from without to",
			req: EvalTestRequest{
				Kind:         "regex",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "gen-1",
				From:         time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC),
			},
		},
		{
			name: "to before from",
			req: EvalTestRequest{
				Kind:         "regex",
				Config:       map[string]any{"pattern": "x"},
				OutputKeys:   []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
				GenerationID: "gen-1",
				From:         time.Date(2026, time.March, 9, 12, 5, 0, 0, time.UTC),
				To:           time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC),
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

func TestEvalTestRequest_NormalizeAndValidateTrimsAndPreservesHints(t *testing.T) {
	from := time.Date(2026, time.March, 9, 11, 55, 0, 0, time.FixedZone("offset", -5*60*60))
	to := time.Date(2026, time.March, 9, 12, 5, 0, 0, time.FixedZone("offset", -5*60*60))
	at := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.FixedZone("offset", -5*60*60))

	normalized, err := (EvalTestRequest{
		Kind:           " regex ",
		Config:         map[string]any{"pattern": "x"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
		GenerationID:   " gen-1 ",
		ConversationID: " conv-1 ",
		From:           from,
		To:             to,
		At:             at,
	}).normalizeAndValidate()

	require.NoError(t, err)
	assert.Equal(t, "regex", normalized.Kind)
	assert.Equal(t, "gen-1", normalized.GenerationID)
	assert.Equal(t, "conv-1", normalized.ConversationID)
	assert.Equal(t, from.UTC(), normalized.From)
	assert.Equal(t, to.UTC(), normalized.To)
	assert.Equal(t, at.UTC(), normalized.At)
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
				Config:       heuristicNotEmptyConfigForTest(),
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

// --- inline generation_data tests ---

func marshalGenerationJSON(t *testing.T, gen *sigilv1.Generation) json.RawMessage {
	t.Helper()
	data, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(gen)
	require.NoError(t, err)
	return json.RawMessage(data)
}

func TestTestService_RunTestInlineGeneration(t *testing.T) {
	gen := testGeneration()
	reader := &stubGenerationReader{generation: nil, err: errors.New("should not be called")}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{{
			Key:   "regex_match",
			Type:  evalpkg.ScoreTypeBool,
			Value: evalpkg.BoolValue(true),
		}},
	}
	svc := newTestService(reader, eval)

	resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "Go"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationData: marshalGenerationJSON(t, gen),
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "gen-1", resp.GenerationID)
	assert.Equal(t, "conv-1", resp.ConversationID)
	assert.False(t, reader.called, "storage reader should not be called when inline generation_data is provided")
}

func TestTestService_RunTestInlineGenerationBadJSON(t *testing.T) {
	reader := &stubGenerationReader{}
	eval := &stubEvaluator{
		kind:   evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{},
	}
	svc := newTestService(reader, eval)

	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "Go"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationData: json.RawMessage(`{invalid json`),
	})

	require.Error(t, err)
	assert.True(t, isValidationError(err), "expected validation error for bad JSON, got: %v", err)
}

func TestTestService_RunTestFallsBackToStorageWithoutInlineData(t *testing.T) {
	reader := &stubGenerationReader{generation: testGeneration()}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{{
			Key:   "regex_match",
			Type:  evalpkg.ScoreTypeBool,
			Value: evalpkg.BoolValue(true),
		}},
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
	assert.True(t, reader.called, "storage reader should be called when generation_data is not provided")
	assert.Equal(t, "gen-1", resp.GenerationID)
}

func TestTestService_RunTestInlineGenerationWithExtraFields(t *testing.T) {
	gen := testGeneration()
	data := marshalGenerationJSON(t, gen)

	// Simulate query API response that includes latest_scores (not a proto field).
	var m map[string]any
	require.NoError(t, json.Unmarshal(data, &m))
	m["latest_scores"] = map[string]any{"k": "v"}
	enriched, err := json.Marshal(m)
	require.NoError(t, err)

	reader := &stubGenerationReader{}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{{
			Key:   "regex_match",
			Type:  evalpkg.ScoreTypeBool,
			Value: evalpkg.BoolValue(true),
		}},
	}
	svc := newTestService(reader, eval)

	resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "Go"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationData: json.RawMessage(enriched),
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "gen-1", resp.GenerationID)
	assert.False(t, reader.called)
}

func TestTestService_RunTestInlineGenerationQueryAPIFormat(t *testing.T) {
	// The query API renames proto "id" → "generation_id". Verify that
	// decodeInlineGeneration normalizes this back so the ID isn't lost.
	queryAPIPayload := json.RawMessage(`{
		"generation_id":"gen-qa",
		"conversation_id":"conv-qa",
		"input":[{"parts":[{"text":"hi"}]}],
		"output":[{"parts":[{"text":"hello"}]}]
	}`)
	reader := &stubGenerationReader{err: errors.New("should not be called")}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{{
			Key:   "regex_match",
			Type:  evalpkg.ScoreTypeBool,
			Value: evalpkg.BoolValue(true),
		}},
	}
	svc := newTestService(reader, eval)

	resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "hello"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "regex_match", Type: evalpkg.ScoreTypeBool}},
		GenerationData: queryAPIPayload,
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "gen-qa", resp.GenerationID, "generation_id should be normalized to proto id")
	assert.Equal(t, "conv-qa", resp.ConversationID)
	assert.False(t, reader.called)
}

func TestDecodeInlineGenerationNormalizesQueryAPIMode(t *testing.T) {
	payload := json.RawMessage(`{
		"generation_id":"gen-m",
		"conversation_id":"conv-m",
		"mode":"SYNC"
	}`)

	gen, err := decodeInlineGeneration(payload)
	require.NoError(t, err)
	require.NotNil(t, gen)
	assert.Equal(t, sigilv1.GenerationMode_GENERATION_MODE_SYNC, gen.GetMode())
}

func TestDecodeInlineGenerationNormalizesQueryAPIError(t *testing.T) {
	payload := json.RawMessage(`{
		"generation_id":"gen-e",
		"conversation_id":"conv-e",
		"error":{"message":"provider unavailable"}
	}`)

	gen, err := decodeInlineGeneration(payload)
	require.NoError(t, err)
	require.NotNil(t, gen)
	assert.Equal(t, "provider unavailable", gen.GetCallError())
}

func TestEvalTestRequest_NormalizeAndValidateAcceptsInlineDataWithoutGenerationID(t *testing.T) {
	gen := testGeneration()
	data := marshalGenerationJSON(t, gen)

	normalized, err := (EvalTestRequest{
		Kind:           "regex",
		Config:         map[string]any{"pattern": "x"},
		OutputKeys:     []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
		GenerationData: data,
	}).normalizeAndValidate()

	require.NoError(t, err)
	assert.Equal(t, "", normalized.GenerationID)
	assert.NotEmpty(t, normalized.GenerationData)
}
