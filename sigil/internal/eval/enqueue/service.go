package enqueue

import (
	"context"
	"fmt"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

const (
	defaultBatchSize    = 64
	defaultPollInterval = 200 * time.Millisecond
	defaultMaxAttempts  = 8
	defaultClaimTTL     = 2 * time.Minute
)

// Config controls durable enqueue dispatcher behavior.
type Config struct {
	Enabled      bool
	BatchSize    int
	PollInterval time.Duration
	MaxAttempts  int
	ClaimTTL     time.Duration
}

// Event is one persisted generation event awaiting rule-engine enqueueing.
type Event struct {
	TenantID       string
	GenerationID   string
	ConversationID *string
	Payload        []byte
	Attempts       int
}

// Store provides durable queue operations for enqueue events.
type Store interface {
	ClaimEvalEnqueueEvents(ctx context.Context, now time.Time, limit int, claimTTL time.Duration) ([]Event, error)
	CompleteEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error
	FailEvalEnqueueEvent(ctx context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error)
}

// Processor performs rule matching + work-item creation for one event.
type Processor interface {
	Process(ctx context.Context, event Event) error
}

// Service drains durable enqueue events into eval work items.
//
// The ingest path persists enqueue events transactionally with generations.
// This dispatcher then converts those events into eval work items with retries.
type Service struct {
	cfg       Config
	logger    log.Logger
	store     Store
	processor Processor
	notifyCh  chan struct{}
}

// NewService constructs a dispatcher with sane defaults.
func NewService(cfg Config, logger log.Logger, store Store, processor Processor) *Service {
	if logger == nil {
		logger = log.NewNopLogger()
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = defaultBatchSize
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = defaultPollInterval
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = defaultMaxAttempts
	}
	if cfg.ClaimTTL <= 0 {
		cfg.ClaimTTL = defaultClaimTTL
	}
	return &Service{
		cfg:       cfg,
		logger:    logger,
		store:     store,
		processor: processor,
		notifyCh:  make(chan struct{}, 1),
	}
}

// Notify requests an immediate enqueue-drain cycle.
func (s *Service) Notify() {
	if s == nil {
		return
	}
	select {
	case s.notifyCh <- struct{}{}:
	default:
	}
}

// Run starts the dispatcher loop and blocks until context cancellation.
func (s *Service) Run(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if s.store == nil {
		return fmt.Errorf("enqueue dispatcher store is required")
	}
	if s.processor == nil {
		return fmt.Errorf("enqueue dispatcher processor is required")
	}
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
		case <-s.notifyCh:
		}

		for {
			processed, err := s.runCycle(ctx)
			if err != nil {
				_ = level.Error(s.logger).Log("msg", "eval enqueue dispatcher cycle failed", "err", err)
				break
			}
			if !processed {
				break
			}
		}
	}
}

func (s *Service) runCycle(ctx context.Context) (bool, error) {
	events, err := s.store.ClaimEvalEnqueueEvents(ctx, time.Now().UTC(), s.cfg.BatchSize, s.cfg.ClaimTTL)
	if err != nil {
		return false, err
	}
	if len(events) == 0 {
		return false, nil
	}

	for _, event := range events {
		s.processEvent(ctx, event)
	}
	return true, nil
}

func (s *Service) processEvent(ctx context.Context, event Event) {
	if err := s.processor.Process(ctx, event); err != nil {
		permanent := evalpkg.IsPermanent(err)
		retryAt := time.Now().UTC().Add(retryBackoff(event.Attempts + 1))
		requeued, failErr := s.store.FailEvalEnqueueEvent(ctx, event.TenantID, event.GenerationID, err.Error(), retryAt, s.cfg.MaxAttempts, permanent)
		if failErr != nil {
			_ = level.Error(s.logger).Log(
				"msg", "eval enqueue dispatcher fail update failed",
				"tenant_id", event.TenantID,
				"generation_id", event.GenerationID,
				"err", failErr,
			)
			return
		}
		if requeued {
			_ = level.Warn(s.logger).Log(
				"msg", "eval enqueue dispatcher requeued event",
				"tenant_id", event.TenantID,
				"generation_id", event.GenerationID,
			)
			return
		}
		_ = level.Error(s.logger).Log(
			"msg", "eval enqueue dispatcher marked event failed",
			"tenant_id", event.TenantID,
			"generation_id", event.GenerationID,
			"err", err,
		)
		return
	}

	if err := s.store.CompleteEvalEnqueueEvent(ctx, event.TenantID, event.GenerationID); err != nil {
		_ = level.Error(s.logger).Log(
			"msg", "eval enqueue dispatcher complete failed",
			"tenant_id", event.TenantID,
			"generation_id", event.GenerationID,
			"err", err,
		)
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

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
