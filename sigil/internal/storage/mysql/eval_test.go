package mysql

import (
	"context"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestEvalStoreEvaluatorCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "tenant-a",
		EvaluatorID: "sigil.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindLLMJudge,
		Config: map[string]any{
			"provider":      "openai",
			"model":         "gpt-4o-mini",
			"system_prompt": "score this response",
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create evaluator: %v", err)
	}

	evaluator, err := store.GetEvaluator(context.Background(), "tenant-a", "sigil.helpfulness")
	if err != nil {
		t.Fatalf("get evaluator: %v", err)
	}
	if evaluator == nil {
		t.Fatalf("expected evaluator")
	}
	if evaluator.Kind != evalpkg.EvaluatorKindLLMJudge {
		t.Errorf("unexpected evaluator kind %q", evaluator.Kind)
	}
	if evaluator.Config["provider"] != "openai" {
		t.Errorf("unexpected provider config %#v", evaluator.Config)
	}

	items, nextCursor, err := store.ListEvaluators(context.Background(), "tenant-a", 10, 0)
	if err != nil {
		t.Fatalf("list evaluators: %v", err)
	}
	if nextCursor != 0 {
		t.Errorf("expected next cursor 0, got %d", nextCursor)
	}
	if len(items) != 1 {
		t.Errorf("expected one evaluator, got %d", len(items))
	}

	if err := store.DeleteEvaluator(context.Background(), "tenant-a", "sigil.helpfulness"); err != nil {
		t.Fatalf("delete evaluator: %v", err)
	}
	if err := store.DeleteEvaluator(context.Background(), "tenant-a", "sigil.helpfulness"); err != nil {
		t.Fatalf("idempotent delete evaluator: %v", err)
	}

	evaluator, err = store.GetEvaluator(context.Background(), "tenant-a", "sigil.helpfulness")
	if err != nil {
		t.Fatalf("get evaluator after delete: %v", err)
	}
	if evaluator != nil {
		t.Errorf("expected evaluator to be deleted")
	}
}

