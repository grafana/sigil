package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/go-kit/log"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"google.golang.org/protobuf/proto"
)

func TestServiceFailHandlingTransientAndPermanent(t *testing.T) {
	tests := []struct {
		name            string
		evaluatorErr    error
		expectPermanent bool
		expectRetry     bool
	}{
		{name: "transient_error", evaluatorErr: errors.New("temporary"), expectPermanent: false, expectRetry: true},
		{name: "permanent_error", evaluatorErr: evalpkg.Permanent(errors.New("invalid")), expectPermanent: true, expectRetry: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &workerStoreStub{
				claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-1")},
				evaluators: map[string]evalpkg.EvaluatorDefinition{
					"tenant-a|eval-1|v1": {
						EvaluatorID: "eval-1",
						Version:     "v1",
						Kind:        evalpkg.EvaluatorKindHeuristic,
						OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
					},
				},
				statusCounts: defaultStatusCounts(),
			}

			service := newTestService(t, store, Config{
				Enabled:          true,
				MaxConcurrent:    1,
				MaxRatePerMinute: 1200,
				MaxAttempts:      3,
				ClaimBatchSize:   10,
				PollInterval:     time.Millisecond,
			})
			service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{kind: evalpkg.EvaluatorKindHeuristic, err: test.evaluatorErr}

			retryBefore := testutil.ToFloat64(evalRetriesTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1"))
			failedBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed", "", ""))

			service.runCycle(context.Background())

			if store.failCalls != 1 {
				t.Fatalf("expected one fail call, got %d", store.failCalls)
			}
			if store.lastFailPermanent != test.expectPermanent {
				t.Fatalf("expected permanent=%v, got %v", test.expectPermanent, store.lastFailPermanent)
			}
			if store.lastFailMaxAttempts != 3 {
				t.Fatalf("expected max attempts to propagate, got %d", store.lastFailMaxAttempts)
			}
			if store.lastRetryAt.IsZero() {
				t.Fatalf("expected retry timestamp to be set")
			}

			retryAfter := testutil.ToFloat64(evalRetriesTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1"))
			failedAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed", "", ""))
			if failedAfter-failedBefore != 1 {
				t.Fatalf("expected failed execution counter increment by 1, got before=%f after=%f", failedBefore, failedAfter)
			}
			if test.expectRetry && retryAfter-retryBefore != 1 {
				t.Fatalf("expected retry counter increment by 1, got before=%f after=%f", retryBefore, retryAfter)
			}
			if !test.expectRetry && retryAfter-retryBefore != 0 {
				t.Fatalf("expected retry counter unchanged, got before=%f after=%f", retryBefore, retryAfter)
			}
		})
	}
}

func TestServiceConcurrencyCap(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{
			newClaimedItem("work-1", "gen-1"),
			newClaimedItem("work-2", "gen-2"),
			newClaimedItem("work-3", "gen-3"),
			newClaimedItem("work-4", "gen-4"),
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts: defaultStatusCounts(),
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    2,
		MaxRatePerMinute: 10000,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})

	fakeEvaluator := &workerFakeEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		sleep:   50 * time.Millisecond,
		outputs: []evaluators.ScoreOutput{{Key: "k", Type: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(true), Passed: boolPtr(true)}},
	}
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = fakeEvaluator

	service.runCycle(context.Background())
	if fakeEvaluator.maxActive > 2 {
		t.Fatalf("expected max concurrent executions <= 2, got %d", fakeEvaluator.maxActive)
	}
	if store.completed != 4 {
		t.Fatalf("expected all items to be completed, got %d", store.completed)
	}
}

func TestServiceRateLimiterAppliesBudget(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-1"), newClaimedItem("work-2", "gen-2")},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts: defaultStatusCounts(),
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 60,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		outputs: []evaluators.ScoreOutput{{Key: "k", Type: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(true), Passed: boolPtr(true)}},
	}

	startedAt := time.Now()
	service.runCycle(context.Background())
	elapsed := time.Since(startedAt)
	if elapsed < 900*time.Millisecond {
		t.Fatalf("expected rate limiter to delay second item, elapsed=%s", elapsed)
	}
}

