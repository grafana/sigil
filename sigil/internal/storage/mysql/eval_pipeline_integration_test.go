package mysql

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/dskit/services"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalenqueue "github.com/grafana/sigil/sigil/internal/eval/enqueue"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	evalrules "github.com/grafana/sigil/sigil/internal/eval/rules"
	evalworker "github.com/grafana/sigil/sigil/internal/eval/worker"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestOnlineEvaluationPipelineEndToEnd(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	ctx := context.Background()
	if err := store.AutoMigrate(ctx); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	if err := store.CreateEvaluator(ctx, evalpkg.EvaluatorDefinition{
		TenantID:    "tenant-a",
		EvaluatorID: "sigil.response_not_empty",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config: map[string]any{
			"not_empty": true,
		},
		OutputKeys: []evalpkg.OutputKey{{
			Key:  "response_not_empty",
			Type: evalpkg.ScoreTypeBool,
		}},
	}); err != nil {
		t.Fatalf("create evaluator: %v", err)
	}

	if err := store.CreateRule(ctx, evalpkg.RuleDefinition{
		TenantID:     "tenant-a",
		RuleID:       "online.response_not_empty.user_visible",
		Enabled:      true,
		Selector:     evalpkg.SelectorUserVisibleTurn,
		Match:        map[string]any{"agent_name": []string{"assistant-*"}},
		SampleRate:   1,
		EvaluatorIDs: []string{"sigil.response_not_empty"},
	}); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	engine := evalrules.NewEngine(store)
	dispatcher := evalenqueue.NewService(
		evalenqueue.Config{
			Enabled:      true,
			BatchSize:    10,
			PollInterval: 25 * time.Millisecond,
			MaxAttempts:  3,
			ClaimTTL:     2 * time.Minute,
		},
		log.NewNopLogger(),
		evalEnqueueStoreTestAdapter{store: store},
		evalEnqueueProcessorTestAdapter{engine: engine},
	)
	dispatcherCtx, cancelDispatcher := context.WithCancel(context.Background())
	dispatcherDone := make(chan error, 1)
	go func() {
		dispatcherDone <- dispatcher.Run(dispatcherCtx)
	}()
	defer func() {
		cancelDispatcher()
		select {
		case err := <-dispatcherDone:
			if err != nil {
				t.Fatalf("stop enqueue dispatcher: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("timed out stopping enqueue dispatcher")
		}
	}()
	store.SetEvalHook(evalNotifyHook{dispatcher: dispatcher})

	generation := &sigilv1.Generation{
		Id:             "gen-e2e-1",
		ConversationId: "conv-e2e-1",
		AgentName:      "assistant-main",
		StartedAt:      timestamppb.New(time.Now().UTC().Add(-time.Second)),
		CompletedAt:    timestamppb.New(time.Now().UTC()),
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{
				Payload: &sigilv1.Part_Text{Text: "Final answer"},
			}},
		}},
	}
	requireNoBatchErrors(t, store.SaveBatch(ctx, "tenant-a", []*sigilv1.Generation{generation}))

	if err := waitForEvalCondition(5*time.Second, 100*time.Millisecond, func() (bool, error) {
		counts, err := store.CountWorkItemsByStatus(ctx, evalpkg.WorkItemStatusQueued)
		if err != nil {
			return false, err
		}
		return counts["tenant-a"] >= 1, nil
	}); err != nil {
		t.Fatalf("wait for queued work item: %v", err)
	}

	workerService := evalworker.NewService(evalworker.Config{
		Enabled:          true,
		MaxConcurrent:    2,
		MaxRatePerMinute: 600,
		MaxAttempts:      3,
		ClaimBatchSize:   10,
		PollInterval:     50 * time.Millisecond,
	}, log.NewNopLogger(), store, store, judges.NewDiscovery())

	workerCtx, cancelWorker := context.WithCancel(context.Background())
	if err := services.StartAndAwaitRunning(workerCtx, workerService); err != nil {
		cancelWorker()
		t.Fatalf("start eval worker: %v", err)
	}
	defer func() {
		cancelWorker()
		_ = services.StopAndAwaitTerminated(context.Background(), workerService)
	}()

	if err := waitForEvalCondition(8*time.Second, 100*time.Millisecond, func() (bool, error) {
		scores, _, err := store.GetScoresByGeneration(ctx, "tenant-a", "gen-e2e-1", 10, 0)
		if err != nil {
			return false, err
		}
		return len(scores) >= 1, nil
	}); err != nil {
		t.Fatalf("wait for score materialization: %v", err)
	}

	scores, _, err := store.GetScoresByGeneration(ctx, "tenant-a", "gen-e2e-1", 10, 0)
	if err != nil {
		t.Fatalf("get scores: %v", err)
	}
	if len(scores) != 1 {
		t.Fatalf("expected exactly one score, got %d", len(scores))
	}
	score := scores[0]
	if score.ScoreKey != "response_not_empty" {
		t.Fatalf("unexpected score key %q", score.ScoreKey)
	}
	if score.Value.Bool == nil || !*score.Value.Bool {
		t.Fatalf("expected bool=true score value, got %#v", score.Value)
	}
	if score.SourceKind != "online_rule" {
		t.Fatalf("expected online_rule source, got %q", score.SourceKind)
	}

	successCounts, err := store.CountWorkItemsByStatus(ctx, evalpkg.WorkItemStatusSuccess)
	if err != nil {
		t.Fatalf("count success work items: %v", err)
	}
	if successCounts["tenant-a"] != 1 {
		t.Fatalf("expected one successful work item, got %d", successCounts["tenant-a"])
	}
}

