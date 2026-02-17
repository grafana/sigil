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

type storeStub struct {
	mu sync.Mutex

	claimBatches [][]Event
	claimCalls   int

	completeCalls  []completeCall
	completeSignal chan struct{}

	failCalls   []failCall
	failRequeue bool
	failErr     error
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

func (s *storeStub) CompleteEvalEnqueueEvent(_ context.Context, tenantID, generationID string) error {
	s.mu.Lock()
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

func (s *storeStub) FailEvalEnqueueEvent(_ context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	s.mu.Lock()
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