func TestServiceMetricsIncrementOnSuccess(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-1")},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts: defaultStatusCounts(),
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 10000,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		outputs: []evaluators.ScoreOutput{{Key: "k", Type: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(true), Passed: boolPtr(true)}},
	}

	execBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success", "", ""))
	scoreBefore := testutil.ToFloat64(evalScoresTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "k", "true", "", ""))

	service.runCycle(context.Background())

	execAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success", "", ""))
	scoreAfter := testutil.ToFloat64(evalScoresTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "k", "true", "", ""))
	if execAfter-execBefore != 1 {
		t.Fatalf("expected success execution counter increment by 1, got before=%f after=%f", execBefore, execAfter)
	}
	if scoreAfter-scoreBefore != 1 {
		t.Fatalf("expected score counter increment by 1, got before=%f after=%f", scoreBefore, scoreAfter)
	}
	if store.completed != 1 {
		t.Fatalf("expected one completed item, got %d", store.completed)
	}
	if store.insertedScores != 1 {
		t.Fatalf("expected one inserted score, got %d", store.insertedScores)
	}
}

func TestServiceCompletionFailureIsHandledAsFailure(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-1")},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts: defaultStatusCounts(),
		completeErr:  errors.New("complete failed"),
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 10000,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		outputs: []evaluators.ScoreOutput{{Key: "k", Type: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(true), Passed: boolPtr(true)}},
	}

	successBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success", "", ""))
	failedBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed", "", ""))

	service.runCycle(context.Background())

	successAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success", "", ""))
	failedAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed", "", ""))
	if successAfter-successBefore != 0 {
		t.Fatalf("expected no success increment when completion fails, got before=%f after=%f", successBefore, successAfter)
	}
	if failedAfter-failedBefore != 1 {
		t.Fatalf("expected failed execution increment by 1 when completion fails, got before=%f after=%f", failedBefore, failedAfter)
	}
	if store.failCalls != 1 {
		t.Fatalf("expected one fail call when completion fails, got %d", store.failCalls)
	}
	if store.completed != 0 {
		t.Fatalf("expected zero completed transitions when completion fails, got %d", store.completed)
	}
	if store.insertedScores != 1 {
		t.Fatalf("expected scores inserted before completion failure, got %d", store.insertedScores)
	}
}

func TestServiceGenerationNotFoundIsTreatedAsTransient(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-missing")},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts: defaultStatusCounts(),
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 1200,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	service.reader = &workerReaderStub{generation: nil}

	service.runCycle(context.Background())

	if store.failCalls != 1 {
		t.Fatalf("expected one fail call, got %d", store.failCalls)
	}
	if store.lastFailPermanent {
		t.Fatalf("expected missing generation to be treated as transient")
	}
}

func TestServiceRunCycleRequeuesUnstartedItemsOnCancel(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{
			newClaimedItem("work-1", "gen-1"),
			newClaimedItem("work-2", "gen-2"),
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts:           defaultStatusCounts(),
		completeRejectCanceled: true,
		requeueRejectCanceled:  true,
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 60,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	started := make(chan struct{}, 1)
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		sleep:   100 * time.Millisecond,
		started: started,
		outputs: []evaluators.ScoreOutput{{Key: "k", Type: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(true), Passed: boolPtr(true)}},
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		service.runCycle(ctx)
		close(done)
	}()

	select {
	case <-started:
		cancel()
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatalf("timed out waiting for first item to start")
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for cycle shutdown")
	}

	if store.completed != 1 {
		t.Fatalf("expected first item to complete, got %d", store.completed)
	}
	if store.insertedScores != 1 {
		t.Fatalf("expected one score insert, got %d", store.insertedScores)
	}
	if store.failCalls != 0 {
		t.Fatalf("expected no fail calls for unstarted canceled items, got %d", store.failCalls)
	}
	if store.requeueCalls != 1 {
		t.Fatalf("expected one requeue call for unstarted item, got %d", store.requeueCalls)
	}
	if len(store.requeuedWorkIDs) != 1 || store.requeuedWorkIDs[0] != "work-2" {
		t.Fatalf("expected work-2 to be requeued without consuming attempts, got %#v", store.requeuedWorkIDs)
	}
	if store.requeueCtxCanceledCount != 0 {
		t.Fatalf("expected requeue transitions to use detached context, got %d canceled requeue calls", store.requeueCtxCanceledCount)
	}
	if store.completeCtxCanceledCount != 0 {
		t.Fatalf("expected complete transitions to use detached context, got %d canceled complete calls", store.completeCtxCanceledCount)
	}
}

