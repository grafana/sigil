package enqueue

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestRunCycleCompletesProcessedEvents(t *testing.T) {
	store := &storeStub{
		claimBatches: [][]Event{{
			{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 0, Payload: []byte("payload")},
		}},
	}
	processor := &processorStub{}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	processed, err := svc.runCycle(context.Background())
	if err != nil {
		t.Fatalf("run cycle: %v", err)
	}
	if !processed {
		t.Fatalf("expected processed=true")
	}
	if len(processor.calls) != 1 {
		t.Fatalf("expected one processor call, got %d", len(processor.calls))
	}
	if len(store.completeCalls) != 1 {
		t.Fatalf("expected one completion call, got %d", len(store.completeCalls))
	}
	if len(store.failCalls) != 0 {
		t.Fatalf("expected no fail calls, got %d", len(store.failCalls))
	}
}

func TestRunCycleRequeuesTransientFailures(t *testing.T) {
	store := &storeStub{
		claimBatches: [][]Event{{
			{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 1, Payload: []byte("payload")},
		}},
		failRequeue: true,
	}
	processor := &processorStub{
		errs: []error{errors.New("temporary DB issue")},
	}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  5,
	}, nil, store, processor)

	processed, err := svc.runCycle(context.Background())
	if err != nil {
		t.Fatalf("run cycle: %v", err)
	}
	if !processed {
		t.Fatalf("expected processed=true")
	}
	if len(store.completeCalls) != 0 {
		t.Fatalf("expected no completion on transient failure, got %d", len(store.completeCalls))
	}
	if len(store.failCalls) != 1 {
		t.Fatalf("expected one fail call, got %d", len(store.failCalls))
	}
	if store.failCalls[0].permanent {
		t.Fatalf("expected transient failure to be non-permanent")
	}
	if store.failCalls[0].maxAttempts != 5 {
		t.Fatalf("expected maxAttempts=5, got %d", store.failCalls[0].maxAttempts)
	}
}

func TestRunCycleMarksPermanentFailuresWithoutRequeue(t *testing.T) {
	store := &storeStub{
		claimBatches: [][]Event{{
			{TenantID: "tenant-a", GenerationID: "gen-perm", Attempts: 0, Payload: []byte("payload")},
		}},
		failRequeue: false,
	}
	processor := &processorStub{
		errs: []error{evalpkg.Permanent(errors.New("invalid payload"))},
	}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	processed, err := svc.runCycle(context.Background())
	if err != nil {
		t.Fatalf("run cycle: %v", err)
	}
	if !processed {
		t.Fatalf("expected processed=true")
	}
	if len(store.failCalls) != 1 {
		t.Fatalf("expected one fail call, got %d", len(store.failCalls))
	}
	if !store.failCalls[0].permanent {
		t.Fatalf("expected permanent failure classification")
	}
	if len(store.completeCalls) != 0 {
		t.Fatalf("expected no completion for permanent failure")
	}
}

func TestNotifyTriggersImmediateProcessing(t *testing.T) {
	store := &storeStub{
		claimBatches: [][]Event{
			{{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 0, Payload: []byte("payload")}},
			{},
		},
		completeSignal: make(chan struct{}, 1),
	}
	processor := &processorStub{}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: 5 * time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- svc.Run(ctx)
	}()

	svc.Notify()
	select {
	case <-store.completeSignal:
	case <-time.After(750 * time.Millisecond):
		t.Fatalf("timed out waiting for notify-driven processing")
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for dispatcher shutdown")
	}
}

func TestProcessEventCompletesWithDetachedContextOnCancel(t *testing.T) {
	store := &storeStub{rejectCanceledComplete: true}
	processor := &processorStub{}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	svc.processEvent(ctx, Event{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 0, Payload: []byte("payload")})

	if len(store.completeCalls) != 1 {
		t.Fatalf("expected completion call to persist even when run context is canceled, got %d", len(store.completeCalls))
	}
	if store.completeCanceledCtxCalls != 0 {
		t.Fatalf("expected detached context for completion, got %d canceled context calls", store.completeCanceledCtxCalls)
	}
}

