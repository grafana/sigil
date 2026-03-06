package worker

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/services"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"golang.org/x/time/rate"
)

const statusTransitionTimeout = 5 * time.Second

type Config struct {
	Enabled           bool
	MaxConcurrent     int
	MaxRatePerMinute  int
	MaxAttempts       int
	ClaimBatchSize    int
	PollInterval      time.Duration
	DefaultJudgeModel string
}

type GenerationReader interface {
	GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
}

type Service struct {
	cfg       Config
	logger    log.Logger
	store     workerStore
	reader    GenerationReader
	discovery *judges.Discovery

	evaluators map[evalpkg.EvaluatorKind]evaluators.Evaluator
	limiter    *rate.Limiter
	semaphore  chan struct{}
	seenQueue  map[evalpkg.WorkItemStatus]map[string]struct{}
}

type workerStore interface {
	GetEvaluatorVersion(ctx context.Context, tenantID, evaluatorID, version string) (*evalpkg.EvaluatorDefinition, error)
	ClaimWorkItems(ctx context.Context, now time.Time, limit int) ([]evalpkg.WorkItem, error)
	RequeueClaimedWorkItem(ctx context.Context, tenantID, workID string) error
	InsertScoreBatch(ctx context.Context, scores []evalpkg.GenerationScore) (int, error)
	CompleteWorkItem(ctx context.Context, tenantID, workID string) error
	FailWorkItem(ctx context.Context, tenantID, workID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error)
	CountWorkItemsByStatus(ctx context.Context, status evalpkg.WorkItemStatus) (map[string]int64, error)
}

func NewService(cfg Config, logger log.Logger, store workerStore, reader GenerationReader, discovery *judges.Discovery) services.Service {
	module := &Service{
		cfg:       cfg,
		logger:    logger,
		store:     store,
		reader:    reader,
		discovery: discovery,
	}
	if module.logger == nil {
		module.logger = log.NewNopLogger()
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName("eval-worker")
}

func (s *Service) start(_ context.Context) error {
	if s.store == nil {
		return fmt.Errorf("eval store is required")
	}
	if s.reader == nil {
		return fmt.Errorf("generation reader is required")
	}
	if s.discovery == nil {
		s.discovery = judges.NewDiscovery()
	}

	if s.cfg.MaxConcurrent <= 0 {
		s.cfg.MaxConcurrent = 4
	}
	if s.cfg.MaxRatePerMinute <= 0 {
		s.cfg.MaxRatePerMinute = 600
	}
	if s.cfg.MaxAttempts <= 0 {
		s.cfg.MaxAttempts = 3
	}
	if s.cfg.ClaimBatchSize <= 0 {
		s.cfg.ClaimBatchSize = 20
	}
	if s.cfg.PollInterval <= 0 {
		s.cfg.PollInterval = 250 * time.Millisecond
	}
	if s.cfg.DefaultJudgeModel == "" {
		s.cfg.DefaultJudgeModel = "openai/gpt-4o-mini"
	}
	judges.SetMetricsObserver(judgeMetricsObserver{})

	ratePerSecond := float64(s.cfg.MaxRatePerMinute) / 60.0
	s.limiter = rate.NewLimiter(rate.Limit(ratePerSecond), max(1, s.cfg.MaxConcurrent))
	s.semaphore = make(chan struct{}, s.cfg.MaxConcurrent)
	s.seenQueue = make(map[evalpkg.WorkItemStatus]map[string]struct{}, 3)

	s.evaluators = map[evalpkg.EvaluatorKind]evaluators.Evaluator{
		evalpkg.EvaluatorKindRegex:      evaluators.NewRegexEvaluator(),
		evalpkg.EvaluatorKindJSONSchema: evaluators.NewJSONSchemaEvaluator(),
		evalpkg.EvaluatorKindHeuristic:  evaluators.NewHeuristicEvaluator(),
		evalpkg.EvaluatorKindLLMJudge:   evaluators.NewLLMJudgeEvaluator(s.discovery, s.cfg.DefaultJudgeModel),
	}
	return nil
}

func (s *Service) run(ctx context.Context) error {
	if !s.cfg.Enabled {
		<-ctx.Done()
		return nil
	}

	ticker := time.NewTicker(s.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			s.runCycle(ctx)
		}
	}
}

func (s *Service) stop(_ error) error {
	return nil
}

func (s *Service) runCycle(ctx context.Context) {
	items, err := s.store.ClaimWorkItems(ctx, time.Now().UTC(), s.cfg.ClaimBatchSize)
	if err != nil {
		_ = level.Error(s.logger).Log("msg", "eval worker claim failed", "err", err)
		return
	}
	if len(items) == 0 {
		s.refreshQueueDepth(ctx)
		return
	}

	var wg sync.WaitGroup
loop:
	for idx, item := range items {
		if err := s.limiter.Wait(ctx); err != nil {
			s.releaseUnstartedItems(ctx, items[idx:], err)
			break
		}
		select {
		case s.semaphore <- struct{}{}:
		case <-ctx.Done():
			s.releaseUnstartedItems(ctx, items[idx:], ctx.Err())
			break loop
		}
		wg.Add(1)
		go func(item evalpkg.WorkItem) {
			defer wg.Done()
			defer func() { <-s.semaphore }()
			s.executeItem(ctx, item)
		}(item)
	}
	wg.Wait()
	s.refreshQueueDepth(ctx)
}