func TestServiceRunCycleRequeuesInFlightCanceledItemsWithoutFailure(t *testing.T) {
	store := &workerStoreStub{
		claimed: []evalpkg.WorkItem{
			newClaimedItem("work-1", "gen-1"),
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"tenant-a|eval-1|v1": {
				EvaluatorID: "eval-1",
				Version:     "v1",
				Kind:        evalpkg.EvaluatorKindHeuristic,
				OutputKeys:  []evalpkg.OutputKey{{Key: "k", Type: evalpkg.ScoreTypeBool}},
			},
		},
		statusCounts:          defaultStatusCounts(),
		requeueRejectCanceled: true,
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 10000,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})
	started := make(chan struct{}, 1)
	service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerCancelingEvaluator{
		kind:    evalpkg.EvaluatorKindHeuristic,
		started: started,
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		service.runCycle(ctx)
		close(done)
	}()

	select {
	case <-started:
		cancel()
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatalf("timed out waiting for item execution to start")
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for canceled cycle to exit")
	}

	if store.failCalls != 0 {
		t.Fatalf("expected no fail calls for canceled in-flight item, got %d", store.failCalls)
	}
	if store.requeueCalls != 1 {
		t.Fatalf("expected one requeue call for canceled in-flight item, got %d", store.requeueCalls)
	}
	if len(store.requeuedWorkIDs) != 1 || store.requeuedWorkIDs[0] != "work-1" {
		t.Fatalf("expected work-1 to be requeued, got %#v", store.requeuedWorkIDs)
	}
	if store.insertedScores != 0 {
		t.Fatalf("expected no inserted scores for canceled item, got %d", store.insertedScores)
	}
	if store.completed != 0 {
		t.Fatalf("expected no completed transitions for canceled item, got %d", store.completed)
	}
	if store.requeueCtxCanceledCount != 0 {
		t.Fatalf("expected detached context for requeue transition, got %d canceled requeue calls", store.requeueCtxCanceledCount)
	}
}

func TestServiceRefreshQueueDepthResetsMissingTenantToZero(t *testing.T) {
	const tenantID = "tenant-depth-reset"

	store := &workerStoreStub{
		statusCounts: map[evalpkg.WorkItemStatus]map[string]int64{
			evalpkg.WorkItemStatusQueued:  {tenantID: 4},
			evalpkg.WorkItemStatusClaimed: {tenantID: 2},
			evalpkg.WorkItemStatusFailed:  {},
		},
	}

	service := newTestService(t, store, Config{
		Enabled:          true,
		MaxConcurrent:    1,
		MaxRatePerMinute: 1200,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     time.Millisecond,
	})

	service.refreshQueueDepth(context.Background())

	if got := testutil.ToFloat64(evalQueueDepth.WithLabelValues(tenantID, string(evalpkg.WorkItemStatusQueued))); got != 4 {
		t.Fatalf("expected queued depth=4 before drain, got %f", got)
	}
	if got := testutil.ToFloat64(evalQueueDepth.WithLabelValues(tenantID, string(evalpkg.WorkItemStatusClaimed))); got != 2 {
		t.Fatalf("expected claimed depth=2 before drain, got %f", got)
	}

	store.statusCounts = map[evalpkg.WorkItemStatus]map[string]int64{
		evalpkg.WorkItemStatusQueued:  {},
		evalpkg.WorkItemStatusClaimed: {},
		evalpkg.WorkItemStatusFailed:  {},
	}
	service.refreshQueueDepth(context.Background())

	if got := testutil.ToFloat64(evalQueueDepth.WithLabelValues(tenantID, string(evalpkg.WorkItemStatusQueued))); got != 0 {
		t.Fatalf("expected queued depth reset to zero after drain, got %f", got)
	}
	if got := testutil.ToFloat64(evalQueueDepth.WithLabelValues(tenantID, string(evalpkg.WorkItemStatusClaimed))); got != 0 {
		t.Fatalf("expected claimed depth reset to zero after drain, got %f", got)
	}
}