func TestEvalStoreRuleCRUDAndUpdate(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	err := store.CreateRule(context.Background(), evalpkg.RuleDefinition{
		TenantID:     "tenant-a",
		RuleID:       "online.helpfulness.user-visible",
		Enabled:      true,
		Selector:     evalpkg.SelectorUserVisibleTurn,
		Match:        map[string]any{"agent_name": []string{"assistant-*"}},
		SampleRate:   0.25,
		EvaluatorIDs: []string{"sigil.helpfulness", "sigil.conciseness"},
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}

	rule, err := store.GetRule(context.Background(), "tenant-a", "online.helpfulness.user-visible")
	if err != nil {
		t.Fatalf("get rule: %v", err)
	}
	if rule == nil {
		t.Fatalf("expected rule")
	}
	if rule.SampleRate != 0.25 {
		t.Errorf("unexpected sample rate: %f", rule.SampleRate)
	}
	if len(rule.EvaluatorIDs) != 2 {
		t.Errorf("expected two evaluator ids, got %#v", rule.EvaluatorIDs)
	}

	rule.Enabled = false
	rule.SampleRate = 0.5
	rule.EvaluatorIDs = []string{"sigil.helpfulness"}
	if err := store.UpdateRule(context.Background(), *rule); err != nil {
		t.Fatalf("update rule: %v", err)
	}

	enabledRules, err := store.ListEnabledRules(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("list enabled rules: %v", err)
	}
	if len(enabledRules) != 0 {
		t.Errorf("expected no enabled rules after disable, got %d", len(enabledRules))
	}

	if err := store.DeleteRule(context.Background(), "tenant-a", "online.helpfulness.user-visible"); err != nil {
		t.Fatalf("delete rule: %v", err)
	}
	if err := store.DeleteRule(context.Background(), "tenant-a", "online.helpfulness.user-visible"); err != nil {
		t.Fatalf("idempotent delete rule: %v", err)
	}

	rule, err = store.GetRule(context.Background(), "tenant-a", "online.helpfulness.user-visible")
	if err != nil {
		t.Fatalf("get rule after delete: %v", err)
	}
	if rule != nil {
		t.Errorf("expected deleted rule")
	}
}

func TestEvalStoreScoreCRUDAndLatest(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 17, 10, 0, 0, 0, time.UTC)
	inserted, err := store.InsertScore(context.Background(), evalpkg.GenerationScore{
		TenantID:         "tenant-a",
		ScoreID:          "sc-1",
		GenerationID:     "gen-1",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScoreKey:         "helpfulness",
		ScoreType:        evalpkg.ScoreTypeNumber,
		Value:            evalpkg.NumberValue(0.7),
		CreatedAt:        base,
		Metadata:         map[string]any{"judge": "gpt-4o-mini"},
	})
	if err != nil {
		t.Fatalf("insert score: %v", err)
	}
	if !inserted {
		t.Fatalf("expected inserted score")
	}

	inserted, err = store.InsertScore(context.Background(), evalpkg.GenerationScore{
		TenantID:         "tenant-a",
		ScoreID:          "sc-1",
		GenerationID:     "gen-1",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		ScoreKey:         "helpfulness",
		ScoreType:        evalpkg.ScoreTypeNumber,
		Value:            evalpkg.NumberValue(0.8),
		CreatedAt:        base.Add(time.Second),
	})
	if err != nil {
		t.Fatalf("insert duplicate score: %v", err)
	}
	if inserted {
		t.Fatalf("expected duplicate insert to be ignored")
	}

	batchInserted, err := store.InsertScoreBatch(context.Background(), []evalpkg.GenerationScore{
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-2",
			GenerationID:     "gen-1",
			EvaluatorID:      "sigil.helpfulness",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.helpfulness",
			ScoreKey:         "helpfulness",
			ScoreType:        evalpkg.ScoreTypeNumber,
			Value:            evalpkg.NumberValue(0.9),
			CreatedAt:        base.Add(2 * time.Second),
		},
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-3",
			GenerationID:     "gen-1",
			EvaluatorID:      "sigil.response_not_empty",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.response_not_empty",
			ScoreKey:         "response_not_empty",
			ScoreType:        evalpkg.ScoreTypeBool,
			Value:            evalpkg.BoolValue(true),
			CreatedAt:        base.Add(3 * time.Second),
		},
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-1",
			GenerationID:     "gen-1",
			EvaluatorID:      "sigil.helpfulness",
			EvaluatorVersion: "2026-02-17",
			ScoreKey:         "helpfulness",
			ScoreType:        evalpkg.ScoreTypeNumber,
			Value:            evalpkg.NumberValue(1.0),
			CreatedAt:        base.Add(4 * time.Second),
		},
	})
	if err != nil {
		t.Fatalf("insert score batch: %v", err)
	}
	if batchInserted != 2 {
		t.Fatalf("expected 2 inserted scores from batch, got %d", batchInserted)
	}

	scores, nextCursor, err := store.GetScoresByGeneration(context.Background(), "tenant-a", "gen-1", 2, 0)
	if err != nil {
		t.Fatalf("get scores by generation: %v", err)
	}
	if len(scores) != 2 {
		t.Fatalf("expected first page with 2 scores, got %d", len(scores))
	}
	if nextCursor == 0 {
		t.Fatalf("expected next cursor for first page")
	}

	scores, nextCursor, err = store.GetScoresByGeneration(context.Background(), "tenant-a", "gen-1", 10, nextCursor)
	if err != nil {
		t.Fatalf("get scores by generation page 2: %v", err)
	}
	if len(scores) != 1 {
		t.Fatalf("expected second page with 1 score, got %d", len(scores))
	}
	if nextCursor != 0 {
		t.Fatalf("expected no next cursor after last page")
	}

	latest, err := store.GetLatestScoresByGeneration(context.Background(), "tenant-a", "gen-1")
	if err != nil {
		t.Fatalf("get latest scores: %v", err)
	}
	if len(latest) != 2 {
		t.Fatalf("expected 2 latest score keys, got %d", len(latest))
	}
	helpfulness := latest["helpfulness"]
	if helpfulness.Value.Number == nil || *helpfulness.Value.Number != 0.9 {
		t.Fatalf("expected latest helpfulness score 0.9, got %#v", helpfulness.Value)
	}
}

func TestEvalStoreWorkItemClaimCompleteFailLifecycle(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Date(2026, 2, 17, 11, 0, 0, 0, time.UTC)
	if err := store.EnqueueWorkItem(context.Background(), evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           "work-1",
		GenerationID:     "gen-1",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScheduledAt:      now,
	}); err != nil {
		t.Fatalf("enqueue work-1: %v", err)
	}
	if err := store.EnqueueWorkItem(context.Background(), evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           "work-2",
		GenerationID:     "gen-2",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScheduledAt:      now,
	}); err != nil {
		t.Fatalf("enqueue work-2: %v", err)
	}

	claimed, err := store.ClaimWorkItems(context.Background(), now.Add(time.Second), 1)
	if err != nil {
		t.Fatalf("claim work items: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one claimed item, got %d", len(claimed))
	}
	if err := store.CompleteWorkItem(context.Background(), "tenant-a", claimed[0].WorkID); err != nil {
		t.Fatalf("complete claimed item: %v", err)
	}

	claimed, err = store.ClaimWorkItems(context.Background(), now.Add(2*time.Second), 5)
	if err != nil {
		t.Fatalf("claim remaining items: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one remaining claimed item, got %d", len(claimed))
	}

	requeued, err := store.FailWorkItem(context.Background(), "tenant-a", claimed[0].WorkID, "transient", now.Add(10*time.Second), 3, false)
	if err != nil {
		t.Fatalf("fail work item transient: %v", err)
	}
	if !requeued {
		t.Fatalf("expected transient failure to requeue")
	}

	claimed, err = store.ClaimWorkItems(context.Background(), now.Add(11*time.Second), 5)
	if err != nil {
		t.Fatalf("claim requeued item: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one requeued claimed item, got %d", len(claimed))
	}

	requeued, err = store.FailWorkItem(context.Background(), "tenant-a", claimed[0].WorkID, "permanent", now.Add(20*time.Second), 3, true)
	if err != nil {
		t.Fatalf("fail work item permanent: %v", err)
	}
	if requeued {
		t.Fatalf("expected permanent failure to mark failed")
	}

	successCounts, err := store.CountWorkItemsByStatus(context.Background(), evalpkg.WorkItemStatusSuccess)
	if err != nil {
		t.Fatalf("count success work items: %v", err)
	}
	if successCounts["tenant-a"] != 1 {
		t.Fatalf("expected one success item, got %d", successCounts["tenant-a"])
	}

	failedCounts, err := store.CountWorkItemsByStatus(context.Background(), evalpkg.WorkItemStatusFailed)
	if err != nil {
		t.Fatalf("count failed work items: %v", err)
	}
	if failedCounts["tenant-a"] != 1 {
		t.Fatalf("expected one failed item, got %d", failedCounts["tenant-a"])
	}
}