func (s *Service) releaseUnstartedItems(ctx context.Context, items []evalpkg.WorkItem, cause error) {
	if len(items) == 0 {
		return
	}
	if cause == nil {
		cause = context.Canceled
	}
	transitionCtx, cancel := detachedContextWithTimeout(ctx, statusTransitionTimeout)
	defer cancel()
	for _, item := range items {
		if err := s.store.RequeueClaimedWorkItem(transitionCtx, item.TenantID, item.WorkID); err != nil && !errors.Is(err, evalpkg.ErrNotFound) {
			_ = level.Error(s.logger).Log(
				"msg", "eval worker release claimed item failed",
				"tenant_id", item.TenantID,
				"work_id", item.WorkID,
				"err", err,
			)
			continue
		}
		_ = level.Warn(s.logger).Log(
			"msg", "eval worker released unstarted claimed item",
			"tenant_id", item.TenantID,
			"work_id", item.WorkID,
			"cause", cause.Error(),
		)
	}
}

func (s *Service) executeItem(ctx context.Context, item evalpkg.WorkItem) {
	startedAt := time.Now()
	kind := "unknown"

	evaluatorDefinition, err := s.store.GetEvaluatorVersion(ctx, item.TenantID, item.EvaluatorID, item.EvaluatorVersion)
	if err != nil {
		s.failItem(ctx, item, kind, err)
		return
	}
	if evaluatorDefinition == nil {
		s.failItem(ctx, item, kind, evalpkg.Permanent(fmt.Errorf("evaluator %q version %q was not found", item.EvaluatorID, item.EvaluatorVersion)))
		return
	}
	kind = string(evaluatorDefinition.Kind)

	evaluatorImpl, ok := s.evaluators[evaluatorDefinition.Kind]
	if !ok {
		s.failItem(ctx, item, kind, evalpkg.Permanent(fmt.Errorf("evaluator kind %q is not supported", evaluatorDefinition.Kind)))
		return
	}

	generation, err := s.reader.GetByID(ctx, item.TenantID, item.GenerationID)
	if err != nil {
		s.failItem(ctx, item, kind, err)
		return
	}
	if generation == nil {
		// Keep this transient to allow eventual consistency between hot WAL
		// truncation and cold object-storage availability.
		s.failItem(ctx, item, kind, fmt.Errorf("generation %q was not found", item.GenerationID))
		return
	}

	input := evaluators.InputFromGeneration(item.TenantID, generation)
	evalCtx := judges.WithTenantID(ctx, item.TenantID)
	outputs, err := evaluatorImpl.Evaluate(evalCtx, input, *evaluatorDefinition)
	if err != nil {
		s.failItem(ctx, item, kind, err)
		return
	}

	scores := make([]evalpkg.GenerationScore, 0, len(outputs))
	createdAt := time.Now().UTC()

	keyConstraints := make(map[string]evalpkg.OutputKey, len(evaluatorDefinition.OutputKeys))
	for _, ok := range evaluatorDefinition.OutputKeys {
		keyConstraints[ok.Key] = ok
	}

	for _, output := range outputs {
		if constraint, found := keyConstraints[output.Key]; found && output.Type == evalpkg.ScoreTypeNumber && output.Value.Number != nil {
			if constraint.Min != nil && *output.Value.Number < *constraint.Min {
				_ = level.Warn(s.logger).Log("msg", "dropping score below min bound", "key", output.Key, "value", *output.Value.Number, "min", *constraint.Min)
				continue
			}
			if constraint.Max != nil && *output.Value.Number > *constraint.Max {
				_ = level.Warn(s.logger).Log("msg", "dropping score above max bound", "key", output.Key, "value", *output.Value.Number, "max", *constraint.Max)
				continue
			}
		}

		score := evalpkg.GenerationScore{
			TenantID:             item.TenantID,
			ScoreID:              makeScoreID(item.WorkID, output.Key),
			GenerationID:         item.GenerationID,
			ConversationID:       generation.GetConversationId(),
			TraceID:              generation.GetTraceId(),
			SpanID:               generation.GetSpanId(),
			EvaluatorID:          item.EvaluatorID,
			EvaluatorVersion:     item.EvaluatorVersion,
			EvaluatorDescription: evaluatorDefinition.Description,
			RuleID:               item.RuleID,
			RunID:                item.WorkID,
			ScoreKey:             output.Key,
			ScoreType:            output.Type,
			Value:                output.Value,
			Unit:                 output.Unit,
			Passed:               output.Passed,
			Explanation:          output.Explanation,
			Metadata:             output.Metadata,
			CreatedAt:            createdAt,
			SourceKind:           "online_rule",
			SourceID:             item.RuleID,
		}
		scores = append(scores, score)
	}

	if _, err := s.store.InsertScoreBatch(ctx, scores); err != nil {
		s.failItem(ctx, item, kind, err)
		return
	}
	transitionCtx, cancel := detachedContextWithTimeout(ctx, statusTransitionTimeout)
	defer cancel()
	if err := s.store.CompleteWorkItem(transitionCtx, item.TenantID, item.WorkID); err != nil {
		s.failItem(ctx, item, kind, fmt.Errorf("complete work item: %w", err))
		return
	}

	evalModel := generation.GetResponseModel()
	agentName := generation.GetAgentName()
	var genModel, genProvider string
	if m := generation.GetModel(); m != nil {
		genModel = m.GetName()
		genProvider = m.GetProvider()
	}
	observeExecution(item.TenantID, item.EvaluatorID, kind, item.RuleID, "success", evalModel, genModel, genProvider, agentName)
	observeExecutionDuration(item.TenantID, item.EvaluatorID, kind, item.RuleID, time.Since(startedAt), evalModel, genModel, genProvider, agentName)
	for _, score := range scores {
		observeProducedScore(item.TenantID, item.EvaluatorID, kind, item.RuleID, score.ScoreKey, score.Passed, evalModel, genModel, genProvider, agentName)
	}
}