func float64Ptr(v float64) *float64 { return &v }

func TestServiceBoundsEnforcement(t *testing.T) {
	tests := []struct {
		name           string
		outputKeys     []evalpkg.OutputKey
		outputs        []evaluators.ScoreOutput
		wantScoreCount int
		wantScoreKeys  []string
	}{
		{
			name: "score_within_bounds_is_stored",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(5),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_below_min_is_dropped",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-1),
			}},
			wantScoreCount: 0,
			wantScoreKeys:  nil,
		},
		{
			name: "score_above_max_is_dropped",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(11),
			}},
			wantScoreCount: 0,
			wantScoreKeys:  nil,
		},
		{
			name: "only_min_set_below_min_dropped",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-0.5),
			}},
			wantScoreCount: 0,
			wantScoreKeys:  nil,
		},
		{
			name: "only_min_set_above_min_stored",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(100),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "only_max_set_above_max_dropped",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(10.5),
			}},
			wantScoreCount: 0,
			wantScoreKeys:  nil,
		},
		{
			name: "only_max_set_below_max_stored",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(-100),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_at_exact_min_is_stored",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(0),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "score_at_exact_max_is_stored",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  float64Ptr(0),
				Max:  float64Ptr(10),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:   "score",
				Type:  evalpkg.ScoreTypeNumber,
				Value: evalpkg.NumberValue(10),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"score"},
		},
		{
			name: "bool_score_ignores_bounds",
			outputKeys: []evalpkg.OutputKey{{
				Key:  "pass",
				Type: evalpkg.ScoreTypeBool,
				Min:  float64Ptr(0),
				Max:  float64Ptr(1),
			}},
			outputs: []evaluators.ScoreOutput{{
				Key:    "pass",
				Type:   evalpkg.ScoreTypeBool,
				Value:  evalpkg.BoolValue(true),
				Passed: boolPtr(true),
			}},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"pass"},
		},
		{
			name: "mixed_outputs_partial_drop",
			outputKeys: []evalpkg.OutputKey{
				{Key: "accuracy", Type: evalpkg.ScoreTypeNumber, Min: float64Ptr(0), Max: float64Ptr(1)},
				{Key: "latency", Type: evalpkg.ScoreTypeNumber, Min: float64Ptr(0), Max: float64Ptr(5000)},
			},
			outputs: []evaluators.ScoreOutput{
				{Key: "accuracy", Type: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(1.5)}, // above max, dropped
				{Key: "latency", Type: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(200)},  // within bounds, stored
			},
			wantScoreCount: 1,
			wantScoreKeys:  []string{"latency"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &workerStoreStub{
				claimed: []evalpkg.WorkItem{newClaimedItem("work-1", "gen-1")},
				evaluators: map[string]evalpkg.EvaluatorDefinition{
					"tenant-a|eval-1|v1": {
						EvaluatorID: "eval-1",
						Version:     "v1",
						Kind:        evalpkg.EvaluatorKindHeuristic,
						OutputKeys:  tt.outputKeys,
					},
				},
				statusCounts: defaultStatusCounts(),
			}

			service := newTestService(t, store, Config{
				Enabled:          true,
				MaxConcurrent:    1,
				MaxRatePerMinute: 10000,
				MaxAttempts:      3,
				ClaimBatchSize:   10,
				PollInterval:     time.Millisecond,
			})
			service.evaluators[evalpkg.EvaluatorKindHeuristic] = &workerFakeEvaluator{
				kind:    evalpkg.EvaluatorKindHeuristic,
				outputs: tt.outputs,
			}

			service.runCycle(context.Background())

			if store.insertedScores != tt.wantScoreCount {
				t.Fatalf("expected %d inserted scores, got %d", tt.wantScoreCount, store.insertedScores)
			}
			if tt.wantScoreCount > 0 {
				if len(store.lastScoreBatch) != tt.wantScoreCount {
					t.Fatalf("expected %d scores in batch, got %d", tt.wantScoreCount, len(store.lastScoreBatch))
				}
				for i, wantKey := range tt.wantScoreKeys {
					if store.lastScoreBatch[i].ScoreKey != wantKey {
						t.Fatalf("expected score[%d].ScoreKey=%q, got %q", i, wantKey, store.lastScoreBatch[i].ScoreKey)
					}
				}
			}
			if store.completed != 1 {
				t.Fatalf("expected item to be completed, got %d", store.completed)
			}
		})
	}
}