func TestEvalStoreWorkItemClaimRecoversStaleClaim(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 17, 12, 0, 0, 0, time.UTC)
	if err := store.EnqueueWorkItem(context.Background(), evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           "work-stale",
		GenerationID:     "gen-stale",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScheduledAt:      base,
	}); err != nil {
		t.Fatalf("enqueue stale work item: %v", err)
	}

	firstClaim, err := store.ClaimWorkItems(context.Background(), base.Add(time.Second), 1)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if len(firstClaim) != 1 {
		t.Fatalf("expected one first claim, got %d", len(firstClaim))
	}

	recoveredClaim, err := store.ClaimWorkItems(context.Background(), base.Add(defaultEvalWorkItemClaimTTL+2*time.Second), 1)
	if err != nil {
		t.Fatalf("claim with stale recovery: %v", err)
	}
	if len(recoveredClaim) != 1 {
		t.Fatalf("expected one recovered claim, got %d", len(recoveredClaim))
	}
	if recoveredClaim[0].WorkID != firstClaim[0].WorkID {
		t.Fatalf("expected stale recovery to reclaim %q, got %q", firstClaim[0].WorkID, recoveredClaim[0].WorkID)
	}
}

func TestEvalStoreRequeueClaimedWorkItemDoesNotIncrementAttempts(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 17, 12, 10, 0, 0, time.UTC)
	if err := store.EnqueueWorkItem(context.Background(), evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           "work-release",
		GenerationID:     "gen-release",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScheduledAt:      base,
	}); err != nil {
		t.Fatalf("enqueue work item: %v", err)
	}

	firstClaim, err := store.ClaimWorkItems(context.Background(), base.Add(time.Second), 1)
	if err != nil {
		t.Fatalf("claim work item: %v", err)
	}
	if len(firstClaim) != 1 {
		t.Fatalf("expected one claimed work item, got %d", len(firstClaim))
	}
	if firstClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts=0 on first claim, got %d", firstClaim[0].Attempts)
	}

	if err := store.RequeueClaimedWorkItem(context.Background(), "tenant-a", firstClaim[0].WorkID); err != nil {
		t.Fatalf("requeue claimed work item: %v", err)
	}

	secondClaim, err := store.ClaimWorkItems(context.Background(), base.Add(2*time.Second), 1)
	if err != nil {
		t.Fatalf("claim requeued work item: %v", err)
	}
	if len(secondClaim) != 1 {
		t.Fatalf("expected one re-claimed work item, got %d", len(secondClaim))
	}
	if secondClaim[0].WorkID != firstClaim[0].WorkID {
		t.Fatalf("expected re-claimed work id %q, got %q", firstClaim[0].WorkID, secondClaim[0].WorkID)
	}
	if secondClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts to remain 0 after claim release, got %d", secondClaim[0].Attempts)
	}
}