func TestProcessEventCancellationRequeuesWithoutConsumingAttempts(t *testing.T) {
	store := &storeStub{
		rejectCanceledRequeue: true,
	}
	processor := &processorStub{errs: []error{context.Canceled}}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	svc.processEvent(ctx, Event{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 0, Payload: []byte("payload")})

	if len(store.failCalls) != 0 {
		t.Fatalf("expected no fail calls for cancellation path, got %d", len(store.failCalls))
	}
	if len(store.requeueCalls) != 1 {
		t.Fatalf("expected one cancellation requeue call, got %d", len(store.requeueCalls))
	}
	if store.requeueCanceledCtxCalls != 0 {
		t.Fatalf("expected detached context for cancellation requeue, got %d canceled context calls", store.requeueCanceledCtxCalls)
	}
}

func TestProcessEventFailsWithDetachedContextOnCancel(t *testing.T) {
	store := &storeStub{
		failRequeue:        true,
		rejectCanceledFail: true,
	}
	processor := &processorStub{errs: []error{errors.New("temporary error")}}
	svc := NewService(Config{
		Enabled:      true,
		BatchSize:    10,
		PollInterval: time.Second,
		MaxAttempts:  3,
	}, nil, store, processor)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	svc.processEvent(ctx, Event{TenantID: "tenant-a", GenerationID: "gen-1", Attempts: 0, Payload: []byte("payload")})

	if len(store.failCalls) != 1 {
		t.Fatalf("expected fail call to persist even when run context is canceled, got %d", len(store.failCalls))
	}
	if store.failCanceledCtxCalls != 0 {
		t.Fatalf("expected detached context for fail transition, got %d canceled context calls", store.failCanceledCtxCalls)
	}
}

type storeStub struct {
	mu sync.Mutex

	claimBatches [][]Event
	claimCalls   int

	completeCalls            []completeCall
	completeSignal           chan struct{}
	rejectCanceledComplete   bool
	completeCanceledCtxCalls int

	requeueCalls            []completeCall
	rejectCanceledRequeue   bool
	requeueCanceledCtxCalls int

	failCalls            []failCall
	failRequeue          bool
	failErr              error
	rejectCanceledFail   bool
	failCanceledCtxCalls int
}

func (s *storeStub) ClaimEvalEnqueueEvents(_ context.Context, _ time.Time, _ int, _ time.Duration) ([]Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.claimCalls >= len(s.claimBatches) {
		s.claimCalls++
		return []Event{}, nil
	}
	batch := append([]Event(nil), s.claimBatches[s.claimCalls]...)
	s.claimCalls++
	return batch, nil
}

func (s *storeStub) CompleteEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.completeCanceledCtxCalls++
		if s.rejectCanceledComplete {
			s.mu.Unlock()
			return ctx.Err()
		}
	}
	s.completeCalls = append(s.completeCalls, completeCall{tenantID: tenantID, generationID: generationID})
	signal := s.completeSignal
	s.mu.Unlock()

	if signal != nil {
		select {
		case signal <- struct{}{}:
		default:
		}
	}
	return nil
}

func (s *storeStub) RequeueClaimedEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.requeueCanceledCtxCalls++
		if s.rejectCanceledRequeue {
			s.mu.Unlock()
			return ctx.Err()
		}
	}
	s.requeueCalls = append(s.requeueCalls, completeCall{tenantID: tenantID, generationID: generationID})
	s.mu.Unlock()
	return nil
}

func (s *storeStub) FailEvalEnqueueEvent(ctx context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	s.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		s.failCanceledCtxCalls++
		if s.rejectCanceledFail {
			s.mu.Unlock()
			return false, ctx.Err()
		}
	}
	defer s.mu.Unlock()
	s.failCalls = append(s.failCalls, failCall{
		tenantID:     tenantID,
		generationID: generationID,
		lastError:    lastError,
		retryAt:      retryAt,
		maxAttempts:  maxAttempts,
		permanent:    permanent,
	})
	return s.failRequeue, s.failErr
}

type processorStub struct {
	mu    sync.Mutex
	errs  []error
	calls []Event
}

func (p *processorStub) Process(_ context.Context, event Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, event)
	if len(p.errs) == 0 {
		return nil
	}
	err := p.errs[0]
	p.errs = p.errs[1:]
	return err
}

type completeCall struct {
	tenantID     string
	generationID string
}

type failCall struct {
	tenantID     string
	generationID string
	lastError    string
	retryAt      time.Time
	maxAttempts  int
	permanent    bool
}