func (s *Service) failItem(ctx context.Context, item evalpkg.WorkItem, kind string, err error) {
	if isRunContextCancellation(ctx, err) {
		s.requeueCanceledItem(ctx, item, err)
		return
	}

	permanent := evalpkg.IsPermanent(err)
	retryAt := time.Now().UTC().Add(retryBackoff(item.Attempts + 1))
	transitionCtx, cancel := detachedContextWithTimeout(ctx, statusTransitionTimeout)
	defer cancel()
	requeued, failErr := s.store.FailWorkItem(transitionCtx, item.TenantID, item.WorkID, err.Error(), retryAt, s.cfg.MaxAttempts, permanent)
	if failErr != nil {
		_ = level.Error(s.logger).Log("msg", "eval worker fail update failed", "tenant_id", item.TenantID, "work_id", item.WorkID, "err", failErr)
	}
	if requeued {
		observeRetry(item.TenantID, item.EvaluatorID, kind, item.RuleID)
	}
	observeExecution(item.TenantID, item.EvaluatorID, kind, item.RuleID, "failed", "", "", "", "")
}

func (s *Service) requeueCanceledItem(ctx context.Context, item evalpkg.WorkItem, cause error) {
	if cause == nil {
		cause = context.Canceled
	}
	transitionCtx, cancel := detachedContextWithTimeout(ctx, statusTransitionTimeout)
	defer cancel()
	if err := s.store.RequeueClaimedWorkItem(transitionCtx, item.TenantID, item.WorkID); err != nil && !errors.Is(err, evalpkg.ErrNotFound) {
		_ = level.Error(s.logger).Log(
			"msg", "eval worker cancellation requeue failed",
			"tenant_id", item.TenantID,
			"work_id", item.WorkID,
			"err", err,
		)
		return
	}
	_ = level.Warn(s.logger).Log(
		"msg", "eval worker released claimed item due cancellation",
		"tenant_id", item.TenantID,
		"work_id", item.WorkID,
		"cause", cause.Error(),
	)
}

func (s *Service) refreshQueueDepth(ctx context.Context) {
	for _, status := range []evalpkg.WorkItemStatus{evalpkg.WorkItemStatusQueued, evalpkg.WorkItemStatusClaimed, evalpkg.WorkItemStatusFailed} {
		counts, err := s.store.CountWorkItemsByStatus(ctx, status)
		if err != nil {
			continue
		}

		seenByStatus := s.seenQueue[status]
		if seenByStatus == nil {
			seenByStatus = map[string]struct{}{}
			s.seenQueue[status] = seenByStatus
		}

		for tenantID, count := range counts {
			setQueueDepth(tenantID, string(status), count)
			seenByStatus[tenantID] = struct{}{}
		}

		for tenantID := range seenByStatus {
			if _, ok := counts[tenantID]; ok {
				continue
			}
			setQueueDepth(tenantID, string(status), 0)
			delete(seenByStatus, tenantID)
		}
	}
}

func retryBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	backoff := time.Second * time.Duration(1<<min(attempt-1, 6))
	if backoff > 2*time.Minute {
		backoff = 2 * time.Minute
	}
	return backoff
}

func makeScoreID(workID, key string) string {
	hash := sha1.Sum([]byte(workID + "|" + key))
	return "sc_" + hex.EncodeToString(hash[:12])
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func detachedContextWithTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	baseCtx := context.Background()
	if ctx != nil {
		baseCtx = context.WithoutCancel(ctx)
	}
	return context.WithTimeout(baseCtx, timeout)
}

func isRunContextCancellation(ctx context.Context, err error) bool {
	if ctx == nil || ctx.Err() == nil {
		return false
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