func TestEvalStoreFailWorkItemDoesNotOverrideSuccessAfterReclaim(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 17, 13, 0, 0, 0, time.UTC)
	if err := store.EnqueueWorkItem(context.Background(), evalpkg.WorkItem{
		TenantID:         "tenant-a",
		WorkID:           "work-race",
		GenerationID:     "gen-race",
		EvaluatorID:      "sigil.helpfulness",
		EvaluatorVersion: "2026-02-17",
		RuleID:           "online.helpfulness",
		ScheduledAt:      base,
	}); err != nil {
		t.Fatalf("enqueue race work item: %v", err)
	}

	firstClaim, err := store.ClaimWorkItems(context.Background(), base.Add(time.Second), 1)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if len(firstClaim) != 1 {
		t.Fatalf("expected one first claim, got %d", len(firstClaim))
	}

	recoveredClaim, err := store.ClaimWorkItems(context.Background(), base.Add(defaultEvalWorkItemClaimTTL+2*time.Second), 1)
	if err != nil {
		t.Fatalf("claim with stale recovery: %v", err)
	}
	if len(recoveredClaim) != 1 {
		t.Fatalf("expected one recovered claim, got %d", len(recoveredClaim))
	}

	if err := store.CompleteWorkItem(context.Background(), "tenant-a", recoveredClaim[0].WorkID); err != nil {
		t.Fatalf("complete recovered claim: %v", err)
	}

	requeued, err := store.FailWorkItem(context.Background(), "tenant-a", firstClaim[0].WorkID, "late worker failure", base.Add(2*time.Hour), 3, false)
	if err != nil {
		t.Fatalf("fail after success should no-op: %v", err)
	}
	if requeued {
		t.Fatalf("expected no requeue when failing an already-success item")
	}

	successCounts, err := store.CountWorkItemsByStatus(context.Background(), evalpkg.WorkItemStatusSuccess)
	if err != nil {
		t.Fatalf("count success items: %v", err)
	}
	if successCounts["tenant-a"] != 1 {
		t.Fatalf("expected one success item, got %d", successCounts["tenant-a"])
	}

	failedCounts, err := store.CountWorkItemsByStatus(context.Background(), evalpkg.WorkItemStatusFailed)
	if err != nil {
		t.Fatalf("count failed items: %v", err)
	}
	if failedCounts["tenant-a"] != 0 {
		t.Fatalf("expected zero failed items after late failure no-op, got %d", failedCounts["tenant-a"])
	}
}