func newTestService(t *testing.T, store *workerStoreStub, cfg Config) *Service {
	t.Helper()

	service := &Service{
		cfg:       cfg,
		logger:    log.NewNopLogger(),
		store:     store,
		reader:    &workerReaderStub{generation: generationWithAssistantText("gen")},
		discovery: judges.NewDiscovery(),
	}
	if err := service.start(context.Background()); err != nil {
		t.Fatalf("start service: %v", err)
	}
	return service
}

func defaultStatusCounts() map[evalpkg.WorkItemStatus]map[string]int64 {
	return map[evalpkg.WorkItemStatus]map[string]int64{
		evalpkg.WorkItemStatusQueued:  {"tenant-a": 0},
		evalpkg.WorkItemStatusClaimed: {"tenant-a": 0},
		evalpkg.WorkItemStatusFailed:  {"tenant-a": 0},
	}
}

func newClaimedItem(workID, generationID string) evalpkg.WorkItem {
	return evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           workID,
		GenerationID:     generationID,
		EvaluatorID:      "eval-1",
		EvaluatorVersion: "v1",
		RuleID:           "rule-1",
		Status:           evalpkg.WorkItemStatusClaimed,
	}
}

func generationWithAssistantText(id string) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id: id,
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{
				Payload: &sigilv1.Part_Text{Text: "hi"},
			}},
		}},
	}
}

type workerStoreStub struct {
	claimed                  []evalpkg.WorkItem
	evaluators               map[string]evalpkg.EvaluatorDefinition
	statusCounts             map[evalpkg.WorkItemStatus]map[string]int64
	requeueCalls             int
	requeuedWorkIDs          []string
	failCalls                int
	failedWorkIDs            []string
	lastFailPermanent        bool
	lastFailMaxAttempts      int
	lastRetryAt              time.Time
	insertedScores           int
	lastScoreBatch           []evalpkg.GenerationScore
	completed                int
	requeueCtxCanceledCount  int
	failCtxCanceledCount     int
	completeCtxCanceledCount int
	requeueRejectCanceled    bool
	failRejectCanceledCtx    bool
	completeRejectCanceled   bool
	completeErr              error
	mu                       sync.Mutex
}

func (s *workerStoreStub) GetEvaluatorVersion(_ context.Context, tenantID, evaluatorID, version string) (*evalpkg.EvaluatorDefinition, error) {
	item, ok := s.evaluators[tenantID+"|"+evaluatorID+"|"+version]
	if !ok {
		return nil, nil
	}
	copied := item
	return &copied, nil
}

func (s *workerStoreStub) ClaimWorkItems(_ context.Context, _ time.Time, _ int) ([]evalpkg.WorkItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := append([]evalpkg.WorkItem(nil), s.claimed...)
	s.claimed = nil
	return items, nil
}

func (s *workerStoreStub) InsertScoreBatch(_ context.Context, scores []evalpkg.GenerationScore) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.insertedScores += len(scores)
	s.lastScoreBatch = append(s.lastScoreBatch, scores...)
	return len(scores), nil
}

