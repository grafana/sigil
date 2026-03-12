package judges

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestInstrumentedClientSuccess(t *testing.T) {
	observer := &metricsObserverStub{}
	SetMetricsObserver(observer)
	defer SetMetricsObserver(nil)

	client := NewInstrumentedClient("openai", fakeJudgeClient{
		judgeFn: func(_ context.Context, _ JudgeRequest) (JudgeResponse, error) {
			return JudgeResponse{
				Model: "gpt-4o-mini",
				Usage: JudgeUsage{
					InputTokens:     21,
					OutputTokens:    7,
					CacheReadTokens: 3,
				},
			}, nil
		},
	})

	_, err := client.Judge(WithTenantID(context.Background(), "tenant-a"), JudgeRequest{Model: "fallback-model"})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}

	snapshot := observer.snapshot()
	if len(snapshot.requests) != 1 {
		t.Fatalf("expected one request event, got %d", len(snapshot.requests))
	}
	if snapshot.requests[0].status != "success" {
		t.Fatalf("expected success status, got %q", snapshot.requests[0].status)
	}
	if len(snapshot.durations) != 1 {
		t.Fatalf("expected one duration event, got %d", len(snapshot.durations))
	}
	if len(snapshot.tokens) != 3 {
		t.Fatalf("expected three token events, got %d", len(snapshot.tokens))
	}
	if len(snapshot.errors) != 0 {
		t.Fatalf("expected no error events, got %d", len(snapshot.errors))
	}
}

func TestInstrumentedClientRateLimitError(t *testing.T) {
	observer := &metricsObserverStub{}
	SetMetricsObserver(observer)
	defer SetMetricsObserver(nil)

	client := NewInstrumentedClient("openai", fakeJudgeClient{
		judgeFn: func(_ context.Context, _ JudgeRequest) (JudgeResponse, error) {
			return JudgeResponse{}, errors.New("rate limit exceeded")
		},
	})

	_, err := client.Judge(WithTenantID(context.Background(), "tenant-a"), JudgeRequest{Model: "gpt-4o-mini"})
	if err == nil {
		t.Fatalf("expected error")
	}

	snapshot := observer.snapshot()
	if len(snapshot.requests) != 1 {
		t.Fatalf("expected one request event, got %d", len(snapshot.requests))
	}
	if snapshot.requests[0].status != "error" {
		t.Fatalf("expected error status, got %q", snapshot.requests[0].status)
	}
	if len(snapshot.errors) != 1 {
		t.Fatalf("expected one error event, got %d", len(snapshot.errors))
	}
	if snapshot.errors[0].errorType != "rate_limit" {
		t.Fatalf("expected rate_limit error type, got %q", snapshot.errors[0].errorType)
	}
	if len(snapshot.tokens) != 0 {
		t.Fatalf("expected no token events on error, got %d", len(snapshot.tokens))
	}
}

func TestInstrumentedClientTimeoutError(t *testing.T) {
	observer := &metricsObserverStub{}
	SetMetricsObserver(observer)
	defer SetMetricsObserver(nil)

	client := NewInstrumentedClient("anthropic", fakeJudgeClient{
		judgeFn: func(ctx context.Context, _ JudgeRequest) (JudgeResponse, error) {
			<-ctx.Done()
			return JudgeResponse{}, ctx.Err()
		},
	})

	ctx, cancel := context.WithTimeout(WithTenantID(context.Background(), "tenant-a"), 10*time.Millisecond)
	defer cancel()
	_, err := client.Judge(ctx, JudgeRequest{Model: "claude-3-5-sonnet"})
	if err == nil {
		t.Fatalf("expected timeout error")
	}

	snapshot := observer.snapshot()
	if len(snapshot.requests) != 1 {
		t.Fatalf("expected one request event, got %d", len(snapshot.requests))
	}
	if snapshot.requests[0].status != "timeout" {
		t.Fatalf("expected timeout status, got %q", snapshot.requests[0].status)
	}
	if len(snapshot.errors) != 1 {
		t.Fatalf("expected one error event, got %d", len(snapshot.errors))
	}
	if snapshot.errors[0].errorType != "timeout" {
		t.Fatalf("expected timeout error type, got %q", snapshot.errors[0].errorType)
	}
}