func TestEvalEnqueueEventClaimCompleteFailLifecycle(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Date(2026, 2, 17, 12, 0, 0, 0, time.UTC)
	for _, generationID := range []string{"gen-1", "gen-2"} {
		row := EvalEnqueueEventModel{
			TenantID:     "tenant-a",
			GenerationID: generationID,
			Payload:      []byte("payload-" + generationID),
			ScheduledAt:  now,
			Status:       evalEnqueueStatusQueued,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := store.DB().Create(&row).Error; err != nil {
			t.Fatalf("seed enqueue event %s: %v", generationID, err)
		}
	}

	claimed, err := store.ClaimEvalEnqueueEvents(context.Background(), now.Add(time.Second), 1, time.Minute)
	if err != nil {
		t.Fatalf("claim enqueue events: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one claimed enqueue event, got %d", len(claimed))
	}
	if err := store.CompleteEvalEnqueueEvent(context.Background(), "tenant-a", claimed[0].GenerationID); err != nil {
		t.Fatalf("complete enqueue event: %v", err)
	}

	claimed, err = store.ClaimEvalEnqueueEvents(context.Background(), now.Add(2*time.Second), 10, time.Minute)
	if err != nil {
		t.Fatalf("claim remaining enqueue events: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one remaining enqueue event, got %d", len(claimed))
	}

	requeued, err := store.FailEvalEnqueueEvent(
		context.Background(),
		"tenant-a",
		claimed[0].GenerationID,
		"transient",
		now.Add(10*time.Second),
		3,
		false,
	)
	if err != nil {
		t.Fatalf("fail enqueue event transient: %v", err)
	}
	if !requeued {
		t.Fatalf("expected transient enqueue failure to requeue")
	}

	claimed, err = store.ClaimEvalEnqueueEvents(context.Background(), now.Add(5*time.Second), 10, time.Minute)
	if err != nil {
		t.Fatalf("claim before retry-at: %v", err)
	}
	if len(claimed) != 0 {
		t.Fatalf("expected no enqueue claims before retry-at, got %d", len(claimed))
	}

	claimed, err = store.ClaimEvalEnqueueEvents(context.Background(), now.Add(11*time.Second), 10, time.Minute)
	if err != nil {
		t.Fatalf("claim requeued enqueue event: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one requeued enqueue event, got %d", len(claimed))
	}
	if claimed[0].Attempts != 1 {
		t.Fatalf("expected attempts=1 after first failure, got %d", claimed[0].Attempts)
	}

	requeued, err = store.FailEvalEnqueueEvent(
		context.Background(),
		"tenant-a",
		claimed[0].GenerationID,
		"permanent",
		now.Add(20*time.Second),
		3,
		true,
	)
	if err != nil {
		t.Fatalf("fail enqueue event permanent: %v", err)
	}
	if requeued {
		t.Fatalf("expected permanent enqueue failure to mark failed")
	}

	failed, err := store.CountEvalEnqueueEventsByStatus(context.Background(), evalEnqueueStatusFailed)
	if err != nil {
		t.Fatalf("count failed enqueue events: %v", err)
	}
	if failed != 1 {
		t.Fatalf("expected 1 failed enqueue event, got %d", failed)
	}

	queued, err := store.CountEvalEnqueueEventsByStatus(context.Background(), evalEnqueueStatusQueued)
	if err != nil {
		t.Fatalf("count queued enqueue events: %v", err)
	}
	if queued != 0 {
		t.Fatalf("expected 0 queued enqueue events, got %d", queued)
	}
}

func TestEvalEnqueueEventClaimRecoversStaleClaims(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Date(2026, 2, 17, 12, 30, 0, 0, time.UTC)
	staleClaimedAt := now.Add(-10 * time.Minute)
	row := EvalEnqueueEventModel{
		TenantID:     "tenant-a",
		GenerationID: "gen-stale",
		Payload:      []byte("payload-stale"),
		ScheduledAt:  now.Add(-time.Minute),
		Status:       evalEnqueueStatusClaimed,
		ClaimedAt:    &staleClaimedAt,
		CreatedAt:    now.Add(-time.Hour),
		UpdatedAt:    now.Add(-time.Hour),
	}
	if err := store.DB().Create(&row).Error; err != nil {
		t.Fatalf("seed stale claimed enqueue event: %v", err)
	}

	claimed, err := store.ClaimEvalEnqueueEvents(context.Background(), now, 10, time.Minute)
	if err != nil {
		t.Fatalf("claim enqueue events with stale recovery: %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("expected one recovered enqueue event, got %d", len(claimed))
	}
	if claimed[0].GenerationID != "gen-stale" {
		t.Fatalf("expected recovered generation gen-stale, got %q", claimed[0].GenerationID)
	}
}

func TestEvalEnqueueEventRequeueClaimedDoesNotIncrementAttempts(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Date(2026, 2, 17, 12, 45, 0, 0, time.UTC)
	row := EvalEnqueueEventModel{
		TenantID:     "tenant-a",
		GenerationID: "gen-release",
		Payload:      []byte("payload-release"),
		ScheduledAt:  now,
		Status:       evalEnqueueStatusQueued,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := store.DB().Create(&row).Error; err != nil {
		t.Fatalf("seed enqueue event: %v", err)
	}

	firstClaim, err := store.ClaimEvalEnqueueEvents(context.Background(), now.Add(time.Second), 1, time.Minute)
	if err != nil {
		t.Fatalf("claim enqueue event: %v", err)
	}
	if len(firstClaim) != 1 {
		t.Fatalf("expected one claimed enqueue event, got %d", len(firstClaim))
	}
	if firstClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts=0 on first enqueue claim, got %d", firstClaim[0].Attempts)
	}

	if err := store.RequeueClaimedEvalEnqueueEvent(context.Background(), "tenant-a", firstClaim[0].GenerationID); err != nil {
		t.Fatalf("requeue claimed enqueue event: %v", err)
	}

	secondClaim, err := store.ClaimEvalEnqueueEvents(context.Background(), now.Add(2*time.Second), 1, time.Minute)
	if err != nil {
		t.Fatalf("claim requeued enqueue event: %v", err)
	}
	if len(secondClaim) != 1 {
		t.Fatalf("expected one re-claimed enqueue event, got %d", len(secondClaim))
	}
	if secondClaim[0].GenerationID != firstClaim[0].GenerationID {
		t.Fatalf("expected generation %q, got %q", firstClaim[0].GenerationID, secondClaim[0].GenerationID)
	}
	if secondClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts to remain 0 after enqueue claim release, got %d", secondClaim[0].Attempts)
	}
}

func TestEvalEnqueueEventFailDoesNotOverrideReleasedClaim(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	now := time.Date(2026, 2, 17, 13, 0, 0, 0, time.UTC)
	row := EvalEnqueueEventModel{
		TenantID:     "tenant-a",
		GenerationID: "gen-race",
		Payload:      []byte("payload-race"),
		ScheduledAt:  now,
		Status:       evalEnqueueStatusQueued,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := store.DB().Create(&row).Error; err != nil {
		t.Fatalf("seed enqueue event: %v", err)
	}

	firstClaim, err := store.ClaimEvalEnqueueEvents(context.Background(), now.Add(time.Second), 1, time.Minute)
	if err != nil {
		t.Fatalf("claim enqueue event: %v", err)
	}
	if len(firstClaim) != 1 {
		t.Fatalf("expected one claimed enqueue event, got %d", len(firstClaim))
	}
	if firstClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts=0 on first enqueue claim, got %d", firstClaim[0].Attempts)
	}

	if err := store.RequeueClaimedEvalEnqueueEvent(context.Background(), "tenant-a", firstClaim[0].GenerationID); err != nil {
		t.Fatalf("release enqueue claim: %v", err)
	}

	requeued, err := store.FailEvalEnqueueEvent(
		context.Background(),
		"tenant-a",
		firstClaim[0].GenerationID,
		"late stale failure",
		now.Add(time.Hour),
		3,
		false,
	)
	if err != nil {
		t.Fatalf("late stale fail should no-op: %v", err)
	}
	if requeued {
		t.Fatalf("expected no requeue when failing a released enqueue claim")
	}

	var refreshed EvalEnqueueEventModel
	if err := store.DB().
		Where("tenant_id = ? AND generation_id = ?", "tenant-a", firstClaim[0].GenerationID).
		First(&refreshed).Error; err != nil {
		t.Fatalf("read enqueue event after stale fail: %v", err)
	}
	if refreshed.Status != evalEnqueueStatusQueued {
		t.Fatalf("expected status %q after stale fail no-op, got %q", evalEnqueueStatusQueued, refreshed.Status)
	}
	if refreshed.Attempts != 0 {
		t.Fatalf("expected attempts=0 after stale fail no-op, got %d", refreshed.Attempts)
	}

	secondClaim, err := store.ClaimEvalEnqueueEvents(context.Background(), now.Add(2*time.Second), 1, time.Minute)
	if err != nil {
		t.Fatalf("claim enqueue event after stale fail: %v", err)
	}
	if len(secondClaim) != 1 {
		t.Fatalf("expected one claim after stale fail no-op, got %d", len(secondClaim))
	}
	if secondClaim[0].Attempts != 0 {
		t.Fatalf("expected attempts=0 after stale fail no-op, got %d", secondClaim[0].Attempts)
	}
}

func TestEvalStoreGetLatestScoresByConversation(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 3, 2, 10, 0, 0, 0, time.UTC)
	convID := "conv-scores"

	// Insert scores across two generations in the same conversation.
	// gen-1: helpfulness scored twice (should keep latest), response_not_empty once.
	// gen-2: helpfulness scored once.
	scores := []evalpkg.GenerationScore{
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-conv-1",
			GenerationID:     "gen-1",
			ConversationID:   convID,
			EvaluatorID:      "sigil.helpfulness",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.helpfulness",
			ScoreKey:         "helpfulness",
			ScoreType:        evalpkg.ScoreTypeNumber,
			Value:            evalpkg.NumberValue(0.5),
			CreatedAt:        base,
		},
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-conv-2",
			GenerationID:     "gen-1",
			ConversationID:   convID,
			EvaluatorID:      "sigil.helpfulness",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.helpfulness",
			ScoreKey:         "helpfulness",
			ScoreType:        evalpkg.ScoreTypeNumber,
			Value:            evalpkg.NumberValue(0.9),
			CreatedAt:        base.Add(time.Second),
		},
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-conv-3",
			GenerationID:     "gen-1",
			ConversationID:   convID,
			EvaluatorID:      "sigil.response_not_empty",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.response_not_empty",
			ScoreKey:         "response_not_empty",
			ScoreType:        evalpkg.ScoreTypeBool,
			Value:            evalpkg.BoolValue(true),
			CreatedAt:        base.Add(2 * time.Second),
		},
		{
			TenantID:         "tenant-a",
			ScoreID:          "sc-conv-4",
			GenerationID:     "gen-2",
			ConversationID:   convID,
			EvaluatorID:      "sigil.helpfulness",
			EvaluatorVersion: "2026-02-17",
			RuleID:           "online.helpfulness",
			ScoreKey:         "helpfulness",
			ScoreType:        evalpkg.ScoreTypeNumber,
			Value:            evalpkg.NumberValue(0.7),
			CreatedAt:        base.Add(3 * time.Second),
		},
	}

	inserted, err := store.InsertScoreBatch(context.Background(), scores)
	if err != nil {
		t.Fatalf("insert score batch: %v", err)
	}
	if inserted != 4 {
		t.Fatalf("expected 4 inserted scores, got %d", inserted)
	}

	result, err := store.GetLatestScoresByConversation(context.Background(), "tenant-a", convID)
	if err != nil {
		t.Fatalf("get latest scores by conversation: %v", err)
	}

	// gen-1 should have 2 keys: helpfulness (latest=0.9) and response_not_empty (true)
	gen1Scores, ok := result["gen-1"]
	if !ok {
		t.Fatalf("expected gen-1 in results")
	}
	if len(gen1Scores) != 2 {
		t.Fatalf("expected 2 score keys for gen-1, got %d", len(gen1Scores))
	}
	helpfulness := gen1Scores["helpfulness"]
	if helpfulness.Value.Number == nil || *helpfulness.Value.Number != 0.9 {
		t.Fatalf("expected latest helpfulness=0.9 for gen-1, got %#v", helpfulness.Value)
	}
	notEmpty := gen1Scores["response_not_empty"]
	if notEmpty.Value.Bool == nil || !*notEmpty.Value.Bool {
		t.Fatalf("expected response_not_empty=true for gen-1, got %#v", notEmpty.Value)
	}

	// gen-2 should have 1 key: helpfulness (0.7)
	gen2Scores, ok := result["gen-2"]
	if !ok {
		t.Fatalf("expected gen-2 in results")
	}
	if len(gen2Scores) != 1 {
		t.Fatalf("expected 1 score key for gen-2, got %d", len(gen2Scores))
	}
	if gen2Scores["helpfulness"].Value.Number == nil || *gen2Scores["helpfulness"].Value.Number != 0.7 {
		t.Fatalf("expected helpfulness=0.7 for gen-2, got %#v", gen2Scores["helpfulness"].Value)
	}

	// Empty conversation should return empty map
	empty, err := store.GetLatestScoresByConversation(context.Background(), "tenant-a", "conv-nonexistent")
	if err != nil {
		t.Fatalf("get latest scores for nonexistent conversation: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected empty map for nonexistent conversation, got %d", len(empty))
	}

	// Different tenant should return empty map (tenant isolation)
	isolated, err := store.GetLatestScoresByConversation(context.Background(), "tenant-b", convID)
	if err != nil {
		t.Fatalf("get latest scores for different tenant: %v", err)
	}
	if len(isolated) != 0 {
		t.Fatalf("expected empty map for different tenant, got %d", len(isolated))
	}

	// Validation: empty tenant
	_, err = store.GetLatestScoresByConversation(context.Background(), "", convID)
	if err == nil {
		t.Fatalf("expected error for empty tenant id")
	}

	// Validation: empty conversation
	_, err = store.GetLatestScoresByConversation(context.Background(), "tenant-a", "")
	if err == nil {
		t.Fatalf("expected error for empty conversation id")
	}
}