func (s *workerStoreStub) RequeueClaimedWorkItem(ctx context.Context, _, workID string) error {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.requeueCtxCanceledCount++
		if s.requeueRejectCanceled {
			s.mu.Unlock()
			return ctx.Err()
		}
	}
	defer s.mu.Unlock()
	s.requeueCalls++
	s.requeuedWorkIDs = append(s.requeuedWorkIDs, workID)
	return nil
}

func (s *workerStoreStub) CompleteWorkItem(ctx context.Context, _, _ string) error {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.completeCtxCanceledCount++
		if s.completeRejectCanceled {
			s.mu.Unlock()
			return ctx.Err()
		}
	}
	if s.completeErr != nil {
		s.mu.Unlock()
		return s.completeErr
	}
	defer s.mu.Unlock()
	s.completed++
	return nil
}

func (s *workerStoreStub) FailWorkItem(ctx context.Context, _, workID string, _ string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.failCtxCanceledCount++
		if s.failRejectCanceledCtx {
			s.mu.Unlock()
			return false, ctx.Err()
		}
	}
	defer s.mu.Unlock()
	s.failCalls++
	s.failedWorkIDs = append(s.failedWorkIDs, workID)
	s.lastFailPermanent = permanent
	s.lastFailMaxAttempts = maxAttempts
	s.lastRetryAt = retryAt
	return !permanent, nil
}

func (s *workerStoreStub) CountWorkItemsByStatus(_ context.Context, status evalpkg.WorkItemStatus) (map[string]int64, error) {
	if s.statusCounts == nil {
		return map[string]int64{"tenant-a": 0}, nil
	}
	counts, ok := s.statusCounts[status]
	if !ok {
		return map[string]int64{}, nil
	}
	out := make(map[string]int64, len(counts))
	for tenantID, count := range counts {
		out[tenantID] = count
	}
	return out, nil
}

type workerReaderStub struct {
	generation *sigilv1.Generation
}

func (s *workerReaderStub) GetByID(_ context.Context, _ string, generationID string) (*sigilv1.Generation, error) {
	if s.generation == nil {
		return nil, nil
	}
	copied, ok := proto.Clone(s.generation).(*sigilv1.Generation)
	if !ok || copied == nil {
		return nil, nil
	}
	copied.Id = generationID
	return copied, nil
}

type workerFakeEvaluator struct {
	kind      evalpkg.EvaluatorKind
	err       error
	outputs   []evaluators.ScoreOutput
	sleep     time.Duration
	started   chan struct{}
	mu        sync.Mutex
	active    int
	maxActive int
}

func (e *workerFakeEvaluator) Kind() evalpkg.EvaluatorKind {
	return e.kind
}

func (e *workerFakeEvaluator) Evaluate(_ context.Context, _ evaluators.EvalInput, _ evalpkg.EvaluatorDefinition) ([]evaluators.ScoreOutput, error) {
	e.mu.Lock()
	e.active++
	if e.active > e.maxActive {
		e.maxActive = e.active
	}
	e.mu.Unlock()
	if e.started != nil {
		select {
		case e.started <- struct{}{}:
		default:
		}
	}

	if e.sleep > 0 {
		time.Sleep(e.sleep)
	}

	e.mu.Lock()
	e.active--
	e.mu.Unlock()

	if e.err != nil {
		return nil, e.err
	}
	return e.outputs, nil
}

func boolPtr(value bool) *bool {
	copied := value
	return &copied
}

type workerCancelingEvaluator struct {
	kind    evalpkg.EvaluatorKind
	started chan struct{}
}

func (e *workerCancelingEvaluator) Kind() evalpkg.EvaluatorKind {
	return e.kind
}

func (e *workerCancelingEvaluator) Evaluate(ctx context.Context, _ evaluators.EvalInput, _ evalpkg.EvaluatorDefinition) ([]evaluators.ScoreOutput, error) {
	if e.started != nil {
		select {
		case e.started <- struct{}{}:
		default:
		}
	}
	<-ctx.Done()
	return nil, ctx.Err()
}