type evalNotifyHook struct {
	dispatcher *evalenqueue.Service
}

func (h evalNotifyHook) OnGenerationsSaved(_ string) {
	if h.dispatcher == nil {
		return
	}
	h.dispatcher.Notify()
}

type evalEnqueueStoreTestAdapter struct {
	store *WALStore
}

func (a evalEnqueueStoreTestAdapter) ClaimEvalEnqueueEvents(ctx context.Context, now time.Time, limit int, claimTTL time.Duration) ([]evalenqueue.Event, error) {
	if a.store == nil {
		return []evalenqueue.Event{}, nil
	}
	events, err := a.store.ClaimEvalEnqueueEvents(ctx, now, limit, claimTTL)
	if err != nil {
		return nil, err
	}
	out := make([]evalenqueue.Event, 0, len(events))
	for _, event := range events {
		out = append(out, evalenqueue.Event{
			TenantID:       event.TenantID,
			GenerationID:   event.GenerationID,
			ConversationID: event.ConversationID,
			Payload:        event.Payload,
			Attempts:       event.Attempts,
		})
	}
	return out, nil
}

func (a evalEnqueueStoreTestAdapter) CompleteEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if a.store == nil {
		return nil
	}
	return a.store.CompleteEvalEnqueueEvent(ctx, tenantID, generationID)
}

func (a evalEnqueueStoreTestAdapter) RequeueClaimedEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if a.store == nil {
		return nil
	}
	return a.store.RequeueClaimedEvalEnqueueEvent(ctx, tenantID, generationID)
}

func (a evalEnqueueStoreTestAdapter) FailEvalEnqueueEvent(ctx context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	if a.store == nil {
		return false, nil
	}
	return a.store.FailEvalEnqueueEvent(ctx, tenantID, generationID, lastError, retryAt, maxAttempts, permanent)
}

type evalEnqueueProcessorTestAdapter struct {
	engine *evalrules.Engine
}

func (a evalEnqueueProcessorTestAdapter) Process(ctx context.Context, event evalenqueue.Event) error {
	if a.engine == nil {
		return nil
	}
	return a.engine.OnGenerationsSaved(ctx, event.TenantID, []evalrules.GenerationRow{{
		GenerationID:   event.GenerationID,
		ConversationID: event.ConversationID,
		Payload:        event.Payload,
	}})
}

func waitForEvalCondition(timeout time.Duration, tick time.Duration, condition func() (bool, error)) error {
	deadline := time.Now().Add(timeout)
	for {
		ok, err := condition()
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out after %s", timeout)
		}
		time.Sleep(tick)
	}
}