func TestEvalStoreListConversationEvalSummaries(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 3, 2, 11, 0, 0, 0, time.UTC)
	passed := true
	failed := false

	scores := []evalpkg.GenerationScore{
		// conv-1: 3 scores — 2 passed, 1 failed
		{TenantID: "tenant-a", ScoreID: "sc-s1", GenerationID: "gen-1", ConversationID: "conv-1", EvaluatorID: "eval-1", EvaluatorVersion: "v1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.9), Passed: &passed, CreatedAt: base},
		{TenantID: "tenant-a", ScoreID: "sc-s2", GenerationID: "gen-1", ConversationID: "conv-1", EvaluatorID: "eval-2", EvaluatorVersion: "v1", ScoreKey: "toxicity", ScoreType: evalpkg.ScoreTypeBool, Value: evalpkg.BoolValue(false), Passed: &passed, CreatedAt: base.Add(time.Second)},
		{TenantID: "tenant-a", ScoreID: "sc-s3", GenerationID: "gen-2", ConversationID: "conv-1", EvaluatorID: "eval-1", EvaluatorVersion: "v1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.2), Passed: &failed, CreatedAt: base.Add(2 * time.Second)},
		// conv-2: 1 score — no passed field (nil)
		{TenantID: "tenant-a", ScoreID: "sc-s4", GenerationID: "gen-3", ConversationID: "conv-2", EvaluatorID: "eval-1", EvaluatorVersion: "v1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.5), CreatedAt: base.Add(3 * time.Second)},
	}

	inserted, err := store.InsertScoreBatch(context.Background(), scores)
	if err != nil {
		t.Fatalf("insert score batch: %v", err)
	}
	if inserted != 4 {
		t.Fatalf("expected 4 inserted scores, got %d", inserted)
	}

	// Query both conversations
	summaries, err := store.ListConversationEvalSummaries(context.Background(), "tenant-a", []string{"conv-1", "conv-2", "conv-nonexistent"})
	if err != nil {
		t.Fatalf("list conversation eval summaries: %v", err)
	}

	// conv-1: total=3, pass=2, fail=1
	conv1, ok := summaries["conv-1"]
	if !ok {
		t.Fatalf("expected conv-1 in summaries")
	}
	if conv1.TotalScores != 3 {
		t.Errorf("expected conv-1 total_scores=3, got %d", conv1.TotalScores)
	}
	if conv1.PassCount != 2 {
		t.Errorf("expected conv-1 pass_count=2, got %d", conv1.PassCount)
	}
	if conv1.FailCount != 1 {
		t.Errorf("expected conv-1 fail_count=1, got %d", conv1.FailCount)
	}

	// conv-2: total=1, pass=0, fail=0 (passed is nil)
	conv2, ok := summaries["conv-2"]
	if !ok {
		t.Fatalf("expected conv-2 in summaries")
	}
	if conv2.TotalScores != 1 {
		t.Errorf("expected conv-2 total_scores=1, got %d", conv2.TotalScores)
	}
	if conv2.PassCount != 0 {
		t.Errorf("expected conv-2 pass_count=0, got %d", conv2.PassCount)
	}
	if conv2.FailCount != 0 {
		t.Errorf("expected conv-2 fail_count=0, got %d", conv2.FailCount)
	}

	// conv-nonexistent should not appear
	if _, ok := summaries["conv-nonexistent"]; ok {
		t.Errorf("expected conv-nonexistent to be absent from summaries")
	}

	// Empty conversation list should return empty map
	empty, err := store.ListConversationEvalSummaries(context.Background(), "tenant-a", []string{})
	if err != nil {
		t.Fatalf("list with empty ids: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected empty map for empty ids, got %d", len(empty))
	}

	// Nil conversation list should return empty map
	nilResult, err := store.ListConversationEvalSummaries(context.Background(), "tenant-a", nil)
	if err != nil {
		t.Fatalf("list with nil ids: %v", err)
	}
	if len(nilResult) != 0 {
		t.Fatalf("expected empty map for nil ids, got %d", len(nilResult))
	}

	// Different tenant should return empty map (tenant isolation)
	isolated, err := store.ListConversationEvalSummaries(context.Background(), "tenant-b", []string{"conv-1"})
	if err != nil {
		t.Fatalf("list for different tenant: %v", err)
	}
	if len(isolated) != 0 {
		t.Fatalf("expected empty map for different tenant, got %d", len(isolated))
	}

	// Re-evaluation: insert a newer score for the same (gen-1, helpfulness) with
	// a different score_id and opposite passed value. The summary must not
	// double-count — it should reflect only the latest score per
	// (generation_id, score_key), consistent with GetLatestScoresByConversation.
	reEvalScore := evalpkg.GenerationScore{
		TenantID:         "tenant-a",
		ScoreID:          "sc-s5-reeval",
		GenerationID:     "gen-1",
		ConversationID:   "conv-1",
		EvaluatorID:      "eval-1",
		EvaluatorVersion: "v2",
		ScoreKey:         "helpfulness",
		ScoreType:        evalpkg.ScoreTypeNumber,
		Value:            evalpkg.NumberValue(0.3),
		Passed:           &failed,
		CreatedAt:        base.Add(10 * time.Second),
	}
	reInserted, err := store.InsertScore(context.Background(), reEvalScore)
	if err != nil {
		t.Fatalf("insert re-eval score: %v", err)
	}
	if !reInserted {
		t.Fatalf("expected re-eval score to be inserted")
	}

	summariesAfterReeval, err := store.ListConversationEvalSummaries(context.Background(), "tenant-a", []string{"conv-1"})
	if err != nil {
		t.Fatalf("list summaries after re-eval: %v", err)
	}
	conv1AfterReeval := summariesAfterReeval["conv-1"]
	// Before fix: total=4 (double-counted helpfulness), pass=2, fail=2
	// After fix:  total=3 (deduplicated), pass=1 (toxicity), fail=2 (helpfulness re-eval + gen-2 helpfulness)
	if conv1AfterReeval.TotalScores != 3 {
		t.Errorf("expected conv-1 total_scores=3 after re-eval (deduplicated), got %d", conv1AfterReeval.TotalScores)
	}
	if conv1AfterReeval.PassCount != 1 {
		t.Errorf("expected conv-1 pass_count=1 after re-eval, got %d", conv1AfterReeval.PassCount)
	}
	if conv1AfterReeval.FailCount != 2 {
		t.Errorf("expected conv-1 fail_count=2 after re-eval, got %d", conv1AfterReeval.FailCount)
	}

	// Validation: empty tenant
	_, err = store.ListConversationEvalSummaries(context.Background(), "", []string{"conv-1"})
	if err == nil {
		t.Fatalf("expected error for empty tenant id")
	}
}

func TestEvalStoreEvaluatorLineage(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenantID := "test-tenant"

	eval := evalpkg.EvaluatorDefinition{
		TenantID:              tenantID,
		EvaluatorID:           "forked.helpfulness",
		Version:               "2026-03-02",
		Kind:                  evalpkg.EvaluatorKindLLMJudge,
		Config:                map[string]any{"provider": "anthropic"},
		OutputKeys:            []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		SourceTemplateID:      "sigil.helpfulness",
		SourceTemplateVersion: "2026-02-17",
	}
	err := store.CreateEvaluator(ctx, eval)
	if err != nil {
		t.Fatalf("create evaluator: %v", err)
	}

	got, err := store.GetEvaluator(ctx, tenantID, "forked.helpfulness")
	if err != nil {
		t.Fatalf("get evaluator: %v", err)
	}
	if got == nil {
		t.Fatal("expected evaluator to exist")
	}
	if got.SourceTemplateID != "sigil.helpfulness" {
		t.Errorf("expected source_template_id=sigil.helpfulness, got %q", got.SourceTemplateID)
	}
	if got.SourceTemplateVersion != "2026-02-17" {
		t.Errorf("expected source_template_version=2026-02-17, got %q", got.SourceTemplateVersion)
	}
}
