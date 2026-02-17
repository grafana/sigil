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
			failedBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed"))

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
			failedAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "failed"))
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

	execBefore := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success"))
	scoreBefore := testutil.ToFloat64(evalScoresTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "k", "true"))

	service.runCycle(context.Background())

	execAfter := testutil.ToFloat64(evalExecutionsTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "success"))
	scoreAfter := testutil.ToFloat64(evalScoresTotal.WithLabelValues("tenant-a", "eval-1", string(evalpkg.EvaluatorKindHeuristic), "rule-1", "k", "true"))
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
	claimed             []evalpkg.WorkItem
	evaluators          map[string]evalpkg.EvaluatorDefinition
	statusCounts        map[evalpkg.WorkItemStatus]map[string]int64
	failCalls           int
	lastFailPermanent   bool
	lastFailMaxAttempts int
	lastRetryAt         time.Time
	insertedScores      int
	completed           int
	mu                  sync.Mutex
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
	return len(scores), nil
}

func (s *workerStoreStub) CompleteWorkItem(_ context.Context, _, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.completed++
	return nil
}

func (s *workerStoreStub) FailWorkItem(_ context.Context, _, _ string, _ string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failCalls++
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