func TestInstrumentedClientNormalizesUnknownLabels(t *testing.T) {
	observer := &metricsObserverStub{}
	SetMetricsObserver(observer)
	defer SetMetricsObserver(nil)

	client := NewInstrumentedClient("   ", fakeJudgeClient{
		judgeFn: func(_ context.Context, _ JudgeRequest) (JudgeResponse, error) {
			return JudgeResponse{}, nil
		},
	})

	_, err := client.Judge(WithTenantID(context.Background(), "tenant-a"), JudgeRequest{Model: "  "})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}

	snapshot := observer.snapshot()
	if len(snapshot.requests) != 1 {
		t.Fatalf("expected one request event, got %d", len(snapshot.requests))
	}
	if snapshot.requests[0].provider != judgeUnknownLabel {
		t.Fatalf("expected provider %q, got %q", judgeUnknownLabel, snapshot.requests[0].provider)
	}
	if snapshot.requests[0].model != judgeUnknownLabel {
		t.Fatalf("expected model %q, got %q", judgeUnknownLabel, snapshot.requests[0].model)
	}
}

func TestInstrumentedClientResponseModelOverridesRequestModel(t *testing.T) {
	observer := &metricsObserverStub{}
	SetMetricsObserver(observer)
	defer SetMetricsObserver(nil)

	client := NewInstrumentedClient("openai", fakeJudgeClient{
		judgeFn: func(_ context.Context, _ JudgeRequest) (JudgeResponse, error) {
			return JudgeResponse{Model: "gpt-4.1-mini"}, nil
		},
	})

	_, err := client.Judge(WithTenantID(context.Background(), "tenant-a"), JudgeRequest{Model: "fallback-model"})
	if err != nil {
		t.Fatalf("judge: %v", err)
	}

	snapshot := observer.snapshot()
	if len(snapshot.requests) != 1 {
		t.Fatalf("expected one request event, got %d", len(snapshot.requests))
	}
	if snapshot.requests[0].model != "gpt-4.1-mini" {
		t.Fatalf("expected response model override, got %q", snapshot.requests[0].model)
	}
}

func TestNormalizeJudgeLabel(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: judgeUnknownLabel},
		{name: "whitespace", input: "   ", want: judgeUnknownLabel},
		{name: "trimmed", input: "  openai  ", want: "openai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeJudgeLabel(tt.input); got != tt.want {
				t.Fatalf("normalizeJudgeLabel(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

type fakeJudgeClient struct {
	judgeFn      func(ctx context.Context, req JudgeRequest) (JudgeResponse, error)
	listModelsFn func(ctx context.Context) ([]JudgeModel, error)
}

func (c fakeJudgeClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	if c.judgeFn == nil {
		return JudgeResponse{}, nil
	}
	return c.judgeFn(ctx, req)
}

func (c fakeJudgeClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	if c.listModelsFn == nil {
		return []JudgeModel{}, nil
	}
	return c.listModelsFn(ctx)
}

type metricsObserverStub struct {
	mu        sync.Mutex
	requests  []requestEvent
	durations []durationEvent
	tokens    []tokenEvent
	errors    []errorEvent
}

type requestEvent struct {
	tenantID string
	provider string
	model    string
	status   string
}

type durationEvent struct {
	tenantID string
	provider string
	model    string
	duration time.Duration
}

type tokenEvent struct {
	tenantID  string
	provider  string
	model     string
	direction string
	count     int64
}

type errorEvent struct {
	tenantID  string
	provider  string
	model     string
	errorType string
}

func (o *metricsObserverStub) ObserveJudgeRequest(tenantID, provider, model, status string) {
	o.mu.Lock()
	o.requests = append(o.requests, requestEvent{tenantID: tenantID, provider: provider, model: model, status: status})
	o.mu.Unlock()
}

func (o *metricsObserverStub) ObserveJudgeDuration(tenantID, provider, model string, duration time.Duration) {
	o.mu.Lock()
	o.durations = append(o.durations, durationEvent{tenantID: tenantID, provider: provider, model: model, duration: duration})
	o.mu.Unlock()
}

func (o *metricsObserverStub) ObserveJudgeTokens(tenantID, provider, model, direction string, count int64) {
	o.mu.Lock()
	o.tokens = append(o.tokens, tokenEvent{tenantID: tenantID, provider: provider, model: model, direction: direction, count: count})
	o.mu.Unlock()
}

func (o *metricsObserverStub) ObserveJudgeError(tenantID, provider, model, errorType string) {
	o.mu.Lock()
	o.errors = append(o.errors, errorEvent{tenantID: tenantID, provider: provider, model: model, errorType: errorType})
	o.mu.Unlock()
}

func (o *metricsObserverStub) snapshot() metricsObserverSnapshot {
	o.mu.Lock()
	defer o.mu.Unlock()
	return metricsObserverSnapshot{
		requests:  append([]requestEvent(nil), o.requests...),
		durations: append([]durationEvent(nil), o.durations...),
		tokens:    append([]tokenEvent(nil), o.tokens...),
		errors:    append([]errorEvent(nil), o.errors...),
	}
}

type metricsObserverSnapshot struct {
	requests  []requestEvent
	durations []durationEvent
	tokens    []tokenEvent
	errors    []errorEvent
}
